# Wave: task list

The plan for what comes next, including what Wave can learn from Zephium, is in [roadmap.md](roadmap.md).

`[x]` done and checked in the app · `[~]` done in part · `[ ]` open

## Sidebar, tabs and spaces
- [x] Sidebar tabs: Essentials (global), pinned tabs with nested folders, Today tabs that tidy away
- [x] Spaces with their own theme; a space belongs to a profile with its own logins
- [x] Creating a space: name, icon, in-panel profile picker, themes, a Cancel that works
- [x] Essentials fill the row edge to edge and get rounder as more sit on one row
- [x] Hover sidebar and top bar never out together in compact mode; same timing and fade for both
- [x] Hover sidebar with tabs on the right
- [x] Sidebar can be dragged to 420 px; the address bar adapts instead of the sidebar stopping
- [x] One sidebar row per split, with a vertical line between the two names
- [x] Settings button removed from the sidebar bottom (it lives in the space's three-dot menu)
- [x] Spaces icons centred in the bottom row
- [x] Canvas hover: a blurred, fading wash over the bottom of the sidebar that hides the spaces row
- [x] Tabs overview (a panel; reachable from the space menu and the space icon's right-click)

## Top bar and windows
- [x] Windows top bar across the window: Wave menu, sidebar button, back, forward, reload, address in the middle, extensions, window buttons
- [x] Back button aligned with the left edge of the page
- [x] Split button at the top right; swaps with the sidebar button when tabs are on the right
- [x] Windows caption buttons: thin glyphs on nothing, flush to the corner, a light grey on hover, Close turns red with a tooltip
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

## Ask Wave
- [x] Floating chat with model picker, Chat mode, dictation
- [x] Overlay with a blurred wash fading in and out; the page stays live
- [x] Built-in commands do what was asked (site searches and more), window closes 6 s after a finished request
- [ ] The assistant acting through the Decider model (needs the model installed; see On-device models)

## Canvas
- [x] Infinite board of cards; Discover (mood and subject); Recently discovered
- [x] Right-click an image or selected text on a page: Save to Canvas
- [x] Cards sorted into topics by one function (`Wave.canvas.classify`)
- [x] On-device models: Sorter and Decider, used apart or together (fusion); installable from Settings
- [ ] Choose the long-term default after some real use (both are in; compare by usage)
- [ ] Download the saved image instead of linking it

## Library
- [x] Spaces, Canvas, History, Boosts, Downloads, Prompts, Routines, Archive
- [x] Routines run at start or daily while Wave is open

## Menus and surfaces
- [x] A transparent surface above every page for menus, the site options panel and notices
- [x] One frosted glass, tint, radius and border for every context menu
- [x] Notices (e.g. "Opened in a new tab") are solid and sit at the top right
- [ ] Move the command bar and Ask Wave's input onto the surface (they draw correctly today)

## Extensions and profiles
- [x] Extensions load per profile; pin them next to the address bar
- [ ] Extension popups (Windows' web view does not provide them)

## First run
- [x] Welcome animation: a drop into still water, ripples, waves, the name, then the app
- [x] A pixel version of the same animation; Settings chooses smooth, pixel or both; replay buttons in Data
- [ ] Step 1: Look (light or dark, tabs left or right, layout)
- [ ] Step 2: Bring your things (import from other browsers)
- [ ] Step 3: Profile and first space
- [ ] Step 4: Ask Wave (built-in, your own key, or on-device models)
- [ ] Step 5: Make Wave the default browser
- [ ] Installer animation (the same water, shown while installing)

## Shipping
- [x] Chrome embedded in the exe for release builds
- [ ] Automatic updates (design in `rust-port/crates/wave/UPDATES.md`; needs a release host and signing)
- [ ] macOS parity (page snapshots, rounded corners, dictation, extensions)
- [ ] Automated tests for the native behaviour (focus, clipping, split, downloads)

## From the roadmap (see roadmap.md)
- [ ] Assistant composer docked in the page frame; page radius equal to the app frame's
- [ ] Tasks panel (plain-words capture, Today / Tomorrow / Upcoming, linked to the page, undo, "Make tasks")
- [ ] Native ad and tracker blocker (engine, lists with updates, cosmetic hiding, "hide with a click", per-site pause)
- [ ] Routines with runs, grants and approvals; routines kept separate from tasks
- [ ] Work canvas: run nodes, helpers with live previews, plan to tasks
- [ ] Skills, memory, provider keys in the system keychain
- [ ] Inactive tab sleep; global launcher; new tab with time and tasks; time and focus; notes beside the page
- [ ] macOS: top bar and navigation as liquid glass
- [ ] Linux: decide the web engine
- [ ] Trackpad gestures prototype
