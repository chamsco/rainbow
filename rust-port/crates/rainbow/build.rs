//! Embeds `ui/` into the executable. A shipped Rainbow cannot read its chrome from the
//! source tree, and an updater must be able to replace one file. Debug builds still read
//! `ui/` from disk when RAINBOW_UI_DIR is set, so the chrome can be edited without a rebuild.

use std::{env, fs, path::Path};

fn mime(path: &str) -> &'static str {
    match path.rsplit('.').next() {
        Some("html") => "text/html",
        Some("css") => "text/css",
        Some("js") => "text/javascript",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    }
}

fn walk(dir: &Path, prefix: &str, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        // Dotfiles are tooling (the QA harness, a screenshot page), never chrome: shipping
        // them would put reachable debug pages inside the binary.
        if name.starts_with('.') {
            continue;
        }
        let rel = if prefix.is_empty() { name } else { format!("{prefix}/{name}") };
        if path.is_dir() {
            walk(&path, &rel, out);
        } else {
            out.push(rel);
        }
    }
}

fn main() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    // Cargo watches a directory's mtime, which does not change when a file inside it is
    // edited, so list every asset. Otherwise a CSS or JS edit ships stale.
    println!("cargo:rerun-if-changed=ui");
    let mut files = Vec::new();
    walk(&manifest.join("ui"), "", &mut files);
    files.sort();
    for rel in &files {
        println!("cargo:rerun-if-changed=ui/{rel}");
    }
    let mut code = String::from("pub static UI: &[(&str, &str, &[u8])] = &[\n");
    for rel in files {
        code.push_str(&format!(
            "    ({:?}, {:?}, include_bytes!(concat!(env!(\"CARGO_MANIFEST_DIR\"), \"/ui/{}\"))),\n",
            rel,
            mime(&rel),
            rel
        ));
    }
    code.push_str("];\n");
    let out = Path::new(&env::var("OUT_DIR").expect("OUT_DIR")).join("ui_assets.rs");
    fs::write(out, code).expect("write ui_assets.rs");
}
