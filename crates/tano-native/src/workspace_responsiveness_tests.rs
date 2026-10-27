//! Exercise real IPC dispatch while a workspace scan owns the session mutex.
use super::*;
use std::{sync::mpsc, time::Duration};

#[test]
fn document_commands_return_to_the_window_thread_while_a_scan_holds_the_session() {
    let app = tauri::test::mock_builder()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            read_document,
            write_document,
            create_folder,
            read_attachment
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap();
    let webview = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();

    for (command, body) in [
        ("read_document", serde_json::json!({ "path": "note.md" })),
        (
            "write_document",
            serde_json::json!({ "path": "note.md", "content": "draft", "expectedHash": "base" }),
        ),
        ("create_folder", serde_json::json!({ "path": "notes" })),
        (
            "read_attachment",
            serde_json::json!({ "workspaceId": "old-workspace", "path": "image.png" }),
        ),
    ] {
        let state = app.state::<AppState>();
        let scan = state.session.lock().unwrap();
        let (returned, dispatch) = mpsc::channel();
        let (resolved, response) = mpsc::channel();
        let window = webview.as_ref().clone();
        let caller = std::thread::spawn(move || {
            window.on_message(
                tauri::webview::InvokeRequest {
                    cmd: command.into(),
                    callback: tauri::ipc::CallbackFn(0),
                    error: tauri::ipc::CallbackFn(1),
                    url: "http://tauri.localhost".parse().unwrap(),
                    body: tauri::ipc::InvokeBody::Json(body),
                    headers: Default::default(),
                    invoke_key: tauri::test::INVOKE_KEY.into(),
                },
                Box::new(move |_, _, result, _, _| {
                    resolved.send(result).unwrap();
                }),
            );
            returned.send(()).unwrap();
        });
        let responsive = dispatch.recv_timeout(Duration::from_secs(2)).is_ok();
        // Always release the lock before asserting, including on regression.
        drop(scan);
        let response = response.recv_timeout(Duration::from_secs(5)).unwrap();
        caller.join().unwrap();
        assert!(
            responsive,
            "{command} blocked IPC dispatch on the session mutex"
        );
        match response {
            tauri::ipc::InvokeResponse::Err(error) => {
                assert_eq!(error.0, serde_json::json!("请先打开一个工作空间"));
            }
            tauri::ipc::InvokeResponse::Ok(_) => panic!("test has no open workspace"),
        }
    }
}
