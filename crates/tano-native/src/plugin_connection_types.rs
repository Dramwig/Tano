//! The native boundary validates again; a webview is not a credential authority.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Url;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub plugin_id: String,
    pub origin: String,
    pub integrity: String,
    pub methods: Vec<String>,
    pub path_prefix: String,
    pub authentication: String,
}
#[derive(Deserialize)]
pub struct Input {
    #[serde(flatten)]
    pub config: Config,
    pub secret: Option<String>,
    pub version: Option<String>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Connection {
    #[serde(flatten)]
    pub config: Config,
    pub version: String,
    pub updated_at: String,
    pub has_secret: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub oauth: Option<OAuthMetadata>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OAuthMetadata {
    pub provider_id: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    pub path: String,
    #[serde(default = "get")]
    pub method: String,
    // Preserve explicit JSON null as a body, unlike Option<Value> deserialization.
    #[serde(default, deserialize_with = "body")]
    pub body: Option<Value>,
}
fn body<'de, D: serde::Deserializer<'de>>(value: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(value).map(Some)
}
fn get() -> String {
    "GET".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn validates_native_inputs_and_canonical_path_scope() {
        let value = json!({"pluginId":"importer", "origin":"https://api.example.test", "integrity":"a".repeat(64), "methods":["GET","POST"], "pathPrefix":"/v1/", "authentication":"bearer", "secret":"private-test-secret"});
        let config = input(value.clone()).unwrap().config;
        for (key, invalid) in [
            ("pluginId", json!("../bad")),
            ("secret", json!(null)),
            ("secret", json!("token\r\nx:inject")),
            ("version", json!("old")),
            ("methods", json!(["GET", "GET"])),
            ("pathPrefix", json!("/v1/../")),
            ("pathPrefix", json!("/v1")),
            ("origin", json!("https://api.example.test/")),
            ("origin", json!("https://user@api.example.test")),
            ("extra", json!(true)),
        ] {
            let mut invalid_value = value.clone();
            invalid_value[key] = invalid;
            assert!(input(invalid_value).is_err(), "{key}");
        }
        for path in [
            "//elsewhere.test/path",
            "/v1/../private",
            "/v1/%252e",
            "/v1/%2Fprivate",
            "/v1/\\private",
            "/v1/?bad#fragment",
        ] {
            let mut request: Request = serde_json::from_value(json!({"path":path})).unwrap();
            assert!(request.validate(&config).is_err(), "{path}");
        }
        for request in [
            json!({"path":"/v1/item", "method":"GET", "body":null}),
            json!({"path":"/v1/item", "method":"DELETE"}),
            json!({"path":"/v1/item", "method":"POST", "body":"x".repeat(65537)}),
        ] {
            assert!(serde_json::from_value::<Request>(request)
                .unwrap()
                .validate(&config)
                .is_err());
        }
        assert!(serde_json::from_value::<Request>(
            json!({"path":"/v1/item", "headers":{"Authorization":"evil"}})
        )
        .is_err());
        let mut request: Request =
            serde_json::from_value(json!({"path":"/v1/a?query=%23", "method":"POST", "body":null}))
                .unwrap();
        request.validate(&config).unwrap();
        assert_eq!(request.body, Some(Value::Null));
    }
}
pub fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 40
        && id.as_bytes()[0].is_ascii_lowercase()
        && id
            .bytes()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
}
pub fn valid_hash(hash: &str) -> bool {
    hash.len() == 64
        && hash
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}
pub fn valid_secret(secret: &str) -> bool {
    (8..=4096).contains(&secret.len()) && secret.bytes().all(|c| (0x21..=0x7e).contains(&c))
}
pub fn origin(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|_| "连接来源无效")?;
    if value.len() > 250
        || url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.origin().ascii_serialization() != value
    {
        return Err("连接来源必须为不含路径或凭据的 HTTPS 来源".into());
    }
    Ok(url)
}
fn method(value: &str) -> bool {
    matches!(value, "GET" | "POST" | "PUT" | "PATCH" | "DELETE")
}
pub fn path(value: &str) -> Result<String, String> {
    if value.is_empty()
        || value.len() > 2048
        || !value.starts_with('/')
        || value.starts_with("//")
        || value
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || c == '\\' || c == '#')
    {
        return Err("连接请求路径无效".into());
    }
    let url = Url::parse("https://connection.invalid")
        .unwrap()
        .join(value)
        .map_err(|_| "连接请求路径无效")?;
    let bytes = url.path().as_bytes();
    for part in bytes.windows(3).filter(|part| part[0] == b'%') {
        if let Ok(code) = u8::from_str_radix(std::str::from_utf8(&part[1..]).unwrap_or(""), 16) {
            if code < 32 || [0x7f, 0x25, 0x2e, 0x2f, 0x5c].contains(&code) {
                return Err("连接路径不能包含编码的控制字符、路径分隔符或跳转".into());
            }
        }
    }
    Ok(format!(
        "{}{}",
        url.path(),
        url.query().map(|q| format!("?{q}")).unwrap_or_default()
    ))
}
impl Config {
    pub fn validate(&self) -> Result<(), String> {
        origin(&self.origin)?;
        let normalized = path(&self.path_prefix)?;
        if !valid_id(&self.plugin_id)
            || !valid_hash(&self.integrity)
            || self.methods.is_empty()
            || self.methods.len() > 5
            || self.methods.iter().any(|m| !method(m))
            || self
                .methods
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len()
                != self.methods.len()
            || normalized != self.path_prefix
            || self.path_prefix.contains('?')
            || !self.path_prefix.ends_with('/')
            || !matches!(
                self.authentication.as_str(),
                "bearer" | "x-api-key" | "api-key" | "private-token"
            )
        {
            return Err("连接设置无效".into());
        }
        Ok(())
    }
}
pub fn input(value: Value) -> Result<Input, String> {
    let object = value.as_object().ok_or("连接设置无效")?;
    if object.keys().any(|key| {
        ![
            "pluginId",
            "origin",
            "integrity",
            "methods",
            "pathPrefix",
            "authentication",
            "secret",
            "version",
        ]
        .contains(&key.as_str())
    }) || ["secret", "version"]
        .iter()
        .any(|key| object.get(*key).is_some_and(|v| !v.is_string()))
    {
        return Err("连接设置无效".into());
    }
    let input: Input = serde_json::from_value(value).map_err(|_| "连接设置无效")?;
    input.config.validate()?;
    if input.secret.as_deref().is_some_and(|v| !valid_secret(v))
        || input
            .version
            .as_deref()
            .is_some_and(|v| uuid::Uuid::parse_str(v).is_err())
    {
        return Err("连接密钥或版本无效".into());
    }
    Ok(input)
}
impl Request {
    pub fn validate(&mut self, config: &Config) -> Result<(), String> {
        self.path = path(&self.path)?;
        let pathname = self.path.split('?').next().unwrap_or("");
        if !method(&self.method)
            || !config.methods.contains(&self.method)
            || !pathname.starts_with(&config.path_prefix)
        {
            return Err("此连接未授权请求的方法或路径".into());
        }
        if self.method == "GET" && self.body.is_some()
            || self
                .body
                .as_ref()
                .is_some_and(|v| serde_json::to_vec(v).map_or(true, |b| b.len() > 64 * 1024))
        {
            return Err("连接请求正文无效或超过 64 KiB".into());
        }
        Ok(())
    }
}
