//! A bounded, temporary IPv4 loopback receiver for a single native OAuth grant.
use std::time::Duration;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

pub struct Loopback {
    listener: TcpListener,
    host: String,
    path: String,
    pub redirect: String,
}
impl Loopback {
    pub async fn bind(provider: &str) -> Result<Self, String> {
        if !super::plugin_connection_types::valid_id(provider) {
            return Err("OAuth 服务标识无效".into());
        }
        let listener = TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .map_err(|_| "无法启动本机授权回调")?;
        let host = listener
            .local_addr()
            .map_err(|_| "无法读取本机回调端口")?
            .to_string();
        let path = format!("/tano/plugins/oauth/{provider}/callback");
        Ok(Self {
            redirect: format!("http://{host}{path}"),
            listener,
            host,
            path,
        })
    }
    pub async fn receive(&self, state: &str) -> Result<(TcpStream, Option<String>), String> {
        // Invalid probes never consume the grant. Bound their number as well as request bytes/time.
        for _ in 0..64 {
            let (mut stream, peer) = self
                .listener
                .accept()
                .await
                .map_err(|_| "读取本机授权回调失败")?;
            if !peer.ip().is_loopback() {
                continue;
            }
            let parsed = tokio::time::timeout(Duration::from_secs(2), async {
                let mut bytes = Vec::new();
                let mut chunk = [0_u8; 1024];
                loop {
                    let size = stream.read(&mut chunk).await.map_err(|_| ())?;
                    if size == 0 || bytes.len() + size > 8192 {
                        return Err(());
                    }
                    bytes.extend_from_slice(&chunk[..size]);
                    if bytes.windows(4).any(|part| part == b"\r\n\r\n") {
                        break;
                    }
                }
                parse(&bytes, &self.host, &self.path, state)
            })
            .await;
            if let Ok(Ok(code)) = parsed {
                return Ok((stream, code));
            }
            reply(stream, false).await;
        }
        Err("本机授权回调请求过多，请重新开始登录".into())
    }
}
fn parse(bytes: &[u8], host: &str, path: &str, state: &str) -> Result<Option<String>, ()> {
    let text = std::str::from_utf8(bytes).map_err(|_| ())?;
    let (head, body) = text.split_once("\r\n\r\n").ok_or(())?;
    if !body.is_empty() {
        return Err(());
    }
    let mut lines = head.split("\r\n");
    let request: Vec<_> = lines.next().ok_or(())?.split(' ').collect();
    if request.len() != 3 || request[0] != "GET" || !matches!(request[2], "HTTP/1.0" | "HTTP/1.1") {
        return Err(());
    }
    let target = request[1];
    if !target.starts_with('/') || target.starts_with("//") || target.contains(['\\', '#']) {
        return Err(());
    }
    let mut hosts = 0;
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(())?;
        if name.eq_ignore_ascii_case("host") {
            hosts += 1;
            if value.trim() != host {
                return Err(());
            }
        }
        if name.eq_ignore_ascii_case("transfer-encoding")
            || name.eq_ignore_ascii_case("content-length") && value.trim() != "0"
        {
            return Err(());
        }
    }
    if hosts != 1 {
        return Err(());
    }
    let (received_path, query) = target.split_once('?').ok_or(())?;
    if received_path != path {
        return Err(());
    }
    let url = tauri::Url::parse(&format!("http://{host}{target}")).map_err(|_| ())?;
    let mut received_state = None;
    let mut code = None;
    let mut error = None;
    for (name, value) in url.query_pairs() {
        let slot = match name.as_ref() {
            "state" => &mut received_state,
            "code" => &mut code,
            "error" => &mut error,
            _ => continue,
        };
        if slot.replace(value.into_owned()).is_some() {
            return Err(());
        }
    }
    if query.is_empty()
        || received_state.as_deref() != Some(state)
        || code.is_some() == error.is_some()
    {
        return Err(());
    }
    let value = code.as_ref().or(error.as_ref()).ok_or(())?;
    if value.is_empty() || value.len() > 4096 || !value.bytes().all(|b| (0x21..=0x7e).contains(&b))
    {
        return Err(());
    }
    Ok(code)
}
pub async fn reply(mut stream: TcpStream, success: bool) {
    let message = if success {
        "账号已连接。请返回同页，可以关闭此页面。"
    } else {
        "授权未完成或已失效。请返回同页重新连接。"
    };
    let body = format!("<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><meta name=\"referrer\" content=\"no-referrer\"><title>同页账号连接</title><p>{message}</p></html>");
    let status = if success { "200 OK" } else { "400 Bad Request" };
    let response = format!("HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'\r\n\r\n{body}", body.len());
    let _ = tokio::time::timeout(Duration::from_secs(2), async {
        stream.write_all(response.as_bytes()).await?;
        stream.shutdown().await
    })
    .await;
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_cross_origin_post_duplicate_state_and_header_smuggling() {
        let valid = |target: &str, headers: &str| {
            format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n{headers}\r\n")
        };
        assert_eq!(
            parse(
                valid("/callback?state=right&code=test-code", "").as_bytes(),
                "127.0.0.1:1234",
                "/callback",
                "right"
            ),
            Ok(Some("test-code".into()))
        );
        for target in [
            "/callback?state=wrong&code=test-code",
            "/callback?state=right&state=right&code=test-code",
            "/callback?state=right&code=x&error=denied",
            "/other?state=right&code=x",
            "http://evil.test/callback?state=right&code=x",
            "/callback?state=right&code=%0d%0aevil",
        ] {
            assert!(parse(
                valid(target, "").as_bytes(),
                "127.0.0.1:1234",
                "/callback",
                "right"
            )
            .is_err());
        }
        for headers in [
            "Host: evil.test\r\n",
            "Content-Length: 1\r\n",
            "Transfer-Encoding: chunked\r\n",
        ] {
            assert!(parse(
                valid("/callback?state=right&code=x", headers).as_bytes(),
                "127.0.0.1:1234",
                "/callback",
                "right"
            )
            .is_err());
        }
    }
    #[tokio::test]
    async fn real_loopback_ignores_invalid_state_accepts_one_callback_and_closes() {
        let receiver = Loopback::bind("test").await.unwrap();
        let redirect = receiver.redirect.clone();
        let task = tokio::spawn(async move {
            let (stream, code) = receiver.receive("test-state").await.unwrap();
            assert_eq!(code.as_deref(), Some("private-test-code"));
            reply(stream, true).await;
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let invalid = client
            .get(format!("{redirect}?state=wrong&code=forged"))
            .send()
            .await
            .unwrap();
        assert_eq!(invalid.status(), 400);
        let response = client
            .get(format!(
                "{redirect}?state=test-state&code=private-test-code"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200);
        assert_eq!(response.headers()["referrer-policy"], "no-referrer");
        assert!(!response.text().await.unwrap().contains("private-test-code"));
        task.await.unwrap();
        assert!(client.get(redirect).send().await.is_err());
    }
}
