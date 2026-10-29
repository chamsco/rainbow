# Automatic updates: the plan

The chrome is now embedded in the exe (`build.rs` writes `ui_assets.rs`, `ui_file` serves it; a
debug build still reads `ui/` from disk unless `RAINBOW_UI_EMBEDDED=1`). A release is one
`rainbow.exe`, so an update is a file swap — no source tree, no second folder to keep in sync.

## What an update needs

1. **A feed.** `updates.json` on the release host, checked on start (about 5 s later) and every
   6 h, and from Settings → About → *Check for updates*:

   ```json
   {
     "version": "0.2.0",
     "url": "https://…/rainbow-0.2.0-x64.exe",
     "sha256": "…",
     "size": 18000000,
     "min_version": "0.1.0",
     "paused": false,
     "rollout": 100,
     "notes": "…"
   }
   ```

   `min_version` is the kill switch: an update below it forces the upgrade screen. `paused`
   stops all checks. `rollout` is a stable hash of the machine id modulo 100, so a 10 %
   rollout reaches the same 10 % every time and never oscillates.

2. **Transport.** Plain `GET` to the feed and the exe, so a GitHub Release asset, an S3
   object or any static host works. GitHub Releases is the cheapest start: upload
   `rainbow.exe` + `updates.json` as release assets, and point the feed URL at the
   `latest/download` alias. No API token is shipped in the app.

3. **Integrity.** SHA-256 from the feed, plus an Ed25519 (minisign) signature over the
   exe bytes with the public key compiled into Rainbow. SHA-256 alone only proves the
   download matched the feed; the signature proves the feed's author. A signing
   certificate is *not* required for this, but Authenticode is still needed so
   SmartScreen and Defender do not warn on a fresh download (SignPath signs open-source
   projects for free). Ship the signature in the feed as `sig`.

4. **The swap.** Windows cannot replace a running exe. Per-user install
   (`%LOCALAPPDATA%\Programs\Rainbow\rainbow.exe`) keeps this admin-free:
   - Download to `%LOCALAPPDATA%\Rainbow\updates\rainbow-<version>.exe.part`, verify, rename to
     `.exe`.
   - Write `rainbow-updater.exe` (a ~40 KB Rust bin, same workspace) and start it detached with
     `--wait <pid> --from <new> --to <install>`.
   - The updater waits for Rainbow to exit, renames the install to `rainbow.exe.old`, moves the new
     file in, starts it, deletes `.old` on the next run. If any step fails it restores the
     old exe and exits non-zero; Rainbow reports "update failed" on the next start.
   - A running app only needs to *offer* "Restart to update"; nothing swaps under it.

   This works without elevation and without an installer. When Rainbow later gets an installer
   (MSIX or Inno), keep the same feed and signature; MSIX/App Installer can then do the swap
   in the background instead of the helper.

5. **State.** Profiles live in `%LOCALAPPDATA%\Rainbow\profiles`, settings in the chrome's
   storage; the update touches neither. The updater never launches with a different
   `RAINBOW_DATA_ROOT`. A downgrade is refused unless `RAINBOW_ALLOW_DOWNGRADE=1`.

6. **UX.** Silent by default: download in the background, then a dot on the sidebar menu and
   one line in Settings → About ("0.2.0 is ready — Restart"). While a page is loading or a
   download is in flight, defer the restart prompt. `--check-updates` on the command line
   prints the result and exits, for CI.

## Order of work

1. Feed struct + version compare + `Check for updates` in Settings → About (no download yet).
2. Download, SHA-256, minisign verify, progress, cancel.
3. `rainbow-updater` bin + the restart handshake.
4. Release workflow: tag → build → sign (minisign + Authenticode) → upload exe, sig and
   `updates.json` (rollout 0 first, then 10 → 50 → 100).

The only decisions left are the release host (recommend GitHub Releases) and the
Authenticode certificate (recommend SignPath, free for open source).
