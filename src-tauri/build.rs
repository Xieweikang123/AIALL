fn main() {
    // tauri-build 2.6.2 does not emit rerun-if-changed for `bundle.icon`,
    // so replacing the app icon alone will not relink the binary.
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.png");
    tauri_build::build()
}
