#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tano_native::configure(tauri::Builder::default())
        .run(tauri::generate_context!())
        .expect("error while running Tano Local");
}
