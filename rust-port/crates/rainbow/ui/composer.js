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
  const FLARE = 22, NR = 22, LIP = .32;
  document.body.append(form);                       // the notch reaches through the frame's bottom margin, so it lives outside the page card
  const hot = Object.assign(document.createElement('div'), { id: 'notchHot', hidden: true });
  document.body.append(hot);
  let armed = false, bandOn = false, p = 0, goal = 0, timer = 0, geo = null;
  const isAsk = () => !$('#ask').hidden;
  const blocked = () => Rainbow.view !== 'page' || isAsk() ||
    !$('#panel').hidden || !$('#cmdbar').hidden || !$('#menu').hidden || !$('#menuSub').hidden ||
    !$('#shotTool').hidden || !$('#newSpace').hidden;

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
    const strip = (x, y, sw, h, cut) => {
      const y0 = Math.max(y, wipe), y1 = y + h;
      return y1 - y0 < 2 ? null : { x: R(x), y: R(y0), w: R(sw), h: R(y1 - y0), cut };
    };
    const disc = (cx, cy) => wipe > top + NR ? null : { y: R(cy), h: 1, disc: [R(cx), R(cy), NR] };
    const list = [
      strip(left + NR, top, w - 2 * NR, bottom - top),
      strip(left, top + NR, w, bottom - top - NR),
      disc(left + NR, top + NR), disc(left + w - NR, top + NR),
      p > .85 ? strip(left - f, bottom - f, f, f, [R(left - f), R(bottom - f), f]) : null,
      p > .85 ? strip(left + w, bottom - f, f, f, [R(left + w + f), R(bottom - f), f]) : null,
    ].filter(Boolean);
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
    setTimeout(() => input.focus(), 180);
  }
  function hide() {
    if (!armed) return;
    armed = false; hot.style.pointerEvents = '';
    go(0);
  }
  const toggle = () => (armed ? hide() : show());

  // The lip: hovering the frame's bottom edge under the notch lets the top of it out, and a click opens it.
  hot.addEventListener('pointerenter', () => { if (!armed && !blocked()) go(LIP); });
  hot.addEventListener('pointerleave', () => { if (!armed) go(0); });
  hot.addEventListener('click', show);
  const syncHot = () => { hot.hidden = armed ? true : blocked(); if (!hot.hidden && p === 0) measure(); };
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
    if (form.contains(e.relatedTarget)) return;
    setTimeout(() => { if (armed && !form.contains(document.activeElement) && !isAsk()) hide(); }, 140);
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
  $('#cpCanvas').onclick = () => { hide(); Rainbow.setView('canvas'); };
  $('#cpSettings').onclick = () => { hide(); Rainbow.openSettings('look'); };
  $('#cpNew').onclick = () => { hide(); Rainbow.openCmd('new'); };
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

  Rainbow.composer = { show, hide, toggle, get open() { return armed; }, get bandOn() { return bandOn; } };
})();
