use crate::error::NativeError;
#[cfg(windows)]
use crate::tab_drag_preview;
#[cfg(windows)]
use tauri::Emitter;
use tauri::Manager;

#[tauri::command]
pub(crate) fn runtime_platform() -> serde_json::Value {
    serde_json::json!({"mobile": cfg!(mobile), "os": std::env::consts::OS})
}

#[cfg(desktop)]
#[tauri::command]
pub(crate) fn open_devtools(
    window: tauri::WebviewWindow,
    window_label: String,
) -> Result<(), String> {
    operation_window(window, &window_label)?.open_devtools();
    Ok(())
}

fn operation_window(
    window: tauri::WebviewWindow,
    label: &str,
) -> Result<tauri::WebviewWindow, String> {
    // Independent file windows can operate on themselves. Only the main bridge
    // may address a shared auxiliary window.
    if label == window.label() {
        return Ok(window);
    }
    if window.label() != "main" || !label.starts_with("aux-") {
        return Err("Invalid operation window".into());
    }
    window
        .app_handle()
        .get_webview_window(label)
        .ok_or_else(|| "Window is closed".into())
}

#[tauri::command]
pub(crate) async fn tab_drag_release(
    window: tauri::WebviewWindow,
    window_label: String,
    preview: Option<serde_json::Value>,
    drag_id: Option<String>,
) -> Result<serde_json::Value, String> {
    let window = operation_window(window, &window_label)?;
    #[cfg(windows)]
    {
        let source = window.hwnd().map_err(|e| e.to_string())?.0 as usize;
        let scale = window.scale_factor().map_err(|e| e.to_string())?;
        tauri::async_runtime::spawn_blocking(move || {
            use windows_sys::Win32::Foundation::POINT;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON,
            };
            use windows_sys::Win32::UI::WindowsAndMessaging::GetCursorPos;

            // The WebView may not dispatch dragend after an OS drag ends outside its window.
            // Observe the button on a host thread so renderer timer throttling cannot lose it.
            let preview = preview
                .map(serde_json::from_value::<tab_drag_preview::Bitmap>)
                .transpose()
                .map_err(|e| e.to_string())?
                .map(|bitmap| tab_drag_preview::Preview::new(bitmap, source as _))
                .transpose()?;
            let mut overlay_announced = false;
            while unsafe { GetAsyncKeyState(VK_LBUTTON.into()) < 0 } {
                if unsafe { GetAsyncKeyState(VK_ESCAPE.into()) < 0 } {
                    return Ok(serde_json::json!({"x": 0, "y": 0, "cancelled": true}));
                }
                let mut cursor = POINT { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut cursor) } != 0 {
                    if let Some(preview) = &preview {
                        preview.update(cursor, source as _)?;
                        // The card is now really on screen: only then may the
                        // renderer hand its DOM copy over, so it never vanishes first.
                        if !overlay_announced {
                            overlay_announced = true;
                            if let Some(drag_id) = &drag_id {
                                let _ = window.emit(
                                    "tano-tab-drag-overlay-ready",
                                    serde_json::json!({ "dragId": drag_id }),
                                );
                            }
                        }
                    }
                    if let Some(drag_id) = &drag_id {
                        let mut local = cursor;
                        if unsafe {
                            windows_sys::Win32::Graphics::Gdi::ScreenToClient(
                                source as _,
                                &mut local,
                            )
                        } != 0
                        {
                            let _ = window.emit(
                                "tano-tab-drag-position",
                                serde_json::json!({
                                    "dragId": drag_id, "x": local.x as f64 / scale, "y": local.y as f64 / scale
                                }),
                            );
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(16));
            }
            let mut point = POINT { x: 0, y: 0 };
            if unsafe { GetCursorPos(&mut point) } == 0 {
                return Err(std::io::Error::last_os_error().to_string());
            }
            // Which top-level window is actually under the release point. A
            // renderer dragleave is not reliable for this (it also fires while
            // crossing elements), and a wrong "outside" detaches the tab.
            // The overlay is click-through, so hit testing skips it.
            let over_source = unsafe {
                use windows_sys::Win32::UI::WindowsAndMessaging::{
                    GetAncestor, WindowFromPoint, GA_ROOT,
                };
                let hit = WindowFromPoint(point);
                !hit.is_null() && GetAncestor(hit, GA_ROOT) as usize == source
            };
            Ok(serde_json::json!({"x": point.x, "y": point.y, "overSource": over_source}))
        })
        .await
        .map_err(|error| error.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = (window, preview, drag_id);
        Err("Tab drag release observation is only available on Windows".to_owned())
    }
}

#[tauri::command(async)]
pub(crate) fn open_external_url(url: String, app: tauri::AppHandle) -> Result<(), String> {
    let parsed = validated_external_url(&url)?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(parsed.as_str(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn validated_external_url(url: &str) -> Result<tauri::Url, String> {
    let parsed = tauri::Url::parse(url).map_err(|_| NativeError::InvalidUrl("链接地址无效"))?;
    match parsed.scheme() {
        "http" | "https" if parsed.username().is_empty() && parsed.password().is_none() => {}
        "mailto" => {
            let address = parsed.path();
            let valid_address = address.split_once('@').is_some_and(|(local, domain)| {
                !local.is_empty()
                    && !domain.is_empty()
                    && !domain.contains('@')
                    && address.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric()
                            || matches!(byte, b'@' | b'.' | b'_' | b'+' | b'-')
                    })
            });
            if !valid_address || parsed.query().is_some() || parsed.fragment().is_some() {
                return Err(NativeError::InvalidUrl("邮箱链接仅支持单个有效地址").into());
            }
        }
        _ => {
            return Err(NativeError::InvalidUrl("外部链接只支持 HTTP、HTTPS 和 mailto 地址").into())
        }
    }
    Ok(parsed)
}

#[cfg(test)]
mod external_url_tests {
    use super::validated_external_url;

    #[test]
    fn accepts_web_and_email_links() {
        assert!(validated_external_url("https://example.com/path").is_ok());
        assert!(validated_external_url("mailto:test+tag@example.com").is_ok());
    }

    #[test]
    fn rejects_unsafe_or_ambiguous_external_links() {
        for url in [
            "javascript:alert(1)",
            "https://user:secret@example.com",
            "mailto:test@example.com?subject=hello",
            "mailto:test%0a@example.com",
            "mailto:test@example.com,other@example.com",
        ] {
            assert!(validated_external_url(url).is_err(), "{url}");
        }
    }
}
