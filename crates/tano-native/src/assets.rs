use crate::storage;
use serde::Serialize;
use std::{fs, path::Path};
use tauri::http::{Request, Response, StatusCode};

const MAX_BYTES: u64 = 50 * 1024 * 1024;

pub fn image_type(bytes: &[u8]) -> Option<(&'static str, &'static str)> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some(("image/png", "png"))
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some(("image/jpeg", "jpg"))
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some(("image/gif", "gif"))
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some(("image/webp", "webp"))
    } else {
        None
    }
}

#[derive(Serialize)]
pub struct ImportedAsset {
    path: String,
    name: String,
    image: bool,
}

pub fn import(
    root: &Path,
    name: &str,
    bytes: &[u8],
    require_image: bool,
    identity: Option<(&str, &Path)>,
) -> Result<ImportedAsset, String> {
    if bytes.len() as u64 > MAX_BYTES {
        return Err("附件不能超过 50 MiB".into());
    }
    let image = image_type(bytes);
    if require_image && image.is_none() {
        return Err("图片支持 PNG、JPEG、GIF 和 WebP；SVG 等格式请作为附件导入".into());
    }
    let basename = name.rsplit(['/', '\\']).next().unwrap_or("attachment");
    let (stem, extension) = basename.rsplit_once('.').unwrap_or((basename, ""));
    let stem: String = stem
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"/\\|?*.".contains(*c))
        .take(40)
        .collect::<String>()
        .trim()
        .into();
    let extension = image
        .map(|(_, extension)| extension.to_string())
        .unwrap_or_else(|| {
            extension
                .chars()
                .filter(|c| c.is_ascii_alphanumeric())
                .take(12)
                .collect()
        });
    let directory = storage::resolve(root, "assets", false)?;
    if !directory.exists() {
        fs::create_dir(&directory).map_err(|e| e.to_string())?;
    }
    if !directory.is_dir() {
        return Err("assets 已存在且不是文件夹".into());
    }
    let filename = format!(
        "{}-{}{}",
        if stem.is_empty() { "attachment" } else { &stem },
        uuid::Uuid::new_v4(),
        if extension.is_empty() {
            String::new()
        } else {
            format!(".{extension}")
        }
    );
    let relative = format!("assets/{filename}");
    let target = storage::resolve(root, &relative, false)?;
    if let Some((workspace_id, cache)) = identity {
        crate::identity_manifest::begin_create(root, workspace_id, cache, &relative, bytes)?;
    }
    if let Err(error) = storage::create_atomic(&target, bytes) {
        if let Some((workspace_id, cache)) = identity {
            let _ = crate::identity_manifest::recover_mutation(root, workspace_id, cache);
        }
        return Err(error);
    }
    if let Some((workspace_id, cache)) = identity {
        crate::identity_manifest::recover_mutation(root, workspace_id, cache)?;
    }
    Ok(ImportedAsset {
        path: relative,
        name: basename.into(),
        image: image.is_some(),
    })
}

pub fn read(root: &Path, relative: &str) -> Result<Vec<u8>, String> {
    let target = storage::resolve(root, relative, true)?;
    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("附件无效或超过 50 MiB".into());
    }
    fs::read(target).map_err(|e| e.to_string())
}

pub fn respond(root: &Path, workspace_id: &str, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let result = (|| {
        if request.method() != "GET" {
            return Err(StatusCode::METHOD_NOT_ALLOWED);
        }
        let decoded =
            percent_encoding::percent_decode_str(request.uri().path().trim_start_matches('/'))
                .decode_utf8()
                .map_err(|_| StatusCode::BAD_REQUEST)?;
        let (id, path) = decoded.split_once('/').ok_or(StatusCode::BAD_REQUEST)?;
        if id != workspace_id {
            return Err(StatusCode::NOT_FOUND);
        }
        let bytes = read(root, path).map_err(|_| StatusCode::NOT_FOUND)?;
        let (mime, _) = image_type(&bytes).ok_or(StatusCode::UNSUPPORTED_MEDIA_TYPE)?;
        Ok((mime, bytes))
    })();
    let (status, mime, bytes) = match result {
        Ok((mime, bytes)) => (StatusCode::OK, mime, bytes),
        Err(status) => (status, "text/plain", b"Image unavailable".to_vec()),
    };
    let mut response = Response::builder()
        .status(status)
        .header("Content-Type", mime)
        .header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff")
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .body(bytes)
        .expect("static response headers");
    if let Some(origin) = request.headers().get("Origin") {
        if origin
            .to_str()
            .ok()
            .and_then(|value| tauri::Url::parse(value).ok())
            .is_some_and(|url| {
                matches!(url.scheme(), "http" | "https" | "tauri")
                    && matches!(
                        url.host_str(),
                        Some("localhost" | "127.0.0.1" | "tauri.localhost")
                    )
            })
        {
            response
                .headers_mut()
                .insert("Access-Control-Allow-Origin", origin.clone());
            response
                .headers_mut()
                .insert("Vary", "Origin".parse().unwrap());
        }
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_without_overwrite_and_serves_only_selected_workspace_images() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nfixture";
        let a = import(&root, "图 片.png", bytes, true, None).unwrap();
        let b = import(&root, "图 片.png", bytes, true, None).unwrap();
        assert_ne!(a.path, b.path);
        let uri = format!(
            "tano-asset://localhost/workspace/{}",
            percent_encoding::utf8_percent_encode(&a.path, percent_encoding::NON_ALPHANUMERIC)
        );
        let request = Request::builder().uri(uri).body(vec![]).unwrap();
        let response = respond(&root, "workspace", &request);
        assert_eq!(response.status(), 200);
        assert_eq!(response.body(), bytes);
        assert_eq!(response.headers()["content-type"], "image/png");
        assert_eq!(respond(&root, "another-workspace", &request).status(), 404);
        let local_request = Request::builder()
            .uri(request.uri())
            .header("Origin", "http://tauri.localhost")
            .body(vec![])
            .unwrap();
        assert_eq!(
            respond(&root, "workspace", &local_request).headers()["access-control-allow-origin"],
            "http://tauri.localhost"
        );
        let external_request = Request::builder()
            .uri(request.uri())
            .header("Origin", "https://example.com")
            .body(vec![])
            .unwrap();
        assert!(!respond(&root, "workspace", &external_request)
            .headers()
            .contains_key("access-control-allow-origin"));
    }
    #[test]
    fn reads_binary_export_attachments_without_relaxing_image_preview_or_path_boundaries() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let bytes = b"%PDF-1.7\n\0\xff";
        fs::write(root.join("attachment.pdf"), bytes).unwrap();
        assert_eq!(read(&root, "attachment.pdf").unwrap(), bytes);
        let request = Request::builder()
            .uri("tano-asset://localhost/workspace/attachment.pdf")
            .body(vec![])
            .unwrap();
        assert_eq!(respond(&root, "workspace", &request).status(), 415);
        assert!(read(&root, "../attachment.pdf").is_err());
        assert!(read(&root, ".tano/config.json").is_err());
    }
    #[test]
    fn imported_attachment_identity_survives_index_loss() {
        let temp = tempfile::tempdir().unwrap();
        let data = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        let id = storage::workspace_identity(&root).unwrap();
        let cache = data.path().join("index.sqlite");
        storage::scan(&root, &id, &cache).unwrap();
        let asset = import(
            &root,
            "image.png",
            b"\x89PNG\r\n\x1a\nfixture",
            true,
            Some((&id, &cache)),
        )
        .unwrap();
        let before = storage::scan(&root, &id, &cache).unwrap();
        let file_id = before
            .files
            .iter()
            .find(|file| file.path == asset.path)
            .unwrap()
            .id
            .clone();
        fs::remove_file(&cache).unwrap();
        let after = storage::scan(&root, &id, &cache).unwrap();
        assert_eq!(
            after
                .files
                .iter()
                .find(|file| file.path == asset.path)
                .unwrap()
                .id,
            file_id
        );
    }
    #[test]
    fn rejects_hidden_escape_and_active_content() {
        let temp = tempfile::tempdir().unwrap();
        let root = fs::canonicalize(temp.path()).unwrap();
        fs::write(root.join("page.svg"), b"<svg onload='alert(1)'/>").unwrap();
        assert!(import(&root, "image.svg", b"<svg/>", true, None).is_err());
        for path in [
            "../secret.png",
            "%2e%2e/secret.png",
            ".tano/config.json",
            "C:/secret.png",
            "page.svg",
        ] {
            let request = Request::builder()
                .uri(format!("tano-asset://localhost/workspace/{path}"))
                .body(vec![])
                .unwrap();
            assert_ne!(respond(&root, "workspace", &request).status(), 200);
        }
    }
    #[cfg(unix)]
    #[test]
    fn never_serves_a_symlink_outside_workspace() {
        let temp = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::write(
            outside.path().join("private.png"),
            b"\x89PNG\r\n\x1a\nprivate",
        )
        .unwrap();
        std::os::unix::fs::symlink(
            outside.path().join("private.png"),
            temp.path().join("link.png"),
        )
        .unwrap();
        assert!(read(temp.path(), "link.png").is_err());
    }
}
