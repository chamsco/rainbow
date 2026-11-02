# Rainbow: task list

The plan for what comes next, including what Rainbow can learn from Zephium, is in [roadmap.md](roadmap.md).

`[x]` done and checked in the app · `[~]` done in part · `[ ]` open

## Shelved for now

The assistant chat and everything built around it are out of the UI for now. The code is parked, not deleted, in
`rust-port/crates/rainbow/ui/.shelved/`, and the plans still stand if it comes back. What was built and is now
hidden:

- Ask Rainbow: the floating chat, model picker, Chat mode, dictation, the blurred overlay and wash, and the
  built-in commands (site searches and more) that acted in the browser.
- Prompts and routines: their editors, the routines that ran at start or daily, and their pages in the Library.
- The Decider model, the Sorter/Decider "Both" fusion, and the API-key settings.
- Step 4 of first run ("Ask Rainbow": built-in commands, your own key, or on-device models).

What ships instead: Windows' own OCR reads the text out of captures, and one local Sorter model files each Trove
card under a topic (see Capture and Trove below).

## Sidebar, tabs and spaces
- [x] Sidebar tabs: Essentials (global), pinned tabs with nested folders, Today tabs that tidy away
- [x] Spaces with their own theme; a space belongs to a profile with its own logins
- [x] Creating a space: name, icon, in-panel profile picker, themes, a Cancel that works
- [x] Essentials fill the row edge to edge and get rounder as more sit on one row
- [x] Essentials reflow with the sidebar: four across when wide, three in the middle, two when squeezed
- [x] Essentials stay below the top bar in every Windows layout; the toolbar layout no longer lifts them into the top-left corner
- [x] Hover sidebar and top bar never out together in compact mode; same timing and fade for both
- [x] Hover sidebar with tabs on the right
- [x] Sidebar can be dragged to 420 px; the address bar adapts instead of the sidebar stopping
- [x] One sidebar row per split, with a vertical line between the two names
- [x] Settings button removed from the sidebar bottom (it lives in the space's three-dot menu)
- [x] Spaces icons centred in the bottom row
- [x] Trove hover: a blurred, fading wash over the bottom of the sidebar that hides the spaces row
- [x] Tabs overview (a panel; reachable from the space menu and the space icon's right-click)

## Top bar and windows
- [x] Windows top bar across the window: Rainbow menu, sidebar button, back, forward, reload, address in the middle, extensions, window buttons
- [x] Back button aligned with the left edge of the page
- [x] Split button at the top right; swaps with the sidebar button when tabs are on the right
- [x] Windows caption buttons: thin glyphs on nothing, flush to the corner, a light grey on hover, Close turns red with a tooltip
- [x] One 8 px frame radius for the page, split panes, Essentials and the floating surfaces; the radius setting can only make corners less round than the frame
- [x] Settings is a page in the web frame (same radius and background as a site), not a floating panel
- [x] Layouts: Only Sidebar, Sidebar and Top Toolbar, Collapsed Sidebar, Compact (hide sidebar / toolbar / both)
- [x] Right-click on the top bar: duplicates and extras removed
- [x] Page area changes are instant in the app so the page and the interface never disagree (no tearing, no dark gap)
- [x] Resize lag fixes in the shell
- [~] Window opening in a new window with Shift+right-click: Shift+right-click opens a link in a new tab; a second window is not built

## Split view and Peek
- [x] Split view side by side or stacked; split menu asks left, right, top or bottom, then a tab or a new one
- [x] Each split pane has its own slim header (back, forward, site, close); divider drags in small steps
- [x] Peek: Shift+click a link for a floating window; close, open as tab, open in split view

## Search and new tab
- [x] Site filter shows the site's name, removable with an x or Delete
- [x] "Search <site> · Press Tab" as the first row when you type the start of a site's name
- [x] Smaller bar; open-tab rows say "Switch to Tab"
- [x] Gmail and other icons come from the site itself

## Capture
- [x] Screenshot/region capture saved to Trove first, then read with Windows' own OCR (offline, no model)
- [x] OCR text is kept on the card, searchable in Trove and fed to the local Sorter's topic classification
- [x] A topic chosen by hand is never overwritten by classification
- [x] The Sorter: a ~23 MB sentence-embedding model, installed once from Settings; files each card under a topic
- [ ] Read text out of images saved with right-click (needs a fetch-to-Trove step) and off full-page saves
- [ ] Capture the page around a selection, not only the visible pane

## Trove
- [x] Infinite board of cards; Discover (mood and subject); Recently discovered
- [x] Right-click an image or selected text on a page: Save to Trove
- [x] Cards sorted into topics by one function (`Rainbow.trove.classify`)
- [x] Captured images are written to `%LOCALAPPDATA%\Rainbow\media` and served locally; cards keep a short URL, so screenshots no longer fill the store
- [ ] Download the saved image instead of linking it

## Library
- [x] Spaces, Trove, History, Boosts, Downloads, Archive

## Menus and surfaces
- [x] A transparent surface above every page for menus, the site options panel and notices
- [x] One frosted glass, tint, radius and border for every context menu
- [x] Notices (e.g. "Opened in a new tab") are solid and sit at the top right
- [ ] Move the command bar onto the surface (it draws correctly today)

## Extensions and profiles
- [x] Extensions load per profile; pin them next to the address bar
- [ ] Extension popups (Windows' web view does not provide them)

## First run
- [x] Water welcome animation removed; the app opens directly
- [x] Replay controls and the first-run welcome setting removed from Settings → Data
- [ ] Step 1: Look (light or dark, tabs left or right, layout)
- [ ] Step 2: Bring your things (import from other browsers)
- [ ] Step 3: Profile and first space
- [ ] Step 4: Local model (install the ~23 MB Sorter, or keep the keyword sorter)
- [ ] Step 5: Make Rainbow the default browser

## Shipping
- [x] UI assets embedded in the exe for release builds; Chromium is the system WebView2 runtime, not bundled
- [ ] Automatic updates (design in `rust-port/crates/rainbow/UPDATES.md`; needs a release host and signing)
- [ ] macOS parity (page snapshots, rounded corners, dictation, extensions)
- [ ] Automated tests for the native behaviour (focus, clipping, split, downloads)

## From the roadmap (see roadmap.md)
- [ ] Page radius equal to the app frame's
- [ ] Shelved — assistant composer docked in the page frame
- [ ] Tasks panel (plain-words capture, Today / Tomorrow / Upcoming, linked to the page, undo)
- [ ] Native ad and tracker blocker (engine, lists with updates, cosmetic hiding, "hide with a click", per-site pause)
- [ ] Shelved — routines with runs, grants and approvals
- [ ] Shelved — work board: run nodes, helpers with live previews, plan to tasks
- [ ] Shelved — skills and memory, keys in the system keychain
- [ ] Inactive tab sleep; global launcher; new tab with time and tasks; time and focus; notes beside the page
- [ ] macOS: top bar and navigation as liquid glass
- [ ] Linux: decide the web engine
- [ ] Trackpad gestures prototype
