# Shelved: the assistant

These files are the AI chat Rainbow used to ship. They are kept intact so the feature can come
back, but nothing loads them today:

- `agent.js` — **Ask Rainbow**, the floating chat that could drive the browser (Claude models over
  the Anthropic API with the user's own key, plus an offline "Rainbow built-in" command set).
- `composer.js` — the resting **composer** notch at the bottom of the page that grew into the chat.
- `jev.js` — the **Jev page agent**, which reads a page as an indexed table of controls and asks a
  model for one decision per step (the "Decider" loop).

## Why they are not embedded

`index.html` does not load them and the ask/composer markup is gone from it. The directory name
starts with a dot, and `build.rs` skips dot-directories when it walks `ui/`, so these files are not
put inside the executable either — they cost nothing at build time or at runtime.

Trove's local OCR + classifier are unrelated: they stay in `trove.js` (`Rainbow.localModel` /
`Rainbow.ocr`) and keep working without any of this.

## Restoring

1. Move the files back out of this directory (`git mv ui/.shelved/agent.js ui/agent.js`, same for
   `jev.js` and `composer.js`), then add their `<script>` tags to `index.html` before
   `library.js` (after `rainbow.js`, like the rest of the chrome).
2. Restore the composer and ask markup in `index.html`: `#composer` / `#cpInput` and its tools,
   `#ask` / `#askLog` / `#askForm` / `#askInput`, and the band the native shell clips for the
   composer. The matching `.ask` / `.composer` styles are still in `rainbow.css`, under the
   "Shelved" notes.
3. Restore the chat's settings: the "ask" settings page in `rainbow.js` and its state (the API key,
   and the chosen model), which the page and `agent.js` read.
4. Restore the Decider model wiring in `jev.js` (its one-decision-per-step round trip needs the same
   key and model the chat page stores).
5. Keep `Rainbow.localModel` (the local Sorter) as it is: it classifies Trove cards and does not
   depend on the chat.

**Old names:** these files still speak the pre-shelf build's Canvas names — `Rainbow.canvas`,
`#canvasView`, `#cpCanvas`, `save_to_canvas` and "Save to Canvas". The board is Trove now, so rename
them to `Rainbow.trove`, `#troveView`, `#trove…`, `save_to_trove` and "Save to Trove" while restoring.
