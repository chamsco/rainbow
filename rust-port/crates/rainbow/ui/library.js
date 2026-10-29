/* Library: the sidebar turns into a rail of sections (spaces, canvas, history, boosts,
   downloads, archive) with a searchable list beside it. */
(() => {
  const { h, $, favicon, hostOf } = Rainbow;
  const S = () => Rainbow.state;
  const svg = d => `<svg viewBox="0 0 16 16">${d}</svg>`;
  const SECTIONS = [
    ['spaces', 'Spaces', svg('<rect x="2" y="2.5" width="12" height="11" rx="2.5"/><path d="M6 2.5v11"/>')],
    ['canvas', 'Canvas', svg('<rect x="2" y="2" width="5" height="6" rx="1.2"/><rect x="9" y="2" width="5" height="4" rx="1.2"/><rect x="2" y="10" width="5" height="4" rx="1.2"/><rect x="9" y="8" width="5" height="6" rx="1.2"/>')],
    ['history', 'History', svg('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>')],
    ['boosts', 'Boosts', svg('<path d="M8 1.5 9.6 6l4.4.4-3.4 2.8 1 4.3L8 11.2l-3.6 2.3 1-4.3L2 6.4 6.4 6z"/>')],
    ['downloads', 'Downloads', svg('<path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10"/>')],
    ['prompts', 'Prompts', svg('<path d="M3 3.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z"/>')],
    ['routines', 'Routines', svg('<path d="M13 8a5 5 0 1 1-1.5-3.5M13 2.5V5h-2.5M8 5.5V8l1.8 1.2"/>')],
    ['archive', 'Archive', svg('<rect x="2" y="3" width="12" height="3" rx="1"/><path d="M3 6v6.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6M6.5 9h3"/>')],
  ];
  const lib = $('#library'), side = $('#sidebar');
  let section = null, q = '', editing = null;
  S().prompts ||= [];
  S().routines ||= [];

  function open(sec = 'spaces') {
    section = sec; q = ''; editing = null;
    side.classList.add('lib'); lib.hidden = false;
    draw();
    lib.querySelector('.lib-search input')?.focus();
  }
  function close() {
    if (!section) return;
    section = null;
    side.classList.remove('lib'); lib.hidden = true;
  }

  const has = (...xs) => !q || xs.some(x => (x || '').toLowerCase().includes(q));
  const item = (lead, text, sub, onclick, extra = {}) =>
    h('button', { class: 'lib-item', onclick, ...extra }, lead, h('span', { class: 't' }, text), sub ? h('small', {}, sub) : null);
  const day = t => {
    const d = new Date(t), today = new Date();
    const diff = Math.round((new Date(today.toDateString()) - new Date(d.toDateString())) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  };
  const time = t => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  function byDay(rows, render) {
    const out = [];
    let last = '';
    for (const r of rows) { const d = day(r.t); if (d !== last) { out.push(h('h3', {}, d)); last = d; } out.push(render(r)); }
    return out;
  }
  const empty = text => h('p', { class: 'lib-empty' }, text);

  function list() {
    const st = S();
    switch (section) {
      case 'spaces': return [
        ...st.spaces.filter(s => has(s.name)).map(s => item(h('span', { class: 'emoji' }, s.icon), s.name, `${s.pinned.length + s.today.length} tabs`,
          () => { Rainbow.switchSpace(s.id); close(); },
          { class: `lib-item${s.id === st.activeSpace ? ' on' : ''}`, oncontextmenu: e => { e.preventDefault(); Rainbow.spaceMenu(s, e.clientX, e.clientY); } })),
        h('div', { class: 'lib-actions' }, h('button', { class: 'btn', onclick: () => { close(); Rainbow.newSpace(); } }, 'New space')),
      ];
      case 'canvas': {
        const topics = [...new Set(st.bookmarks.map(b => b.topic))];
        const cards = st.bookmarks.filter(b => has(b.title, b.note, b.url, b.topic, b.ocr)).slice().reverse();
        return [
          h('div', { class: 'lib-actions' },
            h('button', { class: 'btn', onclick: () => Rainbow.setView('canvas') }, 'Open board'),
            h('button', { class: 'btn', onclick: () => { Rainbow.setView('canvas'); Rainbow.canvas.discover(); } }, 'Discover')),
          topics.length ? h('h3', {}, 'Topics') : null,
          ...topics.filter(t => has(t)).map(t => item(h('span', { class: 'emoji' }, '◌'), t, String(st.bookmarks.filter(b => b.topic === t).length),
            () => { Rainbow.setView('canvas'); Rainbow.canvas.showTopic(t); })),
          cards.length ? h('h3', {}, 'Recently saved') : empty('Save pages with Ctrl+D, or press Discover to find something new.'),
          ...cards.slice(0, 60).map(b => item(b.url ? favicon(b.url) : h('span', { class: 'emoji' }, '❝'), b.title || b.note, b.topic,
            () => { Rainbow.setView('canvas'); Rainbow.canvas.flyToCard(b); })),
        ];
      }
      case 'history': {
        const rows = st.history.filter(x => has(x.title, x.url)).slice(0, 300);
        return rows.length ? byDay(rows, x => item(favicon(x.url), x.title || hostOf(x.url), time(x.t), () => Rainbow.openTab(x.url, { title: x.title })))
          : [empty(q ? 'Nothing in your history matches.' : 'Pages you visit show up here.')];
      }
      case 'boosts': {
        const rows = Object.entries(st.boosts).filter(([d]) => has(d));
        return rows.length ? rows.map(([d, b]) => item(favicon('https://' + d), d, b.on ? 'On' : 'Off',
          () => { Rainbow.setBoost(d, { on: !b.on }); draw(); }, { title: b.on ? 'Turn this boost off' : 'Turn this boost on' }))
          : [empty('Boost a site from the star in the address bar to restyle it.')];
      }
      case 'downloads': {
        const rows = st.downloads.filter(d => has(d.path, d.url));
        const name = d => (d.path || d.url).split(/[\\/]/).pop();
        return rows.length ? byDay(rows, d => item(favicon(d.url), name(d), d.state === 'started' ? 'Downloading…' : d.state === 'failed' ? 'Failed' : time(d.t),
          () => { navigator.clipboard?.writeText(d.path || d.url); Rainbow.toast('Copied the file path'); }, { title: d.path || d.url }))
          : [empty(Rainbow.NATIVE ? 'Files you download show up here.' : 'Downloads show up here in the Rainbow app.')];
      }
      case 'prompts': {
        if (editing?.kind === 'prompts') return [form(editing.item)];
        const rows = S().prompts.filter(x => has(x.title, x.text));
        return [
          h('div', { class: 'lib-actions' }, h('button', { class: 'btn', onclick: () => { editing = { kind: 'prompts', item: null }; draw(); } }, 'New prompt')),
          ...(rows.length ? rows.map(x => item(h('span', { class: 'emoji' }, '✦'), x.title, 'Run', () => Rainbow.ask.open(x.text),
            { title: x.text, oncontextmenu: e => { e.preventDefault(); Rainbow.menu(e.clientX, e.clientY, [['Run', () => Rainbow.ask.open(x.text)], ['Edit…', () => { editing = { kind: 'prompts', item: x }; draw(); }],
              '-', ['Delete', () => { S().prompts = S().prompts.filter(y => y !== x); Rainbow.save(); draw(); }, 'danger']]); } }))
            : [empty('Save a request you make often, then run it from here or from Ask Rainbow.')]),
        ];
      }
      case 'routines': {
        if (editing?.kind === 'routines') return [form(editing.item)];
        const rows = S().routines.filter(x => has(x.title, x.text));
        return [
          h('div', { class: 'lib-actions' }, h('button', { class: 'btn', onclick: () => { editing = { kind: 'routines', item: null }; draw(); } }, 'New routine')),
          ...(rows.length ? rows.map(x => item(h('span', { class: 'emoji' }, '↻'), x.title, when(x), () => runRoutine(x),
            { title: x.text, oncontextmenu: e => { e.preventDefault(); Rainbow.menu(e.clientX, e.clientY, [['Run now', () => runRoutine(x)], ['Edit…', () => { editing = { kind: 'routines', item: x }; draw(); }],
              '-', ['Delete', () => { S().routines = S().routines.filter(y => y !== x); Rainbow.save(); draw(); }, 'danger']]); } }))
            : [empty('A routine is a prompt that runs by itself: when Rainbow starts, or every day at a time you pick.')]),
        ];
      }
      case 'archive': {
        const rows = st.archive.filter(a => has(a.title, a.url));
        return rows.length ? byDay(rows, a => item(favicon(a.url), a.title || a.url, time(a.t), () => Rainbow.openTab(a.url)))
          : [empty('Tabs you close, and Today tabs Rainbow tidies away, land here.')];
      }
    }
    return [];
  }

  /* Prompts and routines share one editor: a title, the request, and (routines) when to run. */
  // The schedule is what it will do; the last run is what it actually did. Both belong on the row,
  // or a routine that has been failing silently looks identical to one that has never run.
  const when = r => {
    const schedule = r.when === 'startup' ? 'On start' : r.when === 'daily' ? `Daily ${r.time || '09:00'}` : 'Manual';
    return r.last ? `${schedule} · last ${day(r.last)}` : schedule;
  };
  function form(it) {
    const kind = editing.kind, routine = kind === 'routines';
    const title = h('input', { type: 'text', placeholder: 'Name', value: it?.title || '', 'aria-label': 'Name' });
    const text = h('textarea', { rows: 4, placeholder: 'What should Rainbow do?', 'aria-label': 'Request' }, it?.text || '');
    const whenSel = h('select', { 'aria-label': 'When' }, [['manual', 'Only when I run it'], ['startup', 'When Rainbow starts'], ['daily', 'Every day at…']]
      .map(([v, l]) => h('option', { value: v, selected: (it?.when || 'manual') === v }, l)));
    const time = h('input', { type: 'time', value: it?.time || '09:00', 'aria-label': 'Time' });
    const done = () => { editing = null; draw(); };
    return h('form', { class: 'lib-form', onsubmit: e => {
      e.preventDefault();
      if (!text.value.trim()) return text.focus();
      const v = { title: title.value.trim() || text.value.trim().slice(0, 32), text: text.value.trim() };
      if (routine) Object.assign(v, { when: whenSel.value, time: time.value || '09:00' });
      if (it) Object.assign(it, v); else S()[kind].push({ id: Rainbow.uid(), ...v, last: 0 });
      Rainbow.save(); done();
    } }, title, text, routine ? whenSel : null, routine ? time : null,
      h('div', { class: 'lib-actions' }, h('button', { type: 'button', class: 'btn', onclick: done }, 'Cancel'), h('button', { type: 'submit', class: 'btn primary' }, 'Save')));
  }
  function runRoutine(r) { r.last = Date.now(); Rainbow.save(); Rainbow.ask.open(r.text); }
  // Due routines run while Rainbow is open: once at start, and a daily one when its time passes.
  const dueCheck = start => {
    if (!Rainbow.ask || Rainbow.ask.isOpen()) return;
    const now = new Date(), today = now.toDateString();
    const r = S().routines.find(x => (start && x.when === 'startup') ||
      (x.when === 'daily' && (x.last ? new Date(x.last).toDateString() !== today : true) && (now.getHours() * 60 + now.getMinutes()) >= ((x.time || '09:00').split(':')[0] * 60 + +(x.time || '09:00').split(':')[1])));
    if (r) runRoutine(r);
  };
  setTimeout(() => dueCheck(true), 4000);
  setInterval(() => dueCheck(false), 60e3);

  function draw() {
    if (!section) return;
    const [, title] = SECTIONS.find(x => x[0] === section);
    const listEl = h('div', { class: 'lib-list' }, list());
    const search = h('input', { placeholder: `Search ${title.toLowerCase()}`, value: q, 'aria-label': `Search ${title}`,
      oninput: e => { q = e.target.value.trim().toLowerCase(); listEl.replaceChildren(...list()); } });
    lib.replaceChildren(
      h('nav', { class: 'lib-rail', 'aria-label': 'Library' }, SECTIONS.map(([id, name, icon]) =>
        h('button', { class: id === section ? 'on' : '', title: name, 'aria-label': name, 'aria-current': id === section ? 'page' : null, innerHTML: icon,
          onclick: () => { section = id; q = ''; editing = null; draw(); } }))),
      h('section', { class: 'lib-panel' },
        h('header', {}, h('h2', {}, title), h('button', { class: 'icon-btn sm', title: 'Back to tabs', 'aria-label': 'Back to tabs', onclick: close,
          innerHTML: svg('<path d="m4.5 4.5 7 7M11.5 4.5l-7 7"/>') })),
        h('label', { class: 'lib-search', innerHTML: svg('<circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/>') }, search),
        listEl));
  }
  lib.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });

  // The Canvas button and the current space's dot open the library.
  $('#canvasBtn').onclick = () => {
    if (Rainbow.view === 'canvas') { Rainbow.setView('page'); close(); } else { Rainbow.setView('canvas'); open('canvas'); }
  };
  $('#spaceDots').addEventListener('click', e => {
    const dot = e.target.closest('.dot');
    if (dot && +dot.dataset.space === S().activeSpace && dot.classList.contains('active')) { e.stopPropagation(); section === 'spaces' ? close() : open('spaces'); }
  }, true);

  Rainbow.library = { open, close, refresh: draw, get section() { return section; } };
})();
