'use strict';
/* The resting Ask composer: a notch at the bottom of the page that grows into the chat. The
   page is a native view above the chrome, so the shell clips a band of chrome out over the page
   for it; the page itself never moves. */
(() => {
  const { $, send } = Rainbow;
  const form = $('#composer'), input = $('#cpInput'), model = $('#cpModel');
  let bandOn = false, queued = 0;
  const isAsk = () => !$('#ask').hidden;
  const blocked = () => Rainbow.view !== 'page' || isAsk() ||
    !$('#panel').hidden || !$('#cmdbar').hidden || !$('#menu').hidden || !$('#menuSub').hidden ||
    !$('#shotTool').hidden || !$('#newSpace').hidden;

  function bandMessage() {
    if (form.hidden) return null;
    const r = form.getBoundingClientRect();
    if (!r.height) return null;
    // Three strips, not a whole row: the notch itself and the two corner pieces beside its base, so the
    // page stays live and visible on either side of it.
    const f = 22, R = Math.round;
    return { t: 'chrome', band: [
      { x: R(r.left), y: R(r.top), w: R(r.width), h: R(r.height) },
      { x: R(r.left - f), y: R(r.bottom - f), w: f, h: f },
      { x: R(r.right), y: R(r.bottom - f), w: f, h: f },
    ] };
  }
  function sendBand() {
    const m = bandMessage();
    if (m) send(m);
  }
  function place() {
    const show = !blocked();
    const was = form.hidden;
    form.hidden = !show;
    if (show && (was || !bandOn)) {
      bandOn = true;
      sendBand();
    } else if (!show && bandOn) {
      bandOn = false;
      // Ask's wash owns the band while it is open; it clears its own on close.
      if (!isAsk()) send({ t: 'chrome', band: null });
    } else if (show) {
      sendBand();   // the page or the sidebar changed width
    }
  }
  // Timers, not rAF: a hidden/occluded tab produces no frames, and the notch must still appear
  // when the chat closes or the view returns.
  const queue = () => { if (!queued) queued = setTimeout(() => { queued = 0; place(); }, 0); };

  // One observer covers the resting state: any overlay or view that takes the page hides the
  // notch, and its close brings it back.
  const observer = new MutationObserver(queue);
  for (const sel of ['#ask', '#panel', '#cmdbar', '#menu', '#menuSub', '#shotTool', '#newSpace', '#canvasView', '#settingsView', '#page'])
    observer.observe($(sel), { attributes: true, attributeFilter: ['hidden', 'class'] });
  addEventListener('resize', queue);
  new ResizeObserver(queue).observe($('#pageCard'));

  const showModel = () => {
    const text = input.value.trim();
    model.hidden = !text;
    form.querySelector('.cp-send').hidden = !text;
    $('#cpMic').hidden = !!text;
    if (text) model.textContent = Rainbow.ask?.modelName?.() || 'Rainbow';
  };
  input.addEventListener('input', showModel);
  input.addEventListener('focus', () => { if (Rainbow.view !== 'page') Rainbow.setView('page'); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { input.value = ''; showModel(); input.blur(); }
  });

  form.onsubmit = e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return input.focus();
    input.value = ''; showModel();
    Rainbow.ask?.open(text);
  };
  $('#cpAgent').onclick = () => { const text = input.value.trim(); input.value = ''; showModel(); Rainbow.ask?.open(text); };
  $('#cpCanvas').onclick = () => Rainbow.setView('canvas');
  $('#cpSettings').onclick = () => Rainbow.openSettings('look');
  $('#cpNew').onclick = () => Rainbow.openCmd('new');
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
  model.onclick = () => { const text = input.value.trim(); input.value = ''; showModel(); Rainbow.ask?.open(text); };

  // Boot: the page view and the shell band settle a beat after the scripts run.
  for (const t of [0, 250, 900]) setTimeout(place, t);
  Rainbow.composer = { place, get bandOn() { return bandOn; } };
})();
