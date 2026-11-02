'use strict';
/* The Ask composer: a notch that rises from the bottom edge of the page on Ctrl+E (or Ask Rainbow in a
   menu), and sinks back when you are done. It is not there the rest of the time.

   The page is a native view above the chrome, so while the notch is up the shell clips three small pieces
   of chrome out over the page for it: the notch, and the two corner pieces beside its base, whose curved
   edges are cut away so the live page shows through them. During the rise and the fall the strips follow
   the notch frame by frame, so no empty square of the chrome's own background is ever drawn on the page. */
(() => {
  const { $, send } = Rainbow;
  const form = $('#composer'), input = $('#cpInput'), model = $('#cpModel');
  const FLARE = 22, NR = 22, LIP = .26;
  document.body.append(form);                       // the notch reaches through the frame's bottom margin, so it lives outside the page card
  const hot = Object.assign(document.createElement('div'), { id: 'notchHot', hidden: true });
  document.body.append(hot);
  // The rim: a few px of the page, blurred, around the notch's head and sides (the top fading out), from a snapshot.
  const RIM = 3;
  const rim = Object.assign(document.createElement('div'), { id: 'cpRim', hidden: true });
  // A sharp copy of the page lies under a blurred one whose top edge fades out: where the blur ends the page itself shows,
  // not the chrome's own background, so there is never a hard cut.
  const rimImg = document.createElement('img'), rimSharp = document.createElement('img');
  rimImg.alt = rimSharp.alt = ''; rimSharp.className = 'sharp';
  const soft = Object.assign(document.createElement('div'), { className: 'soft' });
  soft.append(rimImg);
  rim.append(rimSharp, soft);
  document.body.append(rim);
  let rimReady = false;
  async function loadRim() {
    rimReady = false; rim.hidden = true;
    const s = await Rainbow.pageShot?.();
    if (!s || !armed) return;
    const left = geo.left - RIM, top = geo.top - RIM;
    Object.assign(rim.style, { left: left + 'px', top: top + 'px', width: geo.w + 2 * RIM + 'px', height: geo.h - FLARE + RIM + 'px' });
    for (const im of [rimImg, rimSharp]) {
      Object.assign(im.style, { left: s.x - left + 'px', top: s.y - top + 'px', width: s.w + 'px', height: s.h + 'px' });
      im.src = s.data;
    }
    try { await rimImg.decode(); } catch { return; }
    if (!armed) return;
    rimReady = true; rim.hidden = false; apply();
  }
  let armed = false, bandOn = false, p = 0, goal = 0, timer = 0, geo = null;
  const isAsk = () => !$('#ask').hidden;
  const blocked = () => Rainbow.view !== 'page' || isAsk() ||
    !$('#panel').hidden || !$('#cmdbar').hidden || !$('#menu').hidden || !$('#menuSub').hidden ||
    !$('#shotTool').hidden || !$('#newSpace').hidden;

  // The tools' popovers (Add to Canvas, Tasks, Add tabs) open above the notch. Like the notch they are chrome drawn
  // over the native page, so their rectangle joins the region while they are open.
  const { h } = Rainbow;
  const pop = Object.assign(document.createElement('div'), { id: 'cpPop', hidden: true });
  document.body.append(pop);
  let popKind = '', taskDay = 'today', picked = new Set(), tabFilter = '';
  const PR = 16;
  const ico = d => `<svg viewBox="0 0 16 16">${d}</svg>`;
  const ICON = {
    note: ico('<rect x="3" y="3" width="10" height="10" rx="2"/><path d="M9.5 13v-2.5a1 1 0 0 1 1-1H13"/>'),
    page: ico('<rect x="2.5" y="3" width="11" height="10" rx="2"/><path d="M2.5 6h11"/>'),
    canvas: ico('<rect x="2.4" y="2.4" width="4.4" height="4.4" rx="1"/><circle cx="11.2" cy="4.6" r="2.2"/><path d="M4.6 9.2 6.9 13H2.3z"/>'),
    routine: ico('<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5M8 5.5V8l1.8 1.2"/>'),
    check: ico('<path d="M3.5 8.5 6.5 11.5 12.5 4.5"/>'),
    x: ico('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>'),
    plus: ico('<path d="M8 3v10M3 8h10"/>'),
    tasks: ico('<path d="M2.4 3.8l1.1 1.1 1.9-2M2.4 9l1.1 1.1 1.9-2M7.6 4.2h6M7.6 9.4h6M7.6 13h3.4"/>'),
  };
  const row = (icon, title, sub, fn) => h('button', { type: 'button', class: 'pp-row', onclick: fn },
    h('span', { class: 'pp-ico', innerHTML: icon }), h('span', { class: 'pp-text' }, h('b', {}, title), h('i', {}, sub)));
  const done = () => { closePop(); hide(); };
  function viewCanvasMenu() {
    return [
      row(ICON.note, 'Note', 'Words, links and lists', () => { done(); Rainbow.canvas?.addNote('New note'); Rainbow.setView('canvas'); }),
      row(ICON.page, 'This page', 'Save the open tab to the Canvas', () => { const t = Rainbow.activeTab(); done(); if (t) Rainbow.canvas?.saveTab(t.id); }),
      row(ICON.canvas, 'Canvas', 'Everything you have saved', () => { done(); Rainbow.setView('canvas'); }),
      row(ICON.routine, 'Routines', 'Prompts that run on their own', () => { done(); Rainbow.library?.open('routines'); }),
    ];
  }
  function viewTasks() {
    const st = Rainbow.state; st.tasks ||= [];
    const days = [['today', 'Today'], ['inbox', 'Inbox'], ['later', 'Upcoming']];
    const list = st.tasks.filter(t => t.day === taskDay);
    const add = h('input', { class: 'pp-add', placeholder: 'Add a task…', 'aria-label': 'Add a task',
      onkeydown: e => {
        if (e.key !== 'Enter' || !add.value.trim()) return;
        st.tasks.push({ id: Rainbow.uid(), text: add.value.trim().slice(0, 200), day: taskDay, done: false });
        Rainbow.save(); build(); pop.querySelector('.pp-add')?.focus();
      } });
    return [
      h('div', { class: 'pp-tabs' }, ...days.map(([id, name]) => h('button', { type: 'button', class: id === taskDay ? 'on' : '', onclick: () => { taskDay = id; build(); } },
        name + (st.tasks.some(t => t.day === id && !t.done) ? ` ${st.tasks.filter(t => t.day === id && !t.done).length}` : '')))),
      h('div', { class: 'pp-addrow' }, h('span', { class: 'pp-plus', innerHTML: ICON.plus }), add),
      list.length
        ? h('ul', { class: 'pp-tasks' }, ...list.map(t => h('li', { class: t.done ? 'done' : '' },
            h('button', { type: 'button', class: 'pp-check', 'aria-label': t.done ? 'Mark as to do' : 'Mark as done', innerHTML: t.done ? ICON.check : '', onclick: () => { t.done = !t.done; Rainbow.save(); build(); } }),
            h('span', {}, t.text),
            h('button', { type: 'button', class: 'pp-del', 'aria-label': 'Delete task', innerHTML: ICON.x, onclick: () => { st.tasks = st.tasks.filter(x => x !== t); Rainbow.save(); build(); } }))))
        : h('div', { class: 'pp-empty' }, h('span', { class: 'pp-ico big', innerHTML: ICON.tasks }), h('b', {}, 'Nothing to do'), h('i', {}, 'Add a task when something needs your attention.')),
    ];
  }
  function viewTabs() {
    const s = Rainbow.space(), q = tabFilter.toLowerCase();
    const tabs = [...s.pinned, ...s.today].map(id => Rainbow.tab(id)).filter(t => t && (!q || `${t.title} ${t.url}`.toLowerCase().includes(q)));
    const search = h('input', { class: 'pp-search', placeholder: 'Search tabs', value: tabFilter, 'aria-label': 'Search tabs',
      oninput: e => { tabFilter = e.target.value; const at = e.target.selectionStart; build(); const el = pop.querySelector('.pp-search'); el?.focus(); el?.setSelectionRange(at, at); } });
    return [
      h('div', { class: 'pp-label' }, `${s.icon} ${s.name}`),
      search,
      h('div', { class: 'pp-list' }, ...tabs.map(t => h('button', { type: 'button', class: 'pp-tab', onclick: () => { picked.has(t.id) ? picked.delete(t.id) : picked.add(t.id); build(); } },
        h('span', { class: 'pp-check' + (picked.has(t.id) ? ' on' : ''), innerHTML: picked.has(t.id) ? ICON.check : '' }),
        Rainbow.favicon(t.url, 16),
        h('span', { class: 'pp-text' }, h('b', {}, t.custom || t.title || Rainbow.hostOf(t.url)), h('i', {}, Rainbow.hostOf(t.url)))))),
      h('div', { class: 'pp-foot' },
        h('button', { type: 'button', class: 'btn primary', disabled: !picked.size, onclick: () => { const ids = [...picked]; done(); ids.forEach(id => Rainbow.canvas?.saveTab(id)); } }, `Add to Canvas${picked.size ? ` (${picked.size})` : ''}`)),
    ];
  }
  function build() {
    pop.replaceChildren(...({ canvas: viewCanvasMenu, tasks: viewTasks, tabs: viewTabs }[popKind]?.() || []));
    pop.dataset.kind = popKind;
    placePop();
  }
  function placePop() {
    if (!geo) return;
    const w = Math.min(380, innerWidth - 24);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(12, Math.min(geo.left + 12, innerWidth - w - 12)) + 'px';
    pop.style.bottom = innerHeight - geo.top + 10 + 'px';
    pop.style.maxHeight = Math.max(160, geo.top - 40) + 'px';
    apply();
  }
  const TOOLS = { canvas: '#cpCanvas', tasks: '#cpSettings', tabs: '#cpNew' };
  function openPop(kind) {
    if (popKind === kind) return closePop();
    popKind = kind; picked = new Set(); tabFilter = '';
    pop.hidden = false;
    build();
    for (const [k, sel] of Object.entries(TOOLS)) $(sel).classList.toggle('on', k === kind);
    $('#cpAgent').classList.remove('on');
    setTimeout(() => pop.querySelector('.pp-add, .pp-search')?.focus(), 60);
  }
  function closePop() {
    if (!popKind) return;
    popKind = ''; pop.hidden = true; pop.replaceChildren();
    for (const sel of Object.values(TOOLS)) $(sel).classList.remove('on');
    $('#cpAgent').classList.add('on');
    if (geo) apply();
  }
  new ResizeObserver(() => { if (popKind) placePop(); }).observe(pop);

  // Where the notch rests: centred under the page, its feet on the window's bottom edge.
  function measure() {
    const card = $('#pageCard').getBoundingClientRect();
    const w = Math.min(780, card.width - 140), h = 66;
    const cx = card.left + card.width / 2;
    geo = { left: Math.round(cx - w / 2), w: Math.round(w), h, top: innerHeight - h, bottom: innerHeight };
    const s = form.style;
    s.left = geo.left + 'px'; s.width = geo.w + 'px'; s.height = h + 'px';
    s.setProperty('--gw', innerWidth + 'px'); s.setProperty('--gh', innerHeight + 'px'); s.setProperty('--nw', geo.w + 'px');
    s.setProperty('--gx', -geo.left + 'px'); s.setProperty('--gy', -geo.top + 'px');
    hot.style.left = geo.left + 'px'; hot.style.width = geo.w + 'px';
  }

  // The strips for the part of the notch above `wipe`: nothing above that line is claimed, so the region and the
  // notch can never disagree about what is there. The page shows through everywhere else.
  function bandMessage(wipe) {
    const { left, w, top, bottom } = geo, R = Math.round, f = FLARE;
    const T = Math.max(top, wipe);                        // the notch's visible top: round corners ride the wipe line
    const strip = (x, y, sw, h, cut) => {
      const y0 = Math.max(y, wipe), y1 = y + h;
      return y1 - y0 < 2 ? null : { x: R(x), y: R(y0), w: R(sw), h: R(y1 - y0), cut };
    };
    const rr = Math.min(NR, bottom - T);                  // a lip shorter than the corner radius rounds off with a smaller one
    const disc = (cx, cy) => (rr < 4 ? null : { y: R(cy), h: 1, disc: [R(cx), R(cy), rr] });
    const list = [
      rimReady && p > .85 ? strip(left - RIM, top - RIM, RIM, bottom - FLARE - top + RIM) : null,
      rimReady && p > .85 ? strip(left + w, top - RIM, RIM, bottom - FLARE - top + RIM) : null,
      rimReady && p > .85 ? strip(left + NR, top - RIM, w - 2 * NR, RIM) : null,
      strip(left + rr, T, w - 2 * rr, bottom - T),
      strip(left, T + rr, w, bottom - T - rr),
      disc(left + rr, T + rr), disc(left + w - rr, T + rr),
      p > .85 ? strip(left - f, bottom - f, f, f, [R(left - f), R(bottom - f), f]) : null,
      p > .85 ? strip(left + w, bottom - f, f, f, [R(left + w + f), R(bottom - f), f]) : null,
    ].filter(Boolean);
    if (popKind && p > .85) {
      const r = pop.getBoundingClientRect(), q = PR;
      if (r.width > 2 * q && r.height > 2 * q) {
        const raw = (x, y, bw, bh) => ({ x: R(x), y: R(y), w: R(bw), h: R(bh) }), dc = (cx, cy) => ({ y: R(cy), h: 1, disc: [R(cx), R(cy), q] });
        list.push(raw(r.left + q, r.top, r.width - 2 * q, r.height), raw(r.left, r.top + q, r.width, r.height - 2 * q),
          dc(r.left + q, r.top + q), dc(r.right - q, r.top + q), dc(r.left + q, r.bottom - q), dc(r.right - q, r.bottom - q));
      }
    }
    return list.length ? { t: 'chrome', band: list } : null;
  }
  // Rise and fall are one thing: how much of the notch is let out (0..1). The region wipes from the bottom edge up and the
  // notch itself slides a third as far, so it always covers everything the region lets through.
  function apply() {
    const out = (1 - p) * geo.h;
    form.style.transform = `translateY(${(out * .3).toFixed(1)}px)`;
    hot.style.height = Math.max(4, geo.h * p - 4) + 'px';
    const m = p > .004 ? bandMessage(geo.top + out) : null;
    if (m) { bandOn = true; send(m); }
    else if (bandOn) { bandOn = false; if (!isAsk()) send({ t: 'chrome', band: null }); }
  }
  function run() {
    clearInterval(timer);
    timer = setInterval(() => {
      p += (goal - p) * .2 + Math.sign(goal - p) * .004;
      if (Math.abs(goal - p) < .006) { p = goal; clearInterval(timer); timer = 0; }
      form.hidden = p <= .004;
      apply();
    }, 14);
  }
  function go(to) {
    if (!geo || to > goal) { measure(); }
    form.hidden = false; goal = to; run();
  }

  function show() {
    if (blocked()) return;
    if (armed) { input.focus(); return; }
    armed = true; hot.style.pointerEvents = 'none';
    go(1);
    loadRim();
    setTimeout(() => input.focus(), 180);
  }
  function hide() {
    if (!armed) return;
    armed = false; hot.style.pointerEvents = '';
    closePop();
    rimReady = false; rim.hidden = true;
    go(0);
  }
  const toggle = () => (armed ? hide() : show());

  // The lip: the pointer anywhere near the notch's spot along the bottom lets the top of it out; a click opens it.
  // The page is a native window that hides the pointer from the chrome, so the shell reports where it is.
  function cursor(m) {
    if (armed) return;
    const near = m.on && geo && m.x > geo.left - 70 && m.x < geo.left + geo.w + 70 && m.y > innerHeight - 110 && !blocked();
    if (near && goal === 0) go(LIP);
    else if (!near && goal === LIP) go(0);
  }
  hot.addEventListener('click', show);
  form.addEventListener('click', () => { if (!armed) show(); });
  // Anywhere outside the notch puts it away (a click on the page is a focus change; see below).
  document.addEventListener('pointerdown', e => { if (armed && !form.contains(e.target) && !pop.contains(e.target)) hide(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && popKind) { e.stopPropagation(); closePop(); } }, true);
  const syncHot = () => { hot.hidden = armed ? true : blocked(); if (!armed && !blocked() && p === 0) measure(); };
  setInterval(syncHot, 300);

  // Anything that takes the page over (a view, a menu, the chat itself) puts the notch away.
  const observer = new MutationObserver(() => { if (armed && blocked()) hide(); syncHot(); });
  for (const sel of ['#ask', '#panel', '#cmdbar', '#menu', '#menuSub', '#shotTool', '#newSpace', '#canvasView', '#settingsView', '#page'])
    observer.observe($(sel), { attributes: true, attributeFilter: ['hidden', 'class'] });
  const relayout = () => { if (p > 0) { measure(); apply(); } };
  addEventListener('resize', relayout);
  new ResizeObserver(relayout).observe($('#pageCard'));
  // Leaving the field (a click into the page, another window) puts it away; moving between its own buttons does not.
  form.addEventListener('focusout', e => {
    if (form.contains(e.relatedTarget) || pop.contains(e.relatedTarget)) return;
    setTimeout(() => { if (armed && !form.contains(document.activeElement) && !pop.contains(document.activeElement) && !isAsk()) hide(); }, 140);
  });
  pop.addEventListener('focusout', e => {
    if (form.contains(e.relatedTarget) || pop.contains(e.relatedTarget)) return;
    setTimeout(() => { if (armed && !form.contains(document.activeElement) && !pop.contains(document.activeElement) && !isAsk()) hide(); }, 140);
  });

  const showModel = () => {
    const text = input.value.trim();
    model.hidden = !text;
    form.querySelector('.cp-send').hidden = !text;
    $('#cpMic').hidden = !!text;
    if (text) model.textContent = Rainbow.ask?.modelName?.() || 'Rainbow';
  };
  input.addEventListener('input', showModel);
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; showModel(); hide(); }
  });

  const send_ = text => { input.value = ''; showModel(); hide(); Rainbow.ask?.open(text); };
  form.onsubmit = e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    send_(text);
  };
  $('#cpAgent').onclick = () => send_(input.value.trim());
  $('#cpCanvas').onclick = () => openPop('canvas');
  $('#cpSettings').onclick = () => openPop('tasks');
  $('#cpNew').onclick = () => openPop('tabs');
  // Dictation has to write into this input, not the hidden Ask input, so it has its own small
  // speech path; on Windows the shell opens the system dictation over the focused field.
  let rec = null;
  $('#cpMic').onclick = () => {
    input.focus();
    if (Rainbow.NATIVE && document.documentElement.dataset.os === 'windows') return Rainbow.send({ t: 'dictate' });
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return Rainbow.toast('Dictation is not available here.');
    if (rec) return rec.stop();
    rec = new SR();
    rec.interimResults = true; rec.lang = navigator.language;
    const base = input.value ? input.value.replace(/\s*$/, ' ') : '';
    rec.onresult = e => { input.value = base + [...e.results].map(r => r[0].transcript).join(''); showModel(); };
    rec.onend = () => { rec = null; $('#cpMic').classList.remove('on'); input.focus(); };
    rec.onerror = e => Rainbow.toast(e.error === 'not-allowed' ? 'Microphone access was blocked.' : 'Dictation stopped.');
    $('#cpMic').classList.add('on'); rec.start();
  };
  model.onclick = () => send_(input.value.trim());

  Rainbow.composer = { show, hide, toggle, cursor, get open() { return armed; }, get bandOn() { return bandOn; } };
})();
