'use strict';
/* Canvas: Wave's global bookmarks, laid out as an infinite board of cards (links with
   screenshots, images, notes) grouped by topic and joined by lines. It is the same data
   the command bar searches, so "bookmarks" and "the canvas" are one store. */
(() => {
  const { h, $, uid, save, toast, hostOf, favicon } = Wave;
  const S = () => Wave.state;
  const el = $('#canvasView');
  const DAY = 864e5, STALE = 14 * DAY;
  const CELL_W = 1000, CELL_H = 820;

  el.innerHTML = `
    <div class="cv-viewport" id="cvViewport">
      <div class="cv-world" id="cvWorld"><svg class="cv-edges" id="cvEdges"></svg></div>
    </div>
    <div class="cv-top">
      <label class="cv-search"><svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></svg>
        <input id="cvSearch" placeholder="Search your canvas…" autocomplete="off"><kbd>/</kbd></label>
      <div class="cv-top-right">
        <button class="cv-pill" id="cvAdd"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg>Add</button>
        <span class="cv-count" id="cvCount"></span>
        <button class="cv-pill" id="cvSurprise"><svg viewBox="0 0 16 16"><path d="M2.5 5h3l5 6h3M2.5 11h3l1.5-1.8M10.5 5h3M12 3.5 13.5 5 12 6.5M12 9.5l1.5 1.5L12 12.5"/></svg>Surprise me</button>
      </div>
    </div>
    <nav class="cv-rail" id="cvRail" aria-label="Topics"></nav>
    <div class="cv-bottom-left">
      <button class="cv-pill" id="cvFilter" hidden></button>
      <button class="cv-pill" id="cvCollection"><span class="cv-stack"></span>Recently discovered</button>
    </div>
    <button class="cv-pill cv-discover" id="cvDiscover"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="5.5"/><path d="m10.4 5.6-1.6 3.2-3.2 1.6 1.6-3.2z"/></svg>Discover new things</button>
    <div class="cv-zoom"><button id="cvOut" aria-label="Zoom out">−</button><span id="cvZoomLabel">100%</span><button id="cvIn" aria-label="Zoom in">+</button><button id="cvHome" aria-label="Fit everything"><svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v3M8 11.5v3M1.5 8h3M11.5 8h3"/></svg></button></div>
    <div class="cv-empty" id="cvEmpty">
      <p class="cv-date"></p>
      <h1>Nothing saved yet.</h1>
      <p>Press <kbd>Ctrl</kbd> <kbd>D</kbd> on any page, drop links or images here, paste, or double-click to write a note.</p>
    </div>
    <div class="cv-modal" id="cvModal" hidden></div>
    <div class="cv-collection" id="cvCol" hidden></div>`;

  const vp = $('#cvViewport'), world = $('#cvWorld'), svg = $('#cvEdges');
  const cam = { x: 0, y: 0, z: 1 };
  let filter = null, query = '', fitted = false, connectFrom = null;

  /* ---------- topics and placement ---------- */
  const topics = () => {
    const seen = [];
    for (const b of S().bookmarks) if (!seen.includes(b.topic)) seen.push(b.topic);
    return seen;
  };
  const hue = s => [...(s || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 11);
  const topicColor = t => `hsl(${hue(t)} 55% 58%)`;
  function cellOf(topic) {
    const i = Math.max(0, topics().indexOf(topic));
    const ts = topics().includes(topic) ? i : topics().length;
    return { x: (ts % 3) * CELL_W, y: Math.floor(ts / 3) * CELL_H };
  }
  function place(topic, w = 250, hgt = 300) {
    const c = cellOf(topic);
    const cx = c.x + CELL_W / 2 - w / 2, cy = c.y + CELL_H / 2 - hgt / 2;
    const busy = S().bookmarks.map(b => ({ x: b.x, y: b.y, w: b.w || 250, h: 320 }));
    for (let r = 0; r < 4000; r += 70) {
      for (let a = 0; a < Math.PI * 2; a += Math.max(.35, 140 / Math.max(r, 1))) {
        const x = cx + Math.cos(a) * r * 1.3, y = cy + Math.sin(a) * r;
        if (!busy.some(o => x < o.x + o.w + 40 && x + w + 40 > o.x && y < o.y + o.h && y + hgt > o.y)) return { x: Math.round(x), y: Math.round(y) };
      }
    }
    return { x: cx, y: cy };
  }

  function add(card) {
    const topic = card.topic || Wave.space().name;
    const w = card.kind === 'note' ? 230 : card.kind === 'image' ? 210 : 250;
    const b = { id: uid(), kind: 'link', title: '', note: '', image: null, created: Date.now(), visits: 0, lastVisit: null, tilt: +(Math.random() * 3 - 1.5).toFixed(2), ...card, topic, w };
    if (b.x == null) Object.assign(b, place(topic, w));
    S().bookmarks.push(b);
    save(); draw(); Wave.render();
    return b;
  }

  async function shrink(src, max = 560) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / img.naturalWidth);
        const c = h('canvas', { width: Math.round(img.naturalWidth * k), height: Math.round(img.naturalHeight * k) });
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        try { resolve(c.toDataURL('image/jpeg', .74)); } catch { resolve(src); }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  async function saveTab(id, extra = {}) {
    const t = Wave.tab(id);
    if (!t) return null;
    const dup = S().bookmarks.find(b => b.url === t.url);
    if (dup) { toast('Already on your Canvas'); return dup; }
    // What the page says about itself (works in the native shell; same-origin only in a browser).
    const meta = await Wave.evalIn(id, `(() => { const m = s => document.querySelector(s)?.content || null;
      return { d: m('meta[property="og:description"]') || m('meta[name="description"]'), i: m('meta[property="og:image"]') || m('meta[name="twitter:image"]') }; })()`);
    const shot = await Wave.snapshot(id);
    const b = add({
      kind: 'link', url: t.url, title: t.custom || t.title || hostOf(t.url),
      note: (meta?.d || '').slice(0, 280), image: meta?.i || (shot ? await shrink(shot) : null),
      shot: shot && meta?.i ? await shrink(shot, 420) : null, ...extra,
    });
    toast(`Saved to Canvas · ${b.topic}`);
    return b;
  }
  const saveUrl = (url, title, extra = {}) => S().bookmarks.find(b => b.url === url) || add({ kind: 'link', url, title: title || hostOf(url), ...extra });
  const addNote = (text, extra = {}) => add({ kind: 'note', note: text, ...extra });

  function touch(url) { // a saved link was visited again
    const b = S().bookmarks.find(x => x.url === url);
    if (b) { b.visits++; b.lastVisit = Date.now(); }
  }
  function revisit(b) {
    touch(b.url);
    save();
    Wave.openTab(b.url, { title: b.title });
  }
  function remove(id) {
    S().bookmarks = S().bookmarks.filter(b => b.id !== id);
    S().edges = S().edges.filter(e => e.a !== id && e.b !== id);
    save(); draw(); Wave.render();
  }
  function connect(a, b) {
    if (a === b || S().edges.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) return;
    S().edges.push({ a, b });
    save(); drawEdges();
  }

  /* ---------- drawing ---------- */
  const isStale = b => b.kind === 'link' && Date.now() - (b.lastVisit || b.created) > STALE;
  const matches = b => (!filter || b.topic === filter) && (!query || [b.title, b.note, b.url, b.topic].some(x => (x || '').toLowerCase().includes(query)));

  function cardEl(b) {
    const dim = !matches(b);
    const common = { class: `cv-card k-${b.kind}${dim ? ' dim' : ''}`, dataset: { id: b.id },
      style: `transform:translate(${b.x}px,${b.y}px);width:${b.w}px;--tilt:${b.tilt}deg;--delay:${(b.id % 7) * -.9}s` };
    let inner;
    if (b.kind === 'note') {
      inner = h('div', { class: 'cv-float' }, h('p', { class: 'cv-quote' }, b.note));
    } else if (b.kind === 'image') {
      inner = h('div', { class: 'cv-float' }, h('img', { class: 'cv-cutout', src: b.image, alt: b.title || '', draggable: false }),
        b.title ? h('p', { class: 'cv-caption' }, b.title) : null);
    } else {
      inner = h('div', { class: 'cv-float cv-paper' },
        b.image ? h('div', { class: 'cv-media' }, h('img', { src: b.image, alt: '', draggable: false, onerror: e => e.target.parentElement.remove() }),
          h('span', { class: 'cv-tag' }, b.topic)) : h('span', { class: 'cv-tag plain', style: `--c:${topicColor(b.topic)}` }, b.topic),
        h('div', { class: 'cv-body' },
          h('h3', {}, b.title),
          b.note ? h('p', {}, b.note) : null),
        h('footer', {}, favicon(b.url, 14), h('span', {}, hostOf(b.url)), isStale(b) ? h('em', { class: 'cv-stale' }, 'Revisit') : null));
    }
    return h('div', common, inner, h('button', { class: 'cv-knob', title: 'Drag to another card to connect', 'aria-label': 'Connect' }));
  }

  function drawEdges() {
    const byId = Object.fromEntries(S().bookmarks.map(b => [b.id, b]));
    const center = b => {
      const node = world.querySelector(`.cv-card[data-id="${b.id}"]`);
      return { x: b.x + b.w / 2, y: b.y + (node ? node.offsetHeight / 2 : 150) };
    };
    svg.innerHTML = S().edges.filter(e => byId[e.a] && byId[e.b]).map(e => {
      const p = center(byId[e.a]), q = center(byId[e.b]);
      const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2 - Math.abs(p.x - q.x) * .12;
      return `<path data-a="${e.a}" data-b="${e.b}" d="M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}"/>`;
    }).join('');
  }

  function draw() {
    const bs = S().bookmarks;
    world.querySelectorAll('.cv-card,.cv-label').forEach(n => n.remove());
    const groups = {};
    for (const b of bs) (groups[b.topic] ||= []).push(b);
    for (const [t, items] of Object.entries(groups)) {
      const x = Math.min(...items.map(b => b.x)), y = Math.min(...items.map(b => b.y));
      world.append(h('div', { class: `cv-label${filter && filter !== t ? ' dim' : ''}`, style: `transform:translate(${x}px,${y - 190}px)` },
        h('h2', {}, t), h('span', {}, `${items.length} ${items.length === 1 ? 'thing' : 'things'} nearby`)));
    }
    for (const b of bs) world.append(cardEl(b));
    drawEdges();
    $('#cvEmpty').hidden = bs.length > 0;
    $('#cvEmpty .cv-date').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    drawRail();
    const f = $('#cvFilter');
    f.hidden = !filter;
    f.title = filter ? `Showing ${filter} — click to clear` : '';
    if (filter) f.replaceChildren(h('i', { style: `background:${topicColor(filter)}` }), `Showing ${filter}`, h('b', { 'aria-hidden': 'true' }, '×'));
  }

  function drawRail() {
    const ts = topics();
    $('#cvRail').replaceChildren(
      h('button', { class: `cv-topic${!filter ? ' on' : ''}`, onclick: () => setFilter(null) }, h('i', { style: 'background:var(--cv-ink)' }), h('span', {}, 'Everything')),
      ...ts.map(t => h('button', { class: `cv-topic${filter === t ? ' on' : ''}`, onclick: () => { setFilter(t); flyToTopic(t); } },
        h('i', { style: `background:${topicColor(t)}` }), h('span', {}, t), h('small', {}, String(S().bookmarks.filter(b => b.topic === t).length)))));
  }
  function setFilter(t) { filter = t; draw(); }

  /* ---------- camera ---------- */
  const apply = () => {
    world.style.transform = `translate(${cam.x}px,${cam.y}px) scale(${cam.z})`;
    $('#cvZoomLabel').textContent = Math.round(cam.z * 100) + '%';
  };
  let anim = 0;
  function flyTo(x, y, z = cam.z) {
    cancelAnimationFrame(anim);
    const r = vp.getBoundingClientRect();
    const from = { ...cam }, to = { z, x: r.width / 2 - x * z, y: r.height / 2 - y * z };
    const t0 = performance.now(), dur = matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 620;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 4;
      cam.x = from.x + (to.x - from.x) * e; cam.y = from.y + (to.y - from.y) * e; cam.z = from.z + (to.z - from.z) * e;
      apply();
      if (k < 1) anim = requestAnimationFrame(step);
    };
    anim = requestAnimationFrame(step);
  }
  function flyToCard(b, pulse = true) {
    flyTo(b.x + b.w / 2, b.y + 150, Math.max(cam.z, .9));
    if (pulse) setTimeout(() => world.querySelector(`.cv-card[data-id="${b.id}"]`)?.classList.add('pulse'), 500);
  }
  function flyToTopic(t) {
    const items = S().bookmarks.filter(b => b.topic === t);
    if (items.length) fit(items);
  }
  function fit(items = S().bookmarks) {
    const r = vp.getBoundingClientRect();
    if (!items.length) { cam.x = r.width / 2; cam.y = r.height / 2; cam.z = 1; return apply(); }
    const x0 = Math.min(...items.map(b => b.x)), y0 = Math.min(...items.map(b => b.y)) - 200;
    const x1 = Math.max(...items.map(b => b.x + b.w)), y1 = Math.max(...items.map(b => b.y + 340));
    const z = Math.max(.12, Math.min(1.1, r.width / (x1 - x0 + 200), r.height / (y1 - y0 + 160)));
    flyTo((x0 + x1) / 2, (y0 + y1) / 2, z);
  }
  function zoomAt(f, sx, sy) {
    const r = vp.getBoundingClientRect();
    sx ??= r.width / 2; sy ??= r.height / 2;
    const z = Math.max(.12, Math.min(2.5, cam.z * f));
    cam.x = sx - (sx - cam.x) * (z / cam.z); cam.y = sy - (sy - cam.y) * (z / cam.z); cam.z = z;
    apply();
  }
  const toWorld = (cx, cy) => { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - cam.x) / cam.z, y: (cy - r.top - cam.y) / cam.z }; };

  /* ---------- pointer: pan with momentum, drag cards, connect ---------- */
  let drag = null;
  vp.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    cancelAnimationFrame(anim);
    const card = e.target.closest('.cv-card');
    const knob = e.target.closest('.cv-knob');
    const b = card && S().bookmarks.find(x => x.id === +card.dataset.id);
    vp.setPointerCapture(e.pointerId);
    if (knob || (b && e.altKey)) {
      connectFrom = b;
      drag = { kind: 'connect', b };
      svg.insertAdjacentHTML('beforeend', '<path class="ghost" id="cvGhost"/>');
    } else if (b) drag = { kind: 'card', b, node: card, sx: e.clientX, sy: e.clientY, ox: b.x, oy: b.y, moved: false };
    else drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: cam.x, oy: cam.y, vx: 0, vy: 0, lx: e.clientX, ly: e.clientY, lt: performance.now() };
  });
  vp.addEventListener('pointermove', e => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      cam.x = drag.ox + e.clientX - drag.sx; cam.y = drag.oy + e.clientY - drag.sy; apply();
      const now = performance.now(), dt = Math.max(1, now - drag.lt);
      drag.vx = (e.clientX - drag.lx) / dt; drag.vy = (e.clientY - drag.ly) / dt; drag.lx = e.clientX; drag.ly = e.clientY; drag.lt = now;
      vp.classList.add('panning');
    } else if (drag.kind === 'card') {
      const dx = (e.clientX - drag.sx) / cam.z, dy = (e.clientY - drag.sy) / cam.z;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      drag.b.x = Math.round(drag.ox + dx); drag.b.y = Math.round(drag.oy + dy);
      drag.node.style.transform = `translate(${drag.b.x}px,${drag.b.y}px)`;
      drag.node.classList.add('lifted');
      drawEdges();
    } else if (drag.kind === 'connect') {
      const p = toWorld(e.clientX, e.clientY), b = drag.b;
      document.getElementById('cvGhost')?.setAttribute('d', `M${b.x + b.w / 2},${b.y + 150} L${p.x},${p.y}`);
    }
  });
  vp.addEventListener('pointerup', e => {
    const d = drag; drag = null;
    vp.classList.remove('panning');
    if (!d) return;
    if (d.kind === 'pan') {
      let { vx, vy } = d;
      if (performance.now() - d.lt > 80) return;
      const glide = () => { vx *= .92; vy *= .92; cam.x += vx * 16; cam.y += vy * 16; apply(); if (Math.abs(vx) + Math.abs(vy) > .02) anim = requestAnimationFrame(glide); };
      anim = requestAnimationFrame(glide);
    } else if (d.kind === 'card') {
      d.node.classList.remove('lifted');
      if (d.moved) { save(); draw(); } else openCard(d.b);
    } else if (d.kind === 'connect') {
      document.getElementById('cvGhost')?.remove();
      const target = document.elementsFromPoint(e.clientX, e.clientY).find(n => n.classList?.contains('cv-card'));
      if (target) connect(d.b.id, +target.dataset.id);
      connectFrom = null;
    }
  });
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    cancelAnimationFrame(anim);
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) zoomAt(Math.exp(-e.deltaY * .0025), e.clientX - r.left, e.clientY - r.top);
    else { cam.x -= e.deltaX; cam.y -= e.deltaY; apply(); }
  }, { passive: false });
  vp.addEventListener('dblclick', e => {
    if (e.target.closest('.cv-card')) return;
    const p = toWorld(e.clientX, e.clientY);
    const b = addNote('New note', { x: Math.round(p.x - 115), y: Math.round(p.y - 30), topic: filter || nearestTopic(p) });
    openCard(b, true);
  });
  vp.addEventListener('contextmenu', e => {
    const card = e.target.closest('.cv-card'), path = e.target.closest('path[data-a]');
    if (path) { e.preventDefault(); Wave.menu(e.clientX, e.clientY, [['Remove connection', () => { S().edges = S().edges.filter(x => !(x.a === +path.dataset.a && x.b === +path.dataset.b)); save(); drawEdges(); }, 'danger']]); return; }
    if (!card) return;
    e.preventDefault();
    const b = S().bookmarks.find(x => x.id === +card.dataset.id);
    Wave.menu(e.clientX, e.clientY, [
      ...(b.url ? [['Revisit', () => revisit(b)], ['Copy link', () => navigator.clipboard?.writeText(b.url)]] : []),
      ['Open card', () => openCard(b)],
      ['Connect to…', () => { connectFrom = b; toast('Click the card to connect to'); }],
      ...topics().filter(t => t !== b.topic).slice(0, 6).map(t => [`Move to ${t}`, () => { b.topic = t; Object.assign(b, place(t, b.w)); save(); draw(); }]),
      '-', ['Remove from Canvas', () => remove(b.id), 'danger'],
    ]);
  });
  vp.addEventListener('click', e => {
    if (!connectFrom) return;
    const card = e.target.closest('.cv-card');
    if (card && +card.dataset.id !== connectFrom.id) connect(connectFrom.id, +card.dataset.id);
    connectFrom = null;
  }, true);
  function nearestTopic(p) {
    let best = null, dist = Infinity;
    for (const b of S().bookmarks) { const d = (b.x - p.x) ** 2 + (b.y - p.y) ** 2; if (d < dist) { dist = d; best = b.topic; } }
    return best || Wave.space().name;
  }

  /* ---------- drop & paste ---------- */
  vp.addEventListener('dragover', e => e.preventDefault());
  vp.addEventListener('drop', async e => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY), at = { x: Math.round(p.x - 120), y: Math.round(p.y - 120), topic: filter || nearestTopic(p) };
    const tabId = +e.dataTransfer.getData('wave/tab');
    if (tabId) return saveTab(tabId, at);
    for (const f of e.dataTransfer.files) if (f.type.startsWith('image/')) {
      add({ kind: 'image', image: await shrink(URL.createObjectURL(f), 720), title: f.name.replace(/\.\w+$/, ''), ...at });
      at.x += 230;
    }
    const url = (e.dataTransfer.getData('text/uri-list') || '').split('\n')[0];
    if (url) add({ kind: /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? 'image' : 'link', url, image: /\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(url) ? url : null, title: hostOf(url), ...at });
    else if (!e.dataTransfer.files.length && e.dataTransfer.getData('text/plain')) addNote(e.dataTransfer.getData('text/plain').slice(0, 600), at);
  });
  addEventListener('paste', async e => {
    if (Wave.view !== 'canvas' || e.target.closest?.('input,textarea')) return;
    const r = vp.getBoundingClientRect(), p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const at = { x: Math.round(p.x - 120), y: Math.round(p.y - 120), topic: filter || nearestTopic(p) };
    const img = [...e.clipboardData.items].find(i => i.type.startsWith('image/'));
    if (img) return add({ kind: 'image', image: await shrink(URL.createObjectURL(img.getAsFile()), 720), title: 'Pasted image', ...at });
    const text = e.clipboardData.getData('text/plain').trim();
    if (/^https?:\/\/\S+$/.test(text)) add({ kind: 'link', url: text, title: hostOf(text), ...at });
    else if (text) addNote(text.slice(0, 600), at);
  });

  /* ---------- open card ---------- */
  function openCard(b, edit = false) {
    const m = $('#cvModal');
    const note = h('textarea', { class: 'cv-note', value: b.note || '', placeholder: b.kind === 'note' ? 'Write a note…' : 'Why did you save this?', rows: 3,
      oninput: e => { b.note = e.target.value; save(); } });
    const title = h('h2', { contenteditable: 'plaintext-only', spellcheck: 'false', oninput: e => { b.title = e.target.textContent; save(); } }, b.title || '');
    m.replaceChildren(h('article', { class: `cv-sheet k-${b.kind}` },
      h('button', { class: 'cv-close', 'aria-label': 'Close', onclick: closeCard }, '×'),
      b.image ? h('div', { class: 'cv-hero' }, h('img', { src: b.image, alt: '' })) : null,
      h('div', { class: 'cv-sheet-body' },
        h('div', { class: 'cv-meta' }, h('i', { style: `background:${topicColor(b.topic)}` }),
          h('select', { 'aria-label': 'Topic', onchange: e => { const t = e.target.value === '+' ? prompt('New topic name')?.trim() : e.target.value; if (t) { b.topic = t; Object.assign(b, place(t, b.w)); save(); } } },
            [...new Set([...topics(), b.topic])].map(t => h('option', { value: t, selected: t === b.topic }, t)), h('option', { value: '+' }, 'New topic…')),
          b.url ? h('span', {}, hostOf(b.url)) : null,
          h('span', {}, `Saved ${new Date(b.created).toLocaleDateString()}`),
          b.url ? h('span', {}, b.visits ? `Revisited ${b.visits}×` : 'Not revisited yet') : null),
        b.kind !== 'note' ? title : null,
        note,
        b.shot ? h('img', { class: 'cv-shot', src: b.shot, alt: 'Screenshot when saved' }) : null),
      h('footer', {},
        h('button', { class: 'cv-btn', onclick: () => { remove(b.id); closeCard(); } }, 'Remove'),
        b.url ? h('button', { class: 'cv-btn', onclick: () => navigator.clipboard?.writeText(b.url).then(() => toast('Link copied')) }, 'Copy link') : null,
        h('span', { style: 'flex:1' }),
        b.url ? h('button', { class: 'cv-btn dark', onclick: () => { closeCard(); revisit(b); } }, 'Revisit') : h('button', { class: 'cv-btn dark', onclick: closeCard }, 'Done'))));
    m.hidden = false;
    m.onclick = e => { if (e.target === m) closeCard(); };
    if (edit) { note.focus(); note.select(); }
  }
  function closeCard() { const m = $('#cvModal'); if (!m.hidden) { m.hidden = true; draw(); } }

  /* ---------- collection ---------- */
  function openCollection(tabName = 'saved') {
    const c = $('#cvCol');
    const bs = S().bookmarks.filter(b => b.kind !== 'note');
    const sets = {
      discovered: ['Recently discovered', bs.filter(b => b.discovered).sort((a, b) => b.discovered - a.discovered)],
      saved: ['Recently saved', [...bs].sort((a, b) => b.created - a.created)],
      revisited: ['Recently revisited', bs.filter(b => b.lastVisit).sort((a, b) => b.lastVisit - a.lastVisit)],
      soon: ['Worth revisiting', bs.filter(isStale).sort((a, b) => (a.lastVisit || a.created) - (b.lastVisit || b.created))],
    };
    const [title, items] = sets[tabName];
    c.replaceChildren(
      h('button', { class: 'cv-close', 'aria-label': 'Close', onclick: () => (c.hidden = true) }, '×'),
      h('header', {}, h('div', {}, h('p', {}, 'Your canvas'), h('h1', {}, title)),
        h('div', { class: 'cv-seg' }, Object.entries({ discovered: 'Discovered', saved: 'Saved', revisited: 'Revisited', soon: 'Revisit soon' }).map(([k, l]) =>
          h('button', { class: k === tabName ? 'on' : '', onclick: () => openCollection(k) }, l, h('small', {}, String(sets[k][1].length)))))),
      items.length ? h('div', { class: 'cv-grid' }, items.map(b => h('button', { class: 'cv-mini', onclick: () => { c.hidden = true; flyToCard(b); } },
        b.image ? h('img', { src: b.image, alt: '' }) : h('span', { class: 'cv-mini-ph', style: `--c:${topicColor(b.topic)}` }, hostOf(b.url || '')),
        h('span', {}, b.title || hostOf(b.url))))) : h('p', { class: 'cv-none' }, tabName === 'soon' ? 'Nothing has gone stale. Links you have not opened for two weeks show up here.' : tabName === 'discovered' ? 'Press Discover new things to find something.' : 'Nothing here yet.'));
    c.hidden = false;
  }

  /* ---------- discover ---------- */
  /* Pick a mood and a subject; Wave finds a Wikipedia article that fits and drops it
     on the board under that subject. ponytail: the mood is a search hint, not a model. */
  const MOODS = { surprising: 'unexpected discovery', strange: 'unusual phenomenon', anything: '', useful: 'how it works practical' };
  const SUBJECTS = ['science', 'space', 'psychology', 'geography', 'history', 'art', 'music', 'nature', 'technology', 'food', 'language', 'architecture'];
  const DAILY = 20;
  const today = () => new Date().toDateString();
  const usedToday = () => { const d = S().discover ||= { day: today(), n: 0 }; if (d.day !== today()) Object.assign(d, { day: today(), n: 0 }); return d; };
  const countLabel = () => { $('#cvCount').textContent = `${usedToday().n} of ${DAILY} today`; };
  function wheel(label, items, pick) {
    let at = Math.max(0, items.indexOf(pick));
    const ul = h('ul', { class: 'cv-wheel', role: 'listbox', 'aria-label': label, tabindex: 0 });
    // Seven slots with the pick in the middle; slots past either end stay empty.
    const draw = () => ul.replaceChildren(...[-3, -2, -1, 0, 1, 2, 3].map(d => { const i = at + d, x = items[i];
      return h('li', { role: x ? 'option' : 'presentation', 'aria-selected': x ? String(!d) : null, class: d ? '' : 'on', style: `--d:${Math.abs(d)}`,
        onclick: x ? () => { at = i; draw(); } : null }, x || ' '); }));
    ul.onkeydown = e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); at = (at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length; draw(); } };
    ul.onwheel = e => { e.preventDefault(); at = Math.min(items.length - 1, Math.max(0, at + Math.sign(e.deltaY))); draw(); };
    draw();
    return { el: ul, get value() { return items[at]; } };
  }
  function discover() {
    const m = $('#cvModal'), last = S().discoverPick || {};
    const mood = wheel('Mood', Object.keys(MOODS), last.mood || 'anything'), subject = wheel('Subject', SUBJECTS, last.subject || 'science');
    m.replaceChildren(h('div', { class: 'cv-sheet cv-picker' },
      h('h2', {}, 'Choose a mood and a subject'),
      h('div', { class: 'cv-wheels' }, mood.el, subject.el),
      h('footer', {}, h('button', { class: 'cv-btn', onclick: () => { m.hidden = true; } }, 'Cancel'),
        h('button', { class: 'cv-btn dark', onclick: () => { m.hidden = true; S().discoverPick = { mood: mood.value, subject: subject.value }; find(mood.value, subject.value); } }, 'Take me there'))));
    m.hidden = false;
    m.onclick = e => { if (e.target === m) m.hidden = true; };
    subject.el.focus();
  }
  async function find(mood, subject) {
    const d = usedToday();
    if (d.n >= DAILY) return toast(`That's ${DAILY} discoveries today. More tomorrow.`);
    const seen = new Set(S().bookmarks.map(b => b.url));
    try {
      const q = encodeURIComponent(`${subject} ${MOODS[mood]}`.trim());
      const res = await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&srlimit=40&sroffset=${Math.floor(Math.random() * 5) * 40}&format=json&origin=*`).then(r => r.json());
      const hits = (res.query?.search || []).filter(x => !seen.has(`https://en.wikipedia.org/wiki/${encodeURIComponent(x.title.replace(/ /g, '_'))}`));
      if (!hits.length) return toast('Nothing new turned up. Try another mood.');
      const pick = hits[Math.floor(Math.random() * hits.length)];
      const sum = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pick.title.replace(/ /g, '_'))}`).then(r => r.json());
      d.n++;
      const b = add({ kind: 'link', url: `https://en.wikipedia.org/wiki/${encodeURIComponent(pick.title.replace(/ /g, '_'))}`, title: sum.title || pick.title,
        note: sum.extract || '', image: sum.thumbnail?.source || null, topic: subject, discovered: Date.now() });
      countLabel(); setFilter(subject);
      flyToCard(b);
    } catch { toast('Could not reach Wikipedia.'); }
  }

  /* ---------- chrome ---------- */
  $('#cvSearch').addEventListener('input', e => { query = e.target.value.trim().toLowerCase(); draw(); });
  $('#cvSearch').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const b = S().bookmarks.find(matches); if (b) flyToCard(b); }
    if (e.key === 'Escape') { e.target.value = ''; query = ''; draw(); e.target.blur(); e.stopPropagation(); }
  });
  addEventListener('keydown', e => {
    if (Wave.view !== 'canvas' || e.target.closest?.('input,textarea,[contenteditable]')) return;
    if (e.key === '/') { e.preventDefault(); $('#cvSearch').focus(); }
    if (e.key === 'Escape') { closeCard(); $('#cvCol').hidden = true; }
  });
  $('#cvSurprise').onclick = () => { const bs = S().bookmarks; if (bs.length) flyToCard(bs[Math.floor(Math.random() * bs.length)]); };
  $('#cvAdd').onclick = e => Wave.menu(e.clientX - 120, e.clientY + 16, [
    ['Save current tab', () => Wave.activeTab() ? saveTab(Wave.activeTab().id) : toast('No tab open')],
    ['Add a link…', () => { const u = prompt('Link'); if (u) { const url = Wave.toUrl(u); const b = saveUrl(url, hostOf(url)); flyToCard(b); } }],
    ['Write a note', () => { const r = vp.getBoundingClientRect(); const p = toWorld(r.left + r.width / 2, r.top + r.height / 2); openCard(addNote('New note', { x: p.x - 115, y: p.y, topic: filter || nearestTopic(p) }), true); }],
    ['Add all open tabs in this space', () => { const s = Wave.space(); [...s.pinned, ...s.today].forEach(id => Wave.tab(id) && saveUrl(Wave.tab(id).url, Wave.tab(id).title)); }],
  ]);
  $('#cvCollection').onclick = () => openCollection('discovered');
  $('#cvDiscover').onclick = discover;
  $('#cvFilter').onclick = () => setFilter(null);
  $('#cvIn').onclick = () => zoomAt(1.2);
  $('#cvOut').onclick = () => zoomAt(1 / 1.2);
  $('#cvHome').onclick = () => fit();

  /* Sorting. A small model that runs on this machine decides which topic a captured card belongs to.
     Until one is installed (set `Wave.localModel = { classify(card) }`) a keyword scorer answers the same
     call, so nothing else changes the day the model arrives. */
  const TOPICS = {
    Code: ['github', 'code', 'api', 'rust', 'python', 'javascript', 'developer', 'function', 'compiler', 'stack', 'bug', 'repo', 'software', 'programming'],
    Design: ['design', 'figma', 'typography', 'font', 'color', 'ui', 'ux', 'layout', 'brand', 'illustration', 'dribbble'],
    News: ['news', 'breaking', 'report', 'election', 'government', 'minister', 'court', 'police', 'war', 'times', 'post'],
    Science: ['science', 'study', 'research', 'physics', 'biology', 'space', 'nasa', 'climate', 'chemistry', 'paper', 'arxiv'],
    Shopping: ['buy', 'price', 'shop', 'amazon', 'cart', 'deal', 'sale', 'order', 'review', 'best', 'store'],
    Video: ['youtube', 'video', 'watch', 'film', 'movie', 'trailer', 'stream', 'episode', 'netflix'],
    Music: ['music', 'song', 'album', 'spotify', 'playlist', 'artist', 'band', 'lyrics', 'concert'],
    Food: ['recipe', 'food', 'cook', 'restaurant', 'meal', 'kitchen', 'bake', 'dinner'],
    Travel: ['travel', 'hotel', 'flight', 'trip', 'city', 'guide', 'airbnb', 'visit', 'tour'],
    Money: ['finance', 'bank', 'invest', 'stock', 'crypto', 'market', 'tax', 'budget', 'bitcoin'],
    Health: ['health', 'doctor', 'fitness', 'sleep', 'diet', 'medical', 'workout', 'mental'],
    Reading: ['essay', 'book', 'article', 'blog', 'read', 'story', 'wikipedia', 'novel'],
  };
  function scoreTopic(text) {
    const words = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let best = null, top = 0;
    for (const [topic, keys] of Object.entries(TOPICS)) {
      const n = words.reduce((c, w) => c + (keys.includes(w) ? 1 : 0), 0);
      if (n > top) { top = n; best = topic; }
    }
    return best;
  }
  async function classify({ title = '', text = '', url = '' } = {}) {
    if (Wave.localModel?.classify) {
      try { const t = await Wave.localModel.classify({ title, text, url, topics: Object.keys(TOPICS), existing: topics() }); if (t) return String(t); } catch {}
    }
    return scoreTopic(`${title} ${text} ${hostOf(url)}`) || (url ? Wave.siteName(url) : 'Saved');
  }
  /* Right-click an image, or select text and right-click: it lands on the Canvas, under the topic the
     classifier picks. */
  async function capture(c) {
    const topic = await classify({ title: c.title, text: c.text, url: c.url });
    const b = c.kind === 'image'
      ? add({ kind: 'image', image: c.src, title: c.title || 'Image', url: c.url, topic })
      : add({ kind: 'note', note: String(c.text).slice(0, 600), title: '', source: c.url, topic });
    toast(`Saved to Canvas · ${topic}`);
    return b;
  }

  Wave.canvas = {
    capture, classify, saveTab, saveUrl, addNote, add, remove, connect, touch, fit, flyToCard, openCollection, discover,
    showTopic: t => { setFilter(t); flyToTopic(t); },
    find: q => S().bookmarks.filter(b => [b.title, b.note, b.url, b.topic].some(x => (x || '').toLowerCase().includes(q.toLowerCase()))),
    show() { countLabel(); draw(); if (!fitted) { fitted = true; fit(); } else apply(); },
    hide() { closeCard(); $('#cvCol').hidden = true; },
    redraw: draw,
  };
})();
