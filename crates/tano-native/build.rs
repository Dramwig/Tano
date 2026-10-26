fn main() {
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    if target == "windows" {
        // Tauri mock-window IPC tests link TaskDialogIndirect too. Unlike the
        // desktop binary, this library's test harness has no tauri-build manifest.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    println!(
        "cargo:rustc-cfg={}",
        if target == "android" || target == "ios" {
            "mobile"
        } else {
            "desktop"
        }
    );
    for key in [
        "TANO_UPDATER_URL",
        "TANO_UPDATER_PUBLIC_KEY",
        "TANO_UPDATER_CA_PEM",
        "TANO_MCP_DEV_PATH",
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
}
