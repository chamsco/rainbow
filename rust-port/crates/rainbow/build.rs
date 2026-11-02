//! Embeds `ui/` into the executable. A shipped Rainbow cannot read its chrome from the
//! source tree, and an updater must be able to replace one file. Debug builds still read
//! `ui/` from disk when RAINBOW_UI_DIR is set, so the chrome can be edited without a rebuild.
//!
//! It also gives the Windows exe its icon: `assets/rainbow.rc` names `rainbow.ico`, the
//! resource compiler turns that into a COFF object, and the linker merges it in, so Explorer,
//! the Start menu and pinned shortcuts show the rainbow gnome. That half is best effort: a
//! machine without a resource compiler still builds, just with the stock exe icon. The window
//! icon does not depend on it (`main.rs` embeds `assets/rainbow-icon-256.rgba`).

use std::{env, fs, path::Path, path::PathBuf, process::Command};

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

/// The first existing executable named in `names`, searched along PATH. No shell, so this
/// works the same under cmd, PowerShell and CI.
fn on_path(names: &[&str]) -> Option<PathBuf> {
    let path = env::var_os("PATH")?;
    env::split_paths(&path).map(|dir| dir.join(names[0])).find(|p| p.is_file()).or_else(|| {
        // PATH hit nothing: try the remaining spellings of the same tool.
        env::split_paths(&path)
            .flat_map(|dir| names[1..].iter().map(move |n| dir.join(n)))
            .find(|p| p.is_file())
    })
}

/// windres spells the PE object format with a target name; the MSVC linker refuses a COFF
/// object built for another machine.
fn pe_target(arch: &str) -> Option<&'static str> {
    match arch {
        "x86_64" => Some("pe-x86-64"),
        "x86" | "i686" => Some("pe-i386"),
        "aarch64" => Some("pe-aarch64"),
        _ => None,
    }
}

fn cvtres_machine(arch: &str) -> Option<&'static str> {
    match arch {
        "x86_64" => Some("X64"),
        "x86" | "i686" => Some("X86"),
        "aarch64" => Some("ARM64"),
        _ => None,
    }
}

fn run(mut cmd: Command) -> Result<(), String> {
    let shown = format!("{cmd:?}");
    let out = cmd.output().map_err(|e| format!("{shown}: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr);
        Err(format!("{shown}: {} {}", out.status, stderr.trim()))
    }
}

/// Compile `assets/rainbow.rc` into a COFF object the MSVC linker accepts. Tries the resource
/// compilers a dev machine is likely to have, in order of how little extra wiring they need:
/// mingw-w64's windres writes COFF directly; LLVM's llvm-rc and the Windows SDK's rc.exe write
/// a `.res` that cvtres has to turn into COFF. Returns the first success.
fn compile_rc(assets: &Path, rc: &Path, obj: &Path, arch: &str) -> Result<(), String> {
    let mut errors = Vec::new();

    let windres = ["windres.exe", "windres", "x86_64-w64-mingw32-windres.exe"];
    if let Some(tool) = on_path(&windres) {
        let mut cmd = Command::new(tool);
        cmd.arg("--input-format=rc")
            .arg("--output-format=coff")
            .arg("-I")
            .arg(assets)
            .arg("-i")
            .arg(rc)
            .arg("-o")
            .arg(obj);
        if let Some(t) = pe_target(&arch) {
            cmd.arg(format!("--target={t}"));
        }
        match run(cmd) {
            Ok(()) => return Ok(()),
            Err(e) => errors.push(e),
        }
    }

    // rc.exe / llvm-rc: compile to .res, then convert that to COFF.
    let res = obj.with_extension("res");
    let mut res_made = false;
    for names in [&["llvm-rc.exe", "llvm-rc"][..], &["rc.exe", "rc"][..]] {
        let Some(tool) = on_path(names) else { continue };
        let arg = if names[0].starts_with("llvm-rc") { "/FO" } else { "/fo" };
        let mut cmd = Command::new(tool);
        cmd.arg("/nologo").arg("/I").arg(assets).arg(arg).arg(&res).arg(rc);
        match run(cmd) {
            Ok(()) => {
                res_made = true;
                break;
            }
            Err(e) => errors.push(e),
        }
    }
    if res_made {
        let Some(machine) = cvtres_machine(&arch) else {
            return Err(format!("no COFF machine type for target arch {arch:?}"));
        };
        let cvtres = ["llvm-cvtres.exe", "llvm-cvtres", "cvtres.exe", "cvtres"];
        if let Some(tool) = on_path(&cvtres) {
            let mut cmd = Command::new(tool);
            cmd.arg("/nologo").arg(format!("/OUT:{}", obj.display())).arg(format!("/MACHINE:{machine}")).arg(&res);
            match run(cmd) {
                Ok(()) => return Ok(()),
                Err(e) => errors.push(e),
            }
        } else {
            errors.push("cvtres/llvm-cvtres not found, cannot convert .res to COFF".into());
        }
    } else if errors.is_empty() {
        errors.push("no resource compiler on PATH (looked for windres, llvm-rc, rc.exe)".into());
    }
    Err(errors.join("; "))
}

/// A COFF object for the machine being linked, and not an empty or truncated file: the linker
/// would fail the whole build on a bad object, and a missing exe icon is not worth that.
fn is_coff(path: &Path, arch: &str) -> bool {
    let expected = match arch {
        "x86_64" => 0x8664,
        "x86" | "i686" => 0x014c,
        "aarch64" => 0xaa64,
        _ => return false,
    };
    let Ok(bytes) = fs::read(path) else { return false };
    if bytes.len() < 20 {
        return false;
    }
    let machine = u16::from_le_bytes([bytes[0], bytes[1]]);
    let sections = u16::from_le_bytes([bytes[2], bytes[3]]);
    machine == expected && sections > 0 && sections <= 96
}

/// Give the executable its icon. Never fatal: a failed compile only means Explorer keeps the
/// stock icon, so it prints a cargo warning and returns.
fn embed_icon(manifest: &Path) {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-changed=assets/rainbow.rc");
    println!("cargo:rerun-if-changed=assets/rainbow.ico");
    println!("cargo:rerun-if-changed=assets/rainbow-icon-256.rgba");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let assets = manifest.join("assets");
    let rc = assets.join("rainbow.rc");
    let obj = PathBuf::from(env::var("OUT_DIR").expect("OUT_DIR")).join("rainbow_icon.res.o");
    if !rc.is_file() || !assets.join("rainbow.ico").is_file() {
        println!("cargo:warning=Rainbow: assets/rainbow.rc or assets/rainbow.ico is missing; building without the exe icon");
        return;
    }
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    match compile_rc(&assets, &rc, &obj, &arch) {
        Ok(()) if is_coff(&obj, &arch) => println!("cargo:rustc-link-arg={}", obj.display()),
        Ok(()) => println!("cargo:warning=Rainbow: the resource compiler wrote no usable {arch} COFF object; building without the exe icon"),
        Err(e) => println!("cargo:warning=Rainbow: could not embed the exe icon ({e}); building without it"),
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
    embed_icon(manifest);
}
