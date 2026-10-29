//! Rainbow's native shell. The chrome (sidebar, command bar, Ask Rainbow, Canvas) is the
//! HTML app in `ui/`, loaded into one full-window webview. Each tab's page is its own
//! child webview, placed in the rectangle the chrome reports. The two sides talk over
//! a small JSON protocol: the chrome sends `{t: ...}` messages through `window.ipc`,
//! and the shell answers by calling `rainbow.recv(...)` in the chrome.
//!
//! Only the chrome webview may drive the shell. A page's IPC is limited to forwarding
//! browser shortcuts (Ctrl+T, Ctrl+E, ...) that the page swallowed, Escape, saying it was
//! clicked (for split view), and the http(s) address of a Shift+clicked link (for Peek),
//! so a page can never reach app actions or the agent.

// A shipped build is a GUI app: double-clicking Rainbow.exe must not leave a console window behind
// it. The `nightly` build keeps the console on purpose — the trace is the reason that build exists,
// and on Windows a GUI subsystem binary has no stdout to print to at all. Debug builds keep it too.
#![cfg_attr(all(windows, not(debug_assertions), not(feature = "nightly")), windows_subsystem = "windows")]

use std::{
    borrow::Cow,
    collections::HashMap,
    path::PathBuf,
    time::{Duration, Instant},
};

use base64::Engine as _;
use serde_json::{json, Value};
use winit::{
    application::ApplicationHandler,
    dpi::LogicalSize,
    event::WindowEvent,
    event_loop::{ActiveEventLoop, ControlFlow, EventLoop, EventLoopProxy},
    window::{ResizeDirection, Window, WindowId},
};
use wry::{
    dpi::{LogicalPosition, LogicalSize as WryLogicalSize},
    http::Response,
    NewWindowResponse, PageLoadEvent, Rect, WebContext, WebView, WebViewBuilder,
};
#[cfg(windows)]
use wry::WebViewBuilderExtWindows;

/// Apply the quiet Chromium switches where the platform has them (see `QUIET_ARGS`). A pass-through
/// elsewhere, so the call sites read the same on every platform.
#[cfg(windows)]
fn quiet(b: wry::WebViewBuilder<'_>) -> wry::WebViewBuilder<'_> {
    b.with_additional_browser_args(QUIET_ARGS)
}
#[cfg(not(windows))]
fn quiet(b: wry::WebViewBuilder<'_>) -> wry::WebViewBuilder<'_> {
    b
}

/// Where the surface page lives, next to the chrome's own.
#[cfg(windows)]
const SURFACE_URL: &str = "http://rainbow.localhost/surface.html";
#[cfg(not(windows))]
const SURFACE_URL: &str = "rainbow://localhost/surface.html";

/// Lift a view above its siblings: a child window is drawn in creation order unless told otherwise.
#[cfg(windows)]
fn raise(wv: &WebView) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE};
    use wry::WebViewExtWindows;
    unsafe {
        let _ = SetWindowPos(wv.hwnd(), Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}
#[cfg(not(windows))]
fn raise(_: &WebView) {}

/// A profile id as a folder name: letters and digits only, so an id from the chrome can never
/// point outside Rainbow's own folders.
fn profile_key(p: &str) -> String {
    let k: String = p.chars().filter(|c| c.is_ascii_alphanumeric()).take(32).collect();
    if k.is_empty() { "default".to_string() } else { k }
}

/// Each profile loads only its own extensions: `extensions/<profile>/<unpacked extension>`.
fn ext_dir(profile: &str) -> PathBuf {
    let root = data_root().join("extensions");
    let dir = root.join(profile);
    // Before profiles had their own, unpacked extensions sat directly in `extensions/`: those
    // belong to the default profile.
    if profile == "default" {
        if let Ok(rd) = std::fs::read_dir(&root) {
            for e in rd.flatten() {
                if e.path().join("manifest.json").exists() {
                    let _ = std::fs::create_dir_all(&dir);
                    let _ = std::fs::rename(e.path(), dir.join(e.file_name()));
                }
            }
        }
    }
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// What the toolbar needs to show an installed extension: its folder, its name and its icon.
fn ext_info(dir: &std::path::Path) -> Vec<Value> {
    let Ok(rd) = std::fs::read_dir(dir) else { return vec![] };
    rd.flatten()
        .filter(|e| e.path().is_dir())
        .map(|e| {
            let folder = e.file_name().to_string_lossy().into_owned();
            let man: Value = std::fs::read_to_string(e.path().join("manifest.json"))
                .ok()
                .and_then(|t| serde_json::from_str(t.trim_start_matches('\u{feff}')).ok())
                .unwrap_or(Value::Null);
            let name = man["name"].as_str().filter(|n| !n.starts_with("__MSG_")).unwrap_or(&folder).to_string();
            // The largest PNG icon up to 128px.
            let icon = man["icons"].as_object().and_then(|m| {
                m.iter()
                    .filter_map(|(k, v)| Some((k.parse::<u32>().ok()?, v.as_str()?)))
                    .filter(|(k, v)| *k <= 128 && v.to_ascii_lowercase().ends_with(".png"))
                    .max_by_key(|(k, _)| *k)
                    .and_then(|(_, v)| std::fs::read(e.path().join(v.trim_start_matches('/'))).ok())
                    .map(|b| format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(b)))
            });
            json!({"id": folder, "name": name, "icon": icon})
        })
        .collect()
}

#[cfg(windows)]
const CHROME_URL: &str = "http://rainbow.localhost/index.html";
#[cfg(not(windows))]
const CHROME_URL: &str = "rainbow://localhost/index.html";

/// The Chromium switches a browser needs to be a browser, borrowed from the idea that
/// a privacy-focused fork builds around (`enable_reporting=false`, `safe_browsing_mode=0`,
/// `enable_service_discovery=false`, `google_api_key=""` in its `flags.gn`). Rainbow cannot patch
/// Chromium — it drives the WebView2 that ships with Windows — but it can refuse the background
/// services that exist to report on the user rather than to render a page.
///
/// Two things to keep in mind. wry's own defaults live here too: supplying this string **replaces**
/// them, and they are not optional — `msWebOOUI` is the "mini menu" that appears on text selection,
/// `msPdfOOUI` the built-in PDF toolbar. And `--disable-features` is a single switch, so every
/// feature name has to be in one list; a second occurrence silently wins over the first.
#[cfg(windows)]
const QUIET_ARGS: &str = concat!(
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,",
    "OptimizationHints,OptimizationGuideModelDownloading,MediaRouter ",
    "--disable-background-networking ",
    "--disable-component-update ",
    "--disable-domain-reliability ",
    "--disable-breakpad ",
    "--disable-sync ",
    "--no-pings ",
    "--no-default-browser-check",
);

/// Injected into every page: forward the browser's own shortcuts to the chrome,
/// because keystrokes inside a page never reach the chrome webview.
const PAGE_KEYS: &str = r#"
addEventListener('keydown', function (e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || e.repeat) return;
  var k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if ('tlwerdsbknj,123456789'.indexOf(k) < 0 && k !== 'Tab' && k !== '[' && k !== ']') return;
  e.preventDefault(); e.stopPropagation();
  window.ipc.postMessage(JSON.stringify({ key: k, shift: e.shiftKey }));
}, true);
addEventListener('pointerdown', function () { window.ipc.postMessage('{"focus":true}'); }, true);
(function () {
  function add() { var st = document.createElement('style'); st.textContent = '::-webkit-scrollbar{width:10px;height:10px;background:transparent}::-webkit-scrollbar-track,::-webkit-scrollbar-corner{background:transparent}::-webkit-scrollbar-button{display:none}::-webkit-scrollbar-thumb{background:rgba(128,128,128,.55);background-clip:padding-box;border:3.5px solid transparent;border-radius:10px}::-webkit-scrollbar-thumb:hover{background:rgba(128,128,128,.85);background-clip:padding-box}'; (document.head || document.documentElement).appendChild(st); }
  // At document start there is no <html> yet; wait for it.
  if (document.documentElement) add();
  else new MutationObserver(function (_, o) { if (document.documentElement) { o.disconnect(); add(); } }).observe(document, { childList: true });
})();
addEventListener('keydown', function (e) {
  if (e.key === 'Escape') window.ipc.postMessage('{"key":"Escape","shift":false}');
}, true);
(function () {
  // The page's own icon, as it declares it: the chrome shows what the site shows, not a guess.
  function icon() {
    var ls = document.querySelectorAll('link[rel~="icon"]');
    for (var i = 0; i < ls.length; i++) {
      var u = ls[i].href;
      if (u && u.length < 20000) { window.ipc.postMessage(JSON.stringify({ icon: u })); return; }
    }
  }
  addEventListener('DOMContentLoaded', icon);
  addEventListener('load', icon);
})();
addEventListener('contextmenu', function (e) {
  // A right-click on an image or a selection offers Save to Canvas; the page says what and where.
  if (e.shiftKey || e.defaultPrevented) return;
  var sel = String(getSelection() || '').trim();
  var img = e.target.closest && e.target.closest('img');
  var c = null;
  if (img && /^https?:/i.test(img.currentSrc || img.src)) c = { kind: 'image', src: img.currentSrc || img.src };
  else if (sel.length > 1) c = { kind: 'text', text: sel.slice(0, 4000) };
  if (!c) return;
  e.preventDefault();
  c.x = e.clientX; c.y = e.clientY; c.title = String(document.title).slice(0, 200); c.url = String(location.href).slice(0, 2048);
  window.ipc.postMessage(JSON.stringify({ ctx: c }));
}, true);
addEventListener('contextmenu', function (e) {
  if (!e.shiftKey) return;
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a || !/^https?:/i.test(a.href)) return;
  e.preventDefault(); e.stopPropagation();
  window.ipc.postMessage(JSON.stringify({ newtab: a.href }));
}, true);
addEventListener('click', function (e) {
  if (!e.shiftKey || e.button !== 0) return;
  var a = e.target.closest && e.target.closest('a[href]');
  if (!a || !/^https?:/i.test(a.href)) return;
  e.preventDefault(); e.stopPropagation();
  window.ipc.postMessage(JSON.stringify({ peek: a.href }));
}, true);
"#;

/// Injected into every page: report what is playing (one line every time it changes) and
/// expose the fixed control vocabulary the shell may call. The page never sends commands.
const PAGE_MEDIA: &str = r#"
(function () {
  if (window.__rainbowMedia) return;
  var last = '', pending = 0;
  function pick() {
    var list = document.querySelectorAll('video,audio'), best = null, bs = -1;
    for (var i = 0; i < list.length; i++) {
      var el = list[i], r = el.getBoundingClientRect ? el.getBoundingClientRect() : null;
      var area = r ? Math.max(0, r.width) * Math.max(0, r.height) : 0;
      var s = area + (el.paused || el.ended ? 0 : 1e9) + (el.muted || el.volume === 0 ? 0 : 1e6)
            + (el.currentTime > 0 ? 1e5 : 0) + (isFinite(el.duration) ? 1e3 : 0);
      if (s > bs) { bs = s; best = el; }
    }
    return best;
  }
  function state() {
    var el = pick(), m = navigator.mediaSession && navigator.mediaSession.metadata;
    var s = { any: false, k: '', p: false, m: false, v: 1, t: 0, d: 0, r: 1,
              x: 0, y: 0, w: 0, h: 0, tt: '', ar: '', al: '', art: '',
              host: location.hostname || '', pip: !!document.pictureInPictureElement };
    if (m) {
      s.tt = m.title || ''; s.ar = m.artist || ''; s.al = m.album || '';
      var art = m.artwork;
      if (art && art.length) s.art = art[art.length - 1].src || '';
    }
    if (el) {
      s.any = true;
      s.k = el.tagName === 'VIDEO' ? 'video' : 'audio';
      s.p = !el.paused && !el.ended;
      s.m = el.muted || el.volume === 0;
      s.v = Math.max(0, Math.min(1, el.volume || 0));
      s.t = el.currentTime || 0;
      s.d = isFinite(el.duration) ? el.duration : 0;
      s.r = el.playbackRate || 1;
      if (s.k === 'video' && el.getBoundingClientRect) {
        var b = el.getBoundingClientRect();
        s.x = b.left; s.y = b.top; s.w = Math.max(0, b.width); s.h = Math.max(0, b.height);
      }
    }
    if (!s.tt) s.tt = document.title || '';
    return s;
  }
  function report() {
    var s = state(), key;
    try { key = JSON.stringify(s); } catch (e) { return; }
    if (key === last) return;
    last = key;
    window.ipc.postMessage(JSON.stringify({ media: s }));
  }
  function soon(ms) { if (pending) return; pending = setTimeout(function () { pending = 0; report(); }, ms || 200); }
  window.__rainbowMedia = function (op, v) {
    var el = pick();
    try {
      if (op === 'report') { report(); return true; }
      if (op === 'pip') {
        if (!el || el.tagName !== 'VIDEO') return false;
        if (document.pictureInPictureElement === el) { report(); return true; }
        return el.requestPictureInPicture().then(function () { report(); return true; },
          function () { return false; });
      }
      if (op === 'exitpip') {
        if (!document.pictureInPictureElement) return true;
        return document.exitPictureInPicture().then(function () { report(); return true; },
          function () { return false; });
      }
      if (!el) return false;
      if (op === 'toggle') {
        if (el.paused || el.ended) { var p = el.play(); if (p && p.catch) p.catch(function () {}); }
        else el.pause();
      } else if (op === 'play') { var q = el.play(); if (q && q.catch) q.catch(function () {}); }
      else if (op === 'pause') el.pause();
      else if (op === 'seek') {
        var d = isFinite(el.duration) ? el.duration : 0;
        el.currentTime = Math.max(0, d ? Math.min(d, v) : v);
      } else if (op === 'skip') {
        var d2 = isFinite(el.duration) ? el.duration : 0;
        el.currentTime = Math.max(0, d2 ? Math.min(d2, el.currentTime + v) : el.currentTime + v);
      } else if (op === 'stop') {
        el.pause();
        try { el.currentTime = 0; } catch (e) {}
      } else if (op === 'mute') {
        el.muted = !el.muted; if (!el.muted && el.volume === 0) el.volume = 1;
      } else if (op === 'volume') {
        el.volume = Math.max(0, Math.min(1, v)); el.muted = el.volume === 0;
      } else return false;
      soon(50);
      return true;
    } catch (e) { return false; }
  };
  ['play', 'pause', 'ended', 'volumechange', 'ratechange', 'loadedmetadata', 'durationchange',
   'seeked', 'emptied', 'enterpictureinpicture', 'leavepictureinpicture'].forEach(function (n) {
    document.addEventListener(n, function () { soon(120); }, true);
  });
  document.addEventListener('timeupdate', function () { soon(900); }, true);
  setInterval(report, 2500);
  if (document.readyState === 'complete') report(); else addEventListener('load', report);
})();
"#;

/// Page media states are data from the web: keep only the known keys, clip strings and
/// drop artwork that is neither an image data URL nor http(s).
fn clean_media(v: &Value) -> Option<Value> {
    if !v.is_object() {
        return None;
    }
    let f = |k: &str, lo: f64, hi: f64| {
        v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite()).unwrap_or(0.0).clamp(lo, hi)
    };
    let b = |k: &str| v.get(k).and_then(Value::as_bool).unwrap_or(false);
    let s = |k: &str, n: usize| v.get(k).and_then(Value::as_str).unwrap_or("").chars().take(n).collect::<String>();
    let art = {
        let a = s("art", 1400);
        if a.starts_with("http://") || a.starts_with("https://") || a.starts_with("data:image/") { a } else { String::new() }
    };
    let k = match v.get("k").and_then(Value::as_str) {
        Some("video") => "video",
        Some("audio") => "audio",
        _ => "",
    };
    Some(json!({
        "any": b("any"), "k": k, "p": b("p"), "m": b("m"),
        "v": f("v", 0.0, 1.0), "t": f("t", 0.0, 604800.0), "d": f("d", 0.0, 604800.0),
        "r": f("r", 0.1, 16.0), "x": f("x", -100000.0, 100000.0), "y": f("y", -100000.0, 100000.0),
        "w": f("w", 0.0, 100000.0), "h": f("h", 0.0, 100000.0),
        "tt": s("tt", 200), "ar": s("ar", 200), "al": s("al", 200), "art": art,
        "host": s("host", 120), "pip": b("pip"),
    }))
}

/// The rectangle a page reported (CSS px inside the page viewport).
fn rect_of(v: &Value) -> Option<(f64, f64, f64, f64)> {
    if !v.is_object() {
        return None;
    }
    let n = |k: &str| v.get(k).and_then(Value::as_f64).filter(|x| x.is_finite());
    Some((n("x")?, n("y")?, n("w")?, n("h")?))
}

/// Chromium's browser processes started by this app. Used to tell our PiP window
/// apart from another app's, so a baseline diff can never animate a foreign window.
#[cfg(windows)]
fn browser_pids() -> Vec<u32> {
    use windows::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let me = std::process::id();
    let mut out = vec![];
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        if snap == INVALID_HANDLE_VALUE {
            return out;
        }
        let mut e: PROCESSENTRY32W = std::mem::zeroed();
        e.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        if Process32FirstW(snap, &mut e).is_ok() {
            loop {
                if e.th32ParentProcessID == me {
                    out.push(e.th32ProcessID);
                }
                if Process32NextW(snap, &mut e).is_err() {
                    break;
                }
            }
        }
        let _ = CloseHandle(snap);
    }
    out
}

/// Top-level windows Chromium opened (the native PiP window and devtools share this class).
#[cfg(windows)]
fn pip_windows() -> Vec<isize> {
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetClassNameW, GetWindowThreadProcessId, IsWindowVisible,
    };
    let ours = browser_pids();
    unsafe extern "system" fn each(hwnd: HWND, out: LPARAM) -> BOOL {
        if IsWindowVisible(hwnd).as_bool() {
            let mut buf = [0u16; 96];
            let n = GetClassNameW(hwnd, &mut buf);
            if n > 0 && String::from_utf16_lossy(&buf[..n as usize]) == "Chrome_WidgetWin_1" {
                let mut pid = 0u32;
                GetWindowThreadProcessId(hwnd, Some(&mut pid));
                let acc = &mut *(out.0 as *mut (Vec<u32>, Vec<isize>));
                if acc.0.contains(&pid) {
                    acc.1.push(hwnd.0 as isize);
                }
            }
        }
        BOOL(1)
    }
    let mut found: (Vec<u32>, Vec<isize>) = (ours, vec![]);
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize));
    }
    found.1
}

#[cfg(windows)]
fn pip_bounds(hwnd: isize) -> Option<(f64, f64, f64, f64)> {
    use windows::Win32::Foundation::{HWND, RECT};
    use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
    let mut r = RECT::default();
    unsafe { GetWindowRect(HWND(hwnd as *mut _), &mut r).ok()? };
    Some((r.left as f64, r.top as f64, (r.right - r.left) as f64, (r.bottom - r.top) as f64))
}

/// Slide and resize the native PiP window to a new rect, one frame per step.
#[cfg(windows)]
fn animate_pip(hwnd: isize, from: (f64, f64, f64, f64), to: (f64, f64, f64, f64), frames: u32, ms: u64) {
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER};
    let h = windows::Win32::Foundation::HWND(hwnd as *mut _);
    for i in 1..=frames {
        let t = i as f64 / frames as f64;
        let e = 1.0 - (1.0 - t).powi(3);
        let mix = |a: f64, b: f64| (a + (b - a) * e).round() as i32;
        unsafe {
            let _ = SetWindowPos(
                h,
                None,
                mix(from.0, to.0),
                mix(from.1, to.1),
                mix(from.2, to.2).max(80),
                mix(from.3, to.3).max(45),
                SWP_NOZORDER | SWP_NOACTIVATE,
            );
        }
        std::thread::sleep(Duration::from_millis((ms / frames.max(1) as u64).max(1)));
    }
}

/// Rainbow's per-user data: one folder per profile (logins, cookies) and the extensions folder.
fn data_root() -> PathBuf {
    if let Some(p) = std::env::var_os("RAINBOW_DATA_ROOT") {
        return PathBuf::from(p);
    }
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/share")))
        .unwrap_or_else(std::env::temp_dir);
    base.join("Rainbow")
}

enum UserEvent {
    /// A message from the chrome webview.
    Chrome(String),
    /// Something the shell reports back to the chrome (page events, snapshots).
    ToChrome(Value),
    /// The native picture-in-picture window a tab's video floated into, and the page rect it
    /// covered before floating (the point it slides back to).
    Pip(u64, isize, (f64, f64, f64, f64)),
    /// The app-wide foreground window changed. A PiP window coming forward means the user
    /// clicked it: bring its tab back instead of leaving a floating window to interact with.
    Foreground(isize),
    /// Run a fixed script in a tab once a native animation has finished.
    Run(u64, &'static str),
    /// Write one PNG of the chrome and quit (RAINBOW_SHOT). A diagnostic, not a feature.
    Shot(PathBuf),
    /// The chrome capture finished (or timed out): now the loop may stop.
    ShotDone,
    /// The chrome has not said anything yet. A blank chrome paints nothing and the window
    /// looks black, so it is worth one reload.
    ChromePing,
}

/// Count, total and worst time for one native operation. Kept behind an env var so the
/// normal build pays nothing but the counters still answer "where does the frame go?".
#[derive(Default)]
struct Agg {
    n: u64,
    total: f64,
    max: f64,
}

impl Agg {
    fn add(&mut self, d: Duration) {
        let us = d.as_secs_f64() * 1e6;
        self.n += 1;
        self.total += us;
        if us > self.max {
            self.max = us;
        }
    }
    fn avg(&self) -> f64 {
        if self.n == 0 { 0.0 } else { self.total / self.n as f64 }
    }
    fn json(&self) -> Value {
        json!({"n": self.n, "avg_us": self.avg().round(), "max_us": self.max.round()})
    }
}

/// RAINBOW_PERF=1 writes a line per second with how long the native resize path took.
struct Perf {
    window: std::fs::File,
    next: Instant,
    resized: u64,
    layouts: u64,
    chrome: Agg,
    pane: Agg,
    region: Agg,
}

impl Perf {
    fn open() -> Option<Self> {
        if std::env::var_os("RAINBOW_PERF").is_none() {
            return None;
        }
        let path = std::env::temp_dir().join(format!("rainbow-perf-{}.log", std::process::id()));
        let file = std::fs::OpenOptions::new().create(true).append(true).open(path).ok()?;
        Some(Self { window: file, next: Instant::now() + Duration::from_secs(1), resized: 0, layouts: 0, chrome: Agg::default(), pane: Agg::default(), region: Agg::default() })
    }
    fn flush(&mut self, now: Instant) {
        use std::io::Write as _;
        if now < self.next {
            return;
        }
        self.next = now + Duration::from_secs(1);
        let _ = writeln!(
            self.window,
            "resized={} layouts={} chrome={} pane={} region={}",
            self.resized,
            self.layouts,
            self.chrome.json(),
            self.pane.json(),
            self.region.json()
        );
        self.chrome = Agg::default();
        self.pane = Agg::default();
        self.region = Agg::default();
        self.resized = 0;
        self.layouts = 0;
    }
}

/// RAINBOW_BENCH=1 drives its own resize loop on a throwaway profile and writes
/// `%TEMP%/rainbow-bench.json`, so the resize cost can be compared without a mouse or eyes.
struct Bench {
    step: u32,
    next: Instant,
    started: Instant,
    late: Agg,
    chrome: Agg,
    pane: Agg,
    region: Agg,
    resized: u64,
    layouts: u64,
    tabs: Vec<u64>,
}

struct App {
    proxy: EventLoopProxy<UserEvent>,
    window: Option<Window>,
    chrome: Option<WebView>,
    tabs: HashMap<u64, WebView>,
    /// The tabs on screen and where: one, or two side by side in split view. The flag marks
    /// a floating pane (Peek) that stays visible while an overlay is up.
    panes: Vec<(u64, Rect, bool)>,
    /// The surface view and what it is showing (re-sent once its page has loaded).
    surface: Option<WebView>,
    surface_view: String,
    /// One web context per profile, so each keeps its own logins and cookies.
    contexts: HashMap<String, WebContext>,
    /// The tab that should hold keyboard focus.
    active: Option<u64>,
    /// Page corner radius in logical px.
    radius: f64,
    /// While an overlay (Ask Rainbow, command bar) is up, the page is hidden and the chrome
    /// shows a blurred snapshot of it instead: a native child can't be blurred by CSS.
    overlay: bool,
    /// Ask Rainbow's bottom band is up: pages stay visible, but the chrome keeps keyboard focus.
    asking: bool,
    /// The chrome is drawn over the page, clipped to the sidebar column: the width of that
    /// column in logical px while the collapsed sidebar or the grown rail is showing.
    chrome_over: Option<f64>,
    /// The compact bar's height in logical px while it is showing; 0 when it is not. The page
    /// is a child window above the chrome, so the bar only survives by clipping this strip.
    chrome_bar: Option<f64>,
    chrome_bar_h: f64,
    /// The bar's width in logical px, or 0 for the whole window. The strip is only as wide as
    /// the bar: while the bar rides the peeked sidebar it must not cover the page beside it.
    chrome_bar_w: f64,
    /// A strip of chrome drawn over the live page (Ask Rainbow's wash): (top, height) in logical px.
    chrome_band: Vec<(f64, f64, f64, f64)>,
    /// The peeked sidebar is on the right of the window (tabs on the right).
    chrome_right: bool,
    /// Whether the chrome is currently clipped and raised (kept so the normal path does no work).
    clipped: bool,
    /// The size the chrome webview was last given, in logical px. A window created before a
    /// monitor is attached gets a 0x0 chrome, no Resized ever arrives to fix it, and the
    /// window stays black; the tick below compares this to the window and repairs it.
    chrome_size: Option<(u32, u32)>,
    /// The chrome has spoken once, so it loaded; see the re-assert in `handle`.
    chrome_shown: bool,
    /// The chrome has been reloaded once after a silent start (see `UserEvent::ChromePing`).
    chrome_retried: bool,
    /// What each pane was last given, so an unchanged pane costs nothing.
    placed: HashMap<u64, [f64; 6]>,
    /// Latest window size waiting for the next frame. Windows sends many WM_SIZE per
    /// frame while the edge is dragged; applying each one resizes the chrome and every
    /// page just as often.
    pending_size: Option<(f64, f64)>,
    /// When the pending size may be applied (one per frame at most).
    frame_at: Option<Instant>,
    /// When the drag has been quiet long enough to restore exact corner clipping.
    settle_at: Option<Instant>,
    /// A pane was resized without its rounded region; rebuild on settle.
    region_dirty: bool,
    perf: Option<Perf>,
    bench: Option<Bench>,
    /// The native PiP window each tab is floating in, and the page rect it came from.
    pip_hwnd: HashMap<u64, isize>,
    pip_from: HashMap<u64, (f64, f64, f64, f64)>,
    /// When each PiP window appeared; its first foreground flash is Chromium's own.
    pip_since: HashMap<u64, Instant>,
}

/// RAINBOW_LEGACY_RESIZE=1 restores the old behaviour of applying every resize immediately.
fn legacy_resize() -> bool {
    std::env::var_os("RAINBOW_LEGACY_RESIZE").is_some()
}

/// RAINBOW_KEEP_REGION=1 restores rebuilding the GDI region on every pane resize.
fn keep_region() -> bool {
    std::env::var_os("RAINBOW_KEEP_REGION").is_some()
}

fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
    Rect {
        position: LogicalPosition::new(x, y).into(),
        size: WryLogicalSize::new(w.max(0.0), h.max(0.0)).into(),
    }
}

/// Where captured Canvas images live once they are too big for the chrome's store: one file per
/// capture, readable by other apps and outside the localStorage quota.
fn media_dir() -> PathBuf {
    data_root().join("media")
}

/// A media name is a flat filename (`c<id>-<stamp>.jpg`) and nothing else: no folders, no `..`.
fn safe_media_name(name: &str) -> Option<&str> {
    if name.is_empty() || name.len() > 96 {
        return None;
    }
    let ok = name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'));
    if ok && !name.contains("..") { Some(name) } else { None }
}

fn image_mime(name: &str) -> &'static str {
    match name.rsplit('.').next() {
        Some("png") => "image/png",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("svg") => "image/svg+xml",
        _ => "image/jpeg",
    }
}

/// Write one data URL to the media folder and return the URL the chrome can load it from.
fn save_media(name: &str, data_url: &str) -> Option<String> {
    let name = safe_media_name(name)?;
    let (meta, body) = data_url.split_once(',')?;
    if !meta.starts_with("data:image/") {
        return None;
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(body).ok()?;
    std::fs::create_dir_all(media_dir()).ok()?;
    std::fs::write(media_dir().join(name), &bytes).ok()?;
    Some(format!("http://rainbow.localhost/media/{name}"))
}

fn remove_media(name: &str) {
    if let Some(name) = safe_media_name(name) {
        let _ = std::fs::remove_file(media_dir().join(name));
    }
}

fn ui_file(path: &str) -> Option<(Cow<'static, [u8]>, &'static str)> {
    let path = path.trim_start_matches('/');
    // Captured images are served from the media folder, not the embedded chrome.
    if let Some(name) = path.strip_prefix("media/") {
        let name = safe_media_name(name)?;
        let body = std::fs::read(media_dir().join(name)).ok()?;
        return Some((Cow::Owned(body), image_mime(name)));
    }
    let path = if path.is_empty() { "index.html" } else { path };
    if path.contains("..") {
        return None;
    }
    let mime = match path.rsplit('.').next() {
        Some("html") => "text/html",
        Some("css") => "text/css",
        Some("js") => "text/javascript",
        Some("svg") => "image/svg+xml",
        Some("png") => "image/png",
        Some("woff2") => "font/woff2",
        _ => "application/octet-stream",
    };
    // A shipped exe carries its chrome; a source checkout can still serve ui/ from disk
    // (RAINBOW_UI_DIR, or any debug build) so the chrome is editable without a rebuild.
    if let Some(dir) = std::env::var_os("RAINBOW_UI_DIR") {
        let dir = dir.to_string_lossy();
        return std::fs::read(format!("{dir}/{path}")).ok().map(|b| (Cow::Owned(b), mime));
    }
    if cfg!(debug_assertions) && std::env::var_os("RAINBOW_UI_EMBEDDED").is_none() {
        let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/ui");
        if let Ok(b) = std::fs::read(format!("{dir}/{path}")) {
            return Some((Cow::Owned(b), mime));
        }
    }
    assets::UI
        .iter()
        .find(|(name, _, _)| *name == path)
        .map(|(_, mime, body)| (Cow::Borrowed(*body), *mime))
}

mod assets {
    include!(concat!(env!("OUT_DIR"), "/ui_assets.rs"));
}

impl App {
    fn to_chrome(&self, v: &Value) {
        if let Some(c) = &self.chrome {
            let _ = c.evaluate_script(&format!("window.rainbow && rainbow.recv({v})"));
        }
    }

    fn media_cmd(&mut self, id: u64, op: &str, v: f64, rect: &Value, pane: &Value) {
        // The vocabulary is fixed here; the page only ever sees one of these names.
        let allowed = matches!(
            op,
            "toggle" | "play" | "pause" | "seek" | "skip" | "mute" | "volume" | "pip" | "exitpip" | "report" | "stop"
        );
        if !allowed || !v.is_finite() {
            return;
        }
        #[cfg(windows)]
        {
            let scale = self.window.as_ref().map(|w| w.scale_factor()).unwrap_or(1.0);
            let origin = self.chrome.as_ref().and_then(|c| {
                use windows::Win32::Foundation::RECT;
                use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
                use wry::WebViewExtWindows as _;
                let mut r = RECT::default();
                unsafe { GetWindowRect(c.hwnd(), &mut r).ok()? };
                Some((r.left as f64, r.top as f64))
            }).unwrap_or((0.0, 0.0));
            let to_screen = |r: Option<(f64, f64, f64, f64)>| {
                r.map(|(x, y, w, h)| (origin.0 + x * scale, origin.1 + y * scale, w * scale, h * scale))
            };
            if op == "pip" {
                let baseline = pip_windows();
                if let Some(wv) = self.tabs.get(&id) {
                    let _ = wv.evaluate_script("window.__rainbowMedia&&window.__rainbowMedia(\"pip\",0)");
                }
                let from = to_screen(rect_of(rect));
                let area = to_screen(rect_of(pane));
                let proxy = self.proxy.clone();
                std::thread::spawn(move || {
                    let mut found = None;
                    for _ in 0..24 {
                        std::thread::sleep(Duration::from_millis(50));
                        if let Some(h) = pip_windows().into_iter().find(|h| !baseline.contains(h)) {
                            found = Some(h);
                            break;
                        }
                    }
                    let Some(hwnd) = found else { return };
                    let Some(native) = pip_bounds(hwnd) else { return };
                    let start = from.unwrap_or(native);
                    let _ = proxy.send_event(UserEvent::Pip(id, hwnd, start));
                    let (px, py, pw, ph) = area.unwrap_or((0.0, 0.0, 1280.0, 800.0));
                    let w = (pw * 0.30).clamp(280.0, 560.0);
                    let ratio = if start.2 > 0.0 && start.3 > 0.0 { start.3 / start.2 } else { 9.0 / 16.0 };
                    let hgt = (w * ratio).min((ph * 0.5).max(140.0)).max(140.0);
                    let margin = 18.0 * scale.max(0.5);
                    let to = (px + pw - w - margin, py + ph - hgt - margin, w, hgt);
                    animate_pip(hwnd, start, to, 16, 280);
                });
                return;
            }
            if op == "exitpip" {
                if let Some(hwnd) = self.pip_hwnd.remove(&id) {
                    let back = self.pip_from.remove(&id);
                    self.pip_since.remove(&id);
                    let proxy = self.proxy.clone();
                    std::thread::spawn(move || {
                        if let (Some(b), Some(cur)) = (back, pip_bounds(hwnd)) {
                            animate_pip(hwnd, cur, b, 12, 190);
                        }
                        let _ = proxy.send_event(UserEvent::Run(
                            id,
                            "window.__rainbowMedia&&window.__rainbowMedia(\"exitpip\",0)",
                        ));
                    });
                    return;
                }
            }
            if op == "pip" || op == "exitpip" {
                if let Some(wv) = self.tabs.get(&id) {
                    let _ = wv.evaluate_script(&format!("window.__rainbowMedia&&window.__rainbowMedia({},0)", json!(op)));
                }
                return;
            }
        }
        if let Some(wv) = self.tabs.get(&id) {
            let _ = wv.evaluate_script(&format!(
                "window.__rainbowMedia&&window.__rainbowMedia({},{})",
                json!(op),
                json!(v.clamp(-604800.0, 604800.0))
            ));
        }
    }

    fn open_tab(&mut self, id: u64, url: &str, profile: &str) {
        let Some(window) = &self.window else { return };
        let (p1, p2, p3, p4) = (self.proxy.clone(), self.proxy.clone(), self.proxy.clone(), self.proxy.clone());
        let (p5, p6) = (self.proxy.clone(), self.proxy.clone());
        let key = profile_key(profile);
        let ctx = self
            .contexts
            .entry(key.clone())
            .or_insert_with(|| WebContext::new(Some(data_root().join("profiles").join(&key))));
        let builder = quiet(WebViewBuilder::new_with_web_context(ctx)
            .with_url(url)
            .with_visible(false)
            .with_bounds(rect(0.0, 0.0, 0.0, 0.0))
            .with_devtools(true)
            .with_initialization_script(PAGE_KEYS)
            .with_initialization_script(PAGE_MEDIA))
            .with_ipc_handler(move |req| {
                // A page may only forward a key name and the shift flag, or say it was clicked;
                // the tab id comes from here, never from the page.
                if let Ok(v) = serde_json::from_str::<Value>(req.body()) {
                    if let Some(s) = v.get("media").and_then(clean_media) {
                        let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "media", "id": id, "s": s})));
                        return;
                    }
                    if let Some(c) = v["ctx"].as_object() {
                        // What a right-click can ask for is small and checked here, not trusted.
                        let s = |k: &str, n: usize| c.get(k).and_then(|x| x.as_str()).map(|x| x.chars().take(n).collect::<String>());
                        let n = |k: &str| c.get(k).and_then(|x| x.as_f64()).unwrap_or(0.0).clamp(0.0, 20000.0);
                        let kind = s("kind", 8).unwrap_or_default();
                        let src = s("src", 2048);
                        let ok = (kind == "text" && s("text", 4000).is_some()) || (kind == "image" && src.as_deref().is_some_and(|u| u.starts_with("http://") || u.starts_with("https://")));
                        if ok {
                            let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "ctx", "id": id, "ctx": {
                                "kind": kind, "src": src, "text": s("text", 4000), "title": s("title", 200), "url": s("url", 2048), "x": n("x"), "y": n("y") }})));
                        }
                        return;
                    }
                    if let Some(u) = v["icon"].as_str() {
                        if u.starts_with("https://") || u.starts_with("http://") || u.starts_with("data:image/") {
                            let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "icon", "id": id, "href": u})));
                        }
                        return;
                    }
                    if let Some(u) = v["newtab"].as_str() {
                        if u.starts_with("http://") || u.starts_with("https://") {
                            let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "newtab", "id": id, "url": u})));
                        }
                        return;
                    }
                    if let Some(u) = v["peek"].as_str() {
                        if u.starts_with("http://") || u.starts_with("https://") {
                            let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "peek", "id": id, "url": u})));
                        }
                        return;
                    }
                    if v["focus"].as_bool() == Some(true) {
                        let _ = p1.send_event(UserEvent::ToChrome(json!({"t": "focus", "id": id})));
                        return;
                    }
                    let key = v["key"].as_str().unwrap_or("").chars().take(8).collect::<String>();
                    let _ = p1.send_event(UserEvent::ToChrome(
                        json!({"t": "key", "key": key, "shift": v["shift"].as_bool().unwrap_or(false)}),
                    ));
                }
            })
            .with_document_title_changed_handler(move |title| {
                let _ = p2.send_event(UserEvent::ToChrome(json!({"t": "page", "id": id, "title": title})));
            })
            .with_on_page_load_handler(move |ev, url| {
                let loading = matches!(ev, PageLoadEvent::Started);
                let _ = p3.send_event(UserEvent::ToChrome(
                    json!({"t": "page", "id": id, "url": url, "loading": loading}),
                ));
            })
            .with_new_window_req_handler(move |url, _| {
                let _ = p4.send_event(UserEvent::ToChrome(json!({"t": "popup", "id": id, "url": url})));
                NewWindowResponse::Deny
            })
            .with_download_started_handler(move |url, path| {
                let _ = p5.send_event(UserEvent::ToChrome(
                    json!({"t": "download", "url": url, "path": path.to_string_lossy(), "state": "started"}),
                ));
                true
            })
            .with_download_completed_handler(move |url, path, ok| {
                let path = path.map(|p| p.to_string_lossy().into_owned());
                let size = path.as_deref().and_then(|p| std::fs::metadata(p).ok()).map(|m| m.len());
                let _ = p6.send_event(UserEvent::ToChrome(
                    json!({"t": "download", "url": url, "path": path, "size": size, "state": if ok { "done" } else { "failed" }}),
                ));
            });
        // Chromium extensions: every unpacked folder inside Rainbow's extensions folder loads.
        #[cfg(windows)]
        let builder = {
            builder.with_browser_extensions_enabled(true).with_extensions_path(ext_dir(&key))
        };
        let built = builder.build_as_child(window);
        match built {
            Ok(wv) => {
                self.placed.remove(&id); // a reused id starts at 0x0 and must be placed again
                self.tabs.insert(id, wv);
                if let Some(sf) = &self.surface {
                    raise(sf);   // a view made later sits above it unless it is lifted again
                }
            }
            Err(e) => eprintln!("rainbow: tab {id} failed: {e}"),
        }
    }

    /// Place every visible pane and hide the rest. Focus moves only when the active tab changes.
    /// `{t:'surface', on, x, y, w, h, view}`: show, move or hide the surface. The view is data the
    /// surface page renders as text, never markup.
    fn surface(&mut self, m: &Value) {
        let on = m["on"].as_bool().unwrap_or(false);
        let n = |k: &str| m[k].as_f64().unwrap_or(0.0);
        let r = rect(n("x"), n("y"), n("w"), n("h"));
        if self.surface.is_none() && on {
            let Some(window) = &self.window else { return };
            let (ready, act) = (self.proxy.clone(), self.proxy.clone());
            let built = quiet(WebViewBuilder::new()
                .with_url(SURFACE_URL)
                .with_transparent(true)
                .with_visible(false)
                .with_bounds(r)
                .with_custom_protocol("rainbow".into(), |_, req| match ui_file(req.uri().path()) {
                    Some((body, mime)) => Response::builder().header("Content-Type", mime).body(body).unwrap(),
                    None => Response::builder().status(404).body(Cow::Borrowed(&b""[..])).unwrap(),
                })
                .with_on_page_load_handler(move |ev, _| {
                    if matches!(ev, PageLoadEvent::Finished) {
                        let _ = ready.send_event(UserEvent::Chrome(r#"{"t":"surfaceReady"}"#.to_string()));
                    }
                })
                .with_ipc_handler(move |req| {
                    // The surface may only say which of its buttons was pressed.
                    if let Ok(v) = serde_json::from_str::<Value>(req.body()) {
                        if let Some(a) = v["act"].as_str() {
                            let a: String = a.chars().take(32).collect();
                            let _ = act.send_event(UserEvent::ToChrome(json!({"t": "surfaceAct", "act": a})));
                        }
                    }
                }))
            .build_as_child(window);
            match built {
                Ok(wv) => self.surface = Some(wv),
                Err(e) => eprintln!("rainbow: surface failed: {e}"),
            }
        }
        if let Some(wv) = &self.surface {
            if on {
                self.surface_view = m["view"].to_string();
                let _ = wv.set_bounds(r);
                let _ = wv.evaluate_script(&format!("window.surface && surface.set({})", self.surface_view));
                let _ = wv.set_visible(true);
                raise(wv);
                if m["focus"].as_bool() == Some(true) {
                    let _ = wv.focus();   // a menu takes the keyboard (Escape)
                }
            } else {
                let _ = wv.set_visible(false);
                self.surface_view.clear();
                if !self.overlay && !self.asking {
                    if let Some(tab) = self.active.and_then(|a| self.tabs.get(&a)) {
                        let _ = tab.focus();
                    }
                }
            }
        }
    }

    fn apply_surface(&self) {
        if let (Some(wv), false) = (&self.surface, self.surface_view.is_empty()) {
            let _ = wv.evaluate_script(&format!("window.surface && surface.set({})", self.surface_view));
        }
    }

    fn layout(&mut self, panes: Vec<(u64, Rect, bool)>, active: Option<u64>) {
        for (id, _, _) in &self.panes {
            if !panes.iter().any(|(p, _, _)| p == id) {
                if let Some(wv) = self.tabs.get(id) {
                    let _ = wv.set_visible(false);
                }
                self.placed.remove(id);
            }
        }
        let refocus = active != self.active;
        let had_top = self.panes.iter().any(|p| p.2);
        let top = panes.iter().find(|p| p.2).map(|p| p.0);
        self.panes = panes;
        self.active = active;
        self.place();
        if let (Some(id), false) = (top, had_top) {
            if let Some(wv) = self.tabs.get(&id) {
                let _ = wv.focus();
            }
        } else if refocus && !self.overlay && !self.asking {
            if let Some(wv) = active.and_then(|a| self.tabs.get(&a)) {
                let _ = wv.focus();
            }
        }
    }

    fn place(&mut self) {
        let scale = self.window.as_ref().map_or(1.0, |w| w.scale_factor());
        // While the window edge is being dragged, rebuilding a rounded window region for
        // every pane, every frame, costs more than it shows: the corners are square for a
        // moment and are restored exactly once the drag settles.
        let fast = self.settle_at.is_some() && !keep_region();
        for (id, r, top) in &self.panes {
            let Some(wv) = self.tabs.get(id) else { continue };
            let (pos, size) = (r.position.to_logical::<f64>(scale), r.size.to_logical::<f64>(scale));
            let key = [pos.x, pos.y, size.width, size.height, self.radius, f64::from(self.overlay)];
            if self.placed.get(id) == Some(&key) {
                continue;
            }
            self.placed.insert(*id, key);
            let t = Instant::now();
            let _ = wv.set_bounds(*r);
            let d = t.elapsed();
            if let Some(p) = &mut self.perf {
                p.pane.add(d);
            }
            if let Some(b) = &mut self.bench {
                b.pane.add(d);
            }
            if fast {
                self.region_dirty = true;
            } else {
                let t = Instant::now();
                round(wv, r.size.to_physical::<f64>(scale), self.radius * scale);
                let d = t.elapsed();
                if let Some(p) = &mut self.perf {
                    p.region.add(d);
                }
                if let Some(b) = &mut self.bench {
                    b.region.add(d);
                }
            }
            let _ = wv.set_visible(!self.overlay || *top);
        }
        // The clip is cut around the panes, so it has to follow them.
        if self.chrome_over.is_some() || self.clipped {
            self.reclip();
        }
    }

    /// Cut the chrome around the page and raise it over the page, or put it back behind. The
    /// sidebar floats over the page by drawing the chrome everywhere the page is not.
    fn reclip(&mut self) {
        // A full overlay (command bar, settings) and Ask Rainbow's band both draw across the
        // window, so neither can live inside the sidebar column's clip.
        let mut want = self.chrome_over.filter(|_| !self.overlay && !self.asking);
        // The compact bar is its own strip across the top: it clips even when the sidebar
        // column is not out, because the page would otherwise cover it.
        self.chrome_bar_h = self.chrome_bar.filter(|_| !self.overlay && !self.asking).unwrap_or(0.0);
        // Ask Rainbow's wash is a band of chrome over the live page; it is on while the question is asked.
        let band: Vec<(f64, f64, f64, f64)> = if self.overlay { Vec::new() } else { self.chrome_band.clone() };
        if (self.chrome_bar_h > 0.0 || !band.is_empty()) && want.is_none() {
            want = Some(0.0);
        }
        // A minimized or not-yet-shown window has no area to clip to, and clipping there
        // leaves the chrome with a zero region, which the user sees as a black window.
        let win = self
            .window
            .as_ref()
            .map(|w| {
                let s = w.inner_size();
                (s.width as i32, s.height as i32)
            })
            .unwrap_or((0, 0));
        let want = want.filter(|_| win.0 >= 64 && win.1 >= 64);
        if want.is_none() && !self.clipped {
            return;
        }
        self.clipped = want.is_some();
        let Some(c) = &self.chrome else { return };
        let scale = self.window.as_ref().map_or(1.0, |w| w.scale_factor());
        chrome_over(c, want, scale, win, &self.panes, self.chrome_bar_h, self.chrome_bar_w, &band, self.chrome_right);
    }

    /// Rebuild the exact corner regions once the window has stopped moving.
    fn settle(&mut self) {
        if !self.region_dirty {
            return;
        }
        self.region_dirty = false;
        let scale = self.window.as_ref().map_or(1.0, |w| w.scale_factor());
        for (id, r, _) in &self.panes {
            let Some(wv) = self.tabs.get(id) else { continue };
            let t = Instant::now();
            round(wv, r.size.to_physical::<f64>(scale), self.radius * scale);
            let d = t.elapsed();
            if let Some(p) = &mut self.perf {
                p.region.add(d);
            }
            if let Some(b) = &mut self.bench {
                b.region.add(d);
            }
        }
    }

    fn apply_window_size(&mut self, w: f64, h: f64) {
        self.chrome_size = Some((w.round() as u32, h.round() as u32));
        if let (Some(win), Some(chrome)) = (&self.window, &self.chrome) {
            let _ = win;
            let t = Instant::now();
            let _ = chrome.set_bounds(rect(0.0, 0.0, w, h));
            let d = t.elapsed();
            if let Some(p) = &mut self.perf {
                p.chrome.add(d);
            }
            if let Some(b) = &mut self.bench {
                b.chrome.add(d);
            }
        }
    }

    /// RAINBOW_BENCH=1: open two heavy local pages and resize them in a loop, so the
    /// resize path can be measured without a mouse. Writes %TEMP%/rainbow-bench.json.
    fn start_bench(&mut self) {
        if std::env::var_os("RAINBOW_BENCH").is_none() {
            return;
        }
        let ids = [900_001u64, 900_002];
        for id in ids {
            self.open_tab(id, "http://localhost:5178/perf.html", "default");
            if let Some(wv) = self.tabs.get(&id) {
                let _ = wv.set_visible(true);
            }
        }
        self.bench = Some(Bench {
            step: 0,
            next: Instant::now() + Duration::from_millis(700),
            started: Instant::now(),
            late: Agg::default(),
            chrome: Agg::default(),
            pane: Agg::default(),
            region: Agg::default(),
            resized: 0,
            layouts: 0,
            tabs: ids.to_vec(),
        });
    }

    fn bench_tick(&mut self, el: &ActiveEventLoop, now: Instant) {
        let Some(bench) = &self.bench else { return };
        if now < bench.next {
            return;
        }
        if bench.step >= 240 {
            let bench = self.bench.take().unwrap();
            let out = json!({
                "steps": bench.step,
                "seconds": bench.started.elapsed().as_secs_f64(),
                "resized_events": bench.resized,
                "layout_messages": bench.layouts,
                "tick_late": bench.late.json(),
                "chrome_resize": bench.chrome.json(),
                "pane_resize": bench.pane.json(),
                "corner_region": bench.region.json(),
                "legacy_resize": legacy_resize(),
                "keep_region": keep_region(),
            });
            let path = std::env::temp_dir().join("rainbow-bench.json");
            let _ = std::fs::write(&path, serde_json::to_vec_pretty(&out).unwrap_or_default());
            eprintln!("rainbow: bench written to {}", path.display());
            el.exit();
            return;
        }
        let (step, next) = (bench.step + 1, bench.next + Duration::from_millis(16));
        let late = now.saturating_duration_since(bench.next);
        if let Some(b) = &mut self.bench {
            b.step = step;
            b.next = next;
            b.late.add(late);
        }
        let (w, h) = if step < 120 {
            // A drag: many small size changes, one every frame.
            let p = step as f64;
            (1050.0 + 220.0 * (p * 0.35).sin(), 720.0 + 120.0 * (p * 0.19).sin())
        } else if (step / 8) % 2 == 0 {
            // A sidebar collapse: the page area jumps by ~200px in one frame.
            (1300.0, 860.0)
        } else {
            (1050.0, 720.0)
        };
        if let Some(win) = &self.window {
            let _ = win.request_inner_size(LogicalSize::new(w, h));
        }
        let (a, b) = self.bench.as_ref().map_or((0, 0), |b| (b.tabs[0], b.tabs[1]));
        self.layout(
            vec![
                (a, rect(248.0, 8.0, w * 0.5 - 252.0, h - 16.0), false),
                (b, rect(w * 0.5, 8.0, w * 0.5 - 8.0, h - 16.0), false),
            ],
            Some(a),
        );
    }

    fn rearm(&self, el: &ActiveEventLoop) {
        let mut deadline: Option<Instant> = self.frame_at;
        if let Some(t) = self.settle_at {
            deadline = Some(deadline.map_or(t, |d| d.min(t)));
        }
        if let Some(b) = &self.bench {
            deadline = Some(deadline.map_or(b.next, |d| d.min(b.next)));
        }
        if let Some(d) = deadline {
            el.set_control_flow(ControlFlow::WaitUntil(d));
        }
    }

    fn snapshot(&self, id: u64) {
        let Some(wv) = self.tabs.get(&id) else {
            self.to_chrome(&json!({"t": "snapshot", "id": id, "data": null}));
            return;
        };
        capture(wv, id, "snapshot", self.proxy.clone());
    }

    /// One JPEG of a page, as a data URL. "Visible" goes through `CapturePreview`, which is the
    /// native path and survives where a DevTools screenshot does not; "Full page" needs
    /// `captureBeyondViewport`, which only the DevTools protocol offers.
    fn shot_tab(&self, id: u64, full: bool) {
        if !full {
            let Some(wv) = self.tabs.get(&id) else {
                self.to_chrome(&json!({"t": "shot", "id": id, "data": null}));
                return;
            };
            capture(wv, id, "shot", self.proxy.clone());
            return;
        }
        use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
        use windows::core::{HSTRING, PCWSTR};
        use wry::WebViewExtWindows;
        let Some(wv) = self.tabs.get(&id) else {
            self.to_chrome(&json!({"t": "shot", "id": id, "data": null}));
            return;
        };
        let params = if full {
            r#"{"format":"jpeg","quality":88,"captureBeyondViewport":true}"#
        } else {
            r#"{"format":"jpeg","quality":88}"#
        };
        let proxy = self.proxy.clone();
        let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |_hr, json| {
            let Ok(v) = serde_json::from_str::<Value>(&json) else {
                let _ = proxy.send_event(UserEvent::ToChrome(json!({"t": "shot", "id": id, "data": null})));
                return Ok(());
            };
            let data = v["data"].as_str().unwrap_or_default();
            let reply = if data.is_empty() {
                json!({"t": "shot", "id": id, "data": null})
            } else {
                json!({"t": "shot", "id": id, "data": format!("data:image/jpeg;base64,{data}")})
            };
            let _ = proxy.send_event(UserEvent::ToChrome(reply));
            Ok(())
        }));
        let method = HSTRING::from("Page.captureScreenshot");
        let params = HSTRING::from(params);
        let r = unsafe {
            wv.webview()
                .CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler)
        };
        if r.is_err() {
            self.to_chrome(&json!({"t": "shot", "id": id, "data": null}));
        }
    }

    /// OCR a captured data URL (`data:image/jpeg;base64,…`). The work runs on its own thread and
    /// the reply comes back as `{t:"ocrResult", req, data}`, where `data` is `null` when no
    /// recognizer is available or the image could not be read. The capture is never blocked on it.
    fn ocr(&self, m: &Value) {
        let req = m["req"].as_u64().unwrap_or(0);
        let image = m["data"].as_str().unwrap_or_default().to_string();
        let proxy = self.proxy.clone();
        std::thread::spawn(move || {
            let result = recognize(&image);
            let _ = proxy.send_event(UserEvent::ToChrome(json!({"t": "ocrResult", "req": req, "data": result})));
        });
    }

    /// Put a capture's image on disk (`op:"put"`, name + data URL), or remove it (`op:"del"`).
    /// Either way the chrome hears back, and a failed write leaves the card's data URL intact.
    fn media(&self, m: &Value) {
        let req = m["req"].as_u64().unwrap_or(0);
        let name = m["name"].as_str().unwrap_or_default();
        let reply = match m["op"].as_str().unwrap_or("put") {
            "put" => match save_media(name, m["data"].as_str().unwrap_or_default()) {
                Some(url) => json!({"t": "mediaSaved", "req": req, "url": url}),
                None => json!({"t": "mediaSaved", "req": req, "url": null}),
            },
            "del" => {
                remove_media(name);
                json!({"t": "mediaSaved", "req": req, "ok": true})
            }
            _ => json!({"t": "mediaSaved", "req": req, "url": null}),
        };
        self.to_chrome(&reply);
    }

    /// The site-options "…": clear this origin's cookies, or the HTTP cache. Cookies are exact
    /// (`Storage.clearDataForOrigin`); the cache has no per-origin lever in the protocol, so it
    /// is the whole cache, and the toast says so.
    fn site_data(&self, id: u64, op: &str, origin: &str) {
        let Some(wv) = self.tabs.get(&id) else { return };
        if op == "cookies" && !origin.is_empty() {
            let params = format!(
                r#"{{"origin":{},"storageTypes":"cookies"}}"#,
                serde_json::Value::String(origin.to_string())
            );
            devtools(wv, "Storage.clearDataForOrigin", &params);
        } else {
            devtools(wv, "Network.clearBrowserCache", "{}");
        }
    }

    fn handle(&mut self, el: &ActiveEventLoop, msg: &str) {
        let Ok(m) = serde_json::from_str::<Value>(msg) else { return };
        let id = m["id"].as_u64();
        let num = |k: &str| m[k].as_f64().unwrap_or(0.0);
        match m["t"].as_str().unwrap_or("") {
            "layout" => {
                // The first word from the chrome means it loaded and its JS is running. A
                // WebView2 controller can be left hidden, which paints nothing and leaves the
                // whole window black; asking once more here costs nothing and cures that.
                if !self.chrome_shown {
                    self.chrome_shown = true;
                    if let Some(c) = &self.chrome {
                        let _ = c.set_visible(true);
                    }
                }
                if let Some(p) = &mut self.perf {
                    p.layouts += 1;
                }
                if let Some(b) = &mut self.bench {
                    b.layouts += 1;
                }
                self.radius = num("radius");
                let panes = m["panes"].as_array().map_or(vec![], |ps| {
                    ps.iter()
                        .filter_map(|p| {
                            let n = |k: &str| p[k].as_f64().unwrap_or(0.0);
                            Some((p["id"].as_u64()?, rect(n("x"), n("y"), n("w"), n("h")), p["top"].as_bool() == Some(true)))
                        })
                        .collect()
                });
                self.layout(panes, m["active"].as_u64());
            }
            "open" => {
                if let (Some(id), Some(url)) = (id, m["url"].as_str()) {
                    self.open_tab(id, url, m["profile"].as_str().unwrap_or("default"));
                }
            }
            "nav" => {
                if let (Some(wv), Some(url)) = (id.and_then(|i| self.tabs.get(&i)), m["url"].as_str()) {
                    let _ = wv.load_url(url);
                }
            }
            "exec" => {
                // Back/forward/reload, and Boost CSS/JS the user wrote for this site.
                if let (Some(wv), Some(js)) = (id.and_then(|i| self.tabs.get(&i)), m["js"].as_str()) {
                    let _ = wv.evaluate_script(js);
                }
            }
            "eval" => {
                // Read something out of a page (Ask Rainbow's read_page). The result is page
                // data: the chrome treats it as untrusted text, never as instructions.
                let req = m["req"].clone();
                let proxy = self.proxy.clone();
                match (id.and_then(|i| self.tabs.get(&i)), m["js"].as_str()) {
                    (Some(wv), Some(js)) => {
                        let _ = wv.evaluate_script_with_callback(js, move |out| {
                            let value = serde_json::from_str::<Value>(&out).unwrap_or(Value::Null);
                            let _ = proxy.send_event(UserEvent::ToChrome(json!({"t": "evalResult", "req": req, "value": value})));
                        });
                    }
                    _ => self.to_chrome(&json!({"t": "evalResult", "req": req, "value": null})),
                }
            }
            "mediaCmd" => {
                if let Some(id) = id {
                    let rect = m.get("rect").cloned().unwrap_or(Value::Null);
                    let pane = m.get("pane").cloned().unwrap_or(Value::Null);
                    self.media_cmd(id, m["op"].as_str().unwrap_or(""), num("v"), &rect, &pane);
                }
            }
            "close" => {
                if let Some(id) = id {
                    self.tabs.remove(&id);
                    self.panes.retain(|(p, _, _)| *p != id);
                    self.placed.remove(&id);
                    self.pip_hwnd.remove(&id);
                    self.pip_from.remove(&id);
                    self.pip_since.remove(&id);
                    if self.active == Some(id) {
                        self.active = None;
                    }
                }
            }
            "snapshot" => {
                if let Some(id) = id {
                    self.snapshot(id);
                }
            }
            "shot" => {
                if let Some(id) = id {
                    self.shot_tab(id, m["full"].as_bool().unwrap_or(false));
                }
            }
            // Read the text out of a captured image, off the event loop. The capture itself is
            // already saved; OCR is a reply the chrome attaches when it arrives.
            "ocr" => self.ocr(&m),
            // Move a capture's image out of the chrome's store and onto disk. The reply carries
            // the URL the card should use from then on.
            "media" => self.media(&m),
            "sitedata" => {
                if let Some(id) = id {
                    self.site_data(id, m["op"].as_str().unwrap_or("cache"), m["origin"].as_str().unwrap_or(""));
                }
            }
            "overlay" => {
                let on = m["on"].as_bool().unwrap_or(false);
                if m["low"].as_bool() == Some(true) {
                    self.asking = on;
                    self.reclip();
                } else {
                    self.overlay = on;
                    self.place();
                }
                if on {
                    if let Some(c) = &self.chrome {
                        let _ = c.focus();
                    }
                } else if let Some(wv) = self.active.and_then(|a| self.tabs.get(&a)) {
                    let _ = wv.focus();
                }
            }
            "dictate" => dictate(),
            // The sidebar floats over the page: a page is a child window *above* the chrome,
            // so the chrome is clipped to the sidebar column and raised while it is showing.
            "chrome" => {
                // A message about the band alone leaves the sidebar and bar settings as they are.
                if let Some(b) = m.get("band") {
                    // One strip (x and w optional: the whole width), a list of strips, or null for none.
                    let one = |r: &Value| match (r["y"].as_f64(), r["h"].as_f64()) {
                        (Some(y), Some(h)) if h > 0.0 => Some((r["x"].as_f64().unwrap_or(0.0).max(0.0), y.max(0.0), r["w"].as_f64().unwrap_or(0.0).max(0.0), h)),
                        _ => None,
                    };
                    self.chrome_band = match b.as_array() {
                        Some(list) => list.iter().filter_map(one).collect(),
                        None => one(b).into_iter().collect(),
                    };
                    if m.get("over").is_none() && m.get("bar").is_none() {
                        self.reclip();
                        return;
                    }
                }
                if let Some(over) = m.get("over") {
                    self.chrome_right = over["right"].as_bool().unwrap_or(false);
                    self.chrome_over = if over["on"].as_bool().unwrap_or(false) {
                        Some(over["w"].as_f64().unwrap_or(248.0).clamp(44.0, 600.0))
                    } else {
                        None
                    };
                }
                self.chrome_bar = match m.get("bar").and_then(|b| b.as_f64()) {
                    Some(h) if h > 0.0 => Some(h.clamp(20.0, 80.0)),
                    _ => None,
                };
                self.chrome_bar_w = m.get("barw").and_then(|b| b.as_f64()).unwrap_or(0.0).max(0.0);
                self.reclip();
            }
            "extensions" => {
                let key = profile_key(m["profile"].as_str().unwrap_or("default"));
                let dir = ext_dir(&key);
                self.to_chrome(&json!({"t": "extensions", "profile": key, "dir": dir.to_string_lossy(), "items": ext_info(&dir)}));
            }
            "reveal" => {
                if m["what"].as_str() == Some("extensions") {
                    let dir = ext_dir(&profile_key(m["profile"].as_str().unwrap_or("default")));
                    #[cfg(windows)]
                    let _ = std::process::Command::new("explorer").arg(&dir).spawn();
                }
            }
            // The surface: a small transparent view above every page, for anything that has to be
            // seen over a page (a native page covers the chrome). The chrome says where and what.
            "surface" => self.surface(&m),
            "surfaceReady" => self.apply_surface(),
            "devtools" => {
                if let Some(wv) = id.and_then(|i| self.tabs.get(&i)) {
                    wv.open_devtools();
                }
            }
            "win" => {
                let Some(w) = &self.window else { return };
                match m["op"].as_str().unwrap_or("") {
                    "min" => w.set_minimized(true),
                    "max" => w.set_maximized(!w.is_maximized()),
                    "close" => el.exit(),
                    "drag" => {
                        let _ = w.drag_window();
                    }
                    "resize" => {
                        let dir = match m["dir"].as_str().unwrap_or("") {
                            "n" => ResizeDirection::North,
                            "s" => ResizeDirection::South,
                            "e" => ResizeDirection::East,
                            "w" => ResizeDirection::West,
                            "ne" => ResizeDirection::NorthEast,
                            "nw" => ResizeDirection::NorthWest,
                            "se" => ResizeDirection::SouthEast,
                            _ => ResizeDirection::SouthWest,
                        };
                        let _ = w.drag_resize_window(dir);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

impl ApplicationHandler<UserEvent> for App {
    fn resumed(&mut self, el: &ActiveEventLoop) {
        if self.window.is_some() {
            return;
        }
        let attrs = Window::default_attributes()
            .with_title("Rainbow")
            .with_inner_size(LogicalSize::new(1400.0, 900.0));
        #[cfg(windows)]
        let attrs = {
            use winit::platform::windows::WindowAttributesExtWindows;
            attrs.with_decorations(false).with_undecorated_shadow(true)
        };
        #[cfg(target_os = "macos")]
        let attrs = {
            use winit::platform::macos::WindowAttributesExtMacOS;
            attrs.with_titlebar_transparent(true).with_fullsize_content_view(true).with_title_hidden(true)
        };
        let window = el.create_window(attrs).expect("window");
        let size = window.inner_size().to_logical::<f64>(window.scale_factor());
        let proxy = self.proxy.clone();
        let os = if cfg!(windows) { "windows" } else if cfg!(target_os = "macos") { "macos" } else { "linux" };
        let chrome = quiet(WebViewBuilder::new()
            .with_url(CHROME_URL)
            .with_bounds(rect(0.0, 0.0, size.width, size.height))
            .with_devtools(true)
            .with_initialization_script(format!("window.RAINBOW_NATIVE = true; window.RAINBOW_OS = '{os}';")))
            .with_custom_protocol("rainbow".into(), |_, req| match ui_file(req.uri().path()) {
                Some((body, mime)) => Response::builder().header("Content-Type", mime).body(body).unwrap(),
                None => Response::builder().status(404).body(Cow::Borrowed(&b""[..])).unwrap(),
            })
            .with_ipc_handler(move |req| {
                let _ = proxy.send_event(UserEvent::Chrome(req.body().clone()));
            })
            .build_as_child(&window);
        // A locked user data folder is the one failure a user can cause by double-clicking the
        // icon twice: WebView2 refuses to share a profile between processes and the second Rainbow
        // would otherwise die on a Rust panic with a backtrace nobody can act on.
        let chrome = match chrome {
            Ok(c) => c,
            Err(e) => {
                eprintln!("Rainbow could not start: {e}");
                eprintln!("Another Rainbow is probably already running — close it and try again.");
                eprintln!("If not, delete the \"Rainbow.exe.WebView2\" folder next to this program.");
                std::process::exit(1);
            }
        };
        self.chrome = Some(chrome);
        self.window = Some(window);
        trace("chrome built");
        {
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(2000));
                let _ = proxy.send_event(UserEvent::ChromePing);
            });
        }
        self.start_bench();
        // RAINBOW_SHOT=<png>: render the chrome once and exit. The window is a WebView2 surface, so
        // a screen or PrintWindow capture of it comes back black; this asks WebView2 itself, which
        // is the only way to see whether the chrome paints on a machine with no visible desktop.
        if let Ok(path) = std::env::var("RAINBOW_SHOT") {
            let proxy = self.proxy.clone();
            std::thread::spawn(move || {
                // One shot, twice the patience: a cold WebView2 can still be finding its feet
                // at 2.5s. ShotDone (fired by the capture itself) stops the loop; the last sleep
                // only guarantees the process exits.
                for delay in [2500, 3000] {
                    std::thread::sleep(Duration::from_millis(delay));
                    let _ = proxy.send_event(UserEvent::Shot(PathBuf::from(path.clone())));
                }
                std::thread::sleep(Duration::from_millis(4000));
                let _ = proxy.send_event(UserEvent::ShotDone);
            });
        }
    }

    fn user_event(&mut self, el: &ActiveEventLoop, ev: UserEvent) {
        match ev {
            UserEvent::Chrome(msg) => {
                trace(&format!("ipc {}", &msg[..msg.len().min(160)]));
                self.handle(el, &msg)
            }
            UserEvent::ToChrome(v) => self.to_chrome(&v),
            UserEvent::Pip(id, hwnd, from) => {
                self.pip_hwnd.insert(id, hwnd);
                self.pip_from.insert(id, from);
                self.pip_since.insert(id, Instant::now());
            }
            UserEvent::Foreground(hwnd) => {
                // Clicking the floating PiP window is a request to go back to its tab.
                let hit = self.pip_hwnd.iter().find(|(_, h)| **h == hwnd).map(|(id, _)| *id);
                let Some(id) = hit else { return };
                if self.active == Some(id) {
                    return;
                }
                // Chromium may flash its new PiP window forward; that is not a click.
                if self.pip_since.get(&id).is_some_and(|t| t.elapsed() < Duration::from_millis(400)) {
                    return;
                }
                self.to_chrome(&json!({"t": "pipFocus", "id": id}));
            }
            UserEvent::Run(id, js) => {
                if let Some(wv) = self.tabs.get(&id) {
                    let _ = wv.evaluate_script(js);
                }
            }
            UserEvent::Shot(path) => {
                // CapturePreview is async: the loop has to keep pumping COM callbacks or the
                // completion handler never runs and nothing is written. Exit from ShotDone.
                if let Some(c) = &self.chrome {
                    #[cfg(windows)]
                    {
                        use windows::Win32::Foundation::RECT;
                        use windows::Win32::UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, IsWindowVisible};
                        use wry::WebViewExtWindows as _;
                        let mut b = windows::core::BOOL(0);
                        let hv = unsafe { c.controller().IsVisible(&mut b) };
                        let mut wr = RECT::default();
                        let mut cr = RECT::default();
                        unsafe {
                            let _ = GetWindowRect(c.hwnd(), &mut wr);
                            let _ = GetClientRect(c.hwnd(), &mut cr);
                        }
                        trace(&format!(
                            "shot: ctl_visible={:?} ({hv:?}) win_visible={:?} win_rect=({},{},{},{}) client=({},{})",
                            b.as_bool(),
                            unsafe { IsWindowVisible(c.hwnd()) }.as_bool(),
                            wr.left, wr.top, wr.right, wr.bottom,
                            cr.right, cr.bottom,
                        ));
                    }
                    // Prove the chrome's JS is alive before blaming the capture.
                    let _ = c.evaluate_script(
                        "window.ipc.postMessage(JSON.stringify({t:'probe',title:document.title,\
                         len:document.documentElement.innerHTML.length,\
                         url:location.href,js:typeof rainbow}))",
                    );
                    chrome_shot(c, &path, self.proxy.clone());
                }
            }
            UserEvent::ShotDone => el.exit(),
            UserEvent::ChromePing => {
                if self.chrome_shown || self.chrome_retried {
                    return;
                }
                self.chrome_retried = true;
                trace("chrome never spoke; reloading it once");
                if let Some(c) = &self.chrome {
                    let _ = c.load_url(CHROME_URL);
                }
            }
        }
    }

    fn window_event(&mut self, el: &ActiveEventLoop, _: WindowId, ev: WindowEvent) {
        match ev {
            WindowEvent::CloseRequested => el.exit(),
            WindowEvent::Resized(size) => {
                if let Some(p) = &mut self.perf {
                    p.resized += 1;
                }
                if let Some(b) = &mut self.bench {
                    b.resized += 1;
                }
                let scale = self.window.as_ref().map_or(1.0, |w| w.scale_factor());
                let s = size.to_logical::<f64>(scale);
                if legacy_resize() {
                    self.apply_window_size(s.width, s.height);
                } else {
                    // Windows sends several WM_SIZE per displayed frame while an edge is
                    // dragged. Keep the latest and apply at most one per frame.
                    self.pending_size = Some((s.width, s.height));
                    let now = Instant::now();
                    if self.frame_at.is_none() {
                        self.frame_at = Some(now + Duration::from_millis(16));
                    }
                    self.settle_at = Some(now + Duration::from_millis(140));
                    self.rearm(el);
                }
            }
            // The chrome re-sends the layout on resize; this keeps corners crisp across DPI moves.
            WindowEvent::ScaleFactorChanged { .. } => {
                self.placed.clear();
                self.place();
                // The sidebar clip is in physical px, so a DPI move has to re-apply it.
                self.reclip();
            }
            _ => {}
        }
    }

    fn about_to_wait(&mut self, el: &ActiveEventLoop) {
        let now = Instant::now();
        // The chrome is the whole window; if its size ever drifts from the window's (a window
        // created before a monitor is attached starts at 0x0 and gets no Resized to correct
        // it) the window shows nothing at all. Repairing it costs two integer compares.
        if let (Some(w), Some(_)) = (&self.window, &self.chrome) {
            let s = w.inner_size().to_logical::<f64>(w.scale_factor());
            let want = (s.width.round() as u32, s.height.round() as u32);
            if self.chrome_size != Some(want) && want.0 > 0 && want.1 > 0 {
                self.apply_window_size(s.width, s.height);
            }
        }
        if let Some(at) = self.frame_at {
            if now >= at {
                self.frame_at = None;
                if let Some((w, h)) = self.pending_size.take() {
                    self.apply_window_size(w, h);
                }
            }
        }
        if let Some(at) = self.settle_at {
            if now >= at {
                self.settle_at = None;
                if let Some((w, h)) = self.pending_size.take() {
                    self.apply_window_size(w, h);
                }
                self.settle();
            }
        }
        if let Some(p) = &mut self.perf {
            p.flush(now);
        }
        self.bench_tick(el, now);
        self.rearm(el);
    }
}

/// Send a JPEG of the page to the chrome as `{t:'snapshot', id, data}`.
#[cfg(windows)]
/// Fire a DevTools protocol method at a page and ignore the answer.
#[cfg(windows)]
fn devtools(wv: &WebView, method: &str, params: &str) {
    use webview2_com::CallDevToolsProtocolMethodCompletedHandler;
    use windows::core::{HSTRING, PCWSTR};
    use wry::WebViewExtWindows;
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_hr, _json| Ok(())));
    let method = HSTRING::from(method);
    let params = HSTRING::from(params);
    unsafe {
        let _ = wv.webview().CallDevToolsProtocolMethod(PCWSTR(method.as_ptr()), PCWSTR(params.as_ptr()), &handler);
    }
}
#[cfg(not(windows))]
fn devtools(_: &WebView, _: &str, _: &str) {}

/// One JPEG of a page as a data URL, through `CapturePreview`. Shared by the overlay snapshot
/// and the screenshot tool's "Visible" mode: it is the native path, it needs no DevTools, and
/// unlike `Page.captureScreenshot` it does not take the browser process down on machines whose
/// compositor cannot render a screenshot. `tag` names the reply the chrome waits for.
fn capture(wv: &WebView, id: u64, tag: &str, proxy: EventLoopProxy<UserEvent>) {
    use webview2_com::{
        CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG,
    };
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;
    use wry::WebViewExtWindows;

    let Some(stream) = (unsafe { SHCreateMemStream(None) }) else { return };
    let out = stream.clone();
    let done = proxy.clone();
    let reply = tag.to_string();
    let miss = proxy.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |_hr| {
        let data = unsafe {
            let mut stat = STATSTG::default();
            out.Stat(&mut stat, STATFLAG_NONAME)?;
            let mut buf = vec![0u8; stat.cbSize as usize];
            out.Seek(0, STREAM_SEEK_SET, None)?;
            let mut read = 0u32;
            out.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read)).ok()?;
            buf.truncate(read as usize);
            buf
        };
        let url = format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(data));
        let _ = done.send_event(UserEvent::ToChrome(json!({"t": reply, "id": id, "data": url})));
        Ok(())
    }));
    let started = unsafe { wv.webview().CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_JPEG, &stream, &handler) };
    if started.is_err() {
        let _ = miss.send_event(UserEvent::ToChrome(json!({"t": tag, "id": id, "data": null})));
    }
}

// ponytail: no WKWebView snapshot yet; the overlay falls back to a plain frosted backdrop.
// Upgrade path: WKWebView takeSnapshotWithConfiguration -> NSImage -> PNG via objc2-web-kit.
#[cfg(not(windows))]
fn capture(_: &WebView, id: u64, tag: &str, proxy: EventLoopProxy<UserEvent>) {
    let _ = proxy.send_event(UserEvent::ToChrome(json!({"t": tag, "id": id, "data": null})));
}

/// Read the text out of a captured image with Windows' own recognizer (`Windows.Media.Ocr`):
/// offline, no model to download, and it uses the language packs the machine already has.
/// Returns `{text, lines:[{text,x,y,w,h}]}`, or `None` when no recognizer or image is available.
/// It runs on a worker thread, so the async WinRT calls block only that thread.
#[cfg(windows)]
fn recognize(data_url: &str) -> Option<Value> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    let bytes = base64::engine::general_purpose::STANDARD.decode(data_url.split(',').nth(1)?).ok()?;
    if bytes.is_empty() {
        return None;
    }
    // A pooled thread, so failing here (the apartment is already set) is harmless.
    let _ = unsafe { RoInitialize(RO_INIT_MULTITHREADED) };
    let engine = OcrEngine::TryCreateFromUserProfileLanguages().ok()?;
    let stream = InMemoryRandomAccessStream::new().ok()?;
    let writer = DataWriter::CreateDataWriter(&stream).ok()?;
    writer.WriteBytes(&bytes).ok()?;
    writer.StoreAsync().ok()?.join().ok()?;
    stream.Seek(0).ok()?;
    let decoder = BitmapDecoder::CreateAsync(&stream).ok()?.join().ok()?;
    let bitmap = decoder.GetSoftwareBitmapAsync().ok()?.join().ok()?;
    // The recognizer wants Bgra8; a JPEG usually decodes to another format, so convert when needed.
    let bitmap = if bitmap.BitmapPixelFormat().ok()? == BitmapPixelFormat::Bgra8 {
        bitmap
    } else {
        SoftwareBitmap::ConvertWithAlpha(&bitmap, BitmapPixelFormat::Bgra8, BitmapAlphaMode::Premultiplied).ok()?
    };
    let result = engine.RecognizeAsync(&bitmap).ok()?.join().ok()?;
    let text = result.Text().ok()?.to_string();
    let mut lines = Vec::new();
    if let Ok(ls) = result.Lines() {
        for i in 0..ls.Size().unwrap_or(0) {
            let Ok(line) = ls.GetAt(i) else { continue };
            let Ok(line_text) = line.Text() else { continue };
            // The first word's box stands in for the line's, which is all the chrome needs to
            // point at where the words came from.
            let rect = line.Words().ok().and_then(|ws| {
                (0..ws.Size().ok()?).find_map(|j| ws.GetAt(j).ok().and_then(|w| w.BoundingRect().ok()))
            });
            let (x, y, w, h) = rect.map(|r| (r.X, r.Y, r.Width, r.Height)).unwrap_or((0.0, 0.0, 0.0, 0.0));
            lines.push(json!({"text": line_text.to_string(), "x": x, "y": y, "w": w, "h": h}));
        }
    }
    Some(json!({"text": text, "lines": lines}))
}

#[cfg(not(windows))]
fn recognize(_: &str) -> Option<Value> {
    None
}

/// `RAINBOW_TRACE=1`: print what the shell and the chrome say to each other. Startup and capture
/// problems are invisible otherwise, and a black window has no other tell. A `nightly` build
/// always traces — it is built to be watched, so nobody should have to set a variable first.
fn trace(msg: &str) {
    use std::sync::OnceLock;
    static ON: OnceLock<bool> = OnceLock::new();
    if *ON.get_or_init(|| cfg!(feature = "nightly") || std::env::var_os("RAINBOW_TRACE").is_some()) {
        eprintln!("rainbow: {msg}");
    }
}

/// The banner a nightly build prints first, so a terminal full of logs says which binary it is.
fn banner() {
    if !cfg!(feature = "nightly") {
        return;
    }
    let version = env!("CARGO_PKG_VERSION");
    eprintln!("rainbow {version} nightly — trace on. Ctrl+C or close the window to stop.");
    trace("build: nightly (console subsystem, every message logged)");
}

/// Ask WebView2 for one PNG of the chrome and write it to `path` (RAINBOW_SHOT). A window capture
/// of a WebView2 surface comes back black, so this asks WebView2 itself — the only way to see
/// whether the chrome paints on a machine with no visible desktop. `CapturePreview` is the
/// native path and works whether or not the controller reports itself visible; a DevTools
/// `Page.captureScreenshot` is the fallback, and it is also the thing that takes the browser
/// process down on machines whose compositor cannot render one.
#[cfg(windows)]
fn chrome_shot(wv: &WebView, path: &std::path::Path, proxy: EventLoopProxy<UserEvent>) {
    use webview2_com::{
        CapturePreviewCompletedHandler, Microsoft::Web::WebView2::Win32::COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
    };
    use windows::Win32::System::Com::{STATFLAG_NONAME, STATSTG, STREAM_SEEK_SET};
    use windows::Win32::UI::Shell::SHCreateMemStream;
    use wry::WebViewExtWindows;

    let Some(stream) = (unsafe { SHCreateMemStream(None) }) else {
        let _ = proxy.send_event(UserEvent::ShotDone);
        return;
    };
    let out = stream.clone();
    let file = path.to_path_buf();
    let done = proxy.clone();
    let handler = CapturePreviewCompletedHandler::create(Box::new(move |_hr| {
        let data = unsafe {
            let mut stat = STATSTG::default();
            out.Stat(&mut stat, STATFLAG_NONAME)?;
            let mut buf = vec![0u8; stat.cbSize as usize];
            out.Seek(0, STREAM_SEEK_SET, None)?;
            let mut read = 0u32;
            out.Read(buf.as_mut_ptr().cast(), buf.len() as u32, Some(&mut read)).ok()?;
            buf.truncate(read as usize);
            buf
        };
        if data.is_empty() {
            eprintln!("rainbow: shot: empty image");
        } else {
            eprintln!("rainbow: shot bytes={} -> {}", data.len(), file.display());
            let _ = std::fs::write(&file, &data);
            let _ = done.send_event(UserEvent::ShotDone);
        }
        Ok(())
    }));
    let r = unsafe {
        wv.webview().CapturePreview(COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG, &stream, &handler)
    };
    if let Err(e) = r {
        eprintln!("rainbow: shot: CapturePreview failed: {e:?}");
        let _ = proxy.send_event(UserEvent::ShotDone);
    }
}
#[cfg(not(windows))]
fn chrome_shot(_: &WebView, _: &std::path::Path, proxy: EventLoopProxy<UserEvent>) {
    let _ = proxy.send_event(UserEvent::ShotDone);
}

/// Clip a page to rounded corners. A native child window ignores the chrome's CSS radius.
#[cfg(windows)]
fn round(wv: &WebView, size: wry::dpi::PhysicalSize<f64>, r: f64) {
    use windows::Win32::Graphics::Gdi::{CreateRoundRectRgn, SetWindowRgn};
    use wry::WebViewExtWindows;
    let (w, h, d) = (size.width.round() as i32, size.height.round() as i32, (r * 2.0).round() as i32);
    // The window owns the region after SetWindowRgn, so it is never freed here.
    unsafe {
        let rgn = CreateRoundRectRgn(0, 0, w + 1, h + 1, d, d);
        SetWindowRgn(wv.hwnd(), Some(rgn), false);
    }
}
// ponytail: macOS pages stay square; upgrade path is the WKWebView layer's cornerRadius.
#[cfg(not(windows))]
fn round(_: &WebView, _: wry::dpi::PhysicalSize<f64>, _: f64) {}

/// The rectangles the overlay clip is cut around, in physical px: every pane (the page keeps
/// its own pixels there) and the sidebar column (the chrome paints over the page there).
fn overlay_parts(win: (i32, i32), panes: &[(u64, Rect, bool)], col_w: f64, scale: f64, right: bool) -> (Vec<(i32, i32, i32, i32)>, (i32, i32, i32, i32)) {
    let holes = panes
        .iter()
        .map(|(_, r, _)| {
            let p = r.position.to_physical::<i32>(scale);
            let s = r.size.to_physical::<i32>(scale);
            (p.x, p.y, p.x + s.width, p.y + s.height)
        })
        .collect();
    let cw = (col_w * scale).round().max(1.0) as i32;
    let col = if right { ((win.0 - cw).max(0), 0, win.0.max(1), win.1.max(1)) } else { (0, 0, cw, win.1.max(1)) };
    (holes, col)
}

/// Draw the chrome over the page. A page is a child window that sits above the chrome, so an
/// HTML overlay inside the chrome can never cover it. Clipping the chrome to everything except
/// the panes, plus the sidebar column, and raising it does: outside the region the window is
/// not painted and does not take clicks, so the page stays live underneath and the page never
/// has to be resized. `width: None` puts the chrome back behind the pages.
#[cfg(windows)]
fn chrome_over(wv: &WebView, width: Option<f64>, scale: f64, win: (i32, i32), panes: &[(u64, Rect, bool)], bar_h: f64, bar_w: f64, band: &[(f64, f64, f64, f64)], right: bool) {
    use windows::Win32::Graphics::Gdi::{
        CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, RGN_DIFF, RGN_OR,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_BOTTOM, HWND_TOP, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };
    use wry::WebViewExtWindows as _;
    let h = wv.hwnd();
    let (w, hgt) = (win.0.max(1), win.1.max(1));
    // The strip is only as wide as the bar: 0 means the whole window, a width means the bar is
    // riding the peeked sidebar and the page beside it must keep its pixels.
    let bw = if bar_w > 0.0 { (bar_w * scale).round() as i32 } else { w };
    unsafe {
        let Some(px) = width else {
            // No sidebar column, but the compact bar may still need its strip.
            if bar_h > 0.0 || !band.is_empty() {
                // Everything the pages do not cover (the sidebar when it is always on, the frame around
                // the page) plus the bar's strip over the page. Clipping to the strip alone made
                // the always-on sidebar vanish whenever the bar came out.
                let (holes, _) = overlay_parts(win, panes, 0.0, scale, right);
                let rgn = CreateRectRgn(0, 0, w, hgt);
                for (l, t, r, b) in holes {
                    let hole = CreateRectRgn(l, t, r, b);
                    CombineRgn(Some(rgn), Some(rgn), Some(hole), RGN_DIFF);
                    let _ = DeleteObject(hole.into());
                }
                if bar_h > 0.0 {
                    let bar = CreateRectRgn(0, 0, bw, (bar_h * scale).round() as i32);
                    CombineRgn(Some(rgn), Some(rgn), Some(bar), RGN_OR);
                    let _ = DeleteObject(bar.into());
                }
                for &(bx, y, bwd, bh) in band {
                    let (x0, x1) = ((bx * scale).round() as i32, if bwd > 0.0 { ((bx + bwd) * scale).round() as i32 } else { w });
                    let b = CreateRectRgn(x0, (y * scale).round() as i32, x1, ((y + bh) * scale).round() as i32);
                    CombineRgn(Some(rgn), Some(rgn), Some(b), RGN_OR);
                    let _ = DeleteObject(b.into());
                }
                SetWindowRgn(h, Some(rgn), true);
                let _ = SetWindowPos(h, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
                return;
            }
            SetWindowRgn(h, None, true);
            let _ = SetWindowPos(h, Some(HWND_BOTTOM), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            return;
        };
        let (holes, col) = overlay_parts(win, panes, px, scale, right);
        // The whole window, minus every pane (so the page keeps its own pixels, and the 8 px
        // margins, the toolbar strip and the split gap keep the chrome's)...
        let rgn = CreateRectRgn(0, 0, w, hgt);
        for (l, t, r, b) in holes {
            let hole = CreateRectRgn(l, t, r, b);
            CombineRgn(Some(rgn), Some(rgn), Some(hole), RGN_DIFF);
            let _ = DeleteObject(hole.into());
        }
        // ...plus the sidebar column, which is painted over the page.
        let column = CreateRectRgn(col.0, col.1, col.2, col.3);
        CombineRgn(Some(rgn), Some(rgn), Some(column), RGN_OR);
        let _ = DeleteObject(column.into());
        // ...plus Ask Rainbow's band, which is drawn over the live page.
        for &(bx, y, bwd, bh) in band {
            let (x0, x1) = ((bx * scale).round() as i32, if bwd > 0.0 { ((bx + bwd) * scale).round() as i32 } else { w });
            let b = CreateRectRgn(x0, (y * scale).round() as i32, x1, ((y + bh) * scale).round() as i32);
            CombineRgn(Some(rgn), Some(rgn), Some(b), RGN_OR);
            let _ = DeleteObject(b.into());
        }
        // ...plus the compact bar's strip, for the same reason.
        if bar_h > 0.0 {
            let bar = CreateRectRgn(0, 0, bw, (bar_h * scale).round() as i32);
            CombineRgn(Some(rgn), Some(rgn), Some(bar), RGN_OR);
            let _ = DeleteObject(bar.into());
        }
        // The window owns the region after SetWindowRgn, so it is never freed here.
        SetWindowRgn(h, Some(rgn), true);
        let _ = SetWindowPos(h, Some(HWND_TOP), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
}
// ponytail: on macOS the page webview is an NSView above the chrome's, so the same clip needs
// `addSubview:positioned:`. The CSS overlay still works there, the page just covers it.
#[cfg(not(windows))]
fn chrome_over(_: &WebView, _: Option<f64>, _: f64, _: (i32, i32), _: &[(u64, Rect, bool)], _: f64, _: f64, _: &[(f64, f64, f64, f64)], _: bool) {}

/// Start Windows voice typing (Win+H) into whatever has focus: Ask Rainbow's input.
#[cfg(windows)]
fn dictate() {
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_LWIN,
    };
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, wScan: 0, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, time: 0, dwExtraInfo: 0 },
        },
    };
    let h = VIRTUAL_KEY(0x48);
    let keys = [key(VK_LWIN, false), key(h, false), key(h, true), key(VK_LWIN, true)];
    unsafe { SendInput(&keys, std::mem::size_of::<INPUT>() as i32) };
}
#[cfg(not(windows))]
fn dictate() {}

/// Watch the app-wide foreground window. A native child cannot report clicks, and the PiP
/// window belongs to Chromium's process, so a cheap poll is the only cross-process way to
/// notice that the user clicked the floating video.
#[cfg(windows)]
fn watch_foreground(proxy: EventLoopProxy<UserEvent>) {
    use windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow;
    std::thread::spawn(move || {
        let mut last: isize = 0;
        loop {
            std::thread::sleep(Duration::from_millis(120));
            let now = unsafe { GetForegroundWindow().0 as isize };
            if now == last {
                continue;
            }
            last = now;
            if proxy.send_event(UserEvent::Foreground(now)).is_err() {
                return;
            }
        }
    });
}
#[cfg(not(windows))]
fn watch_foreground(_: EventLoopProxy<UserEvent>) {}

fn main() {
    banner();
    let event_loop = EventLoop::<UserEvent>::with_user_event().build().expect("event loop");
    let mut app = App {
        proxy: event_loop.create_proxy(),
        window: None,
        chrome: None,
        tabs: HashMap::new(),
        panes: vec![],
        surface: None,
        surface_view: String::new(),
        contexts: HashMap::new(),
        active: None,
        radius: 0.0,
        overlay: false,
        asking: false,
        chrome_over: None,
        chrome_bar: None,
        chrome_bar_h: 0.0,
        chrome_bar_w: 0.0,
        chrome_band: Vec::new(),
        chrome_right: false,
        clipped: false,
        chrome_size: None,
        chrome_shown: false,
        chrome_retried: false,
        placed: HashMap::new(),
        pending_size: None,
        frame_at: None,
        settle_at: None,
        region_dirty: false,
        perf: Perf::open(),
        bench: None,
        pip_hwnd: HashMap::new(),
        pip_from: HashMap::new(),
        pip_since: HashMap::new(),
    };
    #[cfg(windows)]
    watch_foreground(event_loop.create_proxy());
    event_loop.set_control_flow(ControlFlow::Wait);
    event_loop.run_app(&mut app).expect("run");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The overlay clip: the page keeps its own pixels, the sidebar column is painted over it.
    #[test]
    fn overlay_cuts_the_page_and_keeps_the_sidebar() {
        let panes = [(1u64, rect(8.0, 8.0, 1384.0, 884.0), false)];
        let (holes, col) = overlay_parts((1400, 900), &panes, 248.0, 1.0, false);
        assert_eq!(holes, vec![(8, 8, 1392, 892)]);
        assert_eq!(col, (0, 0, 248, 900));
        // The column starts at the window edge and reaches the bottom, whatever the pane does.
        assert_eq!(col.0, 0);
        assert!(col.3 >= holes[0].3, "the column covers the page's height");
    }

    /// A 200% window: the hole and the column are physical px, never CSS px.
    #[test]
    fn overlay_scales_with_the_window() {
        let panes = [(1u64, rect(8.0, 8.0, 1384.0, 884.0), false)];
        let (holes, col) = overlay_parts((2800, 1800), &panes, 248.0, 2.0, false);
        assert_eq!(holes, vec![(16, 16, 2784, 1784)]);
        assert_eq!(col.2, 496);
        assert_eq!(col.3, 1800);
    }

    /// Split view: two holes, so the gap between the panes stays the chrome's (that gap is the
    /// divider the chrome draws).
    #[test]
    fn overlay_keeps_the_split_gap() {
        let panes = [
            (1u64, rect(8.0, 8.0, 688.0, 884.0), false),
            (2u64, rect(704.0, 8.0, 688.0, 884.0), false),
        ];
        let (holes, _) = overlay_parts((1400, 900), &panes, 248.0, 1.0, false);
        assert_eq!(holes.len(), 2);
        assert!(holes[0].2 < holes[1].0, "the 8 px gap is not part of either hole");
    }

    /// No page (empty window): the column is the only thing added back, so the chrome still
    /// paints the whole window behind it.
    #[test]
    fn overlay_without_panes_is_the_whole_window_plus_the_column() {
        let (holes, col) = overlay_parts((1400, 900), &[], 248.0, 1.0, false);
        assert!(holes.is_empty());
        assert_eq!(col, (0, 0, 248, 900));
    }
}
