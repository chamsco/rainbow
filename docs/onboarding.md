# First run

A fresh install opens the app directly. The old water-drop welcome animation has been removed,
along with the replay buttons that used to live in Settings → Data.

## Steps after opening (proposed)

1. **Look.** Light, dark or follow the system; tabs on the left or the right; one of the layouts (Only Sidebar, Top Toolbar,
   Collapsed, Compact). Each choice applies live behind the card.
2. **Bring your things.** Import tabs, bookmarks and history from the browsers it finds on the machine; skip is one click.
3. **Profile and first space.** Name the first space, pick its colours, say whether this is the personal profile or a new one.
4. **Ask Rainbow.** Three honest choices: built-in commands (no setup), your own API key, or a small model that runs on this
   machine (a one-time download, shown with its size).
5. **Make it the default browser** (Windows settings page opens; nothing is changed silently).

Each step is skippable and re-reachable from Settings. The steps are not built yet; the app opens straight into the shell.

## The on-device model

Canvas sorting and the built-in assistant should share one small model that runs locally. The call is already in place:
`Rainbow.canvas.classify(card)` asks `Rainbow.localModel.classify` when a model is installed and falls back to a keyword scorer
otherwise. What is left is choosing and shipping the model: a sentence-embedding model (about 20–90 MB) is enough for
sorting; the assistant wants a small instruction-tuned model (a few hundred MB, quantised). Both can run through one native
runtime inside the shell, downloaded on first use rather than bundled.
