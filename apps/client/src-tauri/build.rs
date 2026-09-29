fn main() {
    println!("cargo:rerun-if-env-changed=TANO_UPDATER_URL");
    println!("cargo:rerun-if-env-changed=TANO_UPDATER_PUBLIC_KEY");
    println!("cargo:rerun-if-env-changed=TANO_UPDATER_CA_PEM");
    // The updater integration tests initialize Tauri's mock app. Its Windows
    // dependencies import Common Controls v6 even without a visible window.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rustc-link-arg-tests=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg-tests=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
    }
    tauri_build::build()
}
