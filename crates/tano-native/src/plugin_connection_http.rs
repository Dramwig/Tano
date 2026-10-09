use super::plugin_connection_types::{origin, Config, Request};
use base64::Engine;
use serde::Serialize;
use std::{
    net::{IpAddr, SocketAddr},
    time::Duration,
};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Response {
    pub status: u16,
    pub body: String,
    pub content_type: &'static str,
}
// Match the cloud provider's conservative public-unicast allowlist.
pub fn public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !(a == 0
                || a == 10
                || a == 127
                || a >= 224
                || a == 169 && b == 254
                || a == 172 && (16..=31).contains(&b)
                || a == 100 && (64..=127).contains(&b)
                || a == 192 && (b == 168 || b == 0 && (c == 0 || c == 2) || b == 88 && c == 99)
                || a == 198 && (b == 18 || b == 19 || b == 51 && c == 100)
                || a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            let segments = ip.segments();
            let (a, b) = (segments[0], segments[1]);
            (0x2000..0x3ffe).contains(&a)
                && a != 0x2002
                && !(a == 0x2001 && (b < 0x200 || b == 0xdb8))
        }
    }
}
fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .https_only(true)
        .no_proxy()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .referer(false)
        .timeout(Duration::from_secs(15))
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(0)
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .no_zstd()
        .tls_sslkeylogfile(false)
}
pub async fn prepare(config: &Config) -> Result<reqwest::Client, String> {
    prepare_origin(&config.origin).await
}
pub async fn prepare_origin(value: &str) -> Result<reqwest::Client, String> {
    let url = origin(value)?;
    let hostname = url
        .host_str()
        .ok_or("连接服务地址无效")?
        .trim_matches(['[', ']']);
    let port = url.port_or_known_default().ok_or("连接服务端口无效")?;
    let addresses: Vec<SocketAddr> = if let Ok(ip) = hostname.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::net::lookup_host((hostname, port))
            .await
            .map_err(|_| "无法解析插件服务地址")?
            .take(65)
            .collect()
    };
    if addresses.is_empty()
        || addresses.len() > 64
        || addresses.iter().any(|addr| !public_address(addr.ip()))
    {
        return Err("插件服务必须使用公共网络地址".into());
    }
    // Pin one validated address; TLS still authenticates the original URL hostname.
    builder()
        .resolve(hostname, addresses[0])
        .build()
        .map_err(|_| "无法建立插件服务连接".into())
}
pub async fn exchange_oauth(
    client: reqwest::Client,
    provider: &super::plugin_oauth_types::Provider,
    mut fields: Vec<(&str, String)>,
) -> Result<super::plugin_oauth_types::Tokens, String> {
    let failed = || "账号令牌交换失败，请重新连接；不会自动重复交换令牌".to_owned();
    fields.push(("client_id", provider.client_id.clone()));
    let mut response = client
        .post(&provider.token_endpoint)
        .header(reqwest::header::ACCEPT, "application/json")
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .header(reqwest::header::USER_AGENT, "Tano-Plugin/1")
        .form(&fields)
        .send()
        .await
        .map_err(|_| failed())?;
    if response.status().as_u16() != 200
        || response
            .headers()
            .get(reqwest::header::CONTENT_ENCODING)
            .is_some_and(|v| v != "identity")
        || !response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .is_some_and(|v| v.eq_ignore_ascii_case("application/json"))
            })
    {
        return Err(failed());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| failed())? {
        if bytes.len() + chunk.len() > 16 * 1024 {
            return Err(failed());
        }
        bytes.extend_from_slice(&chunk);
    }
    super::plugin_oauth_types::Tokens::parse(serde_json::from_slice(&bytes).map_err(|_| failed())?)
}
fn headers(config: &Config, secret: &str) -> Result<reqwest::header::HeaderMap, String> {
    use reqwest::header::*;
    let mut headers = HeaderMap::new();
    let (name, value) = if config.authentication == "bearer" {
        (AUTHORIZATION, format!("Bearer {secret}"))
    } else {
        (
            HeaderName::from_bytes(config.authentication.as_bytes())
                .map_err(|_| "连接认证方式无效")?,
            secret.into(),
        )
    };
    let mut value = HeaderValue::from_str(&value).map_err(|_| "连接密钥无效")?;
    value.set_sensitive(true);
    headers.insert(name, value);
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/plain"),
    );
    headers.insert(ACCEPT_ENCODING, HeaderValue::from_static("identity"));
    headers.insert(USER_AGENT, HeaderValue::from_static("Tano-Plugin/1"));
    Ok(headers)
}
pub async fn send(
    client: reqwest::Client,
    config: &Config,
    secret: &str,
    request: &Request,
) -> Result<Response, String> {
    let url = origin(&config.origin)?
        .join(&request.path)
        .map_err(|_| "连接请求地址无效")?;
    let method =
        reqwest::Method::from_bytes(request.method.as_bytes()).map_err(|_| "连接请求方法无效")?;
    let mut outgoing = client
        .request(method, url)
        .headers(headers(config, secret)?);
    if let Some(body) = &request.body {
        outgoing = outgoing.json(body);
    }
    let mut incoming = outgoing
        .send()
        .await
        .map_err(|_| "插件服务请求失败；已发送的写入可能已生效，请先核对结果")?;
    let status = incoming.status().as_u16();
    if (300..400).contains(&status) {
        return Err("插件服务重定向已被拒绝".into());
    }
    if incoming
        .headers()
        .get(reqwest::header::CONTENT_ENCODING)
        .is_some_and(|v| v != "identity")
    {
        return Err("插件服务返回了不支持的压缩响应".into());
    }
    let content_type = if incoming
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.split(';').next() == Some("application/json"))
    {
        "application/json"
    } else {
        "text/plain"
    };
    let mut bytes = Vec::new();
    while let Some(chunk) = incoming
        .chunk()
        .await
        .map_err(|_| "读取插件服务响应失败；已发送的写入可能已生效")?
    {
        if bytes.len() + chunk.len() > 256 * 1024 {
            return Err("插件服务响应超过 256 KiB".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    reject_echo(&body, secret)?;
    Ok(Response {
        status,
        body,
        content_type,
    })
}
fn reject_echo(body: &str, secret: &str) -> Result<(), String> {
    let quoted = serde_json::to_string(secret).map_err(|_| "连接密钥无效")?;
    const COMPONENT: &percent_encoding::AsciiSet = &percent_encoding::NON_ALPHANUMERIC
        .remove(b'-')
        .remove(b'_')
        .remove(b'.')
        .remove(b'!')
        .remove(b'~')
        .remove(b'*')
        .remove(b'\'')
        .remove(b'(')
        .remove(b')');
    let percent = percent_encoding::utf8_percent_encode(secret, COMPONENT).to_string();
    let hex: String = secret
        .as_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    let encoded = base64::engine::general_purpose::STANDARD.encode(secret);
    if [
        secret,
        &quoted[1..quoted.len() - 1],
        &percent,
        &hex,
        &encoded,
    ]
    .iter()
    .any(|value| body.contains(value))
    {
        return Err("服务响应包含敏感凭据，已阻止返回".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn pinned_tls_transport_validates_certificates_and_bounds_responses_without_retry_or_redirect(
    ) {
        use std::{
            io::{BufRead, BufReader},
            process::{Child, Command, Stdio},
        };
        struct Peer(Child);
        impl Drop for Peer {
            fn drop(&mut self) {
                let _ = self.0.kill();
                let _ = self.0.wait();
            }
        }
        let directory =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/fixtures/plugin-tls");
        let mut command = Command::new("node");
        command
            .arg(directory.join("server.cjs"))
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }
        let mut peer = Peer(
            command
                .spawn()
                .expect("Node.js is required by the TLS test peer"),
        );
        let mut line = String::new();
        BufReader::new(peer.0.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let port = line.trim().parse::<u16>().unwrap();
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let config = Config {
            plugin_id: "test".into(),
            origin: format!("https://connection.test:{port}"),
            integrity: "a".repeat(64),
            methods: vec!["GET".into(), "POST".into()],
            path_prefix: "/v1/".into(),
            authentication: "bearer".into(),
        };
        let request = |path: &str| Request {
            path: path.into(),
            method: "GET".into(),
            body: None,
        };
        let untrusted = builder().resolve("connection.test", addr).build().unwrap();
        assert!(
            send(untrusted, &config, "public-test-secret", &request("/v1/ok"))
                .await
                .is_err()
        );
        let cert =
            reqwest::Certificate::from_pem(&std::fs::read(directory.join("ca.pem")).unwrap())
                .unwrap();
        let client = builder()
            .tls_certs_only([cert])
            .resolve("connection.test", addr)
            .build()
            .unwrap();
        for iteration in 1..=2 {
            let result = send(
                client.clone(),
                &config,
                "public-test-secret",
                &Request {
                    path: "/v1/ok".into(),
                    method: "POST".into(),
                    body: Some(serde_json::json!({"title":"中文"})),
                },
            )
            .await
            .unwrap();
            assert_eq!(result.content_type, "application/json");
            let body: serde_json::Value = serde_json::from_str(&result.body).unwrap();
            assert_eq!(body["count"], iteration);
            assert_eq!(body["authorized"], true);
            assert!(body["cookie"].is_null());
            assert_eq!(body["method"], "POST");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(body["body"].as_str().unwrap()).unwrap()
                    ["title"],
                "中文"
            );
        }
        for (path, expected) in [
            ("/v1/redirect", "重定向"),
            ("/v1/echo", "敏感凭据"),
            ("/v1/huge", "256 KiB"),
            ("/v1/compressed", "压缩"),
        ] {
            let error = send(
                client.clone(),
                &config,
                "public-test-secret",
                &request(path),
            )
            .await
            .err()
            .unwrap();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("public-test-secret"));
        }
        assert!(tokio::time::timeout(
            Duration::from_millis(100),
            send(
                client.clone(),
                &config,
                "public-test-secret",
                &request("/v1/slow")
            )
        )
        .await
        .is_err());
        let result = send(
            client.clone(),
            &config,
            "public-test-secret",
            &request("/v1/ok"),
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&result.body).unwrap()["count"],
            8
        );
        let provider = super::super::plugin_oauth_types::Provider {
            id: "test".into(),
            label: "测试".into(),
            origin: config.origin.clone(),
            scopes: vec![],
            authorization_endpoint: format!("{}/oauth/authorize", config.origin),
            token_endpoint: format!("{}/oauth/token", config.origin),
            client_id: "test-native-client".into(),
        };
        let tokens = exchange_oauth(
            client.clone(),
            &provider,
            vec![
                ("grant_type", "authorization_code".into()),
                ("code", "public-test-code".into()),
                ("code_verifier", "v".repeat(43)),
            ],
        )
        .await
        .unwrap();
        assert_eq!(tokens.access_token, "public-test-access-token");
        let refreshed = exchange_oauth(
            client.clone(),
            &provider,
            vec![
                ("grant_type", "refresh_token".into()),
                ("refresh_token", tokens.refresh_token.unwrap()),
            ],
        )
        .await
        .unwrap();
        assert_eq!(
            refreshed.refresh_token.as_deref(),
            Some("public-rotated-refresh-token")
        );
        let error = exchange_oauth(
            client.clone(),
            &provider,
            vec![
                ("grant_type", "authorization_code".into()),
                ("code", "invalid".into()),
            ],
        )
        .await
        .err()
        .unwrap();
        assert!(!error.contains("must-not-return-sensitive-detail"));
        for path in ["/v1/redirect", "/v1/huge", "/v1/compressed"] {
            let mut bad = provider.clone();
            bad.token_endpoint = format!("{}{path}", config.origin);
            assert!(exchange_oauth(client.clone(), &bad, vec![]).await.is_err());
        }
    }
    #[test]
    fn rejects_nonpublic_addresses_and_common_secret_echoes() {
        for address in [
            "0.0.0.0",
            "10.0.0.1",
            "127.0.0.1",
            "100.64.0.1",
            "172.16.0.1",
            "169.254.169.254",
            "192.168.1.1",
            "192.0.2.1",
            "198.18.0.1",
            "198.51.100.1",
            "203.0.113.1",
            "224.0.0.1",
            "255.255.255.255",
            "::1",
            "::ffff:8.8.8.8",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "2002:808:808::1",
            "2001::1",
        ] {
            assert!(!public_address(address.parse().unwrap()), "{address}");
        }
        for address in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(public_address(address.parse().unwrap()));
        }
        let secret = "example_key#123";
        for text in [
            secret.into(),
            "example_key%23123".into(),
            base64::engine::general_purpose::STANDARD.encode(secret),
            secret
                .as_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
        ] {
            assert!(reject_echo(&text, secret).is_err());
        }
        reject_echo("ordinary response", secret).unwrap();
    }
    #[tokio::test]
    async fn refuses_loopback_before_network_and_marks_all_auth_headers_sensitive() {
        let mut config = Config {
            plugin_id: "test".into(),
            origin: "https://127.0.0.1".into(),
            integrity: "a".repeat(64),
            methods: vec!["GET".into()],
            path_prefix: "/".into(),
            authentication: "bearer".into(),
        };
        assert!(prepare(&config).await.is_err());
        for auth in ["bearer", "x-api-key", "api-key", "private-token"] {
            config.authentication = auth.into();
            let headers = headers(&config, "test-key-secret").unwrap();
            let value = &headers[if auth == "bearer" {
                "authorization"
            } else {
                auth
            }];
            assert!(value.is_sensitive());
            assert!(!format!("{headers:?}").contains("test-key-secret"));
            assert!(!headers.contains_key("cookie"));
        }
    }
}
