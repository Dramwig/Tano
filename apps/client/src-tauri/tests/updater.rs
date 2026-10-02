#![cfg(not(any(target_os = "android", target_os = "ios")))]
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::Duration,
};
use tauri_plugin_updater::UpdaterExt;

struct Feed {
    url: String,
    stop: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<()>>,
}
impl Drop for Feed {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        self.thread.take().unwrap().join().unwrap();
    }
}
fn feed(version: &str, payload: &[u8]) -> Feed {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let manifest = serde_json::to_vec(&serde_json::json!({
        "version": version,
        "platforms": { "test": {
            "url": format!("{url}/payload"),
            "signature": include_str!("../test-fixtures/updater/payload.txt.sig").trim()
        }}
    }))
    .unwrap();
    let payload = payload.to_vec();
    let stop = Arc::new(AtomicBool::new(false));
    let shutdown = stop.clone();
    let thread = thread::spawn(move || {
        while !shutdown.load(Ordering::Relaxed) {
            let Ok((mut stream, _)) = listener.accept() else {
                thread::sleep(Duration::from_millis(5));
                continue;
            };
            // Windows accepted sockets inherit the listener's nonblocking mode.
            stream.set_nonblocking(false).unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(3)))
                .unwrap();
            let mut request = [0; 8192];
            let n = stream.read(&mut request).unwrap();
            let body = if request[..n].starts_with(b"GET /payload ") {
                &payload
            } else {
                &manifest
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            )
            .unwrap();
            stream.write_all(body).unwrap();
        }
    });
    Feed {
        url,
        stop,
        thread: Some(thread),
    }
}

#[test]
fn real_download_rejects_tampering_and_manifest_version_substitution() {
    let mut context = tauri::test::mock_context(tauri::test::noop_assets());
    // Only this loopback fixture enables HTTP. Production always enforces HTTPS.
    context.config_mut().plugins.0.insert(
        "updater".into(),
        serde_json::json!({
            "pubkey": include_str!("../test-fixtures/updater/public-key.txt").trim(),
            "requireSignedVersion": true,
            "dangerousInsecureTransportProtocol": true
        }),
    );
    let app = tauri::test::mock_builder()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .build(context)
        .unwrap();
    let original = include_bytes!("../test-fixtures/updater/payload.txt");
    for (version, payload, valid) in [
        ("9.9.9", original.as_slice(), true),
        ("9.9.9", b"tampered".as_slice(), false),
        ("10.0.0", original.as_slice(), false),
    ] {
        let feed = feed(version, payload);
        tauri::async_runtime::block_on(async {
            let update = app
                .updater_builder()
                .target("test")
                .no_proxy()
                .endpoints(vec![format!("{}/manifest", feed.url).parse().unwrap()])
                .unwrap()
                .build()
                .unwrap()
                .check()
                .await
                .unwrap()
                .unwrap();
            let result = update.download(|_, _| {}, || {}).await;
            assert_eq!(result.is_ok(), valid, "{version}: {result:?}");
            if valid {
                assert_eq!(result.unwrap(), original);
            }
        });
    }
    let older = feed("0.0.0", original);
    tauri::async_runtime::block_on(async {
        assert!(app
            .updater_builder()
            .target("test")
            .no_proxy()
            .endpoints(vec![format!("{}/manifest", older.url).parse().unwrap()])
            .unwrap()
            .build()
            .unwrap()
            .check()
            .await
            .unwrap()
            .is_none());
    });
}
