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
  const FLARE = 22, NR = 22, MS = 420;
  let armed = false, bandOn = false, tracking = 0, hideTimer = 0;
  const isAsk = () => !$('#ask').hidden;
  const blocked = () => Rainbow.view !== 'page' || isAsk() ||
    !$('#panel').hidden || !$('#cmdbar').hidden || !$('#menu').hidden || !$('#menuSub').hidden ||
    !$('#shotTool').hidden || !$('#newSpace').hidden;

  // The strips for the notch where it is right now, cut off at the page's bottom edge.
  function bandMessage() {
    const r = form.getBoundingClientRect(), edge = $('#pageCard').getBoundingClientRect().bottom, R = Math.round, f = FLARE;
    const strip = (x, y, w, h, cut) => (edge - y < 3 || w <= 0 || h <= 0) ? null : { x: R(x), y: R(y), w: R(w), h: R(Math.min(y + h, edge) - y), cut };
    const disc = (cx, cy) => edge - (cy - NR) < 3 ? null : { y: R(cy), h: 1, disc: [R(cx), R(cy), NR] };
    const top = r.bottom - f;
    // The notch is two rectangles that leave its top corners out, and a round piece for each corner.
    const list = [
      strip(r.left + NR, r.top, r.width - 2 * NR, r.height),
      strip(r.left, r.top + NR, r.width, r.height - NR),
      disc(r.left + NR, r.top + NR), disc(r.right - NR, r.top + NR),
      strip(r.left - f, top, f, f, [R(r.left - f), R(top), f]),
      strip(r.right, top, f, f, [R(r.right + f), R(top), f]),
    ].filter(Boolean);
    return list.length ? { t: 'chrome', band: list } : null;
  }
  function sendBand() {
    const m = bandMessage();
    if (m) { bandOn = true; send(m); }
  }
  // While the notch moves, follow it every few milliseconds. Timers, not frames: a hidden window makes none.
  function follow() {
    const until = Date.now() + MS + 80;
    clearInterval(tracking);
    tracking = setInterval(() => { sendBand(); if (Date.now() > until) { clearInterval(tracking); tracking = 0; } }, 16);
  }

  // Lay the shell's gradient behind the notch where the window would have it (see rainbow.css).
  function paint() {
    const w = form.offsetWidth, s = form.style;
    s.setProperty('--gw', innerWidth + 'px'); s.setProperty('--gh', innerHeight + 'px');
    s.setProperty('--nw', w + 'px');
    s.setProperty('--gx', -(innerWidth - w) / 2 + 'px'); s.setProperty('--gy', -(innerHeight - form.offsetHeight) + 'px');
  }
  function show() {
    if (blocked() || armed) { if (armed) input.focus(); return; }
    armed = true;
    clearTimeout(hideTimer);
    form.hidden = false;
    paint();
    form.getBoundingClientRect();           // start from where it is hidden, then rise
    form.classList.add('show');
    follow();
    setTimeout(() => input.focus(), 160);
  }
  function hide() {
    if (!armed) return;
    armed = false;
    form.classList.remove('show');
    follow();
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (armed) return;
      form.hidden = true;
      if (bandOn) { bandOn = false; if (!isAsk()) send({ t: 'chrome', band: null }); }
    }, MS);
  }
  const toggle = () => (armed ? hide() : show());

  // Anything that takes the page over (a view, a menu, the chat itself) puts the notch away.
  const observer = new MutationObserver(() => { if (armed && blocked()) hide(); });
  for (const sel of ['#ask', '#panel', '#cmdbar', '#menu', '#menuSub', '#shotTool', '#newSpace', '#canvasView', '#settingsView', '#page'])
    observer.observe($(sel), { attributes: true, attributeFilter: ['hidden', 'class'] });
  addEventListener('resize', () => { if (armed) { paint(); sendBand(); } });
  new ResizeObserver(() => { if (armed) sendBand(); }).observe($('#pageCard'));
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
