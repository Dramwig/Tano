fn main() {
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
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
