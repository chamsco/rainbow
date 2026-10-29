# Rainbow

A spiritual successor to the Arc browser, for Windows first.

Rainbow keeps your tabs in a sidebar, groups them into spaces, and puts an assistant one shortcut
away. The page is a real Chromium view; everything around it is Rainbow's own interface.

## What it does

- **Sidebar tabs.** Essentials across every space, pinned tabs with nested folders, and Today tabs
  that tidy themselves away. Drag to organise; right-click for everything else.
- **Spaces and profiles.** Each space has its own theme and belongs to a profile with its own
  logins and cookies.
- **Layouts.** Only Sidebar, Sidebar and Top Toolbar, Collapsed Sidebar, and Compact mode, where
  the bar and the sidebar appear only when you reach for them.
- **Split view and Peek.** Two pages side by side; Shift+click a link to look at it in a floating
  window.
- **Ask Rainbow** (Ctrl+E). A docked composer at the bottom of the page grows into a chat that can
  act in the browser: open, organise, save, find. Bring your own Anthropic API key, or use the
  built-in model for simple commands.
- **Capture.** Screenshots and dragged regions are saved to the Canvas immediately, then read with
  Windows' own OCR. The text inside a capture is searchable, and it helps sort the card into a
  topic. Images are kept as files under `%LOCALAPPDATA%\Rainbow\media`, so the store stays small.
- **Canvas.** A free-form board for the pages, images and notes you want to come back to, with a
  Discover button for finding new things.
- **Library.** History, downloads, boosts, archive, saved prompts and routines in one searchable rail.
- **Boosts.** Restyle or script any site.
- **Media.** Players for background tabs, and automatic picture-in-picture.
- **Extensions.** Unpacked Chromium extensions load per profile from `%LOCALAPPDATA%\Rainbow\extensions\<profile>`, and can be pinned next to the address bar.

## Build and run

Windows, Rust stable, and the WebView2 runtime (included in Windows 11).

```
cd rust-port
cargo build -p rainbow
./target/debug/rainbow.exe
```

A debug build reads the interface from `crates/rainbow/ui` on disk, so edits to the HTML, CSS and JS
show up after a reload. A release build embeds it and uses the size profile (`opt-level = "z"`, LTO,
one codegen unit, strip): the shipped exe is about 1 MB, and Chromium is the system WebView2 runtime
rather than something bundled.

## Layout

- `rust-port/crates/rainbow/src/main.rs`: the native shell (window, tab views, downloads, picture-in-picture).
- `rust-port/crates/rainbow/ui/`: the interface, plain HTML, CSS and JavaScript.
- `rust-port/crates/rainbow/UPDATES.md`: the plan for automatic updates.

## License

MIT
