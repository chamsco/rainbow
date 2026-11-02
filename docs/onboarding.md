# First run

A fresh install opens the app directly. The old water-drop welcome animation has been removed,
along with the replay buttons that used to live in Settings → Data.

## Steps after opening (proposed)

1. **Look.** Light, dark or follow the system; tabs on the left or the right; one of the layouts (Only Sidebar, Top Toolbar,
   Collapsed, Compact). Each choice applies live behind the card.
2. **Bring your things.** Import tabs, bookmarks and history from the browsers it finds on the machine; skip is one click.
3. **Profile and first space.** Name the first space, pick its colours, say whether this is the personal profile or a new one.
4. **Local model.** Nothing to set up to start: Windows' own OCR reads the text out of captures, and the Sorter (about 23 MB,
   one download) files each Trove card under a topic once installed. The keyword scorer sorts cards until then.
5. **Make it the default browser** (Windows settings page opens; nothing is changed silently).

Each step is skippable and re-reachable from Settings. The steps are not built yet; the app opens straight into the shell.

## The local model

OCR and classification both run on this machine. Windows reads the text out of a capture itself (offline, no model); the
Sorter, a small sentence-embedding model of about 23 MB, is downloaded once on first use and picks the topic of each
Trove card. Nothing is uploaded, and a topic chosen by hand is never overwritten.

The call is already in place: `Rainbow.trove.classify(card)` asks `Rainbow.localModel.classify` when the Sorter is
installed and falls back to a keyword scorer otherwise. Install it, or remove it again, in Settings → Local model.
The assistant chat and the Decider model are shelved for now; the code is parked in
`rust-port/crates/rainbow/ui/.shelved/` and can come back.
