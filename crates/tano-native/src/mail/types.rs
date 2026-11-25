//! Shared DTOs, provider presets, and strict host/address validation for the desktop mail client.

use serde::{Deserialize, Serialize};
use std::net::IpAddr;

pub const DEFAULT_CACHE_LIMIT_BYTES: u64 = 500 * 1024 * 1024;
pub const MAX_ATTACHMENT_BYTES: usize = 25 * 1024 * 1024;
pub const INITIAL_SYNC_DAYS: u32 = 30;
pub const INITIAL_SYNC_LIMIT: usize = 200;

pub const FLAG_SEEN: u32 = 1 << 0;
pub const FLAG_FLAGGED: u32 = 1 << 1;
pub const FLAG_ANSWERED: u32 = 1 << 2;
pub const FLAG_DRAFT: u32 = 1 << 3;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TlsMode {
    Tls,
    Starttls,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AppendSentPolicy {
    Auto,
    Never,
    Always,
}

impl Default for AppendSentPolicy {
    fn default() -> Self {
        Self::Auto
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailPreset {
    pub id: String,
    pub name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_tls: TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_tls: TlsMode,
    pub append_sent: AppendSentPolicy,
    pub send_imap_id: bool,
    pub auth_hint: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccount {
    pub id: String,
    pub provider: String,
    pub label: String,
    pub email: String,
    pub display_name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_tls: TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_tls: TlsMode,
    #[serde(default)]
    pub append_sent: AppendSentPolicy,
    #[serde(default)]
    pub send_imap_id: bool,
    #[serde(default)]
    pub created_at: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAccountInput {
    pub id: Option<String>,
    pub provider: String,
    pub label: String,
    pub email: String,
    #[serde(default)]
    pub display_name: String,
    pub imap_host: String,
    pub imap_port: u16,
    pub imap_tls: TlsMode,
    pub smtp_host: String,
    pub smtp_port: u16,
    pub smtp_tls: TlsMode,
    #[serde(default)]
    pub append_sent: AppendSentPolicy,
    #[serde(default)]
    pub send_imap_id: bool,
}

/// Sensitive credentials are only accepted as command input or read from the OS keyring.
/// They are never serialized back to the WebView or written to disk.
#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailCredentials {
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub password: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailTestResult {
    pub imap_ok: bool,
    pub smtp_ok: bool,
    pub folder_count: usize,
    pub message: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailFolder {
    pub id: String,
    pub account_id: String,
    pub remote_name: String,
    pub display_name: String,
    pub special_use: Option<String>,
    pub uid_validity: Option<u32>,
    pub uid_next: Option<u32>,
    pub unread_count: u32,
    pub total_count: u32,
    pub synced_at: Option<i64>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAddress {
    pub name: String,
    pub address: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessageSummary {
    pub id: String,
    pub account_id: String,
    pub folder_id: String,
    pub uid: u32,
    pub message_id: String,
    pub thread_key: String,
    pub subject: String,
    pub from: Vec<MailAddress>,
    pub to: Vec<MailAddress>,
    pub date_ts: i64,
    pub snippet: String,
    pub seen: bool,
    pub flagged: bool,
    pub answered: bool,
    pub has_attachments: bool,
    pub has_ics: bool,
    pub body_fetched: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentInfo {
    pub id: String,
    pub message_id: String,
    pub part_id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub cid: Option<String>,
    pub is_inline: bool,
    pub downloaded: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailCalendarInvite {
    pub id: String,
    pub message_id: String,
    pub ics_uid: String,
    pub method: String,
    pub summary: String,
    pub raw_ics: String,
    pub imported_object_id: Option<String>,
    pub rsvp_status: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessageDetail {
    pub summary: MailMessageSummary,
    pub cc: Vec<MailAddress>,
    pub reply_to: Vec<MailAddress>,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub text_body: String,
    pub html_sanitized: String,
    pub has_remote_images: bool,
    pub attachments: Vec<MailAttachmentInfo>,
    pub invites: Vec<MailCalendarInvite>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSyncSummary {
    pub account_id: String,
    pub folders_synced: usize,
    pub messages_added: usize,
    pub synced_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailFlagsPatch {
    pub seen: Option<bool>,
    pub flagged: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSendAttachment {
    pub filename: String,
    pub content_type: String,
    pub bytes_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSendRequest {
    pub account_id: String,
    pub to: Vec<String>,
    #[serde(default)]
    pub cc: Vec<String>,
    #[serde(default)]
    pub bcc: Vec<String>,
    pub subject: String,
    pub text_body: String,
    #[serde(default)]
    pub html_body: Option<String>,
    #[serde(default)]
    pub in_reply_to: Option<String>,
    #[serde(default)]
    pub references: Vec<String>,
    #[serde(default)]
    pub attachments: Vec<MailSendAttachment>,
    #[serde(default)]
    pub calendar_ics: Option<String>,
    #[serde(default)]
    pub calendar_method: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailSendResult {
    pub message_id: String,
    pub appended_to_sent: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailDownloadedAttachment {
    pub id: String,
    pub filename: String,
    pub content_type: String,
    pub size_bytes: u64,
    pub bytes_base64: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailCacheStats {
    pub message_count: u64,
    pub cached_body_bytes: u64,
    pub cached_attachment_bytes: u64,
    pub limit_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailDraft {
    pub id: String,
    pub account_id: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub markdown_body: String,
    pub in_reply_to: Option<String>,
    pub references: Vec<String>,
    pub updated_at: i64,
}

pub fn mail_presets() -> Vec<MailPreset> {
    vec![
        MailPreset {
            id: "qq".into(),
            name: "QQ 邮箱".into(),
            imap_host: "imap.qq.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.qq.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Never,
            send_imap_id: false,
            auth_hint: "请在 QQ 邮箱网页版「设置 → 账号 → POP3/IMAP/SMTP」开启 IMAP/SMTP，并填入 16 位授权码（非 QQ 密码）。".into(),
        },
        MailPreset {
            id: "netease-163".into(),
            name: "网易 163 邮箱".into(),
            imap_host: "imap.163.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.163.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Auto,
            send_imap_id: true,
            auth_hint: "请在网易邮箱「设置 → POP3/SMTP/IMAP」开启 IMAP/SMTP 服务，并填入客户端授权密码。".into(),
        },
        MailPreset {
            id: "netease-126".into(),
            name: "网易 126 邮箱".into(),
            imap_host: "imap.126.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.126.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Auto,
            send_imap_id: true,
            auth_hint: "请在 126 邮箱「设置 → POP3/SMTP/IMAP」开启 IMAP/SMTP 服务，并填入客户端授权密码。".into(),
        },
        MailPreset {
            id: "gmail".into(),
            name: "Gmail".into(),
            imap_host: "imap.gmail.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.gmail.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Never,
            send_imap_id: false,
            auth_hint: "请先在 Google 账号开启两步验证，然后生成 16 位「应用专用密码（App Password）」填入此处。".into(),
        },
        MailPreset {
            id: "icloud".into(),
            name: "iCloud 邮件".into(),
            imap_host: "imap.mail.me.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.mail.me.com".into(),
            smtp_port: 587,
            smtp_tls: TlsMode::Starttls,
            append_sent: AppendSentPolicy::Never,
            send_imap_id: false,
            auth_hint: "请使用 Apple 账号与在 account.apple.com 生成的 App 专用密码。".into(),
        },
        MailPreset {
            id: "tencent-exmail".into(),
            name: "腾讯企业邮".into(),
            imap_host: "imap.exmail.qq.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.exmail.qq.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Never,
            send_imap_id: false,
            auth_hint: "若企业已开启安全登录，请在网页版邮箱生成客户端专用密码。".into(),
        },
        MailPreset {
            id: "aliyun-mail".into(),
            name: "阿里企业邮".into(),
            imap_host: "imap.qiye.aliyun.com".into(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: "smtp.qiye.aliyun.com".into(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Auto,
            send_imap_id: false,
            auth_hint: "请在阿里邮箱网页端开启第三方客户端安全密码并填入。".into(),
        },
        MailPreset {
            id: "custom".into(),
            name: "自定义 IMAP / SMTP".into(),
            imap_host: String::new(),
            imap_port: 993,
            imap_tls: TlsMode::Tls,
            smtp_host: String::new(),
            smtp_port: 465,
            smtp_tls: TlsMode::Tls,
            append_sent: AppendSentPolicy::Auto,
            send_imap_id: false,
            auth_hint: "填写邮箱服务商提供的加密 IMAP 与 SMTP 地址（仅支持 TLS 或 STARTTLS）。".into(),
        },
    ]
}

pub fn validate_email_address(value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 254
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("邮箱地址格式无效".into());
    }
    let Some((local, domain)) = trimmed.split_once('@') else {
        return Err("邮箱地址缺少 @ 域名部分".into());
    };
    if local.is_empty() || domain.len() < 3 || !domain.contains('.') || domain.contains('@') {
        return Err("邮箱地址格式无效".into());
    }
    Ok(trimmed.to_string())
}

pub fn validate_host_and_port(host: &str, port: u16, label: &str) -> Result<String, String> {
    let trimmed = host.trim().to_ascii_lowercase();
    if trimmed.is_empty() || trimmed.len() > 253 {
        return Err(format!("{label}服务器地址无效"));
    }
    if port == 0 {
        return Err(format!("{label}端口无效"));
    }
    if trimmed.contains("://")
        || trimmed.contains('/')
        || trimmed.contains('@')
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err(format!("{label}请只填写主机域名，不要包含协议或路径"));
    }
    if trimmed == "localhost" || trimmed.ends_with(".localhost") || trimmed.ends_with(".local") {
        return Err(format!("{label}不允许连接本机或局域网保留域名"));
    }
    if let Ok(ip) = trimmed.parse::<IpAddr>() {
        if is_blocked_ip(ip) {
            return Err(format!("{label}不允许连接本机或链路本地地址"));
        }
    }
    Ok(trimmed)
}

pub fn is_blocked_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback()
                || v4.is_link_local()
                || v4.is_unspecified()
                || v4.is_broadcast()
                || v4.is_multicast()
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

pub fn validate_account_input(input: &MailAccountInput) -> Result<MailAccountInput, String> {
    let label = input.label.trim().to_string();
    if label.is_empty() || label.len() > 120 {
        return Err("请填写 1–120 字的邮箱名称".into());
    }
    let email = validate_email_address(&input.email)?;
    let imap_host = validate_host_and_port(&input.imap_host, input.imap_port, "IMAP")?;
    let smtp_host = validate_host_and_port(&input.smtp_host, input.smtp_port, "SMTP")?;
    let display_name = input
        .display_name
        .trim()
        .chars()
        .take(120)
        .collect::<String>();
    let provider = input.provider.trim().to_string();
    if provider.is_empty() || provider.len() > 64 {
        return Err("邮箱服务商标识无效".into());
    }
    Ok(MailAccountInput {
        id: input.id.clone().filter(|value| !value.trim().is_empty()),
        provider,
        label,
        email,
        display_name,
        imap_host,
        imap_port: input.imap_port,
        imap_tls: input.imap_tls.clone(),
        smtp_host,
        smtp_port: input.smtp_port,
        smtp_tls: input.smtp_tls.clone(),
        append_sent: input.append_sent.clone(),
        send_imap_id: input.send_imap_id,
    })
}

pub fn unix_timestamp_secs() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}
