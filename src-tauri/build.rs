fn main() {
  // tauri-build only watches the config, so a new icon would keep the old one in the exe.
  println!("cargo:rerun-if-changed=icons");
  tauri_build::build()
}
