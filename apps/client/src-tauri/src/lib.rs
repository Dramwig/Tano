#[cfg(desktop)]
mod auxiliary_windows;
#[cfg(desktop)]
mod shell_open;

#[cfg(desktop)]
fn main_window_config() -> tauri::utils::config::WindowConfig {
    serde_json::from_value(serde_json::json!({
        "label": "main", "title": "Tano / 同页", "width": 1440,
        "height": 940, "minWidth": 800, "minHeight": 580,
        "decorations": false, "dragDropEnabled": false, "backgroundColor": "#f7f7f2"
    }))
    .expect("valid main window configuration")
}

#[tauri::command]
fn startup_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[startup] frontend ready: {}", window.label());
    #[cfg(desktop)]
    if window.label() == "main" || window.label().starts_with("file-") {
        window.show().map_err(|error| error.to_string())?;
    }
    #[cfg(mobile)]
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    #[cfg(desktop)]
    let shell = shell_open::prepare();
    let builder = tauri::Builder::default();
    #[cfg(desktop)]
    let builder = builder
        .manage(shell)
        .setup(|app| {
            shell_open::create_initial(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_single_instance::init(shell_open::receive));
    #[cfg(desktop)]
    let builder = tano_native::configure_with_commands(
        builder,
        &[
            "startup_ready",
            "shell_take_workspace",
            "standalone_read",
            "standalone_write",
            "standalone_copy",
        ],
        tauri::generate_handler![
            startup_ready,
            shell_open::shell_take_workspace,
            shell_open::standalone_read,
            shell_open::standalone_write,
            shell_open::standalone_copy
        ],
    );
    #[cfg(mobile)]
    let builder = tano_native::configure_with_commands(
        builder,
        &["startup_ready"],
        tauri::generate_handler![startup_ready],
    );
    builder
        .on_page_load(|webview, payload| {
            #[cfg(debug_assertions)]
            eprintln!(
                "[startup] page load: {} {:?}",
                webview.label(),
                payload.event()
            );
            #[cfg(desktop)]
            if (webview.label() == "main" || webview.label().starts_with("file-"))
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                // Vite dependency discovery and retry can reload an already visible
                // WebView. Keep the same readiness boundary on every navigation.
                // This hook receives a Webview, not a WebviewWindow. Hiding the
                // child WebView would leave it invisible when the host is shown.
                if let Err(error) = webview.window().hide() {
                    eprintln!("Unable to hide the loading main window: {error}");
                }
                #[cfg(debug_assertions)]
                eprintln!("[startup] navigation hidden");
            }
            #[cfg(mobile)]
            let _ = (webview, payload);
        })
        .run(context)
        .expect("error while running Tano Local");
}
