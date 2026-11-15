//! Debug-only prototype: VS Code–style auxiliary windows.
//!
//! Opens a separate "lab" host window whose `window.open()` calls are answered
//! with a real Tauri window built from the opener's `NewWindowFeatures`. On
//! Windows that shares the opener's WebView2 environment, so the opener's
//! JavaScript keeps a live, same-origin handle to the new window and can render
//! Vue components into it without booting a second app.
//!
//! Production windows are untouched; see docs/aux-window-prototype.md.

use std::sync::atomic::{AtomicU32, Ordering};
use tauri::webview::NewWindowResponse;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const HOST_LABEL: &str = "auxlab-host";
static POPUPS: AtomicU32 = AtomicU32::new(0);

/// Async on purpose: creating windows from a synchronous command deadlocks on Windows.
#[tauri::command]
pub async fn aux_window_lab_open(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(HOST_LABEL) {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }
    let handle = app.clone();
    WebviewWindowBuilder::new(
        &app,
        HOST_LABEL,
        WebviewUrl::App("index.html?auxLab=host".into()),
    )
    .title("辅助窗口原型 — Tano")
    .inner_size(780.0, 760.0)
    .disable_drag_drop_handler()
    .on_new_window(move |url, features| {
        let label = format!("auxlab-popup-{}", POPUPS.fetch_add(1, Ordering::Relaxed) + 1);
        // `window_features` applies the requested size/position and, on Windows,
        // the opener's WebView2 environment. Without the shared environment the
        // popup would load as an unrelated page and `window.opener` would be null.
        let built = WebviewWindowBuilder::new(&handle, &label, WebviewUrl::External(url))
            .window_features(features)
            .title("辅助窗口（原型）")
            .decorations(false)
            .disable_drag_drop_handler()
            .build();
        match built {
            Ok(window) => NewWindowResponse::Create { window },
            Err(error) => {
                eprintln!("[aux-window-lab] popup creation failed: {error}");
                NewWindowResponse::Deny
            }
        }
    })
    .build()
    .map_err(|error| error.to_string())?;
    Ok(())
}
