#[tauri::command]
fn startup_ready(window: tauri::WebviewWindow) -> Result<(), String> {
    #[cfg(debug_assertions)]
    eprintln!("[startup] frontend ready: {}", window.label());
    #[cfg(desktop)]
    if window.label() == "main" {
        window.show().map_err(|error| error.to_string())?;
    }
    #[cfg(mobile)]
    let _ = window;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut context = tauri::generate_context!();
    #[cfg(desktop)]
    for window in &mut context.config_mut().app.windows {
        // Only the frontend may reveal this window after mounting the workbench.
        if window.label == "main" {
            window.visible = false;
            #[cfg(debug_assertions)]
            eprintln!("[startup] main window starts hidden");
        }
    }
    tano_native::configure_with_commands(
        tauri::Builder::default(),
        &["startup_ready"],
        tauri::generate_handler![startup_ready],
    )
    .run(context)
    .expect("error while running Tano Local");
}
