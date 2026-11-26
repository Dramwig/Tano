//! Native SMTP sender built on `lettre` + `tokio1-rustls-tls`.
//! Sends mail directly from the user's device using their own mail provider credentials
//! (preserving native SPF/DKIM alignment and avoiding any cloud relay burden).

use super::types::{
    is_blocked_ip, validate_email_address, MailAccount, MailAuthKind, MailCredentials,
    MailSendRequest, TlsMode, MAX_ATTACHMENT_BYTES,
};
use base64::Engine;
use lettre::message::{
    header::{ContentType, HeaderName, HeaderValue},
    Attachment, Mailbox, MultiPart, SinglePart,
};
use lettre::transport::smtp::authentication::{Credentials, Mechanism};
use lettre::transport::smtp::client::{Tls, TlsParameters};
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::net::ToSocketAddrs;
use std::time::Duration;

fn verify_smtp_host(host: &str, port: u16) -> Result<(), String> {
    let addrs = (host, port)
        .to_socket_addrs()
        .map_err(|_| format!("无法解析 SMTP 服务器域名：{host}"))?;
    let mut found = false;
    for addr in addrs {
        found = true;
        if is_blocked_ip(addr.ip()) {
            return Err("SMTP 服务器解析到受限的本地地址，已中止连接".into());
        }
    }
    if !found {
        return Err(format!("无法解析 SMTP 服务器域名：{host}"));
    }
    Ok(())
}

fn build_transport(
    account: &MailAccount,
    creds: &MailCredentials,
) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    verify_smtp_host(&account.smtp_host, account.smtp_port)?;
    let tls_params = TlsParameters::new(account.smtp_host.clone())
        .map_err(|_| "无法初始化 SMTP TLS 参数".to_string())?;
    let tls = match account.smtp_tls {
        TlsMode::Tls => Tls::Wrapper(tls_params),
        TlsMode::Starttls => Tls::Required(tls_params),
    };
    let username = if creds.username.trim().is_empty() {
        account.email.clone()
    } else {
        creds.username.clone()
    };
    let mut builder = AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&account.smtp_host)
        .port(account.smtp_port)
        .tls(tls)
        .timeout(Some(Duration::from_secs(20)));
    builder = match account.auth_kind {
        MailAuthKind::Password => {
            builder.credentials(Credentials::new(username, creds.password.clone()))
        }
        MailAuthKind::Oauth2Microsoft => {
            let access_token = creds
                .access_token
                .as_deref()
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .ok_or_else(|| "缺少 Outlook 访问令牌，请重新登录授权".to_string())?;
            builder
                .credentials(Credentials::new(username, access_token.to_string()))
                .authentication(vec![Mechanism::Xoauth2])
        }
    };
    Ok(builder.build())
}

pub async fn test_smtp(account: &MailAccount, creds: &MailCredentials) -> Result<(), String> {
    let transport = build_transport(account, creds)?;
    let ok = transport
        .test_connection()
        .await
        .map_err(|err| format!("SMTP 连接或认证失败：{}", summarize_smtp_error(&err)))?;
    if !ok {
        return Err("SMTP 服务器未响应 NOOP 测试".into());
    }
    Ok(())
}

pub async fn send_mail(
    account: &MailAccount,
    creds: &MailCredentials,
    req: &MailSendRequest,
) -> Result<(String, Vec<u8>), String> {
    if req.to.is_empty() && req.cc.is_empty() && req.bcc.is_empty() {
        return Err("请至少填写一位收件人".into());
    }
    if req.subject.len() > 500 {
        return Err("邮件主题过长".into());
    }

    let from_mailbox = Mailbox::new(
        if account.display_name.trim().is_empty() {
            None
        } else {
            Some(account.display_name.clone())
        },
        account
            .email
            .parse()
            .map_err(|_| "发件邮箱地址无效".to_string())?,
    );

    let domain = account
        .email
        .split_once('@')
        .map(|(_, d)| d)
        .unwrap_or("localhost");
    let message_id = format!("<tano-{}@{domain}>", uuid::Uuid::new_v4());

    let mut builder = Message::builder()
        .from(from_mailbox)
        .message_id(Some(message_id.clone()))
        .subject(req.subject.trim());

    for raw in &req.to {
        let addr = validate_email_address(raw)?;
        let mailbox: Mailbox = addr
            .parse()
            .map_err(|_| format!("收件人地址无效：{addr}"))?;
        builder = builder.to(mailbox);
    }
    for raw in &req.cc {
        let addr = validate_email_address(raw)?;
        let mailbox: Mailbox = addr.parse().map_err(|_| format!("抄送地址无效：{addr}"))?;
        builder = builder.cc(mailbox);
    }
    for raw in &req.bcc {
        let addr = validate_email_address(raw)?;
        let mailbox: Mailbox = addr.parse().map_err(|_| format!("密送地址无效：{addr}"))?;
        builder = builder.bcc(mailbox);
    }
    if let Some(reply_id) = req
        .in_reply_to
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
    {
        builder = builder.in_reply_to(wrap_angle_id(reply_id));
    }
    for reference in &req.references {
        let trimmed = reference.trim();
        if !trimmed.is_empty() {
            builder = builder.references(wrap_angle_id(trimmed));
        }
    }

    let text_part = SinglePart::plain(req.text_body.clone());
    let mut alt_body = if let Some(html) = req.html_body.as_deref().filter(|h| !h.trim().is_empty())
    {
        MultiPart::alternative()
            .singlepart(text_part)
            .singlepart(SinglePart::html(html.to_string()))
    } else {
        MultiPart::alternative().singlepart(text_part)
    };

    if let Some(ics) = req.calendar_ics.as_deref().filter(|v| !v.trim().is_empty()) {
        let method = req
            .calendar_method
            .as_deref()
            .map(|m| m.trim().to_ascii_uppercase())
            .filter(|m| matches!(m.as_str(), "REPLY" | "REQUEST" | "CANCEL" | "PUBLISH"))
            .unwrap_or_else(|| "REPLY".into());
        let ct = ContentType::parse(&format!("text/calendar; charset=utf-8; method={method}"))
            .map_err(|_| "无效的日历 MIME 类型".to_string())?;
        let cal_part = SinglePart::builder().header(ct).body(ics.to_string());
        alt_body = alt_body.singlepart(cal_part);
    }

    let message = if req.attachments.is_empty() {
        builder
            .multipart(alt_body)
            .map_err(|e| format!("构造邮件失败：{e}"))?
    } else {
        let mut mixed = MultiPart::mixed().multipart(alt_body);
        let mut total_bytes = 0usize;
        for att in &req.attachments {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(att.bytes_base64.as_bytes())
                .map_err(|_| format!("附件数据无效：{}", att.filename))?;
            if bytes.len() > MAX_ATTACHMENT_BYTES {
                return Err(format!("单个附件超过 25 MiB 上限：{}", att.filename));
            }
            total_bytes = total_bytes.saturating_add(bytes.len());
            if total_bytes > MAX_ATTACHMENT_BYTES * 2 {
                return Err("单封邮件附件总大小超过 50 MiB 上限".into());
            }
            let ct = ContentType::parse(&att.content_type)
                .unwrap_or(ContentType::parse("application/octet-stream").expect("static mime"));
            mixed = mixed.singlepart(Attachment::new(att.filename.clone()).body(bytes, ct));
        }
        builder
            .multipart(mixed)
            .map_err(|e| format!("构造带附件邮件失败：{e}"))?
    };

    let formatted = message.formatted();
    let transport = build_transport(account, creds)?;
    transport
        .send(message)
        .await
        .map_err(|err| format!("发送邮件失败：{}", summarize_smtp_error(&err)))?;
    let _ = (HeaderName::new_from_ascii_str, HeaderValue::new);
    Ok((message_id, formatted))
}

fn wrap_angle_id(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches(|c| c == '<' || c == '>');
    format!("<{trimmed}>")
}

fn summarize_smtp_error(err: &lettre::transport::smtp::Error) -> String {
    if err.is_permanent() {
        "认证失败或收件地址被服务器拒绝".into()
    } else if err.is_transient() {
        "服务器暂时不可用，请稍后重试".into()
    } else if err.is_timeout() {
        "连接超时，请检查网络与端口设置".into()
    } else {
        "网络或 TLS 握手失败".into()
    }
}
