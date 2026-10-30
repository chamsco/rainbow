'use strict';
/* Rainbow chrome: spaces, pinned/today tabs, global Essentials, command bar, boosts,
   settings. The page itself lives in the native shell (one webview per tab); in a plain
   browser (for UI work) tabs fall back to iframes. canvas.js and agent.js build on the
   `Rainbow` object exported at the bottom. */

const $ = (s, r = document) => r.querySelector(s);
const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'innerHTML') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null && k !== false) el.append(k);
  return el;
};
const NATIVE = !!window.RAINBOW_NATIVE;
const root = document.documentElement;
root.dataset.os = window.RAINBOW_OS || 'web';
if (NATIVE) root.dataset.native = '';

/* ---------------- state ---------------- */

const KEY = 'rainbow.v1';
let seq = Date.now();
const uid = () => ++seq;
/* Space colours. Three stops, not two: at sidebar size a two-stop gradient reads as one flat
   wash, and it is the third stop that makes the column look lit from a corner. `PALETTES` stays
   two-stop for saved state and for code that only knows a pair. */
const THEMES = [
  { name: 'Rainbow', a: '#7fb2c9', b: '#c8d9c0', c: '#9fd3b5' },
  /* Compass is the exception: almost no colour, so the chrome reads as paper. `flat` tells
     applyTheme to stop pretending it has a space colour and to keep the ink dark — a light theme
     that follows the system into dark mode would be light text on a light column. */
  { name: 'Compass', a: '#e6efe9', b: '#f1f4f1', c: '#f5f6f4', flat: true },
  { name: 'Dawn', a: '#f7e0c8', b: '#f2b8a2', c: '#d9a9c8' },
  { name: 'Blush', a: '#f6cdd8', b: '#e9a7c0', c: '#b58bd8' },
  { name: 'Mauve', a: '#e7c3e0', b: '#c9a3e0', c: '#9b8ad8' },
  { name: 'Coral', a: '#f6c2b0', b: '#ee9a92', c: '#c97ba8' },
  { name: 'Peach', a: '#f8dcb4', b: '#f2b98f', c: '#d98ba4' },
  { name: 'Sun', a: '#f7e7a8', b: '#efd07a', c: '#d9b06a' },
  { name: 'Mint', a: '#d6ecd2', b: '#a8d9b6', c: '#8ec2c9' },
  { name: 'Lagoon', a: '#c8e6e4', b: '#8fc9cf', c: '#6fa6c4' },
  { name: 'Iris', a: '#cfd4f2', b: '#a8b0e8', c: '#8b8fd0' },
  { name: 'Slate', a: '#cfd8de', b: '#9fb0bd', c: '#7b8b9c' },
  { name: 'Midnight', a: '#2b3a4a', b: '#3f5468', c: '#4f6272' },
];
const PALETTES = THEMES.map(t => [t.a, t.b]);
const themeOf = s => THEMES.find(t => t.a === s.a && t.b === s.b && (t.c || t.b) === (s.c || s.b)) || null;
const themeName = s => themeOf(s)?.name || 'Custom';

/* One swatch row for every place that offers a theme — settings, the space editor, the create
   panel — so adding a theme shows up everywhere instead of in one of the three. */
function themeSwatches(current, onpick) {
  return h('div', { class: 'swatches themes' }, THEMES.map(t => h('button', {
    class: `swatch${current.a === t.a && current.b === t.b ? ' on' : ''}`,
    style: `background:linear-gradient(150deg,${t.a},${t.b},${t.c})`,
    title: t.name, 'aria-label': t.name, dataset: { theme: t.name },
    onclick: e => {
      onpick(t);
      e.currentTarget.parentElement.querySelectorAll('.swatch').forEach(x => x.classList.toggle('on', x === e.currentTarget));
    },
  })));
}
const ICONS = ['🌈', '🪷', '🌿', '🐚', '☀️', '🌙', '📚', '💼', '🎨', '🧪', '🎧', '✈️',
  '🔥', '💡', '🌱', '🧠', '🎯', '🛠️', '📦', '🫧', '🍀', '🪐', '🧭', '🏗️'];

function seed() {
  const space = (name, icon, [a, b], urls) => {
    const s = { id: uid(), name, icon, a, b, pinned: [], today: [], folders: [], active: null };
    for (const url of urls) {
      const t = { id: uid(), url, home: url, title: hostOf(url), space: s.id, last: Date.now() };
      tabsSeed[t.id] = t; s.pinned.push(t.id);
    }
    return s;
  };
  const tabsSeed = {};
  const spaces = [
    space('Personal', '🌈', PALETTES[0], ['https://en.wikipedia.org/wiki/Rainbow', 'https://news.ycombinator.com/']),
    space('Work', '💼', PALETTES[2], ['https://github.com/']),
  ];
  return {
    v: 1, spaces, activeSpace: spaces[0].id, tabs: tabsSeed,
    essentials: [
      { id: uid(), url: 'https://mail.google.com/', title: 'Mail' },
      { id: uid(), url: 'https://calendar.google.com/', title: 'Calendar' },
      { id: uid(), url: 'https://www.youtube.com/', title: 'YouTube' },
      { id: uid(), url: 'https://www.figma.com/', title: 'Figma' },
    ],
    bookmarks: [], edges: [], history: [], archive: [], boosts: {},
    settings: {
      mode: 'auto', side: 'left', density: 'comfortable', grain: true, radius: 8, inset: 8, blur: 4, layout: 'sidebar', compact: 'off',
      sideWidth: 248, compactPeek: .5, archiveHours: 12, search: 'google', model: 'claude-opus-5-5', apiKey: '', autoPip: true,
    },
  };
}

let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
if (!state || state.v !== 1) state = seed();
state.settings = { ...seed().settings, ...state.settings };
// Older stores may carry a radius rounder than the window frame; the page follows the frame.
if (state.settings.radius > 8) state.settings.radius = 8;
for (const k of ['bookmarks', 'edges', 'history', 'archive', 'downloads']) state[k] ||= [];
state.boosts ||= {};
state.profiles ||= [{ id: 'default', name: 'Personal' }];
state.extPins ||= {};
state.icons ||= {};       // host -> the icon the site itself declares
state.siteNames ||= {};   // host -> the name its home page gives itself   // profile id -> the extension folders pinned to the toolbar
for (const sp of state.spaces) { sp.folders ||= []; sp.profile ||= 'default'; }

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  // ponytail: one JSON blob in the chrome's localStorage; move to files via IPC
  // when the canvas holds thousands of screenshots.
  saveTimer = setTimeout(flush, 150);
}
/* Write now. A debounced save never runs if the window goes away inside those 150 ms, which
   lost the last change on close — and dropped an import, which reloads immediately. */
function flush() {
  clearTimeout(saveTimer);
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch { toast('Storage is full: remove some Canvas screenshots'); }
}

// Windows ships with the compact title bar (address in the middle, caption buttons at the
// right). Existing installs move once; the setting after that is the user's.
if (root.dataset.os === 'windows' && state.settings.migratedCompact !== true) {
  if (state.settings.layout === 'sidebar') state.settings.layout = 'toolbar';
  state.settings.migratedCompact = true;
  save();
}

/* runtime, not persisted */
const live = new Set();       // tab ids with a webview
const loading = new Set();
const closed = [];            // for Ctrl+Shift+T
let shownTab = null;          // what the page card shows right now
let view = 'page';            // 'page' | 'canvas'

const space = () => state.spaces.find(s => s.id === state.activeSpace) || state.spaces[0];
const tab = id => state.tabs[id];
const activeTab = () => tab(space().active);

/* ---------------- urls ---------------- */

function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } }
/* en.wikipedia.org → wikipedia, www.amazon.com → amazon, google.com → google. A row shows the
   site, not the address: the logo plus the name, and "Open website" underneath when the entry
   has no title of its own. */
function siteName(url) {
  const h = hostOf(url), parts = h.split('.');
  while (parts.length > 2 && parts[0].length <= 4) parts.shift();   // en., www., m.
  if (parts.length > 2) parts.shift();                              // any other subdomain
  return parts[0] || h;
}
const SEARCH = {
  google: 'https://www.google.com/search?q=', duckduckgo: 'https://duckduckgo.com/?q=',
  kagi: 'https://kagi.com/search?q=', bing: 'https://www.bing.com/search?q=',
};
function toUrl(text) {
  const q = text.trim();
  if (!q) return null;
  if (/^[a-z][\w+.-]*:\/\//i.test(q) || /^(about|data|file):/i.test(q)) return q;
  if (!/\s/.test(q) && (/^localhost(:\d+)?(\/|$)/.test(q) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/.*)?$/.test(q))) {
    return (/^localhost|^\d+\.\d+\.\d+\.\d+/.test(q) ? 'http://' : 'https://') + q;
  }
  return SEARCH[state.settings.search] + encodeURIComponent(q);
}
/* What a site calls itself, for people: "news.ycombinator.com" is Hacker News. A few well-known names
   are built in; any other site's name is learned from the title of its home page. */
const SITE_NAMES = { 'news.ycombinator.com': 'Hacker News', 'mail.google.com': 'Gmail', 'calendar.google.com': 'Google Calendar',
  'docs.google.com': 'Google Docs', 'drive.google.com': 'Google Drive', 'www.youtube.com': 'YouTube', 'youtube.com': 'YouTube',
  'github.com': 'GitHub', 'x.com': 'X', 'twitter.com': 'X', 'en.wikipedia.org': 'Wikipedia', 'www.figma.com': 'Figma', 'figma.com': 'Figma',
  'www.reddit.com': 'Reddit', 'www.linkedin.com': 'LinkedIn', 'www.facebook.com': 'Facebook' };
function siteName(urlOrHost) {
  const host = /^https?:/i.test(urlOrHost) ? hostOf(urlOrHost) : String(urlOrHost || '');
  const known = SITE_NAMES[host] || state.siteNames?.[host];
  if (known) return known;
  const p = host.replace(/^www\./, '').split('.');
  const core = p.length > 1 ? p[p.length - 2] : p[0];
  return core ? core[0].toUpperCase() + core.slice(1) : host;
}
function learnSiteName(t) {
  try {
    const u = new URL(t.url);
    if ((u.pathname !== '/' && u.pathname !== '') || u.search || !t.title) return;
    const nm = String(t.title).split(/\s[-|·–—]\s|:\s/)[0].trim();
    if (nm && nm.length <= 28 && nm.toLowerCase() !== u.hostname.toLowerCase()) (state.siteNames ||= {})[u.hostname] = nm;
  } catch {}
}
// Icons some sites do not serve at /favicon.ico until the page itself is open.
const KNOWN_ICONS = { 'mail.google.com': 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  'calendar.google.com': 'https://calendar.google.com/googlecalendar/images/favicons_2020q4/calendar_31.ico',
  'docs.google.com': 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico' };
function favicon(url, size = 16) {
  const host = hostOf(url);
  const letter = (host.replace(/^(mail|calendar|docs|app)\./, '')[0] || '?');
  const hue = [...host].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
  const mono = h('span', { class: 'fav mono', style: `background:hsl(${hue} 42% 52%);width:${size}px;height:${size}px` }, letter);
  if (!/^https?:/.test(url)) return mono;
  // First-party favicon only: no third-party icon service learns what you browse.
  const img = h('img', { class: 'fav', alt: '', width: size, height: size, src: state.icons?.[host] || KNOWN_ICONS[host] || new URL('/favicon.ico', url).href });
  img.onerror = () => img.replaceWith(mono);
  return img;
}

/* ---------------- host bridge ---------------- */

const frames = {};
/* The browser stand-in has no page pixels to give, so it paints a stand-in page: enough for the
   overlay blur, the screenshot tool and the Canvas to be exercised outside the shell. */
function standInPage(times = 1) {
  const r = $('#page').getBoundingClientRect();
  const c = h('canvas', { width: Math.max(2, Math.round(r.width)), height: Math.max(2, Math.round(r.height * times)) });
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, c.width, c.height);
  grad.addColorStop(0, '#eef3ee'); grad.addColorStop(1, '#dde8e1');
  g.fillStyle = grad; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = 'rgba(20,40,30,.13)';
  for (let i = 0; i < 14 * times; i++) g.fillRect(26, 46 + i * 26, c.width * (.28 + (i % 5) * .12), 12);
  try { return c.toDataURL('image/jpeg', .8); } catch { return null; }
}
const web = { // iframe stand-in for the native shell, so the chrome can be built in a browser
  handle(m) {
    const f = frames[m.id];
    switch (m.t) {
      case 'open': {
        const el = h('iframe', { src: m.url, hidden: true, allow: 'clipboard-read; clipboard-write; fullscreen' });
        el.addEventListener('load', () => Rainbow.recv({ t: 'page', id: m.id, loading: false }));
        frames[m.id] = el; $('#page').append(el);
        Rainbow.recv({ t: 'page', id: m.id, url: m.url, loading: true });
        break;
      }
      case 'layout': {
        const base = $('#page').getBoundingClientRect(), on = new Map(m.panes.map(p => [p.id, p]));
        for (const [id, el] of Object.entries(frames)) {
          const p = on.get(+id);
          el.hidden = !p;
          if (p) Object.assign(el.style, { left: p.x - base.left + 'px', top: p.y - base.top + 'px', width: p.w + 'px', height: p.h + 'px' });
        }
        break;
      }
      case 'nav': if (f) { f.src = m.url; Rainbow.recv({ t: 'page', id: m.id, url: m.url, loading: true }); } break;
      case 'close': f?.remove(); delete frames[m.id]; break;
      case 'exec': try { f.contentWindow.eval(m.js); } catch { /* cross-origin in the stand-in */ } break;
      case 'eval': {
        let value = null;
        try { value = f.contentWindow.eval(m.js); } catch { value = null; }
        setTimeout(() => Rainbow.recv({ t: 'evalResult', req: m.req, value }));
        break;
      }
      case 'snapshot': setTimeout(() => Rainbow.recv({ t: 'snapshot', id: m.id, data: standInPage(1) })); break;
      // A full-page shot is the same stand-in, three times taller, so the crop and the fit
      // logic see an image with real proportions.
      case 'shot': setTimeout(() => Rainbow.recv({ t: 'shot', id: m.id, data: standInPage(m.full ? 3 : 1) })); break;
      // The browser stand-in has no recognizer, so it answers with a little text of its own so
      // the capture-then-attach path can be exercised outside the shell.
      case 'ocr': setTimeout(() => Rainbow.recv({ t: 'ocrResult', req: m.req, data: { text: 'Stand-in page text, readable after capture.', lines: [] } })); break;
      // The stand-in has no media folder; keeping the data URL is the correct fallback.
      case 'media': setTimeout(() => Rainbow.recv({ t: 'mediaSaved', req: m.req, url: null })); break;
    }
  },
};
const send = m => (NATIVE ? window.ipc.postMessage(JSON.stringify(m)) : web.handle(m));

const waiters = new Map();
let reqSeq = 0;
function evalIn(id, js) { // run JS in a page and get the (JSON-serialisable) result back
  return new Promise(resolve => {
    const req = ++reqSeq;
    waiters.set(req, resolve);
    send({ t: 'eval', id, js, req });
    setTimeout(() => { if (waiters.delete(req)) resolve(null); }, 4000);
  });
}
const shots = new Map();
function snapshot(id) {
  return new Promise(resolve => {
    if (!live.has(id)) return resolve(null);
    shots.set(id, resolve);
    send({ t: 'snapshot', id });
    setTimeout(() => { if (shots.get(id) === resolve) { shots.delete(id); resolve(null); } }, 1500);
  });
}
/* Read the text out of a captured image. The shell answers with `{ text, lines }` through
   Windows' own recognizer; the browser stand-in answers with a little sample text so the path can
   be exercised without the shell. Resolves null on timeout, so a caller can save the capture first
   and attach the text whenever it arrives. */
const ocrs = new Map();
let ocrSeq = 0;
function ocr(dataUrl) {
  return new Promise(resolve => {
    if (!dataUrl) return resolve(null);
    const req = ++ocrSeq;
    ocrs.set(req, resolve);
    // `send` reaches the shell in the app and the stand-in page in a browser, so the same capture
    // path can be exercised without the shell.
    send({ t: 'ocr', req, data: dataUrl });
    setTimeout(() => { if (ocrs.delete(req)) resolve(null); }, 30000);
  });
}
/* Captures are kept as files, not as data URLs in the chrome's store: a full-page screenshot is
   megabytes, and localStorage has a small quota. Resolves the URL to use, or null to keep the
   data URL (browser stand-in, or a write that failed). */
const mediaSaves = new Map();
let mediaSeq = 0;
function putMedia(name, data) {
  return new Promise(resolve => {
    if (!name || typeof data !== 'string' || !data.startsWith('data:image/')) return resolve(null);
    const req = ++mediaSeq;
    mediaSaves.set(req, resolve);
    send({ t: 'media', op: 'put', req, name, data });
    setTimeout(() => { if (mediaSaves.delete(req)) resolve(null); }, 8000);
  });
}
function delMedia(name) {
  if (NATIVE && name) send({ t: 'media', op: 'del', name });
}

function recv(m) {
  switch (m.t) {
    case 'page': {
      const t = tab(m.id);
      if (!t) return;
      if (m.url && !m.url.startsWith('about:')) t.url = m.url;
      if (m.title) { t.title = m.title; learnSiteName(t); }
      if (m.loading === true) loading.add(m.id);
      if (m.loading === false) {
        loading.delete(m.id);
        applyBoost(t);
        if (!t.title || t.title === hostOf(t.url)) titleFromFrame(t);
        remember(t);
      }
      render(); save();
      break;
    }
    case 'popup': openTab(m.url, { focus: true }); break;
    case 'focus': closeSurfaceMenu(); focusPane(m.id); break;
    case 'download': {
      const d = state.downloads.find(x => x.url === m.url && x.state === 'started');
      if (d) Object.assign(d, { state: m.state, path: m.path || d.path, size: m.size || d.size });
      else state.downloads.unshift({ url: m.url, path: m.path, state: m.state, size: m.size, t: Date.now() });
      state.downloads = state.downloads.slice(0, 200);
      if (m.state === 'done') toast('Downloaded ' + (m.path || '').split(/[\\/]/).pop());
      Rainbow.library?.refresh(); save();
      break;
    }
    case 'media': {
      if (!tab(m.id) || !m.s) break;
      if (!m.s.any) { if (media.delete(m.id)) paintMedia(); break; }
      const cur = media.get(m.id) || { dismissed: false, played: false };
      const wasPlaying = cur.s?.p;
      cur.s = m.s; cur.at = Date.now();
      if (m.s.p && !wasPlaying) cur.rank = Date.now();   // card order: when it started, not when it last reported
      if (m.s.p) { cur.dismissed = false; cur.played = true; }
      media.set(m.id, cur);
      paintMedia();
      break;
    }
    // A click on the floating PiP window comes back here: its tab takes over, which exits
    // PiP through activate() and puts the video back in the page.
    case 'pipFocus': if (tab(m.id)) activate(m.id); break;
    case 'peek': openPeek(m.url); break;
    case 'extensions': (Rainbow.extensions ||= {})[m.profile] = m; drawExtBar(); Rainbow.onExtensions?.(); break;
    case 'surfaceAct': {
      if (m.act === 'dismiss') { closeSurfaceMenu(); break; }
      const fn = m.act.startsWith('m:') && surfMenu?.acts[+m.act.slice(2)];
      if (fn) { closeSurfaceMenu(); fn(); }
      break;
    }
    case 'icon': {
      const t = tab(m.id);
      if (!t || !m.href) break;
      const host = hostOf(t.url);
      if (state.icons[host] !== m.href) {
        state.icons[host] = m.href;
        const keys = Object.keys(state.icons);
        if (keys.length > 400) delete state.icons[keys[0]];
        save(); render();
      }
      break;
    }
    case 'ctx': pageContextMenu(m); break;
    case 'cursor': Rainbow.composer?.cursor(m); break;
    case 'newtab': openTab(m.url, { focus: false }); surfaceToast('Opened in a new tab'); break;
    case 'key': onKey({ key: m.key, ctrlKey: true, shiftKey: m.shift, altKey: false, metaKey: false, preventDefault() {} }); break;
    case 'snapshot': { const r = shots.get(m.id); shots.delete(m.id); r?.(m.data); break; }
    case 'shot': { const r = fullShots.get(m.id); fullShots.delete(m.id); r?.(m.data); break; }
    case 'ocrResult': { const r = ocrs.get(m.req); ocrs.delete(m.req); r?.(m.data); break; }
    case 'mediaSaved': { const r = mediaSaves.get(m.req); mediaSaves.delete(m.req); r?.(m.url || null); break; }
    case 'evalResult': { const r = waiters.get(m.req); waiters.delete(m.req); r?.(m.value); break; }
  }
}
function titleFromFrame(t) {
  if (NATIVE) return;
  try { const d = frames[t.id]?.contentDocument; if (d?.title) t.title = d.title; } catch { /* cross-origin */ }
}
function remember(t) {
  if (!/^https?:/.test(t.url)) return;
  if (state.history[0]?.url !== t.url) Rainbow.canvas?.touch(t.url);
  state.history = [{ url: t.url, title: t.title, t: Date.now() }, ...state.history.filter(x => x.url !== t.url)].slice(0, 1000);
}

/* ---------------- tabs ---------------- */

function ensureLive(t) {
  if (live.has(t.id)) return;
  live.add(t.id);
  send({ t: 'open', id: t.id, url: t.url, profile: profileOf(state.spaces.find(x => x.id === t.space) || space()).id });
}
function showPage(id) {
  shownTab = id;
  syncPage();
}

/* The page area: one pane, or two side by side in split view. The shell places each
   tab's native view in its rectangle; the chrome only draws the gap between them. */
let panes = [], lastLayout = '', syncQueued = false, splitGap = null;
/* Layout is coalesced to one pass per frame and skipped when nothing moved, so dragging
   the window edge or the sidebar doesn't flood the shell with identical messages. */
function syncPage() {
  if (syncQueued) return;
  syncQueued = true;
  let done = false;
  const run = () => { if (done) return; done = true; syncQueued = false; doSync(); };
  requestAnimationFrame(run);
  // rAF is the fast path, not a guarantee: a hidden, minimised or occluded window produces
  // no frames at all, and then the shell would never learn where the panes are — the page
  // area stays black and the shell's "chrome never spoke" reload fires for nothing.
  setTimeout(run, 60);
}
/* A right-click on an image or a selection inside a page: Save to Canvas and the few things that go with it. */
function pageContextMenu(m) {
  const c = m.ctx, p = panes.find(q => q.id === m.id);
  if (!c || !p) return;
  const items = c.kind === 'image' ? [
    ['Save image to Canvas', () => Rainbow.canvas?.capture(c)],
    ['Open image in new tab', () => openTab(c.src)],
    ['Copy image address', () => copyText(c.src, 'Address copied')],
  ] : [
    ['Save to Canvas', () => Rainbow.canvas?.capture(c)],
    ['Copy', () => copyText(c.text, 'Copied')],
    [`Search the web for “${c.text.slice(0, 22)}${c.text.length > 22 ? '…' : ''}”`, () => openTab(SEARCH[state.settings.search] + encodeURIComponent(c.text.slice(0, 200)))],
  ];
  menu(p.x + (+c.x || 0), p.y + (+c.y || 0), items);
}
function doSync() {
  alignNav();
  const s = space();
  const ids = view !== 'page' || !shownTab ? []
    : s.split?.includes(shownTab) && s.split.every(tab) ? s.split : [shownTab];
  ids.forEach(id => ensureLive(tab(id)));
  const r = $('#pageCard').getBoundingClientRect();
  const x = r.left, w = r.width;
  const hgt = Math.max(0, r.height), gap = 6, ratio = s.ratio || .5, col = s.splitDir === 'col';
  let heads = [];
  if (ids.length === 2) {
    // Two boxes (a header and a page each), side by side or stacked, with a gap between.
    const boxes = col
      ? [{ x, y: r.top, w, h: Math.round(hgt * ratio - gap / 2) }, { x, y: r.top + Math.round(hgt * ratio - gap / 2) + gap, w, h: hgt - Math.round(hgt * ratio - gap / 2) - gap }]
      : [{ x, y: r.top, w: Math.round(w * ratio - gap / 2), h: hgt }, { x: x + Math.round(w * ratio - gap / 2) + gap, y: r.top, w: w - Math.round(w * ratio - gap / 2) - gap, h: hgt }];
    heads = boxes.map((b, i) => ({ id: ids[i], x: b.x, y: b.y, w: b.w, h: HEAD_H }));
    panes = boxes.map((b, i) => ({ id: ids[i], x: b.x, y: b.y + HEAD_H, w: b.w, h: Math.max(0, b.h - HEAD_H) }));
    splitGap = col ? { y: boxes[0].y + boxes[0].h + gap / 2 - r.top } : { x: boxes[0].x + boxes[0].w + gap / 2 - r.left };
  } else panes = ids.map(id => ({ id, x, y: r.top, w, h: hgt }));
  drawSplitHeads(heads, r);
  const all = peek ? [...panes, peekRect()] : panes;
  // The frozen page behind an overlay must follow the layout, or changing a setting leaves
  // the blurred snapshot floating where the page used to be.
  const veil = $('#veil'), shot = $('#veilShot');
  if (!veil.hidden && !veil.classList.contains('low') && !shot.hidden && panes[0]) {
    const p = panes[0];
    Object.assign(shot.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
  }
  const msg = JSON.stringify({ t: 'layout', panes: all, active: ids.length ? shownTab : null,
    // Compact mode's band is three pixels, so the page's corners stay shallower than the
    // setting asks for, or the band would be eaten by the rounding.
    radius: state.settings.layout === 'compact' ? Math.min(state.settings.radius, 8) : state.settings.radius });
  if (msg !== lastLayout) { lastLayout = msg; send(JSON.parse(msg)); }
  const div = $('#splitDivider');
  div.hidden = ids.length !== 2;
  div.classList.toggle('col', col);
  if (ids.length === 2) { if (col) { div.style.top = splitGap.y - 4 + 'px'; div.style.left = '0px'; } else { div.style.left = splitGap.x - 4 + 'px'; div.style.top = '0px'; } }
  $('#pageCard').classList.toggle('split', ids.length === 2);
  $('#empty').hidden = view !== 'page' || !!shownTab;
}
function focusPane(id) { // the user clicked into one side of a split
  const s = space();
  if (id === shownTab || !s.split?.includes(id)) return;
  s.active = shownTab = id;
  syncPage(); render(); save();
}
/* Split view: two pages, side by side or stacked. `dir` is where the new page goes relative to the one
   you are on: left, right, top or bottom of the screen. */
let pendingSplit = null;
function splitWith(a, b, dir = 'right') {
  const s = space();
  if (!tab(a) || !tab(b) || a === b) return;
  s.split = dir === 'left' || dir === 'top' ? [b, a] : [a, b];
  s.splitDir = dir === 'top' || dir === 'bottom' ? 'col' : 'row';
  s.ratio = .5;
  activate(b);
}
function unsplit() {
  const s = space(); s.split = null;
  // Hiding is safe to do now; showing has to wait for the frame, because only doSync knows
  // where the divider belongs. Without this the handle could linger over a single page.
  $('#splitDivider').hidden = true;
  syncPage(); render(); save();
}
/* "Split view" asks where, then what: a side of the screen, then a tab (or a new one). */
const ICO_SPLIT = { left: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M7 3v10"/><path d="M2.5 5.5h4v5h-4z" fill="currentColor" stroke="none" opacity=".35"/></svg>',
  right: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M9 3v10"/><path d="M9.5 5.5h4v5h-4z" fill="currentColor" stroke="none" opacity=".35"/></svg>',
  top: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 8h12"/><path d="M3 3.5h10v4H3z" fill="currentColor" stroke="none" opacity=".35"/></svg>',
  bottom: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><path d="M2 8h12"/><path d="M3 8.5h10v4H3z" fill="currentColor" stroke="none" opacity=".35"/></svg>' };
function splitMenu(id, x, y) {
  const s = space();
  if (s.split?.includes(id)) return menu(x, y, [['Close split view', unsplit]]);
  menu(x, y, [
    ['Split view', null, 'head'],
    ['To the left', () => setTimeout(() => splitPicker(id, 'left', x, y)), '', '', ICO_SPLIT.left],
    ['To the right', () => setTimeout(() => splitPicker(id, 'right', x, y)), '', '', ICO_SPLIT.right],
    ['To the top', () => setTimeout(() => splitPicker(id, 'top', x, y)), '', '', ICO_SPLIT.top],
    ['To the bottom', () => setTimeout(() => splitPicker(id, 'bottom', x, y)), '', '', ICO_SPLIT.bottom],
  ]);
}
function splitPicker(id, dir, x, y) {
  const s = space();
  const others = [...s.pinned, ...s.today].filter(o => o !== id && tab(o));
  menu(x, y, [
    ['New tab', () => { pendingSplit = { id, dir }; openCmd('new'); }, '', 'Ctrl+T'],
    others.length ? '-' : null,
    ...others.slice(0, 12).map(o => [tab(o).custom || tab(o).title || hostOf(tab(o).url), () => splitWith(id, o, dir)]),
  ]);
}

/* Each side of a split has a thin header of its own: back, forward, the page's address, and a button
   to leave the split. They sit in the strip above their page, which is chrome, so a page never covers them. */
const HEAD_H = 30;
function drawSplitHeads(heads, origin) {
  const box = $('#splitHeads');
  if (!heads.length) { box.replaceChildren(); box.dataset.sig = ''; return; }
  const sig = heads.map(hd => `${hd.id}:${tab(hd.id)?.url}:${shownTab === hd.id}`).join('|');
  if (box.dataset.sig !== sig) {
    box.dataset.sig = sig;
    box.replaceChildren(...heads.map(hd => {
      const t = tab(hd.id);
      const go = js => e => { e.stopPropagation(); send({ t: 'exec', id: hd.id, js }); };
      const btn = (cls, title, svg, fn) => h('button', { class: cls, title, 'aria-label': title, onclick: fn, innerHTML: svg });
      let host = '';
      try { host = new URL(t?.url).hostname.replace(/^www\./, ''); } catch { host = t?.url || ''; }
      return h('div', { class: 'shead' + (shownTab === hd.id ? ' on' : ''), dataset: { id: hd.id }, onpointerdown: () => focusPane(hd.id) },
        h('span', { class: 'sh-l' },
          btn('sh-b', 'Back', '<svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5"/></svg>', go('history.back()')),
          btn('sh-b', 'Forward', '<svg viewBox="0 0 16 16"><path d="m6 3 5 5-5 5"/></svg>', go('history.forward()'))),
        h('span', { class: 'sh-url', title: t?.url || '' },
          h('span', { class: 'sh-ico', innerHTML: '<svg viewBox="0 0 16 16"><path d="M6.7 9.3a3 3 0 0 0 4.2 0l2-2a3 3 0 0 0-4.2-4.2l-.8.8"/><path d="M9.3 6.7a3 3 0 0 0-4.2 0l-2 2a3 3 0 0 0 4.2 4.2l.8-.8"/></svg>' }), host),
        h('span', { class: 'sh-r', },
          btn('sh-b sh-x', 'Close split view', '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6"/><path d="m6 6 4 4M10 6l-4 4"/></svg>', e => { e.stopPropagation(); unsplit(); })));
    }));
  }
  heads.forEach((hd, i) => {
    const el = box.children[i];
    if (el) Object.assign(el.style, { left: hd.x - origin.left + 'px', top: hd.y - origin.top + 'px', width: hd.w + 'px', height: hd.h + 'px' });
  });
}

function activate(id) {
  const t = tab(id);
  if (!t) return;
  // Leaving a tab that is playing a video floats it (the usual move); coming back puts it
  // back into the page. Only for a single pane, and only while the setting is on.
  const prev = shownTab, s0 = space();
  if (state.settings.autoPip !== false && prev && prev !== id && !s0.split) {
    const m = media.get(prev);
    if (m?.s.p && m.s.k === 'video' && !m.s.pip) togglePip(prev);
  }
  if (t.space && t.space !== state.activeSpace) switchSpace(t.space, { keepTab: true });
  const back = media.get(id);
  if (state.settings.autoPip !== false && back?.s.pip) togglePip(id);
  space().active = id;
  t.last = Date.now();
  ensureLive(t);
  if (view !== 'page') setView('page');
  showPage(id);
  render(); save();
}

function openTab(input, { focus = true, spaceId = state.activeSpace, title } = {}) {
  if (pendingSplit && focus) { const p = pendingSplit; pendingSplit = null; const t = openTab(input, { focus: false, spaceId, title }); if (t) splitWith(p.id, t.id, p.dir); return t; }
  const url = toUrl(input);
  if (!url) return null;
  const s = state.spaces.find(x => x.id === spaceId) || space();
  const t = { id: uid(), url, title: title || hostOf(url), space: s.id, home: null, last: Date.now() };
  state.tabs[t.id] = t;
  const at = s.today.indexOf(s.active);
  s.today.splice(at < 0 ? 0 : at + 1, 0, t.id);
  if (focus) activate(t.id); else { render(); save(); }
  return t;
}

function navigate(id, input) {
  const t = tab(id), url = toUrl(input);
  if (!t || !url) return;
  t.url = url; t.title = hostOf(url);
  if (live.has(id)) send({ t: 'nav', id, url }); else ensureLive(t);
  activate(id);
}

function lists(t) {
  const s = state.spaces.find(x => x.id === t.space);
  return s ? [s.pinned, s.today] : [];
}

function closeTab(id) {
  const t = tab(id);
  if (!t) return;
  const s = state.spaces.find(x => x.id === t.space);
  const wasActive = s?.active === id;
  if (live.has(id)) { send({ t: 'close', id }); live.delete(id); frames[id]?.remove(); }
  media.delete(id);
  if (s?.split?.includes(id)) s.split = null;
  if (t.home || t.ess) { // pinned and Essential tabs unload; they stay in the sidebar
    t.url = t.home || t.url; t.title = t.title || hostOf(t.url);
  } else {
    if (s) s.today = s.today.filter(x => x !== id);
    closed.push({ ...t });
    state.archive = [{ url: t.url, title: t.title, t: Date.now() }, ...state.archive].slice(0, 300);
    delete state.tabs[id];
  }
  if (wasActive && s) {
    const order = [...s.pinned, ...s.today].filter(x => live.has(x));
    s.active = s.today.find(x => live.has(x)) ?? order[0] ?? null;
    if (s.id === state.activeSpace) { if (s.active) activate(s.active); else showPage(null); }
  }
  render(); save();
}

function reopenClosed() {
  const t = closed.pop();
  if (t) openTab(t.url, { spaceId: state.spaces.some(s => s.id === t.space) ? t.space : state.activeSpace });
}

function pinTab(id, pin = true, index) {
  const t = tab(id);
  if (!t || t.ess) return;
  if (t.space !== state.activeSpace && pin) moveTabToSpace(id, state.activeSpace);
  t.folder = null;
  const s = state.spaces.find(x => x.id === t.space);
  s.pinned = s.pinned.filter(x => x !== id);
  s.today = s.today.filter(x => x !== id);
  if (pin) { t.home = t.home || t.url; s.pinned.splice(index ?? s.pinned.length, 0, id); }
  else { t.home = null; s.today.splice(index ?? 0, 0, id); }
  render(); save();
}

function moveTabToSpace(id, spaceId) {
  const t = tab(id);
  const from = state.spaces.find(x => x.id === t.space), to = state.spaces.find(x => x.id === spaceId);
  if (!t || !to || from === to) return;
  const wasPinned = from.pinned.includes(id);
  from.pinned = from.pinned.filter(x => x !== id);
  from.today = from.today.filter(x => x !== id);
  if (from.active === id) from.active = null;
  t.space = to.id; t.folder = null;
  (wasPinned ? to.pinned : to.today).unshift(id);
  if (from.id === state.activeSpace && !from.active) showPage(null);
  render(); save();
}

function addEssential(url, title) {
  if (state.essentials.length >= 12) return toast('Essentials holds up to 12 sites');
  const e = { id: uid(), url, title: title || hostOf(url) };
  state.essentials.push(e);
  render(); save();
  return e;
}
function openEssential(e) {
  // An Essential is global: one tab for it, whichever space you are in.
  let t = Object.values(state.tabs).find(x => x.ess === e.id);
  if (!t) { t = { id: uid(), url: e.url, home: e.url, title: e.title, ess: e.id, space: null, last: Date.now() }; state.tabs[t.id] = t; }
  space().active = t.id;
  ensureLive(t);
  if (view !== 'page') setView('page');
  showPage(t.id);
  render(); save();
}
function removeEssential(id) {
  const t = Object.values(state.tabs).find(x => x.ess === id);
  if (t) { if (live.has(t.id)) { send({ t: 'close', id: t.id }); live.delete(t.id); } delete state.tabs[t.id]; }
  state.essentials = state.essentials.filter(e => e.id !== id);
  for (const s of state.spaces) if (t && s.active === t.id) s.active = null;
  if (t && shownTab === t.id) showPage(null);
  render(); save();
}

function clearToday() {
  const s = space();
  for (const id of [...s.today]) closeTab(id);
}

/* Empty states are zones, not sentences: the row keeps its shape and the drop target is visible
   before you start dragging. A dashed outline says "this holds something" without a caption. */
function essZone() {
  return h('button', { class: 'zone ess-zone', title: 'Add the current tab to Essentials',
    onclick: () => {
      const t = activeTab();
      if (t) { addEssential(t.url, t.custom || t.title); toast('Added to Essentials'); }
      else openCmd('new');
    } },
    h('span', { class: 'zone-plus', innerHTML: '<svg viewBox="0 0 16 16"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>' }),
    h('span', { class: 'zone-t' }, 'Add a site'),
    h('span', { class: 'zone-sub' }, 'or drag a tab here'));
}

function pinZone() {
  return h('li', { class: 'zone pin-zone', role: 'button', tabindex: 0, title: 'Drag a tab here to pin it',
    onclick: () => openCmd('new'),
    onkeydown: e => { if (e.key === 'Enter') openCmd('new'); } },
    h('span', { class: 'zone-ico', innerHTML: '<svg viewBox="0 0 24 24" stroke-width="1.6"><path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/></svg>' }),
    h('span', { class: 'zone-t' }, 'Pin a tab'),
    h('span', { class: 'zone-sub' }, 'Drag one here, or press Ctrl+Shift+D'));
}

function autoArchive() {
  const limit = state.settings.archiveHours;
  if (!limit) return;
  const cutoff = Date.now() - limit * 3600e3;
  for (const s of state.spaces) for (const id of [...s.today]) {
    const t = tab(id);
    if (t && t.last < cutoff && id !== s.active) closeTab(id);
  }
}

function cycleTab(dir) {
  const s = space();
  const order = [...s.pinned, ...s.today];
  if (!order.length) return;
  const i = order.indexOf(s.active);
  activate(order[(i + dir + order.length) % order.length]);
}

/* ---------------- spaces ---------------- */

function switchSpace(id, { keepTab = false } = {}) {
  if (!state.spaces.some(s => s.id === id)) return;
  state.activeSpace = id;
  applyTheme();
  if (!keepTab) {
    const s = space();
    const t = tab(s.active);
    if (t && (t.space === s.id || t.ess)) { ensureLive(t); showPage(t.id); } else { s.active = null; showPage(null); }
    if (view !== 'page') setView(view);
  }
  render(); save();
}
function stepSpace(dir) {
  const i = state.spaces.findIndex(s => s.id === state.activeSpace);
  switchSpace(state.spaces[(i + dir + state.spaces.length) % state.spaces.length].id);
}
function createSpace(name = 'New Space', icon, colors, profile) {
  const p = colors || PALETTES[state.spaces.length % PALETTES.length];
  const s = { id: uid(), name, icon: icon || ICONS[state.spaces.length % ICONS.length], a: p[0], b: p[1], c: p[2] || p[1], pinned: [], today: [], folders: [], active: null, profile: profile || space().profile || 'default' };
  state.spaces.push(s);
  switchSpace(s.id);
  return s;
}
const profileOf = s => state.profiles.find(p => p.id === s?.profile) || state.profiles[0];

/* ---------------- create a space ---------------- */

/* Creating a space is a small room, not a form in a dialog. A colour chip cannot show you a
   gradient, so the thing you are actually choosing — what the sidebar will look like — is drawn
   live beside the fields, at the size you will see it. */
let nsState = null, nsPeekGrew = false;

function openNewSpace(opts = {}) {
  closeAll();
  // Pick a theme no other space is using: a new space that looks exactly like an old one is
  // the one thing the colours are for.
  const used = new Set(state.spaces.map(x => x.a + x.b));
  const free = THEMES.find(t => !used.has(t.a + t.b)) || THEMES[state.spaces.length % THEMES.length];
  nsState = {
    name: opts.name || '',
    icon: opts.icon || ICONS[state.spaces.length % ICONS.length],
    a: free.a, b: free.b, c: free.c,
    profile: space().profile || 'default',
    tabs: opts.tabs || [],
    folder: opts.folder || null,
    fromSpace: opts.folder ? space().id : null,
  };
  // The form *is* the sidebar while it is open, so the page stays live behind it. In compact
  // mode the sidebar is away: call it back before putting the form in it.
  const app = $('#app');
  if (state.settings.layout === 'compact' && !app.classList.contains('collapsed')) toggleSidebar();
  if (state.settings.layout === 'compact') {
    openPeekSidebar();
    // A form at half the sidebar is a scroll: the peek grows to the full sidebar while the
    // panel is open, and folds back to the saved fraction when it closes.
    if ((state.settings.compactPeek ?? .5) < 1) {
      nsPeekGrew = true;
      root.style.setProperty('--peek-w', 'var(--side-w)');
      sidebarOverlay(true, state.settings.sideWidth, true);
    }
  }
  $('#newSpace').replaceChildren(buildNewSpace());
  $('#newSpace').hidden = false;
  $('#sidebar').classList.add('making');
  // Escape closes from anywhere in the panel, not only from the name field.
  $('#newSpace').addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeNewSpace(); } });
  nsSync();
  const input = $('#nsName');
  input.focus();
  input.select();
}
const newSpace = openNewSpace;

function closeNewSpace() {
  if ($('#newSpace').hidden) return;
  $('#newSpace').hidden = true;
  $('#newSpace').replaceChildren();
  nsState = null;
  $('#sidebar').classList.remove('making');
  if (nsPeekGrew) {
    nsPeekGrew = false;
    applyTheme();   // the peek folds back to its fraction
    if ($('#app').classList.contains('peek')) sidebarOverlay(true, peekW(), true);
  }
  veilOff();
  closePeekIfIdle();
}

/* Creating a space is a column of the sidebar, not a window over the page: the fields sit
   where the space list will be, so you can see the page you are separating from while you
   type. The theme swatches stay out of the way behind "Choose a theme". */
function buildNewSpace() {
  const st = nsState;
  const name = h('input', { id: 'nsName', type: 'text', placeholder: 'Space name…', autocomplete: 'off', spellcheck: 'false',
    oninput: e => { st.name = e.target.value; nsSync(); },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); nsCreate(); } if (e.key === 'Escape') { e.preventDefault(); closeNewSpace(); } } });

  const iconPop = h('div', { class: 'ns-icon-pop', id: 'nsIconPop' }, ICONS.map(i =>
    h('button', { type: 'button', class: 'ns-ico' + (i === st.icon ? ' on' : ''), onclick: e => {
      st.icon = i;
      e.currentTarget.parentElement.querySelectorAll('.ns-ico').forEach(b => b.classList.toggle('on', b === e.currentTarget));
      $('#nsIconBtn .ns-emoji').textContent = i;
      $('#nsIconPop').classList.remove('open');
      nsSync();
    } }, i)));

  // The profile picker is a list inside the panel (a native dropdown would be a plain white box
  // on top of the frosted one): the current profile, and a list of the others that opens beneath it.
  const list = h('div', { class: 'nsp-list', id: 'nsProfileList', role: 'listbox', hidden: true });
  const fillList = () => {
    list.replaceChildren(...state.profiles.map(p => h('button', { type: 'button', role: 'option', class: p.id === st.profile ? 'on' : '',
      onclick: () => { st.profile = p.id; list.hidden = true; nsSync(); } }, p.name)),
      h('button', { type: 'button', onclick: () => {
        const inp = h('input', { type: 'text', placeholder: 'Profile name', 'aria-label': 'New profile name',
          onkeydown: e => {
            e.stopPropagation();
            if (e.key === 'Escape') { e.preventDefault(); fillList(); }
            if (e.key === 'Enter') {
              e.preventDefault();
              const n = inp.value.trim();
              if (n) { const p = { id: 'p' + uid(), name: n }; state.profiles.push(p); st.profile = p.id; save(); list.hidden = true; nsSync(); }
            }
          } });
        list.replaceChildren(inp); inp.focus();
      } }, '+ New profile…'));
  };
  const profile = h('div', { class: 'nsp-pick' },
    h('button', { type: 'button', class: 'nsp-row', id: 'nsProfileBtn', 'aria-haspopup': 'listbox', 'aria-expanded': 'false',
      onclick: e => { const open = list.hidden; if (open) fillList(); list.hidden = !open; e.currentTarget.setAttribute('aria-expanded', String(open)); } },
      h('i', { class: 'pdot', id: 'nsProfileDot' }), h('span', { class: 'nsp-row-t', id: 'nsProfileName' }, ''),
      h('span', { class: 'nsp-row-v', innerHTML: '<svg viewBox="0 0 16 16"><path d="m4 6 4 4 4-4"/></svg>' })),
    list);

  const themes = h('div', { class: 'ns-themes', id: 'nsThemes' }, THEMES.map(t =>
    h('button', { type: 'button', class: 'ns-sw', title: t.name, 'aria-label': t.name,
      style: `background:linear-gradient(150deg,${t.a},${t.b},${t.c})`,
      onclick: e => {
        st.a = t.a; st.b = t.b; st.c = t.c;
        e.currentTarget.parentElement.querySelectorAll('.ns-sw').forEach(b => b.classList.toggle('on', b === e.currentTarget));
        $('#nsA').value = t.a; $('#nsB').value = t.b; $('#nsC').value = t.c;
        nsSync();
      } })));

  const colorIn = (id, key) => h('input', { type: 'color', id, value: st[key], 'aria-label': `${key.toUpperCase()} colour`,
    oninput: e => { st[key] = e.target.value; $('#nsThemes').querySelectorAll('.ns-sw').forEach(b => b.classList.remove('on')); nsSync(); } });

  return h('div', { class: 'nsp', role: 'document' },
    h('form', { class: 'nsp-form', onsubmit: e => { e.preventDefault(); nsCreate(); } },
      h('div', { class: 'nsp-hero' },
        h('button', { type: 'button', class: 'nsp-icon', id: 'nsIconBtn', 'aria-haspopup': 'true', title: 'Space icon',
          onclick: e => {
            e.stopPropagation();
            const open = !iconPop.classList.contains('open');
            iconPop.classList.toggle('open', open);
            if (open) setTimeout(() => addEventListener('pointerdown', function away(ev) {
              if (ev.target.closest('#nsIconPop')) return addEventListener('pointerdown', away, { once: true });
              iconPop.classList.remove('open');
            }, { once: true }));
          } },
          h('span', { class: 'ns-emoji' }, st.icon)),
        iconPop,
        h('h2', {}, 'Create a Space'),
        h('p', { class: 'nsp-sub' }, 'Separate your tabs for life, work, projects, and more.')),
      h('div', { class: 'nsp-body' },
        h('label', { class: 'nsp-field' },
          h('span', { class: 'nsp-field-ico', innerHTML: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2.4"/><path d="M6 3v10"/></svg>' }), name),
        profile,
        h('button', { type: 'button', class: 'nsp-row', id: 'nsThemeBtn', 'aria-expanded': 'false',
          onclick: e => {
            const wrap = $('#nsThemesWrap'), open = wrap.hidden;
            wrap.hidden = !open;
            e.currentTarget.setAttribute('aria-expanded', String(open));
          } },
          h('span', { class: 'nsp-field-ico', innerHTML: '<svg viewBox="0 0 16 16"><path d="M3 13.5h10"/><path d="M9.5 3.2a2 2 0 0 1 3.3 2.3L8 10.3 5.7 11l.7-2.3z"/></svg>' }),
          h('span', { class: 'nsp-row-t' }, 'Choose a theme'),
          h('span', { class: 'nsp-row-v', id: 'nsThemeName' }, '')),
        h('div', { class: 'nsp-themes', id: 'nsThemesWrap', hidden: true },
          themes,
          h('div', { class: 'ns-custom' }, h('span', {}, 'Or pick your own'), colorIn('nsA', 'a'), colorIn('nsB', 'b'), colorIn('nsC', 'c'))),
        h('div', { class: 'nsp-rows', id: 'nsRows' })),
      h('div', { class: 'nsp-foot' },
        h('button', { type: 'submit', class: 'btn primary', id: 'nsCreate', disabled: true }, 'Create Space'),
        h('button', { type: 'button', class: 'btn ghost', id: 'nsCancel', onclick: closeNewSpace }, 'Cancel'))));
}

/* The panel *is* the sidebar, so what you are choosing is what you get: the gradient is on the
   form itself, the icon and the theme name follow the state, and the Create button waits for a
   name. A folder's tabs ride along, listed as real rows so you can see what moves. */
function nsSync() {
  const st = nsState;
  if (!st) return;
  const panel = $('#newSpace .nsp');
  if (!panel) return;
  panel.style.setProperty('--a', st.a);
  panel.style.setProperty('--b', st.b);
  panel.style.setProperty('--c', st.c);
  panel.dataset.ink = (lum(st.a) + lum(st.b) + lum(st.c || st.b)) / 3 < .22 ? 'light' : 'dark';
  // The flat theme is lit from above, not from a corner: say so with the same class.
  const flat = !!THEMES.find(t => t.a === st.a && t.b === st.b)?.flat;
  panel.classList.toggle('flat', flat);
  $('#nsThemeName').textContent = themeName({ a: st.a, b: st.b, c: st.c });
  $('#nsCreate').disabled = !st.name.trim();
  const p = profileOf({ profile: st.profile });
  $('#nsProfileDot').style.background = `linear-gradient(150deg,${st.a},${st.b},${st.c})`;
  $('#nsProfileName').textContent = p?.name || 'Profile';
  // A folder's tabs come along: show them, so the panel says what is being carried over.
  const rows = $('#nsRows');
  if (st.tabs.length) {
    rows.hidden = false;
    rows.replaceChildren(...st.tabs.slice(0, 5).map(id => {
      const t = tab(id);
      return h('i', { class: 'real' }, favicon(t?.home || t?.url || ''), h('span', {}, t?.custom || t?.title || 'Tab'));
    }));
    rows.classList.add('filled');
  } else {
    rows.hidden = true;
    rows.replaceChildren();
    rows.classList.remove('filled');
  }
}

function nsCreate() {
  const st = nsState;
  if (!st || !st.name.trim()) return;
  const s = createSpace(st.name.trim(), st.icon, [st.a, st.b, st.c], st.profile);
  if (st.tabs.length) adoptTabs(st.tabs, s.id, st.folder, st.fromSpace);
  closeNewSpace();
  applyTheme(); render(); save();
  toast(`${s.icon}  ${s.name} created`);
}

/* Tabs (and the folder that held them) move into the new space instead of being copied. */
function adoptTabs(ids, toId, folder, fromSpaceId) {
  const from = state.spaces.find(s => s.id === fromSpaceId);
  const to = state.spaces.find(s => s.id === toId);
  if (!to) return;
  for (const id of ids) {
    const t = tab(id);
    if (!t) continue;
    const src = state.spaces.find(x => x.id === t.space);
    if (src) {
      src.pinned = src.pinned.filter(x => x !== id);
      src.today = src.today.filter(x => x !== id);
      if (src.active === id) src.active = null;
    }
    t.space = to.id;
    t.folder = null;
    t.home = t.home || t.url;
    if (!to.pinned.includes(id)) to.pinned.push(id);
  }
  if (folder && from) from.folders = from.folders.filter(f => f !== folder);
  render(); save();
}

function deleteSpace(id) {
  if (state.spaces.length < 2) return toast('Rainbow needs at least one space');
  const s = state.spaces.find(x => x.id === id);
  for (const t of [...s.pinned, ...s.today]) { if (live.has(t)) { send({ t: 'close', id: t }); live.delete(t); } delete state.tabs[t]; }
  state.spaces = state.spaces.filter(x => x.id !== id);
  if (state.activeSpace === id) switchSpace(state.spaces[0].id);
  render(); save();
}

/* ---------------- appearance ---------------- */

function lum(hex) {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
/* Sidebar and Top Toolbar moves the navigation and address pill into a bar across the window. */
let toolbarOn = false, compactOn = false, capOn = false, sideOn = '';
function placeChrome() {
  const st = state.settings;
  const on = st.layout === 'toolbar', comp = st.layout === 'compact';
  // Windows puts the caption buttons at the window's top right, over the page column, the way
  // every Windows browser does; the sidebar keeps the whole left edge to itself.
  const cap = root.dataset.os === 'windows' && (st.layout === 'sidebar' || st.layout === 'rail');
  if (on === toolbarOn && comp === compactOn && cap === capOn && st.side === sideOn) return;
  toolbarOn = on; compactOn = comp; capOn = cap; sideOn = st.side;
  const win = root.dataset.os === 'windows', right = $('#tbRight');
  // The Rainbow menu button rides in the compact bar's slot; every other layout keeps it first in the nav.
  if (!comp) $('.nav').prepend($('#appMenuBtn'));
  if (comp) {
    $('#cbNav').append($('.nav'));
    $('#cbMid').append($('#urlPill'));
    $('#cbApp').append($('#appMenuBtn'));
    // Pinned extensions, then the window buttons, at the right end (the left on macOS).
    $('.cb-right').prepend($('#splitBtn'));
    if (win) { $('#cbNewTab').after($('#extBar')); $('.cb-right').append($('#winControls')); }
    else { $('#cbWin').append($('#winControls')); right.prepend($('#extBar')); }
  } else if (on || cap) {
    // The top bar: menu and navigation at the left, the address in the middle, then the pinned
    // extensions and the window buttons. (On Windows this is every layout but compact.)
    $('#topbar').append($('.nav'), $('#urlPill'), right);
    right.append($('#extBar'), $('#winControls'));
    // The sidebar button sits on the sidebar's side of the bar and the split button opposite: with
    // tabs on the right they trade places.
    if (st.side === 'right') { right.insertBefore($('#toggleSidebar'), $('#winControls')); $('#appMenuBtn').after($('#splitBtn')); }
    else { $('#back').before($('#toggleSidebar')); right.prepend($('#splitBtn')); }
  } else {
    $('.side-top').append($('#winControls'), $('.nav'));
    right.prepend($('#extBar'));
    $('#library').after($('#urlPill'));
  }
  cbarAuto();
}

/* Compact mode: the bar is a strip the shell has to clip out for — a page is a child window
   above the chrome and would otherwise cover it. The strip is only as wide as the bar itself:
   the peeked sidebar's width when the bar rides it, the whole window when the bar stands
   alone, and nothing at all while the bar is away. */
let cbarSent = '';
function cbarBox() {
  if (state.settings.layout !== 'compact') return { h: 0, w: 0 };
  const app = $('#app');
  const auto = $('#cbar').classList.contains('auto');        // hover-only
  const peek = app.classList.contains('peek');               // the sidebar is out
  const near = app.classList.contains('cbar-near');          // the pointer is at the top
  if (auto && (peek || !near)) return { h: 0, w: 0 };       // never together with the peeked sidebar
  return { h: 34, w: 0 };                                    // 0 = the whole window
}
function cbarMsg() {
  const b = cbarBox();
  const key = b.h + ':' + b.w;
  if (key === cbarSent) return;
  cbarSent = key;
  send({ t: 'chrome', bar: b.h, barw: b.w });
}
let cbarGone = 0;
function cbarAuto() {
  const st = state.settings;
  // What compact mode hides: the bar ('toolbar'), the sidebar ('sidebar'), or both. 'off' keeps
  // both, and then the bar simply stands at the top of the window.
  const hide = st.layout === 'compact' && st.compact && st.compact !== 'off' && st.compact !== 'sidebar';
  $('#cbar').classList.toggle('auto', hide);
  root.dataset.cbarAuto = hide ? 'on' : 'off';
  $('#app').classList.remove('cbar-near');
  clearTimeout(cbarGone);
  cbarMsg();
}
// Near the top edge the bar is there; away from it, it goes, with the same leeway the sidebar
// gets, so crossing the top of the window on the way somewhere is not a flicker. Registered
// once: it reads the layout rather than being re-bound per theme pass.
addEventListener('pointermove', e => {
  if (state.settings.layout !== 'compact' || !$('#cbar').classList.contains('auto')) return;
  const app = $('#app');
  if (e.clientY <= 4) {
    if (app.classList.contains('peek')) return;   // the sidebar got here first
    if (!app.classList.contains('cbar-near')) { app.classList.add('cbar-near'); cbarMsg(); }
    clearTimeout(cbarGone);
  } else if (e.clientY > 40 && app.classList.contains('cbar-near')) {
    clearTimeout(cbarGone);
    cbarGone = setTimeout(() => { app.classList.remove('cbar-near'); cbarMsg(); }, PEEK_LEAVE);
  }
});

/* The compact block, shared by the bar's own menu and the frame menu: what compact mode
   hides, and the submenu that goes with it. */
function compactItems() {
  const st = state.settings;
  const mode = () => (st.compact === 'sidebar' || st.compact === 'toolbar' || st.compact === 'both') ? st.compact : 'off';
  const pick = v => { st.compact = v; setLayout('compact'); syncCompactSidebar(); applyTheme(); render(); save(); cbarAuto(); };
  return [
    [st.layout === 'compact' ? 'Disable compact mode' : 'Enable compact mode',
      () => {
        const off = st.layout === 'compact';
        setLayout(off ? 'sidebar' : 'compact');
        if (!off && mode() === 'off') { st.compact = 'both'; save(); }
        cbarAuto();
      },
      st.layout === 'compact' ? 'check' : ''],
    '-',
    ['Hide sidebar', () => pick('sidebar'), mode() === 'sidebar' ? 'check' : ''],
    ['Hide toolbar', () => pick('toolbar'), mode() === 'toolbar' ? 'check' : ''],
    ['Hide both', () => pick('both'), mode() === 'both' ? 'check' : ''],
  ];
}
function compactMenu(x, y) { frameMenu(x, y); }
/* With the top bar across the window, the navigation sits beside the sidebar's edge and the address in
   the middle: the sidebar may not grow past the room between them. */
const spansBar = () => (root.dataset.os === 'windows' && (state.settings.layout === 'sidebar' || state.settings.layout === 'rail')) || state.settings.layout === 'toolbar';
const sideCap = () => 420;
function fitSide() {
  const st = state.settings;
  root.style.setProperty('--side-w', (st.layout === 'rail' ? 58 : Math.min(st.sideWidth, sideCap())) + 'px');
  // The Essentials row follows the width it is given.
  setEssCols(state.essentials.length || 1);
  if (typeof sideFit === 'function') requestAnimationFrame(sideFit);
}
/* The address bar's room is measured, not inherited: the sidebar's own width, read whenever it changes, keeps the top bar's
   columns exact while the sidebar is dragged (an inherited custom property left them one step behind). */
function sideFit() {
  const app = $('#app');
  const fit = app.classList.contains('collapsed') ? 0 : Math.round($('#sidebar').getBoundingClientRect().width);
  root.style.setProperty('--side-fit', fit + 'px');
  // On Windows the bar's three columns are set here too: the address takes what the sidebar leaves.
  const tb = $('#topbar'), st = state.settings;
  const cols = root.dataset.os === 'windows' && (st.layout === 'sidebar' || st.layout === 'rail')
    ? (st.side === 'right' ? `minmax(130px, 1fr) minmax(150px, 620px) ${fit + 110}px` : `${fit + 110}px minmax(150px, 620px) minmax(130px, 1fr)`) : '';
  if (tb.style.gridTemplateColumns !== cols) tb.style.gridTemplateColumns = cols;
  alignNav();
}
new ResizeObserver(sideFit).observe($('#sidebar'));
new MutationObserver(sideFit).observe($('#app'), { attributes: true, attributeFilter: ['class'] });
new MutationObserver(sideFit).observe(root, { attributes: true, attributeFilter: ['data-layout', 'data-side', 'data-os'] });
let fitQueued = 0;
addEventListener('resize', () => { if (!fitQueued) fitQueued = requestAnimationFrame(() => { fitQueued = 0; fitSide(); }); });

/* Back, forward and reload line up with the left edge of the page, whatever the sidebar's width. */
function alignNav() {
  const back = $('#back');
  if (!back) return;
  if (!(root.dataset.os === 'windows' && (state.settings.layout === 'sidebar' || state.settings.layout === 'rail' || state.settings.layout === 'toolbar')) || !back.closest('#topbar')) {
    back.style.marginLeft = '';
    return;
  }
  back.style.marginLeft = '0px';
  const natural = back.getBoundingClientRect().left, target = $('#pageCard').getBoundingClientRect().left;
  back.style.marginLeft = Math.max(0, Math.round(target - natural)) + 'px';
}
function applyTheme() {
  const s = space(), st = state.settings;
  root.style.setProperty('--a', s.a);
  root.style.setProperty('--b', s.b);
  root.style.setProperty('--c', s.c || s.b);   // older spaces have two stops; the third falls back
  // A flat theme is a light theme by definition — paper is the whole point — so it does not follow
  // the system into dark mode, and its ink stays dark. Everything else keeps following the mode.
  const flat = !!themeOf(s)?.flat;
  root.dataset.theme = flat ? 'flat' : 'grad';
  const dark = !flat && (st.mode === 'dark' || (st.mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches));
  // The shell is the space's own gradient on every platform now, so contrast comes from the
  // colours behind the text, not from the system mode: light space -> dark ink, dark space ->
  // light ink. A flat paper theme is always dark ink.
  root.dataset.ink = flat ? 'dark' : (lum(s.a) + lum(s.b) + lum(s.c || s.b)) / 3 < .22 ? 'light' : 'dark';
  root.dataset.mode = dark ? 'dark' : 'light';
  root.dataset.side = st.side;
  root.dataset.density = st.density;
  root.dataset.layout = st.layout;
  root.dataset.grain = st.grain ? 'on' : 'off';
  // The page follows the window frame. 8 px is the Windows 11 frame; the setting may only make
  // the corners less round, never rounder than the frame they sit inside.
  root.style.setProperty('--radius', Math.max(0, Math.min(8, st.radius || 0)) + 'px');
  root.style.setProperty('--inset', st.inset + 'px');
  root.style.setProperty('--blur', st.blur + 'px');
  fitSide();
  // Compact mode's peek is half the sidebar by default and grows to all of it by drag, so the
  // width is a ratio of the sidebar rather than the sidebar itself.
  root.style.setProperty('--peek-w', st.layout === 'compact'
    ? `calc(var(--side-w) * ${(st.compactPeek ?? .5).toFixed(3)})`
    : st.sideWidth + 'px');
  placeChrome();
  // The compact setting can change without the layout changing (Hide sidebar → Hide both),
  // so this runs on every theme pass rather than only when the chrome mode flips.
  cbarAuto();
  cbarMsg();
  requestAnimationFrame(syncPage);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

/* ---------------- boosts ---------------- */

function boostCss(b) {
  let css = '';
  if (b.hue) css += `html{filter:hue-rotate(${b.hue}deg)}img,video,picture,svg image{filter:hue-rotate(-${b.hue}deg)}`;
  const fonts = { serif: 'Georgia,serif', sans: 'system-ui,sans-serif', mono: 'ui-monospace,Consolas,monospace' };
  if (fonts[b.font]) css += `*:not(code):not(pre):not([class*=icon]){font-family:${fonts[b.font]}!important}`;
  const zap = (b.zap || '').split('\n').map(x => x.trim()).filter(Boolean);
  if (zap.length) css += `${zap.join(',')}{display:none!important}`;
  return css + (b.css || '');
}
function applyBoost(t) {
  const b = state.boosts[hostOf(t.url)];
  if (!b || !live.has(t.id)) return;
  const css = b.on ? boostCss(b) : '';
  send({ t: 'exec', id: t.id, js: `(()=>{let s=document.getElementById('rainbow-boost');if(!s){s=document.createElement('style');s.id='rainbow-boost';document.documentElement.appendChild(s)}s.textContent=${JSON.stringify(css)}})()` });
  if (b.on && b.js) send({ t: 'exec', id: t.id, js: b.js });
}
function setBoost(domain, patch) {
  state.boosts[domain] = { on: true, hue: 0, font: '', zap: '', css: '', js: '', ...state.boosts[domain], ...patch };
  for (const t of Object.values(state.tabs)) if (hostOf(t.url) === domain) applyBoost(t);
  save();
}

/* ---------------- rendering ---------------- */

const path = u => { try { const p = new URL(u).pathname; return hostOf(u) + (p.length > 1 ? p : ''); } catch { return u; } };
const ico = {
  x: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>',
};

/* A split is one row in the sidebar: both pages' names, a thin line between them that turns into an x on hover. */
function splitRow(ta, tb, section) {
  const s = space();
  const half = t => h('span', { class: 'half' + (s.active === t.id ? ' on' : ''), title: t.url, role: 'button', tabindex: 0,
    onclick: () => activate(t.id), oncontextmenu: e => { e.preventDefault(); e.stopPropagation(); tabMenu(t, e.clientX, e.clientY); } },
    favicon(t.url), h('span', { class: 'title' }, t.custom || siteName(t.url)));
  return h('li', { class: 'tab split-row', dataset: { id: ta.id } }, half(ta),
    h('span', { class: 'vsep-wrap' }, h('i', { class: 'vsep' }),
      h('button', { class: 'x', title: 'Close split view', 'aria-label': 'Close split view', innerHTML: ico.x, onclick: unsplit })),
    half(tb));
}
/* The rows for a list of tab ids: a split whose two pages are both in the list becomes one row. */
function tabRows(ids, section) {
  const s = space(), out = [], done = new Set();
  for (const id of ids) {
    const t = tab(id);
    if (!t || done.has(id)) continue;
    const mate = s.split?.includes(id) ? s.split.find(o => o !== id) : null;
    if (mate && ids.includes(mate) && tab(mate)) {
      done.add(mate);
      out.push(splitRow(...(s.split[0] === id ? [t, tab(mate)] : [tab(mate), t]), section));
    } else out.push(tabRow(t, section));
  }
  return out;
}

function tabRow(t, section) {
  const s = space();
  const drift = t.home && path(t.url) !== path(t.home);
  const li = h('li', {
    class: `tab${s.active === t.id ? ' active' : ''}${live.has(t.id) ? '' : ' unloaded'}${loading.has(t.id) ? ' loading' : ''}${s.split?.includes(t.id) ? ' in-split' : ''}`,
    draggable: true, dataset: { id: t.id }, title: t.url, role: 'button', tabindex: 0,
    onclick: e => { if (!e.target.closest('.x,.drift')) activate(t.id); },
    onauxclick: e => { if (e.button === 1) closeTab(t.id); },
    ondblclick: () => rename(li, t),
    onkeydown: e => { if (e.key === 'Enter') activate(t.id); if (e.key === 'Delete') closeTab(t.id); },
    oncontextmenu: e => { e.preventDefault(); tabMenu(t, e.clientX, e.clientY); },
    ondragstart: e => { dragId = t.id; e.dataTransfer.setData('rainbow/tab', t.id); e.dataTransfer.setData('text/uri-list', t.url); li.classList.add('dragging'); },
    ondragend: () => { dragId = 0; hideEssGhost(); li.classList.remove('dragging'); },
  },
  favicon(t.url),
  h('span', { class: 'title' }, t.custom || t.title || hostOf(t.url)),
  drift && section === 'pinned' ? h('button', { class: 'drift', title: `Back to ${t.home}`, onclick: () => navigate(t.id, t.home) }, '↩') : null,
  h('button', { class: 'x', title: section === 'pinned' ? 'Unload' : 'Close (Ctrl+W)', 'aria-label': 'Close tab', innerHTML: section === 'pinned' && !live.has(t.id) ? '' : ico.x, onclick: () => closeTab(t.id) }));
  return li;
}

/* Pinned folders. ponytail: s.pinned stays a flat list of tab ids and each tab
   remembers its folder, so folders always sit above loose pins in their level. */
const ico_folder = '<svg viewBox="0 0 16 16"><path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h2.6l1.5 1.5h4.9A1.5 1.5 0 0 1 14 6v5.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z"/></svg>';
function newFolder(parent = null) {
  const s = space(), f = { id: uid(), name: 'New Folder', parent, open: true };
  s.folders.push(f);
  render(); save();
  const li = document.querySelector(`.folder[data-folder="${f.id}"] > .folder-row`);
  if (li) rename(li, f, 'name');
  return f;
}
function deleteFolder(s, f) {
  for (const t of s.pinned.map(tab)) if (t?.folder === f.id) t.folder = f.parent;
  for (const x of s.folders) if (x.parent === f.id) x.parent = f.parent;
  s.folders = s.folders.filter(x => x !== f);
  render(); save();
}
function insideFolder(s, f, target) { // would putting f into target make a loop?
  for (let x = target; x; x = s.folders.find(y => y.id === x)?.parent) if (x === f.id) return true;
  return false;
}
function dropInFolder(e, f) {
  e.preventDefault(); e.stopPropagation();
  e.currentTarget.classList.remove('drop-target');
  const s = space(), fid = +e.dataTransfer.getData('rainbow/folder'), id = +e.dataTransfer.getData('rainbow/tab');
  if (fid) { const g = s.folders.find(x => x.id === fid); if (g && !insideFolder(s, g, f.id)) g.parent = f.id; }
  else if (id && tab(id) && !tab(id).ess) { if (!s.pinned.includes(id)) pinTab(id, true); tab(id).folder = f.id; }
  f.open = true;
  render(); save();
}
function folderRow(s, f, kids) {
  const li = h('li', { class: `folder${f.open ? ' open' : ''}`, dataset: { folder: f.id } },
    h('div', {
      class: 'tab folder-row', role: 'button', tabindex: 0, draggable: true, 'aria-expanded': String(f.open),
      onclick: () => { f.open = !f.open; render(); save(); },
      onkeydown: e => { if (e.key === 'Enter') { f.open = !f.open; render(); save(); } },
      ondblclick: e => { e.stopPropagation(); rename(e.currentTarget, f, 'name'); },
      oncontextmenu: e => { e.preventDefault(); menu(e.clientX, e.clientY, [
        ['Turn into a Space…', () => folderToSpace(f), '', '', ICO_SPACE],
        '-',
        ['New folder inside', () => newFolder(f.id)],
        ['Rename', () => rename(li.firstChild, f, 'name')],
        '-', ['Delete folder (keeps its tabs)', () => deleteFolder(s, f), 'danger']]); },
      ondragstart: e => { e.stopPropagation(); e.dataTransfer.setData('rainbow/folder', f.id); },
      ondragover: e => { if (e.dataTransfer.types.some(x => x === 'rainbow/tab' || x === 'rainbow/folder')) { e.preventDefault(); e.stopPropagation(); e.currentTarget.classList.add('drop-target'); } },
      ondragleave: e => e.currentTarget.classList.remove('drop-target'),
      ondrop: e => dropInFolder(e, f),
    }, h('span', { class: 'fav folder-ico', innerHTML: ico_folder }), h('span', { class: 'title' }, f.name), h('span', { class: 'chev' }, '›')),
    f.open && kids.length ? h('ul', { class: 'tab-list sub',
      ondragover: e => { if (e.dataTransfer.types.includes('rainbow/tab')) { e.preventDefault(); e.stopPropagation(); } },
      ondrop: e => dropInFolder(e, f) }, kids) : null);
  return li;
}
function pinnedTree(s, parent = null) {
  return [
    ...s.folders.filter(f => (f.parent ?? null) === parent).map(f => folderRow(s, f, pinnedTree(s, f.id))),
    ...tabRows(s.pinned.filter(id => (tab(id)?.folder ?? null) === parent), 'pinned'),
  ];
}

/* Every tab in a folder, including nested folders — the order the tree shows them in. */
function folderTabs(s, fid) {
  const out = [];
  for (const t of s.pinned.map(tab)) if (t && t.folder === fid) out.push(t.id);
  for (const f of s.folders.filter(x => x.parent === fid)) out.push(...folderTabs(s, f.id));
  return out;
}

/* A folder of tabs is a space that has not been given a name yet: same thing, different shelf.
   The tabs move rather than copy — a tab in two places is two tabs. */
function folderToSpace(f) {
  const s = space(), ids = folderTabs(s, f.id);
  if (!ids.length) return toast('That folder is empty');
  openNewSpace({ name: f.name === 'New Folder' ? '' : f.name, tabs: ids, folder: f });
}

function rename(li, t, key = 'custom') {
  const input = h('input', { class: 'rename', value: t[key] || t.title, onclick: e => e.stopPropagation() });
  li.querySelector('.title').replaceWith(input);
  input.focus(); input.select();
  const done = ok => { if (ok) t[key] = input.value.trim() || (key === 'name' ? t.name : null); render(); save(); };
  input.onkeydown = e => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); e.stopPropagation(); };
  input.onblur = () => done(true);
}

function render() {
  queueMicrotask(drawExtBar);
  const s = space(), t = activeTab();
  // address pill
  const txt = $('#urlText');
  // A flash ("Link copied") owns the text until it expires; a re-render must not eat it.
  if (!$('#urlPill').classList.contains('copied')) {
    txt.textContent = t ? path(t.url) : 'Search or enter address';
    txt.classList.toggle('placeholder', !t);
  }
  $('#copyLink').disabled = !t;
  $('#copyLink').title = t ? `Copy ${t.url}` : 'Copy link';
  $('#linkOpts').disabled = !t;
  $('#saveBtn').classList.toggle('on', !!(t && state.bookmarks.some(b => b.url === t.url)));
  $('#saveBtn').disabled = !t;   // with no tab there is nothing to save; say so by dimming
  $('#saveBtn').title = !t ? 'Save to Canvas'
    : (state.bookmarks.some(b => b.url === t.url) ? 'Already on your Canvas' : 'Save to Canvas');

  // essentials: a dotted zone when empty, so the row still says what it is for
  setEssCols(state.essentials.length || 1);
  $('#essentials').replaceChildren(...(state.essentials.length ? state.essentials.map(e => {
    const et = Object.values(state.tabs).find(x => x.ess === e.id);
    return h('button', {
      class: `essential${et && s.active === et.id ? ' active' : ''}${et && live.has(et.id) ? ' live' : ''}`,
      title: e.title, dataset: { id: e.id },
      onclick: () => openEssential(e),
      oncontextmenu: ev => { ev.preventDefault(); menu(ev.clientX, ev.clientY, [
        ['Open', () => openEssential(e)], ['Copy link', () => copyText(e.url, 'Link copied')],
        ['Save to Canvas', () => Rainbow.canvas?.saveUrl(e.url, e.title)], '-',
        ['Remove from Essentials', () => removeEssential(e.id), 'danger']]); },
    }, favicon(e.url, 20));
  }) : [essZone()]));

  // space header + lists
  $('#spaceName').replaceChildren(h('span', { class: 'emoji' }, s.icon), h('span', {}, s.name));
  const tree = pinnedTree(s);
  $('#pinnedList').replaceChildren(...(tree.length ? tree : [pinZone()]));
  $('#todayList').replaceChildren(...tabRows(s.today, 'today'));
  $('#clearToday').hidden = !s.today.length;

  $('#spaceDots').replaceChildren(...state.spaces.map(x => h('button', {
    class: `dot${x.id === s.id ? ' active' : ''}`, role: 'tab', 'aria-selected': x.id === s.id ? 'true' : 'false',
    title: x.name, onclick: () => switchSpace(x.id), dataset: { space: x.id },
    oncontextmenu: e => { e.preventDefault(); spaceMenu(x, e.clientX, e.clientY); },
  }, x.id === s.id ? x.icon : h('i'))));
  $('#canvasBtn').classList.toggle('on', view === 'canvas');
  $('#splitBtn').classList.toggle('on', !!s.split);
  sideButtons();
}

/* ---------------- menus, toasts, panels ---------------- */

const ICO_SPACE = '<svg viewBox="0 0 16 16"><rect x="2.3" y="3" width="11.4" height="10" rx="2.2"/><path d="M6.2 3v10"/></svg>';
const ICO_FOLDER_PLUS = '<svg viewBox="0 0 16 16"><path d="M2 4.4A1.4 1.4 0 0 1 3.4 3h2.4l1.4 1.4h4.4A1.4 1.4 0 0 1 13 5.8v1.7"/><path d="M2 4.4v6.2A1.4 1.4 0 0 0 3.4 12h4.9"/><path d="M12 9.7v4M10 11.7h4"/></svg>';
const ICO_TAB_PLUS = '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.6"/><path d="M8 5.4v5.2M5.4 8h5.2"/></svg>';

let menuAnchor = null;

/* In the app a menu is drawn by the surface, above the page, so it needs no snapshot, no floating
   sidebar and no rail growth to be seen. The chrome keeps the actions; the surface only draws and
   reports which row was pressed. */
let surfMenu = null;   // { acts: [fn], anchor }
function downscale(src, f) {
  return new Promise(res => {
    const im = new Image();
    im.onload = () => {
      const c = h('canvas', { width: Math.max(2, Math.round(im.naturalWidth * f)), height: Math.max(2, Math.round(im.naturalHeight * f)) });
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      try { res(c.toDataURL('image/jpeg', .6)); } catch { res(null); }
    };
    im.onerror = () => res(null);
    im.src = src;
  });
}
function surfaceMenu(x, y, items, anchor, opts = {}) {
  const same = surfMenu && anchor && surfMenu.anchor === anchor;   // its own button toggles it
  closeSurfaceMenu();
  if (same) return;
  const acts = [];
  const ser = list => list.filter(Boolean).map(it => {
    if (it === '-') return { t: 'sep' };
    const ex = it[5] || {};
    if (ex.host) return { t: 'host', label: String(it[0]), fav: ex.host.fav, secure: !!ex.host.secure };
    if (!it[1] && (it[2] === 'title' || it[2] === 'head')) return { t: 'head', label: String(it[0]) };
    const o = { t: 'item', label: String(it[0]), kbd: it[3] || '', cls: it[2] === 'sub' ? '' : (it[2] || ''), ico: it[4] || '' };
    if (Array.isArray(it[1])) o.sub = ser(it[1]);
    else { o.id = acts.push(it[1]) - 1; if (ex.sub) o.sub = ser(ex.sub); }
    if (ex.sw !== undefined) o.sw = !!ex.sw;
    if (ex.mini) o.mini = { ico: ex.mini.ico, title: ex.mini.title, id: acts.push(ex.mini.fn) - 1 };
    return o;
  });
  const view = ser(items);
  const rows = l => l.reduce((n, it) => n + (it.t === 'sep' ? 9 : it.t === 'head' ? 26 : it.t === 'host' ? 34 : 30), 10);
  const hasSub = view.some(it => it.sub);
  const w = opts.w || 240, hgt = Math.min(rows(view), innerHeight - 16);
  const subH = hasSub ? Math.max(...view.filter(it => it.sub).map(it => rows(it.sub))) : 0;
  const boxW = w + (hasSub ? 232 : 0), boxH = Math.max(hgt, subH + 40);
  const left = Math.max(4, Math.min(x, innerWidth - boxW - 4)), top = Math.max(4, Math.min(y, innerHeight - boxH - 4));
  surfMenu = { acts, anchor };
  if (anchor) { anchor.classList.add('on'); anchor.setAttribute('aria-expanded', 'true'); }
  clearTimeout(surfaceTimer);
  // A click anywhere else in the chrome closes it (clicks inside a page arrive as a `focus` message).
  setTimeout(() => addEventListener('pointerdown', e => { if (surfMenu && !(anchor && anchor.contains(e.target))) closeSurfaceMenu(); }, { once: true }));
  const post = (bg, refresh) => send({ t: 'surface', on: true, focus: !refresh, x: left, y: top, w: boxW, h: boxH,
    view: { kind: 'menu', w, dark: root.dataset.mode === 'dark', items: view, bg, refresh } });
  post(null, false);
  // Then the frosted glass: a small picture of the page behind the menu, which the surface blurs.
  const p = panes[0], token = surfMenu;
  if (p) snapshot(p.id).then(async data => {
    if (!data || surfMenu !== token) return;
    const small = await downscale(data, .35);
    if (small && surfMenu === token) post({ src: small, px: p.x, py: p.y, pw: p.w, ph: p.h, sx: left, sy: top }, true);
  });
}
function closeSurfaceMenu() {
  if (!surfMenu) return;
  const { anchor } = surfMenu;
  surfMenu = null;
  if (anchor) { anchor.classList.remove('on'); anchor.removeAttribute('aria-expanded'); }
  send({ t: 'surface', on: false });
}

function menu(x, y, items, anchor = null, opts = {}) {
  if (NATIVE) return surfaceMenu(x, y, items, anchor, opts);
  const m = $('#menu');
  m.classList.toggle('with-icons', items.some(it => it && it[4]));
  m.replaceChildren(...items.filter(Boolean).map(menuItem));
  if (anchor) { menuAnchor = anchor; anchor.classList.add('on'); anchor.setAttribute('aria-expanded', 'true'); }
  m.hidden = false;
  $('#menuSub').hidden = true;
  // A menu can only be seen where the chrome is drawn over the page — the sidebar column. When
  // that column is too narrow (the sidebar is collapsed, or folded to the 58 px rail) float the
  // sidebar out first, the same overlay the rail's own menus use, then clamp the menu into the
  // column it now holds. Without this a menu opened from the address bar was drawn under the page.
  if ($('#sidebar').getBoundingClientRect().width < m.offsetWidth + 8) {
    openPeekSidebar();
    growRail(true);
  }
  const side = $('#sidebar').getBoundingClientRect();
  const w = m.offsetWidth, hgt = m.offsetHeight;
  const left = side.width > w + 8 ? Math.min(x, side.right - w - 4) : x;
  m.style.left = Math.max(4, Math.min(left, innerWidth - w - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - hgt - 4)) + 'px';
  setTimeout(() => addEventListener('pointerdown', closeMenuOutside, { once: true }));
}

/* One menu row. An item whose action is an array is a submenu: it opens to the right of its
   own row and never closes the menu it belongs to. */
function menuItem(it) {
  if (it === '-') return h('hr');
  // [label, null, 'title' | 'head'] — a non-clickable heading.
  if (!it[1] && (it[2] === 'title' || it[2] === 'head')) return h('div', { class: `menu-${it[2]}` }, it[0]);
  const sub = Array.isArray(it[1]);
  return h('button', {
    class: (it[4] ? `${it[2] || ''} with-ico` : (it[2] || '')) + (sub ? ' has-sub' : ''),
    onclick: sub ? null : () => { closeMenu(); it[1](); },
    onpointerdown: sub ? e => { e.preventDefault(); e.stopPropagation(); openSub(e.currentTarget, it[1]); } : null,
  },
    it[4] ? h('span', { class: 'mi-ico', innerHTML: it[4] }) : null,
    it[0], it[3] ? h('small', {}, it[3]) : null);
}

function openSub(el, items) {
  const m = $('#menuSub');
  m.replaceChildren(...items.filter(Boolean).map(menuItem));
  m.hidden = false;
  const r = el.getBoundingClientRect(), w = m.offsetWidth, hgt = m.offsetHeight;
  m.style.left = Math.max(4, Math.min(r.right - 4, innerWidth - w - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(r.top - 5, innerHeight - hgt - 4)) + 'px';
  setTimeout(() => addEventListener('pointerdown', closeMenuOutside, { once: true }));
}
function closeMenuOutside(e) { if (!e.target.closest('#menu')) closeMenu(); else addEventListener('pointerdown', closeMenuOutside, { once: true }); }
function closeMenu() {
  closeSurfaceMenu();
  $('#menu').hidden = true;
  $('#menuSub').hidden = true;
  if (menuAnchor) { menuAnchor.classList.remove('on'); menuAnchor.removeAttribute('aria-expanded'); menuAnchor = null; }
  growRail(false);
  closePeekIfIdle();
}

/* The rail is too narrow for a menu and the page is composited above the chrome, so a
   menu opened from it would be hidden past the 58px column. Float the full sidebar over the
   page while the menu is up, then fold back. The page does not move, so nothing is resized. */
let railGrow = false;
function growRail(on) {
  if (state.settings.layout !== 'rail' || railGrow === on) return;
  railGrow = on;
  $('#app').classList.toggle('rail-grow', on);
  root.dataset.layout = on ? 'sidebar' : 'rail';
  sidebarOverlay(on, state.settings.sideWidth);
}

/* The bottom "+" opens a create menu above itself, inside the sidebar. */
function newItemMenu(btn) {
  if (!$('#menu').hidden && menuAnchor === btn) return closeMenu();
  const r = btn.getBoundingClientRect();
  if (NATIVE) {   // above the button, its right edge on the button's
    return menu(Math.max(6, r.right - 246), r.top - 118, [
      ['New Space', newSpace, '', '', ICO_SPACE],
      ['New Folder', () => newFolder(), '', '', ICO_FOLDER_PLUS],
      ['New Tab', () => openCmd('new'), '', 'Ctrl+T', ICO_TAB_PLUS],
    ], btn);
  }
  growRail(true);
  menu(r.left, r.top, [
    ['New Space', newSpace, '', '', ICO_SPACE],
    ['New Folder', () => newFolder(), '', '', ICO_FOLDER_PLUS],
    ['New Tab', () => openCmd('new'), '', 'Ctrl+T', ICO_TAB_PLUS],
  ], btn);
  const m = $('#menu');
  m.style.left = Math.max(6, Math.min(r.right - m.offsetWidth + 6, innerWidth - m.offsetWidth - 6)) + 'px';
  m.style.top = Math.max(6, r.top - m.offsetHeight - 8) + 'px';
}

function tabMenu(t, x, y) {
  const pinned = !!t.home && !t.ess;
  menu(x, y, [
    [pinned ? 'Unpin' : 'Pin tab', () => pinTab(t.id, !pinned), '', 'Ctrl+Shift+D'],
    ['Add to Essentials', () => { addEssential(t.url, t.title); }],
    ['Save to Canvas', () => Rainbow.canvas?.saveTab(t.id), '', 'Ctrl+D'],
    ['Rename', () => { const li = document.querySelector(`.tab[data-id="${t.id}"]`); if (li) rename(li, t); }],
    ['Copy link', () => copyText(t.url, 'Link copied')],
    ['Duplicate', () => openTab(t.url)],
    '-',
    ['Split view', () => setTimeout(() => splitMenu(t.id, x, y))],
    '-',
    ...state.spaces.filter(s => s.id !== t.space).map(s => [`Move to ${s.icon} ${s.name}`, () => moveTabToSpace(t.id, s.id)]),
    '-',
    [pinned ? 'Remove pin' : 'Close tab', () => { if (pinned) { pinTab(t.id, false); closeTab(t.id); } else closeTab(t.id); }, 'danger'],
  ]);
}
function spaceMenu(s, x, y) {
  menu(x, y, [
    ['Edit space…', () => openSpaceSettings(s)],
    ['New folder', () => { switchSpace(s.id); newFolder(); }],
    ['New space', newSpace],
    ['Tabs overview', () => openTabsOverview()],
    ['Settings', () => openSettings(), '', 'Ctrl+,'],
    '-',
    ['Delete space', () => confirmPanel(`Delete "${s.name}" and its tabs?`, () => deleteSpace(s.id)), 'danger'],
  ]);
}

/* Clipboard: the menu item is the gesture, but fall back if the permission is missing.
   `what` false means the caller reports it in its own place (the address pill), so no toast. */
async function copyText(text, what = 'Copied') {
  if (!text) return false;
  try { await navigator.clipboard.writeText(text); if (what) toast(what); return true; }
  catch {
    const ta = h('textarea', { style: 'position:fixed;left:-9999px;top:0' });
    ta.value = text; document.body.append(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    if (what) toast(ok ? what : 'Could not copy');
    return ok;
  }
}

/* A copy confirmed inside the address pill: the text says what happened and the pill
   brightens for a moment, then both settle back. In place, where the click was. */
let flashTimer = 0;
function flashUrl(text, ok = true) {
  const pill = $('#urlPill'), txt = $('#urlText'), ico = $('#copyLink');
  clearTimeout(flashTimer);
  txt.textContent = text;
  txt.classList.remove('placeholder');
  pill.classList.add('copied');
  ico.classList.toggle('done', ok);   // the icon agrees with the text
  flashTimer = setTimeout(() => {
    pill.classList.remove('copied');
    ico.classList.remove('done');
    render();  // puts the address back
  }, 1300);
}

/* Compact mode says what is hidden: the sidebar, the toolbar, or both. The sidebar's state has to
   follow the mode every time it changes, not only when compact mode is entered: going from "hide
   both" to "hide toolbar" must bring the sidebar back, and the other way round must put it away. */
function syncCompactSidebar() {
  if (state.settings.layout !== 'compact') return;
  const m = state.settings.compact, hide = m === 'sidebar' || m === 'both';
  if (hide !== $('#app').classList.contains('collapsed')) toggleSidebar();
}

function setLayout(id) {
  const app = $('#app');
  clearTimeout(peekOut); clearTimeout(peekGone);
  app.classList.remove('peek', 'peek-out', 'rail-grow');
  railGrow = false;
  sidebarOverlay(false);
  const wasCompact = state.settings.layout === 'compact';
  state.settings.layout = id;
  // Compact mode is the sidebar out of the way plus the bar, so entering it folds the sidebar
  // away (remembering whether it was out before) and leaving puts it back.
  if (id === 'compact') {
    const m = state.settings.compact;
    if ((m === 'sidebar' || m === 'both') && !app.classList.contains('collapsed')) {
      state.settings.sideBeforeCompact = true;
      toggleSidebar();
    }
  } else if (wasCompact && state.settings.sideBeforeCompact) {
    state.settings.sideBeforeCompact = false;
    if (app.classList.contains('collapsed')) toggleSidebar();
  }
  syncCompactSidebar();
  applyTheme(); render(); save(); syncPage(); cbarMsg();
}

/* The title bar and the empty frame around it open the window menu (this is the
   sidebar menu: compact mode, hide sidebar, tabs on the right, theme, toolbar). */
function frameMenu(x, y) {
  const st = state.settings;
  menu(x, y, [
    ['New Tab', () => openCmd('new'), '', 'Ctrl+T'],
    ['New Space', newSpace],
    ['New Folder', newFolder],
    '-',
    ...compactItems(),
    '-',
    ['Tabs on the right', () => { st.side = st.side === 'right' ? 'left' : 'right'; applyTheme(); save(); syncPage(); }, st.side === 'right' ? 'check' : ''],
    ['Edit theme…', () => openSpaceSettings()],
    ['Customize toolbar…', () => openSettings('look')],
    '-',
    ['Reload', () => activeTab() && send({ t: 'exec', id: activeTab().id, js: 'location.reload()' })],
    ['Settings', () => openSettings(), '', 'Ctrl+,'],
  ]);
}

/* New Tab, the way Arc shows its containers: the profiles this Rainbow knows, then the ways
   to add or edit one. A profile needs a space to open a tab into. */
function newTabInProfile(p) {
  const s = state.spaces.find(x => x.profile === p.id);
  if (!s) { toast(`${p.name} has no space yet`); openSettings('profiles'); return; }
  if (s.id !== state.activeSpace) switchSpace(s.id);
  openCmd('new');
}
function newTabMenu(x, y) {
  const items = [['New Tab', null, 'title']];
  for (const p of state.profiles) {
    const sp = state.spaces.find(s => s.profile === p.id);
    items.push([
      h('span', { class: 'mi' }, h('i', { class: 'pdot', style: sp ? `background:linear-gradient(150deg,${sp.a},${sp.b})` : '' }), p.name),
      () => newTabInProfile(p), '', sp && sp.name !== p.name ? sp.name : '',
    ]);
  }
  items.push('-',
    ['Add a new profile', () => { state.profiles.push({ id: 'p' + uid(), name: 'New Profile' }); save(); openSettings('profiles'); }],
    ['Manage profiles', () => openSettings('profiles')]);
  menu(x, y, items);
}

/* The sliders in the address pill: what you can do with the current link. */
function linkMenu(x, y) {
  const t = activeTab();
  if (!t) return;
  const s = space();
  menu(x, y, [
    ['Copy link', () => copyText(t.url, 'Link copied'), '', 'Ctrl+C'],
    ['Copy as Markdown', () => copyText(`[${t.custom || t.title || t.url}](${t.url})`, 'Markdown copied')],
    '-',
    ['Add to Essentials', () => addEssential(t.url, t.title)],
    ['Save to Canvas', () => Rainbow.canvas?.saveTab(t.id), '', 'Ctrl+D'],
    s.split ? null : ['Open in split view', () => { const nt = openTab(t.url, { focus: false }); if (nt) splitWith(t.id, nt.id, 'right'); }],
    '-',
    ['Boost this site', openBoost, state.boosts[hostOf(t.url)]?.on ? 'check' : ''],
  ]);
}

/* ---------------- site options ---------------- */
/* The panel behind the sliders: what you can do with the page itself, not with the link. The
   shape — Share, Extensions with its own "+", Automatic Picture-in-Picture, and Secure with the
   "…" that opens the site's own settings. */
const WEBSTORE = 'https://chromewebstore.google.com/category/extensions';

function openSitePop(anchor) {
  const t = activeTab();
  if (!t) return;
  closeAll();
  if (NATIVE) return surfaceSitePop(anchor, t);
  const pop = $('#sitePop');
  $('#spFav').replaceChildren(favicon(t.url, 16));
  $('#spHost').textContent = hostOf(t.url);
  const secure = /^https:/i.test(t.url);
  $('#spSecureLabel').textContent = secure ? 'Secure' : 'Not secure';
  $('#spSecure').classList.toggle('no', !secure);
  $('#spSecure').title = secure ? 'Connection is secure' : 'Connection is not private';
  pipSync();
  pop.hidden = false;
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
  pop.style.top = Math.min(r.bottom + 6, innerHeight - pop.offsetHeight - 8) + 'px';
  setTimeout(() => addEventListener('pointerdown', function away(e) {
    if (e.target.closest('#sitePop') || e.target.closest('#menu')) return addEventListener('pointerdown', away, { once: true });
    closeSitePop();
  }, { once: true }));
}
function closeSitePop() { $('#sitePop').hidden = true; }
/* The same panel on the surface (above the page), as a rich menu. */
function surfaceSitePop(anchor, t) {
  const svg = d => `<svg viewBox="0 0 16 16">${d}</svg>`;
  const secure = /^https:/i.test(t.url);
  const r = anchor.getBoundingClientRect();
  let fav = '';
  try { fav = state.icons[hostOf(t.url)] || KNOWN_ICONS[hostOf(t.url)] || new URL('/favicon.ico', t.url).href; } catch {}
  menu(Math.min(r.left, innerWidth - 292), r.bottom + 6, [
    [siteName(t.url), null, '', '', '', { host: { fav, secure } }],
    '-',
    ['Share URL', () => copyText(t.url, 'Link copied'), '', '', svg('<path d="M8 10.5V2.5M5.5 5 8 2.5 10.5 5"/><path d="M3.5 9v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V9"/>')],
    ['Extensions', () => openSettings('mods'), '', '', svg('<path d="M8 2.5 13.5 8 8 13.5 2.5 8z"/><circle cx="8" cy="8" r="1.6"/>'),
      { mini: { ico: svg('<path d="M8 3.5v9M3.5 8h9"/>'), title: 'Add from the Chrome Web Store', fn: () => openTab(WEBSTORE) } }],
    ['Automatic Picture-in-Picture', () => { state.settings.autoPip = !pipOn(); save(); surfaceToast(pipOn() ? 'Videos float when you leave their tab' : 'Videos stay in their tab'); },
      '', '', svg('<rect x="2" y="3.5" width="8.5" height="6" rx="1.4"/><path d="M10.5 6.5h2.2a1.3 1.3 0 0 1 1.3 1.3v2.4a1.3 1.3 0 0 1-1.3 1.3h-2.2z"/>'), { sw: pipOn() }],
    [secure ? 'Secure' : 'Not secure', () => openSettings('tabs'), '', '', svg('<rect x="4" y="7" width="8" height="6" rx="1.4"/><path d="M6 7V5a2 2 0 0 1 4 0v2"/>'), { sub: [
      ['Clear Cache', () => siteData('cache')], ['Clear Cookies', () => siteData('cookies')], '-',
      ['Manage Extensions', () => openSettings('mods')], ['Add Extension', () => openTab(WEBSTORE)], ['All Site Settings', () => openSettings('tabs')]] }],
    ['Screenshot', openShotTool, '', 'Ctrl+Shift+S', svg('<path d="M2.5 5.5h2l1-1.8h5l1 1.8h2a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1z"/><circle cx="8" cy="9.2" r="2.1"/>')],
  ], anchor, { w: 290 });
}
const pipOn = () => state.settings.autoPip !== false;
function pipSync() {
  $('#spPip').classList.toggle('on', pipOn());
  $('#spPip').setAttribute('aria-checked', String(pipOn()));
}
$('#spShare').onclick = () => { const t = activeTab(); if (t) copyText(t.url, 'Link copied'); };
$('#spExt').onclick = () => { closeSitePop(); openSettings('mods'); };
$('#spExtAdd').onclick = () => { closeSitePop(); openTab(WEBSTORE); };
$('#spPip').onclick = () => {
  state.settings.autoPip = !pipOn();
  save(); pipSync();
  toast(pipOn() ? 'Videos float when you leave their tab' : 'Videos stay in their tab');
};
$('#spSecureBtn').onclick = () => { closeSitePop(); openSettings('tabs'); };
$('#spSecureMore').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  menu(r.right, r.bottom + 4, [
    ['Clear Cache', () => siteData('cache')],
    ['Clear Cookies', () => siteData('cookies')],
    '-',
    ['Manage Extensions', () => { closeSitePop(); openSettings('mods'); }],
    ['Add Extension', () => { closeSitePop(); openTab(WEBSTORE); }],
    ['All Site Settings', () => { closeSitePop(); openSettings('tabs'); }],
  ], e.currentTarget);
};
$('#spShot').onclick = () => { closeSitePop(); openShotTool(); };
function siteData(op) {
  const t = activeTab();
  if (!t) return;
  let origin = '';
  try { origin = new URL(t.url).origin; } catch { return toast('Not a web page'); }
  send({ t: 'sitedata', id: t.id, op, origin });
  toast(op === 'cookies' ? `Cookies cleared for ${hostOf(t.url)}` : 'Cache cleared');
}

/* ---------------- screenshot ---------------- */
/* Screenshots open in region mode: drag a piece of the page, or take it whole with Visible and
   Full page standing by at the top right. A native page cannot be drawn over, so the tool hides
   the page and stands its own frozen snapshot in its place — what you drag across is the page,
   pixel for pixel, and the crop comes off that same image. */
let shotPane = null, shotDrag = null, shotSel = null;
async function openShotTool() {
  const t = activeTab();
  if (!t) return toast('No tab open');
  const p = panes[0];
  if (!p) return toast('Nothing to capture');
  closeAll();
  const data = await snapshot(p.id);
  if (!data) return toast('Could not capture the page');
  shotPane = p; shotSel = null; shotDrag = null;
  const img = $('#stImg');
  img.src = data;
  Object.assign(img.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' });
  $('#stSel').hidden = true;
  $('#stHint').textContent = 'Drag to select an area';
  $('#shotTool').hidden = false;
  send({ t: 'overlay', on: true });   // hide the real page; the snapshot stands in for it
}
function closeShotTool() {
  if ($('#shotTool').hidden) return;
  $('#shotTool').hidden = true;
  $('#stSel').hidden = true;
  shotDrag = shotSel = null;
  send({ t: 'overlay', on: false });
  closePeekIfIdle();
}
$('#stClose').onclick = closeShotTool;
$('#stVisible').onclick = async () => {
  const src = $('#stImg').src;
  if (src) await shotSave(await fitShot(src));
};
$('#stFull').onclick = async () => {
  const t = activeTab();
  if (!t) return;
  $('#stHint').textContent = 'Capturing the full page…';
  const data = await fullShot(t.id);
  $('#stHint').textContent = 'Drag to select an area';
  if (!data) return toast('Could not capture the full page');
  await shotSave(await fitShot(data, 1600));
};
$('#shotTool').addEventListener('pointerdown', e => {
  if (e.target.closest('.st-bar') || e.button !== 0) return;
  e.preventDefault();
  shotDrag = { x0: e.clientX, y0: e.clientY };
  $('#stSel').hidden = false;
  Object.assign($('#stSel').style, { left: e.clientX + 'px', top: e.clientY + 'px', width: '0px', height: '0px' });
});
addEventListener('pointermove', e => {
  if (!shotDrag) return;
  const x = Math.min(shotDrag.x0, e.clientX), y = Math.min(shotDrag.y0, e.clientY);
  const w = Math.abs(e.clientX - shotDrag.x0), hgt = Math.abs(e.clientY - shotDrag.y0);
  Object.assign($('#stSel').style, { left: x + 'px', top: y + 'px', width: w + 'px', height: hgt + 'px' });
  $('#stSize').textContent = `${Math.round(w)} × ${Math.round(hgt)}`;
});
addEventListener('pointerup', e => {
  if (!shotDrag) return;
  const { x0, y0 } = shotDrag, p = shotPane;
  const w = Math.abs(e.clientX - x0), hgt = Math.abs(e.clientY - y0);
  shotDrag = null;
  if (w < 8 || hgt < 8) { $('#stSel').hidden = true; return; }   // a click is not a selection
  shotSel = { x: Math.min(x0, e.clientX) - p.x, y: Math.min(y0, e.clientY) - p.y, w, hgt };
  shotCrop(shotSel);
});
/* The crop comes off the same frozen image, scaled from CSS px to the snapshot's own pixels. */
async function shotCrop(sel) {
  const img = $('#stImg'), p = shotPane;
  if (!img.src) return;
  const k = img.naturalWidth / p.w;
  const data = await cropShot(img.src, sel.x * k, sel.y * k, sel.w * k, sel.hgt * k);
  if (data) await shotSave(data);
  else toast('Could not crop that area');
}
async function shotSave(data) {
  if (!data) return toast('Could not capture the image');
  const t = activeTab();
  // Saved first, read and sorted after: the screenshot must survive even when OCR is unavailable.
  const b = Rainbow.canvas?.add({ kind: 'image', image: data, title: t ? (t.custom || t.title || hostOf(t.url)) : 'Screenshot',
    url: t?.url || null, sourceUrl: t?.url || null, created: Date.now() });
  closeShotTool();
  if (!b) return;
  toast('Screenshot saved to Canvas');
  Rainbow.canvas?.enrich?.(b.id, data);
}
/* Stored shots are capped: a full page at full size is megabytes of localStorage. */
function fitShot(src, max = 1400) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / img.naturalWidth);
      if (k === 1 && img.naturalWidth * img.naturalHeight < 1.6e6) return resolve(src);
      const c = h('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/jpeg', .84)); } catch { resolve(src); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
function cropShot(src, x, y, w, hgt) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const c = h('canvas', { width: Math.max(1, Math.round(w)), height: Math.max(1, Math.round(hgt)) });
      c.getContext('2d').drawImage(img, Math.round(x), Math.round(y), c.width, c.height, 0, 0, c.width, c.height);
      try { resolve(c.toDataURL('image/jpeg', .88)); } catch { resolve(null); }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
const fullShots = new Map();
function fullShot(id) {
  return new Promise(resolve => {
    fullShots.set(id, resolve);
    send({ t: 'shot', id, full: true });
    setTimeout(() => { if (fullShots.get(id) === resolve) { fullShots.delete(id); resolve(null); } }, 8000);
  });
}

let toastTimer = 0;
/* A notice drawn by the surface: it sits above the page, which a chrome toast cannot. In a plain
   browser there is no surface, so it is an ordinary toast. */
let surfaceTimer = 0;
function surfaceToast(text) {
  if (!NATIVE) return toast(text);
  if (surfMenu) return;   // a menu has the surface
  const w = 280, hgt = 44;   // top right, under the window buttons
  send({ t: 'surface', on: true, x: innerWidth - w - 16, y: 46, w, h: hgt, view: { kind: 'toast', text } });
  clearTimeout(surfaceTimer);
  surfaceTimer = setTimeout(() => { if (!surfMenu) send({ t: 'surface', on: false }); }, 2600);
}

/* Pinned extensions sit to the right of the address. Each profile has its own extensions, so the
   bar shows the ones pinned for the current space's profile. */
const profileId = () => space().profile || 'default';
function drawExtBar() {
  const bar = $('#extBar');
  if (!bar) return;
  const pid = profileId(), info = Rainbow.extensions?.[pid];
  if (NATIVE && !info) { if (!(Rainbow.extAsked ||= {})[pid]) { Rainbow.extAsked[pid] = 1; send({ t: 'extensions', profile: pid }); } }
  const pins = state.extPins[pid] || [];
  bar.replaceChildren(...pins.map(id => info?.items.find(x => x.id === id)).filter(Boolean).map(x =>
    h('button', { class: 'ext-pin', title: x.name, 'aria-label': x.name,
      onclick: () => toast(`${x.name}: extension popups are not available yet`) },
      x.icon ? h('img', { src: x.icon, alt: '' }) : h('span', {}, x.name.slice(0, 1).toUpperCase()))));
}
function toast(text) {
  const t = $('#toast');
  t.textContent = text; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2400);
}

/* Overlays: the page is a native view the chrome cannot draw over or blur, so take a
   snapshot of it, hide it, and blur the snapshot instead. */
/* 'low' (Ask Rainbow) blurs only a band along the bottom of the window: the page above it
   stays live and is shortened to end where the band starts. */
let overlayDepth = 0, veilMode = 'full';
let veilHide = 0;
async function veilOn(mode = 'full') {
  clearTimeout(veilHide); $('#veil').classList.remove('out');
  if (overlayDepth++) return;
  veilMode = mode;
  const veil = $('#veil'), img = $('#veilShot');
  veil.classList.toggle('low', mode === 'low');
  if (mode === 'low') return washOn(veil);
  Object.assign(veil.style, { top: '0px', height: innerHeight + 'px' });
  img.hidden = true;
  const p = panes[0];
  if (NATIVE && p) {
    const data = await snapshot(p.id);
    if (data) { img.src = data; Object.assign(img.style, { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' }); img.hidden = false; }
  }
  veil.hidden = false;
  send({ t: 'overlay', on: true });
}
/* Ask Rainbow's wash. The page stays live and keeps its size. The chrome is lifted over a band along the
   bottom of the window, and there it draws a sharp picture of the page (so the seam cannot be seen)
   with a blurred copy fading in over it, thicker towards the bottom. */
async function washOn(veil) {
  const band = Math.round(Math.max(innerHeight * .42, 300)), top = innerHeight - band;
  Object.assign(veil.style, { top: top + 'px', height: band + 'px' });
  const wash = $('#wash');
  wash.replaceChildren();
  $('#veilShot').hidden = true;
  if (NATIVE) {
    const shots = await Promise.all(panes.map(async p => [p, await snapshot(p.id)]));
    for (const cls of ['sharp', 'soft']) for (const [p, data] of shots) if (data) {
      wash.append(h('img', { class: cls, alt: '', src: data, style: `left:${p.x}px;top:${p.y - top}px;width:${p.w}px;height:${p.h}px` }));
    }
  }
  wash.append(h('div', { class: 'tint' }));
  veil.hidden = false;
  send({ t: 'chrome', band: { y: top, h: band } });
  send({ t: 'overlay', on: true, low: true });
}
function veilOff() {
  if (--overlayDepth > 0) return;
  overlayDepth = 0;
  const v = $('#veil');
  if (veilMode === 'low') {
    // The wash dissolves with the chat; only then does the shell stop drawing the band.
    send({ t: 'overlay', on: false, low: true });
    if (v.hidden) { send({ t: 'chrome', band: null }); return; }
    v.classList.add('out');
    veilHide = setTimeout(() => { v.hidden = true; v.classList.remove('out'); $('#wash').replaceChildren(); send({ t: 'chrome', band: null }); }, 340);
    return;
  }
  v.hidden = true;
  send({ t: 'overlay', on: false });
}

function panel(title, build) {
  closeAll();
  veilOn();
  $('#panel').classList.remove('wide');
  $('#panelTitle').textContent = title;
  $('#panelBody').replaceChildren(...[].concat(build()));
  $('#panel').hidden = false;
  $('#panel').querySelector('input,select,textarea,button')?.focus();
}
function closePanel() { if (!$('#panel').hidden) { $('#panel').hidden = true; veilOff(); closePeekIfIdle(); } }
function confirmPanel(text, yes) {
  panel('Are you sure?', () => [h('p', { class: 'hint', style: 'opacity:.85;font-size:13px' }, text),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
      h('button', { class: 'btn primary', onclick: () => { closePanel(); yes(); } }, 'Delete'))]);
}

const field = (label, control) => h('label', { class: 'field' }, h('span', {}, label), control);
const seg = (options, value, onpick) => {
  const el = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, label] of options) el.append(h('button', { class: v === value ? 'on' : '', role: 'radio', 'aria-checked': String(v === value),
    onclick: e => { el.querySelectorAll('button').forEach(b => { b.classList.toggle('on', b === e.currentTarget); b.setAttribute('aria-checked', String(b === e.currentTarget)); }); onpick(v); } }, label));
  return el;
};
const range = (value, min, max, oninput) => h('input', { type: 'range', min, max, value, oninput: e => oninput(+e.target.value) });

function openSpaceSettings(s = space()) {
  if (s.id !== state.activeSpace) switchSpace(s.id);
  panel(`${s.icon} ${s.name}`, () => [
    field('Name', h('input', { type: 'text', value: s.name, oninput: e => { s.name = e.target.value || 'Space'; render(); save(); } })),
    field('Icon', h('div', { class: 'swatches' }, ICONS.map(i => h('button', { class: `swatch${s.icon === i ? ' on' : ''}`, style: 'display:grid;place-items:center;font-size:14px',
      onclick: e => { s.icon = i; e.currentTarget.parentElement.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b === e.currentTarget)); render(); save(); } }, i)))),
    field('Theme', h('div', { class: 'theme-field' },
      themeSwatches(s, t => { s.a = t.a; s.b = t.b; s.c = t.c; applyTheme(); save(); }),
      h('div', { class: 'theme-custom' }, h('span', {}, 'Custom'),
        h('input', { type: 'color', value: s.a, 'aria-label': 'First colour', oninput: e => { s.a = e.target.value; applyTheme(); save(); } }),
        h('input', { type: 'color', value: s.b, 'aria-label': 'Second colour', oninput: e => { s.b = e.target.value; applyTheme(); save(); } }),
        h('input', { type: 'color', value: s.c || s.b, 'aria-label': 'Third colour', oninput: e => { s.c = e.target.value; applyTheme(); save(); } })))),
    state.profiles.length > 1 ? field('Profile', h('select', { 'aria-label': 'Profile', onchange: e => { s.profile = e.target.value; save(); toast('New tabs in this space use that profile'); } },
      state.profiles.map(p => h('option', { value: p.id, selected: p.id === s.profile }, p.name)))) : null,
    h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: () => confirmPanel(`Delete “${s.name}” and its tabs?`, () => deleteSpace(s.id)) }, 'Delete space'),
      h('button', { class: 'btn primary', onclick: closePanel }, 'Done')),
  ]);
  $('#panelBody input')?.select();
}

/* Settings is a page with a left rail of sections, with its own left rail. */
const SETTINGS_SECTIONS = [['look', 'Look and Feel'], ['tabs', 'Tabs and browsing'], ['profiles', 'Spaces and profiles'], ['mods', 'Extensions and themes'],
  ['ask', 'Ask Rainbow'], ['models', 'On-device models'], ['keys', 'Keyboard shortcuts'], ['data', 'Data']];
const heading = t => h('h3', { class: 'set-h' }, t);
function openSettings(section = 'look') {
  const st = state.settings;
  // Settings is a page in the web frame, so it uses the page's own ink and lines rather than the
  // floating panel's glass tokens.
  const host = $('#settingsView');
  const closeSettings = () => setView('page');
  if (view === 'settings') { closeMenu(); closeCmd(); closePanel(); closeSitePop(); } else closeAll();
  // A floating peek is a page view above the chrome; settings owns the frame now.
  if (peek) closePeek();
  const set = (k, v) => { st[k] = v; applyTheme(); render(); save(); };
  const body = h('div', { class: 'set-body' });
  const nav = h('nav', { class: 'set-nav', 'aria-label': 'Settings sections' });
  const LAYOUT_IDS = ['sidebar', 'toolbar', 'rail', 'compact'];
  // Choosing Compact with no compact target picked should hide the sidebar, not leave the
  // layout "compact" and the sub-control saying "Off". Remember what was there so Off returns.
  function pickLayout(id, focus = false) {
    if (id === 'compact') {
      if (st.layout !== 'compact') st.preCompact = st.layout;
      if ((st.compact || 'off') === 'off') st.compact = 'sidebar';
    }
    set('layout', id); draw();
    if (focus) host.querySelector(`.layout-card[data-layout="${id}"]`)?.focus();
  }
  // A radio group, like Yalqen's ChoiceCards: arrow keys move the choice and the focus together.
  const layoutCard = (id, name) => h('button', {
    class: `layout-card${st.layout === id ? ' on' : ''}`, 'data-layout': id,
    role: 'radio', 'aria-checked': String(st.layout === id), tabindex: st.layout === id ? '0' : '-1',
    onclick: () => pickLayout(id),
    onkeydown: e => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      pickLayout(LAYOUT_IDS[(LAYOUT_IDS.indexOf(id) + step + LAYOUT_IDS.length) % LAYOUT_IDS.length], true);
    },
  },
    h('div', { class: `art ${id}` }, h('i', { class: 'top' }), h('i', { class: 'bar' }), h('i', { class: 'page' })), h('span', {}, name));
  const pages = {
    look: () => [
      heading('Browser layout'),
      h('div', { class: 'layout-cards', role: 'radiogroup', 'aria-label': 'Browser layout' }, layoutCard('sidebar', 'Only Sidebar'), layoutCard('toolbar', 'Sidebar and Top Toolbar'), layoutCard('rail', 'Collapsed Sidebar'), layoutCard('compact', 'Compact')),
      // Off returns to the layout you had, instead of always forcing Only Sidebar.
      field('Compact mode', seg([['off', 'Off'], ['sidebar', 'Hide sidebar'], ['toolbar', 'Hide toolbar'], ['both', 'Hide both']], st.compact || 'off', v => {
        st.compact = v;
        if (v === 'off') {
          if (st.layout === 'compact') setLayout(st.preCompact || 'sidebar');
        } else {
          if (st.layout !== 'compact') st.preCompact = st.layout;
          setLayout('compact');
        }
        syncCompactSidebar();
      })),
      heading('Space theme'),
      field('Theme', h('div', { class: 'theme-field' },
        themeSwatches(space(), t => { const s = space(); s.a = t.a; s.b = t.b; s.c = t.c; applyTheme(); render(); save(); draw(); }),
        h('p', { class: 'hint', style: 'margin:0' }, `“${themeName(space())}” — each space keeps its own. Compass is the flat one: paper, a mint cast at the top, and a grey-violet selection.`))),
      heading('Appearance'),
      field('Mode', seg([['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark']], st.mode, v => set('mode', v))),
      field('Sidebar', seg([['left', 'Left'], ['right', 'Right']], st.side, v => set('side', v))),
      field('Density', seg([['comfortable', 'Comfortable'], ['compact', 'Compact']], st.density, v => set('density', v))),
      field('Paper grain', seg([[true, 'On'], [false, 'Off']], st.grain, v => set('grain', v))),
      field('Corner radius', range(st.radius, 0, 8, v => set('radius', v))),
      h('p', { class: 'hint' }, 'The app frame is 8 px; the page never goes rounder than the frame it sits inside.'),
      field('Page margin', range(st.inset, 0, 20, v => set('inset', v))),
      field('Overlay blur', range(st.blur, 0, 60, v => set('blur', v))),
      h('p', { class: 'hint' }, 'To change a space’s name, icon or colours, right-click it.'),
    ],
    tabs: () => [
      heading('Tabs'),
      field('Float videos', seg([[true, 'On'], [false, 'Off']], st.autoPip !== false, v => set('autoPip', v))),
      h('p', { class: 'hint' }, 'When you leave a tab that is playing a video, it floats in the corner and slides back into the page when you return.'),
      field('Archive Today tabs after', h('select', { onchange: e => set('archiveHours', +e.target.value) },
        [[12, '12 hours'], [24, '1 day'], [168, '7 days'], [720, '30 days'], [0, 'Never']].map(([v, l]) => h('option', { value: v, selected: st.archiveHours === v }, l)))),
      heading('Search'),
      field('Search engine', h('select', { onchange: e => set('search', e.target.value) },
        Object.keys(SEARCH).map(k => h('option', { value: k, selected: st.search === k }, k[0].toUpperCase() + k.slice(1))))),
      heading('Links'),
      h('p', { class: 'hint' }, 'Hold Shift and click a link to peek at it in a floating window. Close it, open it as a tab, or put it beside the page in split view.'),
    ],
    profiles: () => [
      heading('Profiles'),
      h('p', { class: 'hint' }, 'A profile keeps its own logins, cookies and extensions. Every space belongs to one profile.'),
      ...state.profiles.map(p => {
        const used = state.spaces.filter(s => s.profile === p.id);
        return h('div', { class: 'profile-row' },
          h('input', { type: 'text', value: p.name, 'aria-label': 'Profile name', oninput: e => { p.name = e.target.value || 'Profile'; save(); } }),
          h('span', { class: 'hint' }, used.length ? used.map(s => `${s.icon} ${s.name}`).join(', ') : 'No spaces yet'),
          state.profiles.length > 1 && !used.length ? h('button', { class: 'btn', onclick: () => { state.profiles = state.profiles.filter(x => x !== p); save(); draw(); } }, 'Delete') : null);
      }),
      h('div', { class: 'row-btns', style: 'justify-content:flex-start' },
        h('button', { class: 'btn primary', onclick: () => { state.profiles.push({ id: 'p' + uid(), name: 'New Profile' }); save(); draw(); } }, 'Add a new Profile')),
    ],
    mods: () => {
      Rainbow.onExtensions = () => { if (section === 'mods') draw(); };
      if (NATIVE) for (const p of state.profiles) if (!Rainbow.extensions?.[p.id]) send({ t: 'extensions', profile: p.id });
      return [
        heading('Themes'),
        themeSwatches(space(), t => { const s = space(); s.a = t.a; s.b = t.b; s.c = t.c; applyTheme(); save(); draw(); }),
        h('p', { class: 'hint' }, `Colours apply to the current space (${space().name}). Mode, radius and blur are in Look and Feel.`),
        heading('Extensions'),
        NATIVE ? [
          h('p', { class: 'hint' }, 'Extensions belong to a profile. Unpack one into its own folder inside that profile’s folder, then restart Rainbow. Pin the ones you want next to the address bar.'),
          ...state.profiles.flatMap(p => {
            const info = Rainbow.extensions?.[p.id], pins = state.extPins[p.id] ||= [];
            return [
              h('div', { class: 'profile-row' }, h('strong', {}, p.name),
                h('span', { class: 'hint' }, info?.dir || '…'),
                h('button', { class: 'btn', onclick: () => send({ t: 'reveal', what: 'extensions', profile: p.id }) }, 'Open folder')),
              ...(info?.items?.length ? info.items.map(x => h('div', { class: 'ext-row' },
                x.icon ? h('img', { class: 'ext-ico', src: x.icon, alt: '' }) : h('span', { class: 'ext-ico' }, x.name.slice(0, 1).toUpperCase()),
                h('span', {}, x.name),
                h('button', { class: 'btn', onclick: () => { const i = pins.indexOf(x.id); i < 0 ? pins.push(x.id) : pins.splice(i, 1); save(); drawExtBar(); draw(); } },
                  pins.includes(x.id) ? 'Unpin' : 'Pin'))) : [h('p', { class: 'hint' }, 'No extensions installed.')]),
            ];
          }),
        ] : h('p', { class: 'hint' }, 'Extensions load in the Rainbow app.'),
        heading('Boosts'),
        h('p', { class: 'hint' }, 'Per-site styling and scripts live in Boosts: press the star in the address bar.'),
      ];
    },
    ask: () => [
      heading('Ask Rainbow'),
      field('Anthropic API key', h('input', { type: 'password', value: st.apiKey, placeholder: 'sk-ant-…', autocomplete: 'off', oninput: e => { st.apiKey = e.target.value.trim(); save(); } })),
      h('p', { class: 'hint' }, 'Ask Rainbow opens with Ctrl+E. The key is kept on this device and sent only to api.anthropic.com. Without a key, the built-in model still runs simple commands.'),
    ],
    models: () => {
      Rainbow.onModels = () => { if (section === 'models') draw(); };
      const [rows, mode] = Rainbow.modelsPage();
      return [
        heading('On-device models'),
        h('p', { class: 'hint' }, 'Small models that run on this machine to sort your Canvas and to make quick decisions for Ask Rainbow. Installing downloads a model once from its public host; every decision after that stays here.'),
        field('Use', seg([['both', 'Both together'], ['sorter', 'Sorter'], ['decider', 'Decider'], ['off', 'Off']], mode, v => { Rainbow.setModelMode(v); })),
        ...rows,
        h('p', { class: 'hint' }, 'Together, the Sorter answers when it is sure and hands close calls to the Decider.'),
      ];
    },
    keys: () => [heading('Keyboard shortcuts'), ...shortcutRows()],
    data: () => [
      heading('Data'),
      h('div', { class: 'row-btns', style: 'justify-content:flex-start' },
        h('button', { class: 'btn', onclick: exportData }, 'Export…'),
        h('button', { class: 'btn', onclick: importData }, 'Import…'),
        h('button', { class: 'btn', onclick: () => openArchive() }, 'Archive')),
    ],
  };
  function draw() {
    nav.replaceChildren(...SETTINGS_SECTIONS.map(([id, name]) => h('button', { class: id === section ? 'on' : '', 'aria-current': id === section ? 'page' : null,
      onclick: () => { section = id; draw(); } }, name)));
    body.replaceChildren(...[].concat(pages[section]()).flat());
  }
  const title = h('h1', { class: 'set-title' }, 'Settings');
  const cross = { innerHTML: '<svg viewBox="0 0 16 16"><path d="m4 4 8 8M12 4l-8 8"/></svg>' };
  // Two cards side by side, neither resizable: the sections on the left, the chosen section on the right.
  host.replaceChildren(h('div', { class: 'set-shell' },
    h('aside', { class: 'set-left' },
      h('header', { class: 'set-top' }, title,
        h('button', { class: 'icon-btn', 'aria-label': 'Close settings', title: 'Close settings', onclick: closeSettings, ...cross })),
      nav),
    body));
  draw();
  setView('settings');
  host.scrollTop = 0;
}

function exportData() {
  const copy = { ...state, settings: { ...state.settings, apiKey: '' } };
  const a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(copy, null, 1)], { type: 'application/json' })), download: 'rainbow-export.json' });
  a.click();
}
function importData() {
  const input = h('input', { type: 'file', accept: 'application/json' });
  input.onchange = async () => {
    try {
      const next = JSON.parse(await input.files[0].text());
      if (next.v !== 1 || !Array.isArray(next.spaces)) throw new Error('not a Rainbow export');
      next.settings.apiKey = state.settings.apiKey;
      for (const id of live) send({ t: 'close', id });
      live.clear();
      state = next;
      flush(); // the reload below would drop a debounced write, and with it the import
      location.reload();
    } catch (e) { toast('Import failed: ' + e.message); }
  };
  input.click();
}
function openArchive() {
  panel('Archive', () => state.archive.length
    ? state.archive.slice(0, 120).map(a => h('button', { class: 'btn', style: 'display:flex;gap:10px;align-items:center;text-align:left;font-weight:400',
        onclick: () => { closePanel(); openTab(a.url); } }, favicon(a.url), h('span', { style: 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, a.title || a.url),
        h('small', { class: 'hint' }, new Date(a.t).toLocaleDateString())))
    : h('p', { class: 'hint' }, 'Tabs you close, and Today tabs Rainbow archives, land here.'));
}

function openBoost() {
  const t = activeTab();
  if (!t || !/^https?:/.test(t.url)) return toast('Open a site to boost it');
  const domain = hostOf(t.url);
  // Choosing Boost is the intent to boost, so record it on open. Without this the panel said
  // "Enabled: On" while nothing had been applied, and the menu's check mark never appeared.
  if (!state.boosts[domain]) setBoost(domain, { on: true });
  const b = { on: true, hue: 0, font: '', zap: '', css: '', js: '', ...state.boosts[domain] };
  const upd = (k, v) => { b[k] = v; setBoost(domain, { [k]: v }); render(); };
  panel(`Boost ${domain}`, () => [
    field('Enabled', seg([[true, 'On'], [false, 'Off']], b.on, v => upd('on', v))),
    field('Colour shift', range(b.hue, 0, 359, v => upd('hue', v))),
    field('Font', seg([['', 'Site'], ['sans', 'Sans'], ['serif', 'Serif'], ['mono', 'Mono']], b.font, v => upd('font', v))),
    h('label', {}, h('span', { class: 'hint' }, 'Hide elements (one CSS selector per line)'), h('textarea', { value: b.zap, placeholder: '.cookie-banner\n#sidebar-ads', oninput: e => upd('zap', e.target.value) })),
    h('label', {}, h('span', { class: 'hint' }, 'Custom CSS'), h('textarea', { value: b.css, placeholder: 'body { max-width: 72ch; margin: auto; }', oninput: e => upd('css', e.target.value) })),
    h('label', {}, h('span', { class: 'hint' }, 'Custom JavaScript (runs on every load of this site)'), h('textarea', { value: b.js, placeholder: "document.title = 'Focus'", onchange: e => upd('js', e.target.value) })),
    h('div', { class: 'row-btns' }, h('button', { class: 'btn', onclick: () => { delete state.boosts[domain]; applyBoost({ ...t }); send({ t: 'nav', id: t.id, url: t.url }); save(); closePanel(); render(); } }, 'Delete boost'),
      h('button', { class: 'btn primary', onclick: closePanel }, 'Done')),
  ]);
}

function appMenu(x, y) {
  const t = activeTab();
  menu(x, y, [
    ['New tab', () => openCmd('new'), '', 'Ctrl+T'],
    ['New space', newSpace],
    ['New folder', () => newFolder()],
    ['Reopen closed tab', reopenClosed, '', 'Ctrl+Shift+T'],
    '-',
    t ? ['Split view', () => setTimeout(() => splitMenu(t.id, x, y))] : null,
    ['Canvas', () => setView('canvas'), '', 'Ctrl+Shift+K'],
    ['Ask Rainbow', () => Rainbow.composer?.show(), '', 'Ctrl+E'],
    ['Library', () => Rainbow.library?.open('spaces')],
    ['History', () => Rainbow.library?.open('history')],
    ['Downloads', () => Rainbow.library?.open('downloads')],
    '-',
    t ? ['Boost this site', openBoost, '', 'Ctrl+B'] : null,
    t ? ['Print…', () => send({ t: 'exec', id: t.id, js: 'print()' })] : null,
    t ? ['Developer tools', () => send({ t: 'devtools', id: t.id }), '', 'Ctrl+Shift+I'] : null,
    '-',
    ['Import data…', importData], ['Export data…', exportData],
    ['Keyboard shortcuts', openShortcuts],
    ['Settings', openSettings, '', 'Ctrl+,'],
    NATIVE ? '-' : null,
    NATIVE ? ['Close window', () => { flush(); send({ t: 'win', op: 'close' }); }] : null,
  ]);
}
function shortcutRows() {
  const rows = [['Shift+Click', 'Peek a link'], ['Ctrl+T', 'New tab or search'], ['Ctrl+L', 'Edit address'], ['Ctrl+W', 'Close tab'], ['Ctrl+Shift+T', 'Reopen closed tab'],
    ['Ctrl+Tab', 'Next tab'], ['Ctrl+1…9', 'Go to space'], ['Ctrl+S', 'Show or hide sidebar'], ['Ctrl+D', 'Save to Canvas'],
    ['Ctrl+Shift+D', 'Pin or unpin'], ['Ctrl+Shift+K', 'Canvas'], ['Ctrl+E', 'Ask Rainbow'], ['Ctrl+B', 'Boost this site'],
    ['Ctrl+[ / ]', 'Back / forward'], ['Ctrl+R', 'Reload'], ['Ctrl+,', 'Settings']];
  return rows.map(([k, d]) => h('div', { class: 'field' }, h('span', {}, d), h('kbd', {}, k)));
}
function openShortcuts() { openSettings('keys'); }

/* ---------------- command bar ---------------- */

const ACTIONS = [
  ['New space', () => newSpace(), '＋'],
  ['Open Canvas', () => setView('canvas'), '▦'],
  ['Ask Rainbow', () => Rainbow.composer?.show(), '✦'],
  ['Toggle sidebar', () => toggleSidebar(), '⇤'],
  ['Settings', () => openSettings(), '⚙'],
  ['Boost this site', () => openBoost(), '★'],
  ['Pin or unpin this tab', () => activeTab() && pinTab(activeTab().id, !activeTab().home), '📌'],
  ['Save this page to Canvas', () => Rainbow.canvas?.saveTab(space().active), '🔖'],
  ['Clear Today tabs', () => clearToday(), '✕'],
  ['Reopen closed tab', () => reopenClosed(), '↺'],
  ['Archive', () => openArchive(), '🗄'],
  ['Copy URL', () => activeTab() && navigator.clipboard?.writeText(activeTab().url), '⧉'],
];
let cmdMode = 'new', cmdItems = [], cmdSel = 0, cmdScope = null;

/* The row above the field is the space you are in: its pinned sites first, then the global
   Essentials. It is why the command bar is not the same bar in every space. */
function cmdChips() {
  const s = space(), out = [], seen = new Set();
  const add = (url, title) => {
    const host = hostOf(url);
    if (!host || seen.has(host)) return;
    seen.add(host);
    out.push({ host, url, title: title || host });
  };
  for (const id of s.pinned) { const t = tab(id); if (t) add(t.home || t.url, t.custom || t.title); }
  for (const e of state.essentials) add(e.url, e.title);
  return out.slice(0, 6);
}

function renderChips() {
  const chips = cmdChips();
  $('#cmdChips').replaceChildren(...chips.map(c => h('button', {
    class: 'cmd-chip' + (cmdScope === c.host ? ' on' : ''), title: `${c.title} — ${c.host}`, dataset: { host: c.host },
    onpointerdown: e => { e.preventDefault(); cmdScope = cmdScope === c.host ? null : c.host; renderChips(); cmdUpdate(); $('#cmdInput').focus(); },
  }, favicon(c.url, 18))), h('button', {
    class: 'cmd-chip cmd-chip-add', title: 'Add the current tab to Essentials',
    onpointerdown: e => {
      e.preventDefault();
      const t = activeTab();
      if (!t) return toast('No tab to add');
      addEssential(t.url, t.custom || t.title); renderChips(); cmdUpdate();
    },
  }, h('span', { innerHTML: '<svg viewBox="0 0 16 16"><path d="M8 3.6v8.8M3.6 8h8.8"/></svg>' })));
  $('#cmdScope').hidden = !cmdScope;
  if (cmdScope) $('#cmdScope').replaceChildren(favicon(chips.find(c => c.host === cmdScope)?.url || 'https://' + cmdScope, 14), h('span', {}, siteName(cmdScope)),
    h('button', { type: 'button', class: 'cmd-scope-x', title: 'Search everything (Delete)', 'aria-label': 'Remove the site filter',
      onpointerdown: e => { e.preventDefault(); clearCmdScope(); } },
      h('span', { innerHTML: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>' })));
  $('#cmdInput').placeholder = cmdScope ? `Search ${siteName(cmdScope)}` : 'Search tabs, bookmarks, history or the web';
  $('#cmdFoot').textContent = cmdScope
    ? `Searching ${siteName(cmdScope)} · Delete for everything · Tab for the next site · Esc to close`
    : 'Tab to scope to a site · ↵ to open · Esc to close';
}

function clearCmdScope() { cmdScope = null; renderChips(); cmdUpdate(); $('#cmdInput').focus(); }

function openCmd(mode = 'new') {
  closeAll();
  cmdMode = mode;
  cmdScope = null;
  veilOn();
  const input = $('#cmdInput');
  input.value = mode === 'edit' && activeTab() ? activeTab().url : '';
  $('#cmdbar').hidden = false;
  renderChips();
  input.focus(); input.select();
  cmdUpdate();
}
let cmdRunning = false;
function closeCmd() { if (!cmdRunning) pendingSplit = null; if (!$('#cmdbar').hidden) { $('#cmdbar').hidden = true; cmdScope = null; veilOff(); closePeekIfIdle(); } }
/* Typing the start of a site's name offers to search that site: "redd" gives "Search Reddit", and Tab
   moves into it. The names come from the sites you know: built in, Essentials, open tabs and history. */
function siteHint(q) {
  if (!q || q.length < 2 || /\s/.test(q)) return null;
  const known = new Map();
  for (const [host, name] of Object.entries(SITE_NAMES)) known.set(host, name);
  for (const e of state.essentials) known.set(hostOf(e.url), siteName(e.url));
  for (const t of Object.values(state.tabs)) known.set(hostOf(t.url), siteName(t.url));
  for (const x of state.history.slice(0, 300)) known.set(hostOf(x.url), siteName(x.url));
  for (const [host, name] of known) if (host && name.toLowerCase().startsWith(q)) return { host, name };
  for (const [host, name] of known) if (host && host.replace(/^(www|mail|news|en|m)\./, '').startsWith(q)) return { host, name };
  return null;
}
function scopeTo(host) {
  cmdScope = host;
  $('#cmdInput').value = '';
  renderChips(); cmdUpdate(); $('#cmdInput').focus();
}
function cmdUpdate() {
  const raw = $('#cmdInput').value;
  const q = raw.trim().toLowerCase();
  const text = raw.trim();
  const items = [];
  const match = (...xs) => q.split(/\s+/).every(w => xs.some(x => (x || '').toLowerCase().includes(w)));
  const scope = cmdScope;
  const inScope = u => !scope || hostOf(u) === scope;
  const hint = !scope && q ? siteHint(q) : null;
  if (hint) items.push({ kind: 'sitehint', fav: 'https://' + hint.host, label: `Search ${hint.name}`, meta: 'Press Tab', keep: true, run: () => scopeTo(hint.host) });
  if (scope && !q) items.push({ kind: 'open', fav: 'https://' + scope, label: `Open ${siteName(scope)}`, meta: 'Open', run: () => openTab('https://' + scope) });
  if (q) {
    const url = scope
      ? SEARCH[state.settings.search] + encodeURIComponent(`${text} site:${scope}`)
      : toUrl(text);
    const isSearch = !scope && url.startsWith(SEARCH[state.settings.search]);
    items.push({
      kind: 'search', glyph: isSearch || scope ? '⌕' : '↗',
      label: scope ? `Search ${siteName(scope)} for “${text}”` : isSearch ? `Search “${text}”` : url,
      meta: cmdMode === 'edit' ? 'Open here' : 'Search',
      run: () => cmdMode === 'edit' && activeTab() ? navigate(space().active, url) : openTab(url),
    });
  }
  const seen = new Set();
  for (const t of Object.values(state.tabs)) {
    if (scope && !inScope(t.url)) continue;
    if (q ? match(t.title, t.url, t.custom) : t.space === state.activeSpace) {
      const named = t.custom || t.title;
      items.push({ kind: 'tab', fav: t.url, label: named || siteName(t.url), meta: named ? (t.space ? 'Switch to Tab' : 'Essential') : 'Open website', run: () => activate(t.id) });
      seen.add(t.url);
    }
  }
  if (q) {
    for (const s of state.spaces) if (match(s.name)) items.push({ kind: 'space', glyph: s.icon, label: s.name, meta: 'Space', run: () => switchSpace(s.id) });
    for (const b of state.bookmarks) if (!seen.has(b.url) && inScope(b.url) && match(b.title, b.url, b.note, b.topic)) {
      items.push({ kind: 'bookmark', fav: b.url, label: b.title || siteName(b.url), meta: b.title ? 'Bookmark' : 'Open website', run: () => openTab(b.url) }); seen.add(b.url);
    }
    for (const x of state.history) if (!seen.has(x.url) && inScope(x.url) && match(x.title, x.url)) {
      items.push({ kind: 'history', fav: x.url, label: x.title || siteName(x.url), meta: x.title ? 'History' : 'Open website', run: () => openTab(x.url) }); seen.add(x.url);
      if (items.length > 40) break;
    }
  }
  for (const [label, run, glyph] of ACTIONS) if (!scope && (q ? match(label) : items.length < 9)) items.push({ kind: 'cmd', glyph, label, meta: 'Command', run });
  if (q && !scope && /^ask\b|\?$/.test(q)) items.splice(1, 0, { kind: 'ask', glyph: '✦', label: `Ask Rainbow: ${text}`, meta: 'Ctrl+E', run: () => Rainbow.ask?.open(text.replace(/^ask\s*/i, '')) });
  cmdItems = items.slice(0, 12); cmdSel = 0;
  $('#cmdResults').replaceChildren(...cmdItems.map((it, i) => h('li', {
    class: (i === cmdSel ? 'sel ' : '') + 'k-' + it.kind, role: 'option', 'aria-selected': String(i === cmdSel),
    onpointerdown: e => { e.preventDefault(); cmdRun(i); }, onpointermove: () => cmdPick(i),
  }, it.fav ? favicon(it.fav, 16) : h('span', { class: 'glyph' }, it.glyph), h('span', { class: 't' }, it.label), h('span', { class: 'k' }, it.meta))));
}
function cmdPick(i) {
  cmdSel = i;
  [...$('#cmdResults').children].forEach((li, j) => { li.classList.toggle('sel', j === i); li.setAttribute('aria-selected', String(j === i)); });
}
function cmdRun(i) { const it = cmdItems[i]; if (it?.keep) return it.run(); cmdRunning = true; closeCmd(); it?.run(); cmdRunning = false; }
$('#cmdInput').addEventListener('input', cmdUpdate);
$('#cmdInput').addEventListener('keydown', e => {
  // The bar owns its keys while the field has focus. Without this, Escape reached the window
  // handler below, which calls closeAll(): the scope was dropped and the whole bar closed in the
  // same keystroke, so "Esc drops the scope first" never happened.
  e.stopPropagation();
  if (e.key === 'ArrowDown') { e.preventDefault(); cmdPick(Math.min(cmdSel + 1, cmdItems.length - 1)); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); cmdPick(Math.max(cmdSel - 1, 0)); }
  else if (e.key === 'Tab' && !cmdScope && siteHint(e.currentTarget.value.trim().toLowerCase())) { e.preventDefault(); scopeTo(siteHint(e.currentTarget.value.trim().toLowerCase()).host); }
  else if (e.key === 'Tab') {
    // Tab walks the row of sites: all → first → second → … → all. The reference behaviour is
    // "press Tab to search here", and the chip you land on is the answer to "here".
    e.preventDefault();
    const chips = cmdChips();
    if (!chips.length) return;
    const i = chips.findIndex(c => c.host === cmdScope);
    cmdScope = i === -1 ? chips[0].host : (chips[i + 1]?.host ?? null);
    renderChips(); cmdUpdate();
  }
  else if ((e.key === 'Delete' && cmdScope) || (e.key === 'Backspace' && cmdScope && !e.currentTarget.value)) { e.preventDefault(); clearCmdScope(); }
  else if (e.key === 'Enter') { e.preventDefault(); cmdRun(cmdSel); }
  else if (e.key === 'Escape') { e.preventDefault(); if (cmdScope) { cmdScope = null; renderChips(); cmdUpdate(); } else closeCmd(); }
});

/* ---------------- views, sidebar, layout ---------------- */

function setView(v) {
  view = v;
  $('#canvasView').hidden = v !== 'canvas';
  $('#settingsView').hidden = v !== 'settings';
  $('#page').hidden = v !== 'page';
  syncPage();
  if (v === 'canvas') Rainbow.canvas?.show(); else Rainbow.canvas?.hide?.();
  render();
}
function toggleSidebar() {
  // A native page can't animate in step with CSS, so in the app the layout snaps and the
  // page is placed once; the animated grid stays for the browser preview.
  const app = $('#app');
  // An overlay cannot survive the column changing under it: drop it before the grid moves,
  // or the chrome stays clipped and raised over the widened page.
  clearTimeout(peekOut); clearTimeout(peekGone);
  app.classList.remove('peek', 'peek-out', 'rail-grow');
  railGrow = false;
  sidebarOverlay(false);
  if (NATIVE) app.classList.add('instant');
  app.classList.toggle('collapsed');
  // In the app, send the new rectangle in this same task instead of waiting for the next
  // animation frame: the page and the chrome then land in the same composite, instead of
  // leaving one frame of empty page-card between them.
  if (NATIVE) doSync(); else syncPage();
  // Two quick toggles used to leave the second one animating: the first timeout removed the
  // class while the second change was still in flight. Each toggle gets its own deadline.
  clearTimeout(instantTimer);
  if (NATIVE) instantTimer = setTimeout(() => app.classList.remove('instant'), 50);
}
new ResizeObserver(syncPage).observe($('#pageCard'));
$('#app').addEventListener('transitionend', syncPage);

function closeAll() {
  closeMenu(); closeCmd(); closePanel(); closeNewSpace(); closeSitePop(); closeShotTool();
  Rainbow.ask?.close(); closeNowPlaying(); closeRecents();
  // Settings is a view in the page frame, not an overlay: Escape and the other overlays must
  // still be able to leave it.
  if (view === 'settings') setView('page');
}

/* ---------------- input ---------------- */

function onKey(e) {
  const mod = e.ctrlKey || e.metaKey;
  if (peek && (e.key === 'Escape' || (mod && e.key === 'w'))) { e.preventDefault?.(); return closePeek(); }
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const t = activeTab();
  const run = fn => { e.preventDefault(); fn(); };
  if (e.altKey && !mod && k === 'ArrowLeft' && t) return run(() => send({ t: 'exec', id: t.id, js: 'history.back()' }));
  if (e.altKey && !mod && k === 'ArrowRight' && t) return run(() => send({ t: 'exec', id: t.id, js: 'history.forward()' }));
  if (!mod) return;
  if (k === 't' && e.shiftKey) return run(reopenClosed);
  if (k === 't') return run(() => openCmd('new'));
  if (k === 'l') return run(() => openCmd('edit'));
  if (k === 'w') return run(() => t && closeTab(t.id));
  if (k === 'r') return run(() => t && send({ t: 'exec', id: t.id, js: 'location.reload()' }));
  if (k === 's' && e.shiftKey) return run(openShotTool);
  if (k === 's') return run(toggleSidebar);
  if (k === 'd' && e.shiftKey) return run(() => t && pinTab(t.id, !t.home));
  if (k === 'd') return run(() => t && Rainbow.canvas?.saveTab(t.id));
  if (k === 'e') return run(() => (Rainbow.ask?.isOpen() ? Rainbow.ask.close() : Rainbow.composer?.toggle()));
  if (k === 'k' && e.shiftKey) return run(() => setView(view === 'canvas' ? 'page' : 'canvas'));
  if (k === 'b') return run(openBoost);
  if (k === ',') return run(() => (view === 'settings' ? setView('page') : openSettings()));
  if (k === '[' && t) return run(() => send({ t: 'exec', id: t.id, js: 'history.back()' }));
  if (k === ']' && t) return run(() => send({ t: 'exec', id: t.id, js: 'history.forward()' }));
  if (k === 'Tab') return run(() => cycleTab(e.shiftKey ? -1 : 1));
  if (k === 'i' && e.shiftKey && t) return run(() => send({ t: 'devtools', id: t.id }));
  if (/^[1-9]$/.test(k)) return run(() => state.spaces[+k - 1] && switchSpace(state.spaces[+k - 1].id));
}
addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeAll(); return; }
  if (e.target.closest?.('input,textarea,select') && !(e.ctrlKey || e.metaKey)) return;
  onKey(e);
});

$('#urlPill').addEventListener('click', e => { if (!e.target.closest('button')) openCmd('edit'); });
$('#urlPill').addEventListener('keydown', e => { if (e.key === 'Enter') openCmd('edit'); });
$('#copyLink').onclick = async e => {
  e.stopPropagation();
  const t = activeTab();
  if (!t) return;
  flashUrl('Link copied');                    // say it before the await: no dead click
  const ok = await copyText(t.url, false);
  if (!ok) flashUrl('Could not copy', false);
};
$('#linkOpts').onclick = e => {
  e.stopPropagation();
  openSitePop(e.currentTarget);
};
$('#newTabRow').onclick = () => openCmd('new');
$('#newTabRow').oncontextmenu = e => { e.preventDefault(); newTabMenu(e.clientX, e.clientY); };
$('#clearToday').onclick = clearToday;
$('#toggleSidebar').onclick = toggleSidebar;
$('#appMenuBtn').onclick = e => { const r = e.currentTarget.getBoundingClientRect(); appMenu(r.left, r.bottom + 4); };
$('#back').onclick = () => activeTab() && send({ t: 'exec', id: activeTab().id, js: 'history.back()' });
$('#forward').onclick = () => activeTab() && send({ t: 'exec', id: activeTab().id, js: 'history.forward()' });
$('#reload').onclick = () => activeTab() && send({ t: 'exec', id: activeTab().id, js: 'location.reload()' });
$('#newSpaceBtn').onclick = e => newItemMenu(e.currentTarget);
$('#spaceName').onclick = e => spaceMenu(space(), e.clientX, e.clientY + 8);
$('#spaceMenuBtn').onclick = e => spaceMenu(space(), e.clientX, e.clientY + 8);
$('#saveBtn').onclick = () => activeTab() && Rainbow.canvas?.saveTab(activeTab().id);
$('#canvasBtn').onclick = () => { closeRecents(); setView(view === 'canvas' ? 'page' : 'canvas'); };
$('#panelClose').onclick = closePanel;
$('#veil').onclick = closeAll;

// Two-finger horizontal swipe on the sidebar changes space.
let swipe = 0, swipeLock = 0;
$('#sidebar').addEventListener('wheel', e => {
  if (Math.abs(e.deltaX) < Math.abs(e.deltaY) || Date.now() < swipeLock) return;
  swipe += e.deltaX;
  if (Math.abs(swipe) > 120) { stepSpace(swipe > 0 ? 1 : -1); swipe = 0; swipeLock = Date.now() + 500; }
}, { passive: true });

// Collapsed sidebar: hovering the window edge peeks it. The peek is an overlay over the page,
// not a grid column, so the page is never resized (that resize was the jitter) and the sidebar
// sits over the window the usual way. A native page would cover an HTML overlay, so the
// shell clips the chrome webview to the sidebar column and raises it while the overlay is up.
let peekOut = 0, peekGone = 0, sideOver = false, instantTimer = 0;
/* The peek's width in logical px: the whole sidebar, or compact mode's fraction of it. */
const peekW = () => state.settings.layout === 'compact'
  ? Math.round(state.settings.sideWidth * (state.settings.compactPeek ?? .5))
  : state.settings.sideWidth;
function sidebarOverlay(on, w, force) {
  if (sideOver === on && !force) return;
  sideOver = on;
  // The floating sidebar stops one inset short of the column's edge; clipping to it exactly leaves no dark strip beside it.
  send({ t: 'chrome', over: { on, w: (w || peekW()) - 8, right: state.settings.side === 'right' } });
}
// Leaving the sidebar is not a snap. The pointer gets a moment of leeway to come back — you
// cross the panel on the way to the page all the time — and the panel fades out instead of
// vanishing in one frame.
const PEEK_LEAVE = 420, PEEK_FADE = 260;   // PEEK_FADE matches --motion in the CSS
let shrinkTimer = 0;
function keepPeek() {
  clearTimeout(peekOut); clearTimeout(peekGone);
  if (shrinkTimer) { clearInterval(shrinkTimer); shrinkTimer = 0; sidebarOverlay(true, peekW(), true); }
  $('#app').classList.remove('peek-out');
}
/* Leaving natively: the sidebar slides out and the clip narrows with its edge, a little ahead of it, so no
   strip of the chrome's own dark page card is ever drawn where the sidebar was. */
function shrinkPeek(ms) {
  const from = peekW(), t0 = performance.now();
  clearInterval(shrinkTimer);
  shrinkTimer = setInterval(() => {
    const t = Math.min(1, (performance.now() - t0) / ms + .1), left = (1 - t) ** 4;
    if (t >= 1 || from * left < 12) { clearInterval(shrinkTimer); shrinkTimer = 0; return; }
    sidebarOverlay(true, Math.round(from * left) + 8, true);
  }, 12);
}
const openPeekSidebar = () => {
  clearTimeout(peekOut);
  const app = $('#app');
  if (!app.classList.contains('collapsed')) return;
  if (app.classList.contains('peek-out')) { keepPeek(); return; }  // caught it mid-fade
  if (app.classList.contains('peek')) return;
  // The bar and the sidebar are never out together. Whichever the pointer reached first owns
  // the corner; the other waits until it has gone.
  if (state.settings.layout === 'compact' && app.classList.contains('cbar-near')) return;
  app.classList.add('peek');
  sidebarOverlay(true, peekW());
  cbarMsg();   // the bar rides the sidebar out, so its strip follows
};
const overlayOpen = () => !!surfMenu || !$('#menu').hidden || !$('#cmdbar').hidden || !$('#panel').hidden || !$('#ask').hidden;
const closePeekSidebar = (delay = PEEK_LEAVE) => {
  clearTimeout(peekOut);
  // The create panel *is* the sidebar while it is open: it owns the peek, and typing in the
  // name field must not be interrupted by the pointer wandering off to the page.
  if ($('#sidebar').classList.contains('making')) return;
  peekOut = setTimeout(() => {
    const app = $('#app');
    if (!app.classList.contains('peek') || app.classList.contains('peek-out') || overlayOpen()) return;
    app.classList.add('peek-out');
    if (NATIVE) shrinkPeek(PEEK_FADE);
    peekGone = setTimeout(() => {
      app.classList.remove('peek', 'peek-out');
      sidebarOverlay(false);
      cbarMsg();   // the bar's strip goes with the sidebar
    }, PEEK_FADE);
  }, delay);
};
// A menu opened during the hide delay used to keep the peek open forever: nothing
// re-armed the timer once the menu closed.
function closePeekIfIdle() {
  if (overlayOpen() || $('#sidebar').classList.contains('making') || !$('#app').classList.contains('peek')) return;
  if ($('#sidebar').matches(':hover')) return;
  closePeekSidebar(80);
}
$('#edgeHover').addEventListener('pointerenter', openPeekSidebar);
$('#sidebar').addEventListener('pointerenter', keepPeek);
$('#sidebar').addEventListener('pointerleave', () => closePeekSidebar());
$('#topbar').addEventListener('pointerenter', () => { if ($('#app').classList.contains('collapsed')) closePeekSidebar(); });
$('#pageCard').addEventListener('pointerenter', () => closePeekSidebar());
addEventListener('blur', () => closePeekSidebar(0));

/* Compact mode's peek starts at half the sidebar and grows to all of it. The handle is the
   sidebar's own right edge — the chrome only exists inside the clipped column, so the handle
   has to live inside it too. */
$('#peekGrow').addEventListener('pointerdown', e => {
  if (state.settings.layout !== 'compact') return;
  e.preventDefault();
  const el = e.currentTarget, right = state.settings.side === 'right';
  el.classList.add('on');
  try { el.setPointerCapture(e.pointerId); } catch { /* a pointer with no capture still reports to the window */ }
  const move = ev => {
    const x = right ? innerWidth - ev.clientX : ev.clientX;
    const k = Math.min(1, Math.max(.5, x / state.settings.sideWidth));
    state.settings.compactPeek = k;
    // Live: the width follows the pointer, and the shell's clip follows the width.
    root.style.setProperty('--peek-w', `calc(var(--side-w) * ${k.toFixed(3)})`);
    sidebarOverlay(true, Math.round(state.settings.sideWidth * k), true);
  };
  const up = () => {
    el.classList.remove('on');
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    removeEventListener('pointercancel', up);
    save();
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
  addEventListener('pointercancel', up);
});

// The compact bar: its own buttons, and its own menu on right-click.
$('#cbNewTab').onclick = () => openCmd('new');
$('#splitBtn').innerHTML = ICO_SPLIT.right;
$('#splitBtn').onclick = e => {
  const t = activeTab();
  if (!t) return toast('Open a page to split');
  const r = e.currentTarget.getBoundingClientRect();
  splitMenu(t.id, Math.min(r.left, innerWidth - 250), r.bottom + 6);
};
$('#cbar').addEventListener('contextmenu', e => { if (e.target.closest('button')) return; e.preventDefault(); compactMenu(e.clientX, e.clientY); });
$('#cbar').addEventListener('dblclick', e => { if (!e.target.closest('button')) send({ t: 'win', op: 'max' }); });

// Sidebar width.
$('#sidebarResizer').addEventListener('pointerdown', e => {
  const startX = e.clientX, startW = state.settings.sideWidth, dir = state.settings.side === 'right' ? -1 : 1;
  const move = ev => { state.settings.sideWidth = Math.max(200, Math.min(sideCap(), startW + (ev.clientX - startX) * dir)); fitSide(); };
  const up = () => { removeEventListener('pointermove', move); save(); syncPage(); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up, { once: true });
});

// Window chrome (frameless on Windows). Closing writes the session first: the shell exits the
// event loop at once, so a pending debounced save would be lost.
for (const b of document.querySelectorAll('[data-win]')) b.onclick = () => {
  if (b.dataset.win === 'close') flush();
  send({ t: 'win', op: b.dataset.win });
};
addEventListener('beforeunload', flush);
if (root.dataset.os === 'windows') { // caption buttons, not macOS traffic lights
  const glyph = { close: '<path d="m3.5 3.5 9 9m0-9-9 9"/>', min: '<path d="M3 8h10"/>', max: '<rect x="3.5" y="3.5" width="9" height="9" rx="1.2"/>' };
  const fr = /^fr/i.test(navigator.language), names = fr ? { close: 'Fermer', min: 'Réduire', max: 'Agrandir' } : { close: 'Close', min: 'Minimize', max: 'Maximize' };
  for (const b of document.querySelectorAll('.wc')) { b.innerHTML = `<svg viewBox="0 0 16 16">${glyph[b.dataset.win]}</svg>`; b.title = names[b.dataset.win]; b.setAttribute('aria-label', names[b.dataset.win]); }
}
document.addEventListener('pointerdown', e => {
  if (!NATIVE || e.button !== 0) return;
  const edge = e.target.closest?.('#edges i');
  if (edge) { e.preventDefault(); return send({ t: 'win', op: 'resize', dir: edge.dataset.dir }); }
  if (e.target.matches?.('[data-drag], .side-bottom, .space-head, .tab-scroll, body, .app, .sidebar, #topbar, .nav, .win-controls, .tb-right, .cbar, .cb-left, .cb-mid, .cb-right, .cb-slot')) send({ t: 'win', op: 'drag' });
});
$('.side-top').addEventListener('dblclick', e => { if (!e.target.closest('button')) send({ t: 'win', op: 'max' }); });
$('#topbar').addEventListener('dblclick', e => { if (!e.target.closest('button')) send({ t: 'win', op: 'max' }); });

// Right-clicking the frame itself (title bar, sidebar background, the inset border around
// the page) opens the window menu, like the sidebar menu.
document.addEventListener('contextmenu', e => {
  const t = e.target;
  if (!t.closest?.('#app')) return;
  if (t.closest('#urlPill')) {
    e.preventDefault();
    if (activeTab()) linkMenu(e.clientX, e.clientY);
    return;
  }
  if (t.closest('.tab, .essential, button, input, textarea, select, a, iframe, #menu, #panel, .cmdbar, .veil, .tab-scroll, #pageCard')) return;
  e.preventDefault();
  frameMenu(e.clientX, e.clientY);
});

/* drag and drop: reorder, pin by dropping in Pinned, Essentials, other spaces, Canvas */
const ESS_MAX = 12;
/* How many tiles fit across the sidebar at its current width: four when there is room, three in
   the middle, two when it is squeezed. The count is recomputed by fitSide() as the sidebar is
   dragged, so the row reflows instead of shrinking the tiles forever. */
function essCols(n) {
  if (n <= 1) return 1;
  const w = Math.min(state.settings.sideWidth, sideCap());
  const cap = w < 220 ? 2 : w < 300 ? 3 : 4;
  return Math.max(1, Math.min(cap, n));
}
function setEssCols(n) {
  const box = $('#essentials');
  if (!box) return;
  box.style.setProperty('--cols', essCols(n));
  box.style.setProperty('--ess-r', 'var(--radius)');
}
let dragId = 0, essGhost = null, essGhostFor = 0;
function hideEssGhost() {
  if (!essGhost) return;
  essGhost.remove();
  essGhost = null;
  essGhostFor = 0;
  setEssCols(state.essentials.length);
}
// While a tab is over Essentials, preview the slot it will take: a glass tile
// with the tab's icon and title, as if the drop had already happened.
function showEssGhost(t) {
  const box = $('#essentials');
  if (!t || t.ess || state.essentials.length >= ESS_MAX) return hideEssGhost();
  if (essGhost && !essGhost.isConnected) { essGhost = null; essGhostFor = 0; }
  const name = t.custom || t.title || hostOf(t.url);
  if (!essGhost) {
    essGhost = h('div', { class: 'ess-ghost', 'aria-hidden': 'true' });
    box.append(essGhost);
    setEssCols(state.essentials.length + 1);
  }
  if (essGhostFor !== t.id) {
    essGhostFor = t.id;
    essGhost.replaceChildren(h('span', { class: 'ess-ghost-chip' },
      favicon(t.home || t.url, 16), h('span', { class: 'ess-ghost-name' }, name)));
  }
}
function dropIndex(list, y) {
  const rows = [...list.querySelectorAll('.tab:not(.dragging)')];
  const i = rows.findIndex(r => y < r.getBoundingClientRect().top + r.offsetHeight / 2);
  return i < 0 ? rows.length : i;
}
// A folder dragged back out to the top of Pinned.
$('#pinnedList').addEventListener('drop', e => {
  const fid = +e.dataTransfer.getData('rainbow/folder'), f = space().folders.find(x => x.id === fid);
  if (f) { f.parent = null; render(); save(); }
});
for (const list of [$('#pinnedList'), $('#todayList')]) {
  list.addEventListener('dragover', e => {
    if (!e.dataTransfer.types.some(x => x === 'rainbow/tab' || x === 'text/uri-list' || (x === 'rainbow/folder' && list.id === 'pinnedList'))) return;
    e.preventDefault();
    list.classList.add('drop-target');
  });
  list.addEventListener('dragleave', () => list.classList.remove('drop-target'));
  list.addEventListener('drop', e => {
    e.preventDefault();
    list.classList.remove('drop-target');
    const id = +e.dataTransfer.getData('rainbow/tab');
    const pinned = list.dataset.section === 'pinned';
    if (id && tab(id)) {
      const t = tab(id);
      if (t.ess) return;
      if (t.space !== state.activeSpace) moveTabToSpace(id, state.activeSpace);
      pinTab(id, pinned, dropIndex(list, e.clientY));
    } else {
      const url = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const t = url && openTab(url.split('\n')[0], { focus: false });
      if (t && pinned) pinTab(t.id, true, dropIndex(list, e.clientY));
    }
  });
}
const essWrap = $('#essentials').parentElement;
essWrap.addEventListener('dragover', e => {
  if (!(e.target.closest('#essentials') || $('#essentials').contains(e.target))) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  showEssGhost(tab(dragId));
});
essWrap.addEventListener('dragleave', e => { if (!essWrap.contains(e.relatedTarget)) hideEssGhost(); });
$('#essentials').addEventListener('drop', e => {
  e.preventDefault();
  hideEssGhost();
  const t = tab(+e.dataTransfer.getData('rainbow/tab'));
  if (t && !t.ess) { addEssential(t.home || t.url, t.custom || t.title); if (!t.home) closeTab(t.id); }
});
$('#urlPill').addEventListener('dragover', e => e.preventDefault()); // drop target for an empty Essentials row
$('#urlPill').addEventListener('drop', e => { e.preventDefault(); const t = tab(+e.dataTransfer.getData('rainbow/tab')); if (t && !state.essentials.length) addEssential(t.url, t.title); });
$('#spaceDots').addEventListener('dragover', e => { if (e.target.closest('.dot')) e.preventDefault(); });
$('#spaceDots').addEventListener('drop', e => {
  const dot = e.target.closest('.dot'), id = +e.dataTransfer.getData('rainbow/tab');
  if (dot && id) { e.preventDefault(); moveTabToSpace(id, +dot.dataset.space); toast('Moved'); }
});
$('#canvasBtn').addEventListener('dragover', e => e.preventDefault());
$('#canvasBtn').addEventListener('drop', e => { e.preventDefault(); const id = +e.dataTransfer.getData('rainbow/tab'); if (id) Rainbow.canvas?.saveTab(id); });

// Drag the gap between split panes to resize them.
$('#splitDivider').addEventListener('pointerdown', e => {
  const div = e.currentTarget, sp = space(), r = $('#pageCard').getBoundingClientRect(), col = sp.splitDir === 'col';
  try { div.setPointerCapture(e.pointerId); } catch { /* the window still reports the move */ }
  let last = -1;
  const move = ev => {
    // Resizing two live pages is the heaviest thing the shell does, so the ratio moves in 4 px steps.
    const raw = col ? (ev.clientY - r.top) / r.height : (ev.clientX - r.left) / r.width;
    const px = Math.round(raw * (col ? r.height : r.width) / 4) * 4;
    if (px === last) return;
    last = px;
    sp.ratio = Math.min(.8, Math.max(.2, px / (col ? r.height : r.width)));
    syncPage();
  };
  div.addEventListener('pointermove', move);
  div.addEventListener('pointerup', () => { div.removeEventListener('pointermove', move); save(); }, { once: true });
});
// In a plain browser the panes are iframes: clicking into one blurs this window.
addEventListener('blur', () => setTimeout(() => {
  const f = document.activeElement;
  if (f?.tagName === 'IFRAME') focusPane(+Object.keys(frames).find(id => frames[id] === f));
}));

/* ---------------- peek ---------------- */
/* Shift+click a link: it opens in a floating window over the dimmed page. The window is a
   real tab-less webview, so it is placed by the shell like any pane; the buttons live in
   the chrome just outside its right edge. */
let peek = null;
function peekRect() {
  const r = $('#pageCard').getBoundingClientRect();
  const w = Math.min(1100, r.width * .8), hgt = r.height * .88;
  return { id: peek.id, x: r.left + (r.width - w) / 2, y: r.top + (r.height - hgt) / 2, w, h: hgt, top: true };
}
async function openPeek(url) {
  if (peek || view !== 'page' || !/^https?:\/\//i.test(url)) return;
  await veilOn('full');
  peek = { id: uid(), url };
  live.add(peek.id);
  send({ t: 'open', id: peek.id, url, profile: profileOf(space()).id });
  const r = peekRect(), ui = $('#peekUi');
  ui.style.left = Math.min(r.x + r.w + 12, innerWidth - 48) + 'px';
  ui.style.top = r.y + 'px';
  ui.hidden = false;
  syncPage();
}
function closePeek() {
  if (!peek) return null;
  const { id, url } = peek;
  send({ t: 'close', id }); live.delete(id); frames[id]?.remove();
  peek = null;
  $('#peekUi').hidden = true;
  veilOff();
  syncPage();
  return url;
}
$('#peekClose').onclick = closePeek;
$('#peekOpen').onclick = () => { const u = closePeek(); if (u) openTab(u); };
$('#peekSplit').onclick = () => {
  const a = space().active, u = closePeek();
  if (!u) return;
  const t = openTab(u, { focus: false });
  if (a && t) splitWith(a, t.id);
};
$('#veil').addEventListener('click', () => peek && closePeek());

/* ---------------- now playing + recent files ---------------- */
/* The page reports its media (shell-injected PAGE_MEDIA). A tab only earns a card once it
   has actually played something; the card stays through pauses and disappears while its
   tab is in front, until the tab is closed. State lives only in this window. */
const media = new Map();          // tab id -> { s, at, dismissed, played }
let npOpen = false, npTimer = 0, npSig = '';
let arcOpen = false, arcTimer = 0;

const ICON_PLAY = '<svg viewBox="0 0 16 16"><path d="M5.2 3.2v9.6L12.6 8z" fill="currentColor" stroke="none"/></svg>';
const ICON_PAUSE = '<svg viewBox="0 0 16 16"><path d="M5 3h2v10H5zM9 3h2v10H9z" fill="currentColor" stroke="none"/></svg>';
const ICON_REW = '<svg viewBox="0 0 16 16"><path d="M7.6 4.2v7.6L3.2 8z" fill="currentColor" stroke="none"/><path d="M13 4.2v7.6L8.6 8z" fill="currentColor" stroke="none"/></svg>';
const ICON_FWD = '<svg viewBox="0 0 16 16"><path d="M3 4.2v7.6L7.4 8z" fill="currentColor" stroke="none"/><path d="M8.4 4.2v7.6L12.8 8z" fill="currentColor" stroke="none"/></svg>';
const ICON_SOUND = '<svg viewBox="0 0 16 16"><path d="M3 6.2h2.4L9 3v10L5.4 9.8H3z"/><path d="M11.4 6a3 3 0 0 1 0 4M12.9 4.4a5.2 5.2 0 0 1 0 7.2"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 16 16"><path d="M3 6.2h2.4L9 3v10L5.4 9.8H3z"/><path d="m11 6 3.2 3.2M14.2 6 11 9.2"/></svg>';
const ICON_PIP = '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><rect x="8" y="7.8" width="4.6" height="3.6" rx="1"/></svg>';
const ICON_PIP_ON = '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" rx="2"/><rect x="8" y="7.8" width="4.6" height="3.6" rx="1" fill="currentColor" stroke="none"/></svg>';
const ICON_X = '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>';
const ICON_NOTE = '<svg viewBox="0 0 16 16"><path d="M6 12V4.5l6-1.2v7"/><circle cx="4.6" cy="12.2" r="1.6"/><circle cx="10.6" cy="10.6" r="1.6"/></svg>';
const ICON_FILM = '<svg viewBox="0 0 16 16"><rect x="2" y="3.5" width="12" height="9" rx="1.6"/><path d="M5.6 3.5v9M10.4 3.5v9M2 8h12"/></svg>';
const ICON_FILE = '<svg viewBox="0 0 16 16"><path d="M4 2h5l3 3v9H4z"/><path d="M9 2v3.5h3"/></svg>';

function fmtTime(s) {
  s = Math.max(0, Math.floor(isFinite(s) ? s : 0));
  const m = Math.floor(s / 60), h = Math.floor(m / 60);
  const mm = h ? String(m % 60).padStart(2, '0') : m;
  return h ? `${h}:${mm}:${String(s % 60).padStart(2, '0')}` : `${mm}:${String(s % 60).padStart(2, '0')}`;
}
function since(t) {
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
function mediaNow(m) {
  const s = m.s;
  const extra = s.p ? (Date.now() - m.at) / 1000 * (s.r || 1) : 0;
  const t = Math.max(0, s.d ? Math.min(s.d, s.t + extra) : s.t + extra);
  return { ...s, t };
}
function mediaLive() { // cards for background tabs that have played something
  const focused = view === 'page' ? space().active : null;
  return [...media.entries()]
    .filter(([id, m]) => m.played && !m.dismissed && id !== focused)
    // Two players both report every second, so ordering by the last report swapped the cards on
    // every tick. Order by when each started playing, then by tab id, which never changes.
    .sort((a, b) => ((b[1].s.p ? 1 : 0) - (a[1].s.p ? 1 : 0)) || ((b[1].rank || 0) - (a[1].rank || 0)) || (a[0] - b[0]))
    .slice(0, 3);
}
function mediaSend(id, op, v = 0) { send({ t: 'mediaCmd', id, op, v }); }

function paintMedia() {
  const list = mediaLive(), stack = $('#mediaStack');
  const show = list.length > 0 && root.dataset.layout !== 'rail';
  stack.hidden = !show;
  if (!list.length) { closeNowPlaying(); if (npSig) { npSig = ''; stack.replaceChildren(); } return; }
  if (!show && npOpen) closeNowPlaying();
  drawNowPlaying();
}
function sideButtons() {
  paintMedia();
}

function placeSidePop(pop, anchor) {
  const sb = $('.sidebar').getBoundingClientRect(), b = anchor.getBoundingClientRect();
  const w = pop.offsetWidth || 228, h = pop.offsetHeight || 0;
  pop.style.left = Math.max(sb.left + 6, Math.min(b.left, sb.right - w - 6)) + 'px';
  const above = b.height ? innerHeight - b.top + 6 : 8;
  pop.style.bottom = Math.max(8, Math.min(above, innerHeight - h - 8)) + 'px';
}
function openNowPlaying() {
  clearTimeout(npTimer);
  if (!mediaLive().length || root.dataset.layout === 'rail') return;
  closeRecents();
  drawNowPlaying();
  npOpen = true;
  $('#mediaStack').classList.add('open');
}
function closeNowPlaying() {
  npOpen = false;
  clearTimeout(npTimer);
  $('#mediaStack').classList.remove('open');
}
/* Every open tab in every space, in one list you can search by eye. It is a panel rather than a
   popover on the sidebar, so it works when the sidebar is hidden (compact mode). */
function openTabsOverview() {
  const body = () => state.spaces.flatMap(sp => {
    const ids = [...sp.pinned, ...sp.today].filter(tab);
    if (!ids.length) return [];
    return [h('h3', { class: 'set-h' }, `${sp.icon} ${sp.name}`),
      ...ids.map(id => {
        const t = tab(id);
        return h('div', { class: 'ov-row' },
          h('button', { class: 'ov-tab', title: t.url, onclick: () => { closePanel(); if (sp.id !== state.activeSpace) switchSpace(sp.id); activate(id); } },
            favicon(t.home || t.url), h('span', {}, t.custom || t.title || hostOf(t.url))),
          h('button', { class: 'icon-btn sm', 'aria-label': 'Close tab', onclick: e => { closeTab(id); e.currentTarget.closest('.ov-row').remove(); } },
            h('span', { innerHTML: '<svg viewBox="0 0 16 16"><path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/></svg>' })));
      })];
  });
  panel('Tabs', () => { const rows = body(); return rows.length ? rows : [h('p', { class: 'hint' }, 'No tabs are open.')]; });
}
function openRecents() {
  clearTimeout(arcTimer);
  sideButtons();
  if (root.dataset.layout === 'rail' || !drawArchive()) return;
  closeNowPlaying();
  const pop = $('#arcPop');
  clearTimeout(arcHide); pop.classList.remove('out');
  pop.hidden = false;
  arcOpen = true;
  placeSidePop(pop, $('#canvasBtn'));
  // It is a wash over the bottom of the sidebar, covering the spaces row, not a card beside the button.
  const sb = $('.sidebar').getBoundingClientRect();
  Object.assign(pop.style, { left: sb.left + 'px', width: sb.width + 'px', bottom: Math.max(0, innerHeight - sb.bottom) + 'px' });
}
let arcHide = 0;
function closeRecents() {
  arcOpen = false; clearTimeout(arcTimer);
  const pop = $('#arcPop');
  if (pop.hidden || pop.classList.contains('out')) return;
  pop.classList.add('out');
  clearTimeout(arcHide);
  arcHide = setTimeout(() => { pop.hidden = true; pop.classList.remove('out'); }, 300);
}

function mediaCmdCard(id, op, v) { // optimistic local state, then the page confirms
  const m = media.get(id);
  if (!m) return;
  const now = mediaNow(m).t;
  if (op === 'toggle') { m.s.t = now; m.s.p = !m.s.p; m.at = Date.now(); if (m.s.p) m.rank = m.at; m.s.dismissed = false; }
  else if (op === 'seek') { m.s.t = v; m.at = Date.now(); }
  else if (op === 'mute') m.s.m = !m.s.m;
  m.dismissed = false;
  mediaSend(id, op, v);
  updateNowPlaying();
}
function stopMedia(id) {
  const m = media.get(id);
  if (!m) return;
  if (m.s.pip) mediaSend(id, 'exitpip');
  mediaSend(id, 'stop');
  m.s.p = false; m.s.pip = false; m.dismissed = true; m.at = Date.now();
  updateNowPlaying();
  paintMedia();
}
function togglePip(id) {
  const m = media.get(id);
  if (!m) return;
  if (m.s.pip) { mediaSend(id, 'exitpip'); m.s.pip = false; }
  else {
    m.s.pip = true; // optimistic; the page's next report is the truth
    const pane = panes.find(p => p.id === id) || (() => {
      const r = $('#pageCard').getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    })();
    const msg = {
      t: 'mediaCmd', id, op: 'pip', v: 0,
      rect: { x: pane.x + (m.s.x || 0), y: pane.y + (m.s.y || 0), w: m.s.w || 0, h: m.s.h || 0 },
      pane: { x: pane.x, y: pane.y, w: pane.w || 0, h: pane.h || 0 },
    };
    send(msg);
  }
  updateNowPlaying();
}

function npCard(id, m, depth = 0) {
  const s = mediaNow(m), n = tab(id), url = n?.url || '';
  const card = h('div', { class: 'np-card', dataset: { id }, style: `--d:${depth}` });
  if (depth === 0) card.classList.add('front');
  card.addEventListener('click', e => {
    if (e.target.closest('button, .np-bar')) return;
    activate(id);
  });
  const art = s.art
    ? h('img', { class: 'np-art', alt: '', src: s.art })
    : h('div', { class: 'np-art', innerHTML: s.k === 'audio' ? ICON_NOTE : ICON_FILM });
  const title = h('div', { class: 'np-title' }, s.tt || n?.title || hostOf(url));
  const sub = h('div', { class: 'np-sub' }, s.ar || s.al || hostOf(url) || (s.k === 'audio' ? 'Audio' : 'Video'));
  const close = h('button', { class: 'np-x', title: 'Stop and dismiss', 'aria-label': 'Stop and dismiss', innerHTML: ICON_X });
  close.onclick = () => stopMedia(id);
  const top = h('div', { class: 'np-top' }, art, h('div', { class: 'np-meta' }, title, sub), close);

  const fill = h('i');
  const bar = h('div', { class: 'np-bar', title: 'Seek' }, fill);
  bar.addEventListener('pointerdown', e => {
    const cur = media.get(id), r = bar.getBoundingClientRect();
    if (!cur?.s.d) return;
    const v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * cur.s.d;
    cur.s.t = v; cur.at = Date.now();
    mediaSend(id, 'seek', v);
    updateNowPlaying();
  });
  const times = h('div', { class: 'np-times' },
    h('span', { class: 'np-t' }, fmtTime(s.t)),
    h('span', { class: 'np-d' }, s.d ? fmtTime(s.d) : 'LIVE'));

  const btn = (cls, title, html, onclick) => {
    const b = h('button', { class: cls || null, title, innerHTML: html });
    b.onclick = onclick;
    return b;
  };
  const main = btn('np-main', s.p ? 'Pause' : 'Play', s.p ? ICON_PAUSE : ICON_PLAY, () => mediaCmdCard(id, 'toggle'));
  main.dataset.op = 'toggle';
  const mute = btn(null, s.m ? 'Unmute' : 'Mute', s.m ? ICON_MUTED : ICON_SOUND, () => mediaCmdCard(id, 'mute'));
  mute.dataset.op = 'mute';
  mute.classList.toggle('on', !s.m);
  const pip = btn(null, s.pip ? 'Back into the page' : 'Float video', s.pip ? ICON_PIP_ON : ICON_PIP, () => s.pip ? activate(id) : togglePip(id));
  pip.dataset.op = 'pip';
  pip.classList.toggle('on', !!s.pip);
  if (s.k !== 'video') pip.hidden = true;
  const rewind = btn(null, 'Back 10 seconds', ICON_REW, () => mediaSend(id, 'skip', -10));
  const fwd = btn(null, 'Forward 10 seconds', ICON_FWD, () => mediaSend(id, 'skip', 10));

  card.append(top, bar, times, h('div', { class: 'np-ctl' }, rewind, main, fwd, mute, pip));
  return card;
}

function drawNowPlaying() {
  const stack = $('#mediaStack'), list = mediaLive();
  const sig = list.map(([id, m], i) => `${id}|${i}|${Math.round(m.s.d || 0)}|${m.s.art}|${m.s.k}|${m.s.tt}`).join(',');
  if (sig !== npSig) { npSig = sig; stack.replaceChildren(...list.map(([id, m], i) => npCard(id, m, i))); }
  updateNowPlaying();
}
function updateNowPlaying() {
  for (const card of $('#mediaStack').children) {
    const m = media.get(+card.dataset.id);
    if (!m) continue;
    const s = mediaNow(m), pct = s.d ? Math.min(100, s.t / s.d * 100) : 0;
    card.querySelector('.np-bar i').style.width = pct + '%';
    card.querySelector('.np-t').textContent = fmtTime(s.t);
    card.querySelector('.np-d').textContent = s.d ? fmtTime(s.d) : 'LIVE';
    const main = card.querySelector('[data-op="toggle"]');
    main.innerHTML = s.p ? ICON_PAUSE : ICON_PLAY;
    main.title = s.p ? 'Pause' : 'Play';
    const mute = card.querySelector('[data-op="mute"]');
    mute.innerHTML = s.m ? ICON_MUTED : ICON_SOUND;
    mute.title = s.m ? 'Unmute' : 'Mute';
    mute.classList.toggle('on', !s.m);
    const pip = card.querySelector('[data-op="pip"]');
    pip.innerHTML = s.pip ? ICON_PIP_ON : ICON_PIP;
    pip.title = s.pip ? 'Back into the page' : 'Float video';
    pip.classList.toggle('on', !!s.pip);
  }
}

function fmtSize(n) {
  if (!n) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)) + ' ' + u[i];
}

function drawArchive() {
  const pop = $('#arcPop');
  pop.replaceChildren();
  if (root.dataset.layout === 'rail') return false;
  // Files first, canvas saves second, then the three newest of either.
  const files = state.downloads.map(d => ({
    kind: 'file', t: d.t || 0, path: d.path, url: d.url,
    name: (d.path || d.url || '').split(/[\\/]/).pop() || 'Download',
    sub: [fmtSize(d.size), d.url ? hostOf(d.url) : ''].filter(Boolean).join(' — '),
  }));
  const cards = state.bookmarks.map(b => ({
    kind: 'card', t: b.created || 0, image: b.image,
    name: b.title || b.url || 'Untitled',
    sub: [b.url ? hostOf(b.url) : '', since(b.created)].filter(Boolean).join(' — '),
  }));
  const items = [...files, ...cards].sort((a, b) => b.t - a.t).slice(0, 3);
  if (!items.length) return false;
  items.forEach((it, i) => {
    const thumb = it.image
      ? h('div', { class: 'arc-thumb' }, h('img', { alt: '', src: it.image }))
      : h('div', { class: 'arc-thumb' }, h('span', { class: 'arc-file', innerHTML: ICON_FILE }));
    pop.append(h('button', {
      class: 'arc-item', style: `--i:${i}`,
      onclick: () => {
        closeRecents();
        if (it.kind === 'card') setView('canvas');
        else if (it.path) Rainbow.library?.open('downloads');
        else if (it.url) openTab(it.url);
      },
    }, thumb, h('div', { class: 'arc-text' },
      h('div', { class: 'arc-name' }, it.name),
      h('div', { class: 'arc-sub' }, it.sub || (it.kind === 'card' ? 'Canvas' : 'Download')))));
  });
  return true;
}

// The stack opens on hover; a short grace keeps it open while the pointer crosses a gap.
{
  const stack = $('#mediaStack');
  stack.addEventListener('pointerenter', openNowPlaying);
  stack.addEventListener('pointerleave', () => {
    clearTimeout(npTimer);
    npTimer = setTimeout(() => {
      if (stack.matches(':hover')) return;
      closeNowPlaying();
    }, 200);
  });
}
{
  const b = $('#canvasBtn'), p = $('#arcPop');
  b.addEventListener('pointerenter', openRecents);
  b.addEventListener('pointerleave', () => {
    clearTimeout(arcTimer);
    arcTimer = setTimeout(() => {
      if (p.matches(':hover')) return;
      closeRecents();
    }, 180);
  });
  p.addEventListener('pointerenter', () => clearTimeout(arcTimer));
  p.addEventListener('pointerleave', () => {
    arcTimer = setTimeout(closeRecents, 220);
  });
}
document.addEventListener('pointerdown', e => {
  if (arcOpen && !e.target.closest('#arcPop, #canvasBtn')) closeRecents();
}, true);
addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (npOpen) closeNowPlaying(); if (arcOpen) closeRecents(); }
});

/* ---------------- boot ---------------- */

const Rainbow = window.Rainbow = {
  get state() { return state; }, NATIVE, h, $, uid, save, render, toast, menu, panel, closePanel, field, seg,
  hostOf, toUrl, favicon, send, recv, snapshot, ocr, putMedia, delMedia, evalIn, veilOn, veilOff, closeAll,
  space, tab, activeTab, live, openTab, activate, navigate, closeTab, pinTab, moveTabToSpace,
  addEssential, openEssential, removeEssential, clearToday, switchSpace, createSpace, deleteSpace,
  frameMenu, compactMenu, newTabMenu, linkMenu, setLayout, cbarAuto, placeChrome,
  openSitePop, openShotTool, spaceMenu,
  pageShot: async () => { const p = panes[0]; const data = p && await snapshot(p.id); return data ? { data, x: p.x, y: p.y, w: p.w, h: p.h } : null; },
  siteName, newFolder, newSpace, openNewSpace, closeNewSpace, folderToSpace, splitMenu, splitPicker, appMenu, openPeek, closePeek, applyTheme, setBoost, openBoost, openSettings, openSpaceSettings, openCmd, syncPage, splitWith, unsplit, setView, toggleSidebar, reopenClosed, PALETTES, THEMES, ICONS,
  media, openNowPlaying, closeNowPlaying, openRecents, closeRecents, sideButtons,
  get view() { return view; },
};
window.rainbow = { recv }; // what the native shell calls

applyTheme();
render();
{
  const s = space();
  const t = tab(s.active);
  if (t) { ensureLive(t); showPage(t.id); } else showPage(null);
}
autoArchive();
setInterval(autoArchive, 10 * 60e3);
