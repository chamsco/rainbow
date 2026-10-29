# Rainbow: roadmap

Where Rainbow goes next, and what it can learn from [Zephium](https://github.com/zephium-browser/Zephium), an open-source
browser built the same way (Rust shell, the system's own web engine, an HTML interface, WebView2 on Windows and WebKit on
macOS). Rainbow's finished and open work is in [tasks.md](tasks.md); this file is the plan.

## Licence first

Zephium is **MPL-2.0**: a file-level licence. Using its ideas, behaviour and structure is free. Copying a file, or a
substantial part of one, keeps that file under MPL-2.0 (the notice stays, and changes to it are published), even inside an
MIT project. So the rule for Rainbow is: **take ideas and designs, write our own code**; only if we deliberately adopt a
whole module do we keep it in its own MPL-marked file. Things Zephium itself builds on:

- `adblock-rust` (Brave, MPL-2.0) is a library; using it as a dependency is fine.
- EasyList and EasyPrivacy are **CC BY-SA 3.0**: a bundled copy needs attribution, and the list stays under that licence.

## What to take, in order

### 1. The assistant docked in the page (high)
Zephium puts the assistant's composer at the bottom of the page, cut into the page frame like a notch: a few tool icons,
"What do you want to do?", a mic. Ask Rainbow today is a floating window with a wash behind it.
- Dock a composer into the bottom edge of the page frame; it grows into the chat on use.
- **The page's corner radius equals the app frame's.** On Windows 11 the frame is 8 px; the page, the composer notch and
  the split panes follow one radius token (today Corner radius is a setting, default 10).
- Keep the wash for long answers; the notch is the resting state.

### 2. Tasks (high)
A real Tasks panel, which Routines and the assistant can write into:
- Capture in plain words ("call Anna tomorrow at 3"), parsed into a day and time; lists Today, Tomorrow, Upcoming.
- A task remembers the page it came from, and opens it.
- Check off, undo, subtasks, priority. A count badge on the panel's edge.
- "Make tasks" on any plan the assistant produces; each step becomes a task linked back to its source.
- Stored locally, one file per list so other apps can read them.

### 3. Work canvas for the assistant (high, builds on Canvas)
Zephium's agent flows live on a canvas, not in a chat scroll: a prompt node with "Your memory" and a skill attached,
questions asked inline, helper branches that each browse a live page you can watch (Working / Done), result cards (photos,
price, flight timelines), a plan card, and finally tasks.
- Rainbow's Canvas already holds cards; add **run nodes**: prompt, memory, helper, result, plan.
- Helpers use a real tab in the background and show a live preview card.
- Everything with an effect (post, buy, change) waits for an explicit OK; reading and placing cards does not.
- **Skills** (small written procedures: trip planning, compare and choose, plan my day, weekly status) and **memory**
  (what Rainbow knows about you, local, editable).
- Choose a model per step: built-in commands, your own key (Anthropic, OpenAI, Google, Mistral, Groq, OpenRouter and
  others), a local server (Ollama, LM Studio), or the on-device Decider. Keys go in the system keychain, not in settings.

### 4. A native ad and tracker blocker (high)
How Zephium does it, and how Rainbow would:
- **Engine:** Brave's `adblock-rust` compiles EasyList and EasyPrivacy into an immutable matcher. Requests are stopped
  *before* the page can make them. On Windows that is WebView2's resource-request hook for every page view.
- **Lists:** a bundled copy ships in the app (attribution, CC BY-SA); an updater refreshes them about every 24–30 hours with
  conditional requests, no redirects, size and sanity checks, and keeps the last good copy if an update fails.
- **Cosmetic hiding:** a static stylesheet for known ad containers, plus **"hide anything on a page with a click"**
  (a personal element picker, stored per site).
- **Controls:** on by default per profile, pause for one site, a counter of what was blocked, Settings → Privacy.
- **Out of scope on purpose:** scriptlets, response rewriting, a proxy or certificate. Say plainly what is not covered.
- Rainbow already has per-site Boosts, which can host the picker's saved rules.

### 5. Routines, planned (high). See "Routines and tasks" below.

### 6. Quality-of-life that costs little (medium)
- Inactive tabs sleep and wake when you return (WebView2 can suspend a hidden page).
- A global launcher (Ctrl+Shift+Space) that reaches tabs, history, notes and commands from anywhere.
- New tab with the time, the day's tasks and a calm background.
- Time on the web, counted on this device only, with focus rounds that keep chosen sites shut.
- Notes beside the page, each one a Markdown file you own.
- Extensions: a short list verified to work (password managers, dark mode, vim keys) one click away, install from the Web Store.
- Import in the welcome flow from Chrome, Edge, Firefox, Brave and Safari.
- Every shortcut rebindable.
- Private windows keep nothing.

### 7. Platforms and look (medium)
- **macOS:** the top bar and navigation bar as liquid glass (a vibrancy view behind the interface); window buttons as native.
- **Windows:** Mica backdrop; caption buttons as drawn now (thin glyphs, flush to the corner, Close turns red).
- **Linux:** the shell's web view library uses WebKitGTK there, not Chromium. Chromium on Linux means embedding CEF, which
  is a decision in its own right (size, updates, a second code path). Open question; no work until it is decided.
- **Safari/WebKit** on macOS is already what the shell uses there.

### 8. Gestures (low)
A short video shows trackpad gestures moving a page around. Worth a prototype once split view and spaces are steady: swipe
between spaces, pinch to the tab overview.

## Routines and tasks

They are different things and should stay different.

|  | Task | Routine |
| --- | --- | --- |
| What it is | Something *you* will do | Something *Rainbow* does for you, again and again |
| Has | A day, maybe a time, a link to a page | A prompt, a trigger, a grant, a log |
| Ends when | You check it off | It never ends; each run does |
| Lives in | Tasks panel | Library → Routines |

**Routines, as they should work:**
1. **A trigger:** at a time (daily, weekdays, weekly), on start, or when you open a site. Missed runs happen at the next start,
   once, and say so.
2. **A grant, shown up front:** what the routine may do without asking. The default is read the web, read open tabs, put
   cards on the Canvas, add tasks. Anything with an effect (send, post, buy, change a setting) always waits for an OK, which
   arrives as a notice.
3. **A run, not a message:** each execution is saved as a run with its time, what it read, what it produced and whether it
   succeeded. Results appear as Canvas cards and, if it found something to do, as tasks. Failed runs say why and offer Retry.
4. **A budget:** a cap on steps and time per run, and a model choice per routine (built-in, on-device, or a key).
5. **A skill** can be attached ("weekly status", "morning reading"), the same skills the assistant uses.
6. **Quiet by default:** a run finishes silently unless it needs you; one summary card per day at most.
7. **Off the page's reach:** a page can never create or change a routine; only the interface can.

Today's Routines (a prompt that runs at start or daily while Rainbow is open) are step 1 of this. The next steps are the run
log, the grant and the notice for anything that needs approval.

## Suggested order
1. Window buttons and radius tokens (small; buttons done).
2. Tasks panel (unblocks routines and "Make tasks").
3. Native blocker (self-contained, high value, can ship alone).
4. Docked composer in the page.
5. Routines with runs and grants.
6. Work canvas: run nodes, helpers, plan → tasks.
7. Skills and memory; provider keys in the keychain.
8. The rest of the quality-of-life list; macOS glass; Linux decision.
