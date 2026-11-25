//! RFC 5322 / MIME parsing, GBK/UTF-8 decoding, Modified UTF-7 folder decoding,
//! iCalendar (.ics) extraction, and strict HTML sanitization (with remote image blocking).

use super::store::{ParsedAttachmentRecord, ParsedBodyPayload, ParsedInviteRecord};
use super::types::{MailAddress, MAX_ATTACHMENT_BYTES};
use base64::Engine;
use mail_parser::{Address, HeaderValue, Message, MessageParser, MimeHeaders};
use std::collections::{HashMap, HashSet};

const MAX_INLINE_CACHE_BYTES: usize = 4 * 1024 * 1024;
const MAX_BODY_CHARS: usize = 2 * 1024 * 1024;

pub fn parse_rfc822_body(raw: &[u8]) -> ParsedBodyPayload {
    let Some(message) = MessageParser::default().parse(raw) else {
        let fallback = String::from_utf8_lossy(raw)
            .chars()
            .take(40_000)
            .collect::<String>();
        let snippet = make_snippet(&fallback);
        return ParsedBodyPayload {
            text_body: fallback,
            html_sanitized: String::new(),
            snippet,
            has_remote_images: false,
            attachments: Vec::new(),
            invites: Vec::new(),
        };
    };

    let text_body = message
        .body_text(0)
        .map(|s| s.chars().take(MAX_BODY_CHARS).collect::<String>())
        .unwrap_or_default();

    let mut attachments = Vec::new();
    let mut invites = Vec::new();
    let mut inline_cid_map: HashMap<String, String> = HashMap::new();

    for (index, part) in message.attachments().enumerate() {
        let content_type = part
            .content_type()
            .map(|ct| match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub).to_ascii_lowercase(),
                None => ct.ctype().to_ascii_lowercase(),
            })
            .unwrap_or_else(|| "application/octet-stream".into());
        let filename = part
            .attachment_name()
            .map(sanitize_filename)
            .filter(|name| !name.is_empty())
            .unwrap_or_else(|| format!("attachment-{}", index + 1));
        let bytes = part.contents();
        let size_bytes = bytes.len() as u64;
        let cid = part
            .content_id()
            .map(|value| {
                value
                    .trim()
                    .trim_matches(|c| c == '<' || c == '>')
                    .to_string()
            })
            .filter(|v| !v.is_empty());
        let is_inline = cid.is_some()
            || part
                .content_disposition()
                .and_then(|d| d.ctype().eq_ignore_ascii_case("inline").then_some(()))
                .is_some();

        if is_calendar_part(&content_type, &filename) {
            if let Some(raw_ics) = decode_text_lossy(bytes) {
                if raw_ics.contains("BEGIN:VCALENDAR") {
                    invites.push(extract_invite_metadata(&raw_ics, index));
                }
            }
        }

        let mut inline_bytes = None;
        if is_inline && bytes.len() <= MAX_INLINE_CACHE_BYTES {
            if let Some(ref cid_key) = cid {
                if content_type.starts_with("image/") {
                    let encoded = base64::engine::general_purpose::STANDARD.encode(bytes);
                    inline_cid_map.insert(
                        cid_key.to_ascii_lowercase(),
                        format!("data:{content_type};base64,{encoded}"),
                    );
                }
            }
            inline_bytes = Some(bytes.to_vec());
        }

        attachments.push(ParsedAttachmentRecord {
            part_id: index.to_string(),
            filename,
            content_type,
            size_bytes,
            cid,
            is_inline,
            inline_bytes,
        });
    }

    // Some invitations are placed as an alternative body part instead of an attachment.
    for (part_idx, part) in message.parts.iter().enumerate() {
        let content_type = part
            .content_type()
            .map(|ct| match ct.subtype() {
                Some(sub) => format!("{}/{}", ct.ctype(), sub).to_ascii_lowercase(),
                None => ct.ctype().to_ascii_lowercase(),
            })
            .unwrap_or_default();
        if content_type == "text/calendar" || content_type == "application/ics" {
            if let Some(text) = part.text_contents() {
                if text.contains("BEGIN:VCALENDAR")
                    && !invites.iter().any(|existing| existing.raw_ics == text)
                {
                    invites.push(extract_invite_metadata(text, part_idx));
                }
            }
        }
    }

    let raw_html = message
        .body_html(0)
        .map(|s| s.chars().take(MAX_BODY_CHARS).collect::<String>())
        .unwrap_or_default();
    let (html_sanitized, has_remote_images) = if raw_html.is_empty() {
        (String::new(), false)
    } else {
        sanitize_email_html(&raw_html, &inline_cid_map)
    };

    let snippet_source = if !text_body.trim().is_empty() {
        text_body.clone()
    } else {
        strip_html_tags(&html_sanitized)
    };
    let snippet = make_snippet(&snippet_source);

    ParsedBodyPayload {
        text_body,
        html_sanitized,
        snippet,
        has_remote_images,
        attachments,
        invites,
    }
}

pub fn extract_attachment_bytes(raw: &[u8], part_index: usize) -> Result<Vec<u8>, String> {
    let message = MessageParser::default()
        .parse(raw)
        .ok_or_else(|| "无法解析邮件内容".to_string())?;
    let part = message
        .attachments()
        .nth(part_index)
        .ok_or_else(|| "邮件中不存在该附件分片".to_string())?;
    let bytes = part.contents();
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(format!(
            "附件超过单文件上限（{} MiB）",
            MAX_ATTACHMENT_BYTES / (1024 * 1024)
        ));
    }
    Ok(bytes.to_vec())
}

pub fn parse_header_addresses(
    message: &Message<'_>,
) -> (
    Vec<MailAddress>,
    Vec<MailAddress>,
    Vec<MailAddress>,
    Vec<MailAddress>,
) {
    (
        convert_address(message.from()),
        convert_address(message.to()),
        convert_address(message.cc()),
        convert_address(message.reply_to()),
    )
}

pub fn parse_references(message: &Message<'_>) -> (Option<String>, Vec<String>) {
    let in_reply_to = extract_header_ids(message.in_reply_to()).into_iter().next();
    let references = extract_header_ids(message.references());
    (in_reply_to, references)
}

fn extract_header_ids(header: &HeaderValue<'_>) -> Vec<String> {
    match header {
        HeaderValue::Text(s) => s
            .split_whitespace()
            .map(|id| id.trim().trim_matches(|c| c == '<' || c == '>').to_string())
            .filter(|id| !id.is_empty())
            .collect(),
        HeaderValue::TextList(list) => list
            .iter()
            .map(|id| id.trim().trim_matches(|c| c == '<' || c == '>').to_string())
            .filter(|id| !id.is_empty())
            .collect(),
        _ => Vec::new(),
    }
}

fn convert_address(addr: Option<&Address<'_>>) -> Vec<MailAddress> {
    let Some(addr) = addr else {
        return Vec::new();
    };
    addr.iter()
        .filter_map(|item| {
            let email = item.address()?.trim().to_string();
            if email.is_empty() {
                return None;
            }
            let name = item
                .name()
                .map(|n| n.trim().to_string())
                .unwrap_or_default();
            Some(MailAddress {
                name,
                address: email,
            })
        })
        .collect()
}

/// Strictly sanitize HTML email body with ammonia:
/// - Strips scripts, iframes, forms, event handlers, javascript: URLs
/// - Replaces `cid:` image references with safe inline data URIs when cached
/// - Neutralizes remote http(s) image `src` into `data-tano-remote-src` so no tracking pixel fires
pub fn sanitize_email_html(
    raw_html: &str,
    inline_cid_map: &HashMap<String, String>,
) -> (String, bool) {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };

    let has_remote = Arc::new(AtomicBool::new(false));
    let has_remote_cb = Arc::clone(&has_remote);
    let cid_map = Arc::new(inline_cid_map.clone());
    let mut tags: HashSet<&str> = ammonia::Builder::default().clone_tags();
    for extra in [
        "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "center", "font",
    ] {
        tags.insert(extra);
    }

    let mut generic_attrs: HashSet<&str> = HashSet::new();
    generic_attrs.insert("title");
    generic_attrs.insert("dir");
    generic_attrs.insert("lang");
    generic_attrs.insert("align");
    generic_attrs.insert("valign");
    generic_attrs.insert("width");
    generic_attrs.insert("height");

    let mut builder = ammonia::Builder::default();
    builder
        .tags(tags)
        .generic_attributes(generic_attrs)
        .add_tag_attributes(
            "td",
            &[
                "colspan",
                "rowspan",
                "bgcolor",
                "cellpadding",
                "cellspacing",
            ],
        )
        .add_tag_attributes("th", &["colspan", "rowspan", "bgcolor"])
        .add_tag_attributes(
            "table",
            &["border", "cellpadding", "cellspacing", "bgcolor"],
        )
        .add_tag_attributes(
            "img",
            &[
                "src",
                "alt",
                "title",
                "width",
                "height",
                "data-tano-remote-src",
            ],
        )
        .add_tag_attributes("a", &["href", "title", "target"])
        .add_url_schemes(&["mailto", "tel", "cid", "data"])
        .link_rel(Some("noopener noreferrer"))
        .attribute_filter(move |element, attribute, value| {
            if element == "img" && attribute == "src" {
                let trimmed = value.trim();
                let lower = trimmed.to_ascii_lowercase();
                if let Some(cid) = lower.strip_prefix("cid:") {
                    if let Some(data_uri) = cid_map.get(cid) {
                        return Some(data_uri.clone().into());
                    }
                    return None;
                }
                if lower.starts_with("http://") || lower.starts_with("https://") {
                    has_remote_cb.store(true, Ordering::Relaxed);
                    return None;
                }
                if lower.starts_with("data:image/png;base64,")
                    || lower.starts_with("data:image/jpeg;base64,")
                    || lower.starts_with("data:image/gif;base64,")
                    || lower.starts_with("data:image/webp;base64,")
                {
                    return Some(trimmed.to_string().into());
                }
                return None;
            }
            Some(value.into())
        });

    // Preserve remote image URLs in a safe non-loading attribute before ammonia strips `src`.
    let pre_marked = mark_remote_img_attrs(raw_html);
    if pre_marked != raw_html {
        has_remote.store(true, Ordering::Relaxed);
    }
    let clean = builder.clean(&pre_marked).to_string();
    (clean, has_remote.load(Ordering::Relaxed))
}

fn mark_remote_img_attrs(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(pos) = find_ascii_case_insensitive(rest, "<img") {
        out.push_str(&rest[..pos]);
        let after = &rest[pos..];
        let Some(end) = after.find('>') else {
            out.push_str(after);
            return out;
        };
        let tag = &after[..=end];
        if let Some(url) = extract_img_remote_src(tag) {
            let escaped = url
                .replace('&', "&amp;")
                .replace('"', "&quot;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let prefix = &tag[..tag.len() - 1];
            let (body, closing) = if let Some(stripped) = prefix.strip_suffix('/') {
                (stripped, "/>")
            } else {
                (prefix, ">")
            };
            out.push_str(body);
            out.push_str(" data-tano-remote-src=\"");
            out.push_str(&escaped);
            out.push('"');
            out.push_str(closing);
        } else {
            out.push_str(tag);
        }
        rest = &after[end + 1..];
    }
    out.push_str(rest);
    out
}

fn extract_img_remote_src(tag: &str) -> Option<String> {
    let lower = tag.to_ascii_lowercase();
    let idx = lower.find("src=")?;
    let after = tag[idx + 4..].trim_start();
    let url = if let Some(rest) = after.strip_prefix('"') {
        rest.split('"').next()?
    } else if let Some(rest) = after.strip_prefix('\'') {
        rest.split('\'').next()?
    } else {
        after
            .split(|c: char| c.is_whitespace() || c == '>' || c == '/')
            .next()?
    };
    let trimmed = url.trim();
    let lower_url = trimmed.to_ascii_lowercase();
    if lower_url.starts_with("http://") || lower_url.starts_with("https://") {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn find_ascii_case_insensitive(haystack: &str, needle: &str) -> Option<usize> {
    haystack
        .to_ascii_lowercase()
        .find(&needle.to_ascii_lowercase())
}

fn is_calendar_part(content_type: &str, filename: &str) -> bool {
    content_type == "text/calendar"
        || content_type == "application/ics"
        || filename.to_ascii_lowercase().ends_with(".ics")
}

fn extract_invite_metadata(raw_ics: &str, index: usize) -> ParsedInviteRecord {
    let unfolded = unfold_ics_lines(raw_ics);
    let mut ics_uid = String::new();
    let mut method = "PUBLISH".to_string();
    let mut summary = String::new();
    for line in unfolded.lines() {
        let trimmed = line.trim();
        let upper = trimmed.to_ascii_uppercase();
        if upper.starts_with("METHOD:") {
            method = trimmed[7..].trim().to_ascii_uppercase();
        } else if ics_uid.is_empty() && upper.starts_with("UID:") {
            ics_uid = trimmed[4..].trim().to_string();
        } else if summary.is_empty() && upper.starts_with("SUMMARY") {
            if let Some((_, val)) = trimmed.split_once(':') {
                summary = val.trim().replace("\\n", " ").replace("\\,", ",");
            }
        }
    }
    if ics_uid.is_empty() {
        ics_uid = format!("invite-{index}");
    }
    if summary.is_empty() {
        summary = "日历邀请".into();
    }
    ParsedInviteRecord {
        ics_uid,
        method,
        summary,
        raw_ics: raw_ics.chars().take(256 * 1024).collect(),
    }
}

fn unfold_ics_lines(raw: &str) -> String {
    raw.replace("\r\n ", "")
        .replace("\r\n\t", "")
        .replace("\n ", "")
        .replace("\n\t", "")
}

fn decode_text_lossy(bytes: &[u8]) -> Option<String> {
    if bytes.is_empty() {
        return None;
    }
    Some(String::from_utf8_lossy(bytes).to_string())
}

fn sanitize_filename(input: &str) -> String {
    input
        .trim()
        .replace(['/', '\\', '\0', '\r', '\n'], "_")
        .chars()
        .take(180)
        .collect()
}

fn strip_html_tags(html: &str) -> String {
    let mut out = String::with_capacity(html.len().min(2048));
    let mut in_tag = false;
    for ch in html.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => {
                in_tag = false;
                out.push(' ');
            }
            _ if !in_tag => out.push(ch),
            _ => {}
        }
        if out.len() >= 1024 {
            break;
        }
    }
    out
}

pub fn make_snippet(text: &str) -> String {
    let collapsed = text.split_whitespace().collect::<Vec<_>>().join(" ");
    collapsed.chars().take(180).collect()
}

/// RFC 3501 Section 5.1.3 Modified UTF-7 decoder for international IMAP mailbox names
/// (e.g. QQ / NetEase Chinese folder names like `&UXZO1mWHTvZZOQ-` -> `已发送`).
pub fn decode_modified_utf7(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let bytes = input.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'&' {
            if i + 1 < bytes.len() && bytes[i + 1] == b'-' {
                out.push('&');
                i += 2;
                continue;
            }
            if let Some(rel_end) = bytes[i + 1..].iter().position(|&b| b == b'-') {
                let encoded = &input[i + 1..i + 1 + rel_end];
                if let Some(decoded) = decode_mutf7_segment(encoded) {
                    out.push_str(&decoded);
                    i += rel_end + 2;
                    continue;
                }
            }
        }
        if let Some(ch) = input[i..].chars().next() {
            out.push(ch);
            i += ch.len_utf8();
        } else {
            break;
        }
    }
    out
}

fn decode_mutf7_segment(segment: &str) -> Option<String> {
    let mut b64 = segment.replace(',', "/");
    let rem = b64.len() % 4;
    if rem != 0 {
        for _ in 0..(4 - rem) {
            b64.push('=');
        }
    }
    let raw = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .ok()?;
    if raw.len() % 2 != 0 {
        return None;
    }
    let utf16: Vec<u16> = raw
        .chunks_exact(2)
        .map(|pair| u16::from_be_bytes([pair[0], pair[1]]))
        .collect();
    String::from_utf16(&utf16).ok()
}
