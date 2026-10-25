'use strict';
/* On-device models. Two small models, used apart or together, both running on this machine:

     Sorter   a sentence-embedding model. It reads a card and says which topic it sits closest to.
     Decider  a small instruction model that makes one decision at a time ("which of these?"), the shape the
              page agent in jev.js uses.

   "Both" is the fusion: the Sorter answers when it is sure; when two topics are close it hands the decision to
   the Decider, with just those candidates. Neither is installed by default. Installing downloads the model once
   from its public host into this browser's cache; after that every decision is made locally.

   `Wave.localModel.classify(card)` is the one call the Canvas makes. It answers null when nothing is installed,
   and the Canvas falls back to its keyword scorer. */
(() => {
  const { h } = Wave;
  const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm';
  const MODELS = {
    sorter: { id: 'sorter', name: 'Sorter', role: 'Files Canvas cards under the right topic', repo: 'Xenova/all-MiniLM-L6-v2', task: 'feature-extraction', size: '~23 MB', opts: { dtype: 'q8' } },
    decider: { id: 'decider', name: 'Decider', role: 'Makes one small decision at a time, for sorting and for the assistant', repo: 'onnx-community/Qwen2.5-0.5B-Instruct', task: 'text-generation', size: '~400 MB', opts: { dtype: 'q4' } },
  };
  const st = Wave.state.models ||= { mode: 'both', installed: {} };
  const pipes = {}, status = {};   // loaded pipelines; 'idle' | 'loading' | 'ready' | 'error'
  let lib = null;

  const emit = () => Wave.onModels?.();
  const runtime = async () => {
    if (!lib) {
      lib = await import(RUNTIME);
      lib.env.allowLocalModels = false;
      lib.env.useBrowserCache = true;
    }
    return lib;
  };

  async function install(id) {
    const m = MODELS[id];
    if (!m || status[id] === 'loading') return;
    status[id] = 'loading'; m.progress = 0; emit();
    try {
      const { pipeline } = await runtime();
      const device = id === 'decider' && navigator.gpu ? 'webgpu' : 'wasm';
      pipes[id] = await pipeline(m.task, m.repo, { ...m.opts, device,
        progress_callback: p => { if (p.status === 'progress' && p.total) { m.progress = Math.round(p.loaded / p.total * 100); emit(); } } });
      st.installed[id] = true; status[id] = 'ready'; Wave.save();
    } catch (e) {
      status[id] = 'error'; m.error = String(e.message || e);
    }
    emit();
  }
  async function remove(id) {
    delete pipes[id]; status[id] = 'idle'; st.installed[id] = false; Wave.save();
    try { for (const name of await caches.keys()) { const c = await caches.open(name); for (const r of await c.keys()) if (r.url.includes(MODELS[id].repo)) await c.delete(r); } } catch {}
    emit();
  }
  // A model that was installed earlier loads from the cache the first time it is asked.
  async function ready(id) {
    if (pipes[id]) return pipes[id];
    if (!st.installed[id]) return null;
    await install(id);
    return pipes[id] || null;
  }
  const on = id => (st.mode === 'both' || st.mode === id) && st.installed[id];

  /* ---- the Sorter: nearest topic by meaning ---- */
  let protos = null;   // topic name -> unit vector
  const unit = v => { const n = Math.hypot(...v) || 1; return v.map(x => x / n); };
  async function embed(text) {
    const p = await ready('sorter');
    const out = await p(String(text).slice(0, 600), { pooling: 'mean', normalize: true });
    return Array.from(out.data);
  }
  async function prototypes(topics) {
    protos ||= {};
    for (const [name, words] of Object.entries(topics)) if (!protos[name]) protos[name] = await embed(`${name}: ${words.join(', ')}`);
    return protos;
  }
  const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  async function nearest(card, topics) {
    const protosNow = await prototypes(topics);
    const v = await embed(`${card.title || ''} ${card.text || ''} ${card.url ? new URL(card.url, 'https://x').hostname : ''}`);
    // Meaning first; a few exact keyword hits nudge it, so "useEffect" never lands under Music.
    const words = new Set(`${card.title || ''} ${card.text || ''}`.toLowerCase().split(/[^a-z0-9]+/));
    return Object.entries(protosNow).map(([topic, p]) => ({ topic, score: dot(v, p) + .04 * Math.min(3, topics[topic].filter(k => words.has(k)).length) })).sort((a, b) => b.score - a.score);
  }

  /* ---- the Decider: one choice among a few ---- */
  async function decide({ question, options }) {
    const p = await ready('decider');
    if (!p) return null;
    // A small model is steadier naming an option than numbering it: it is asked for the word, and the
    // reply is matched back to the options.
    const msgs = [
      { role: 'system', content: 'You make one decision. Reply with exactly one of the allowed words and nothing else.' },
      { role: 'user', content: `${question}
Allowed words: ${options.join(', ')}.
Reply:` },
    ];
    const out = await p(msgs, { max_new_tokens: 6, do_sample: false });
    const text = String(out[0]?.generated_text?.at?.(-1)?.content ?? out[0]?.generated_text ?? '').toLowerCase();
    let best = null, at = 1e9;
    for (const o of options) { const i = text.indexOf(String(o).toLowerCase()); if (i >= 0 && i < at) { at = i; best = o; } }
    return best;
  }

  /* ---- what the Canvas calls ---- */
  async function classify(card) {
    const topics = Wave.canvas?.topicWords?.();
    if (!topics || st.mode === 'off') return null;
    const names = Object.keys(topics), q = `${card.title || ''}. ${String(card.text || '').slice(0, 300)} (${card.url || ''})`;
    if (on('sorter')) {
      const ranked = await nearest(card, topics);
      const [a, b] = ranked;
      const sure = !b || a.score - b.score >= .06;
      if (sure || !on('decider')) return a.topic;
      return (await decide({ question: `Which topic fits this best?\n${q}`, options: ranked.slice(0, 3).map(r => r.topic) })) || a.topic;
    }
    if (on('decider')) return await decide({ question: `Which topic fits this best?\n${q}`, options: names });
    return null;
  }

  Wave.localModel = { classify, decide, install, remove, MODELS, status: id => status[id] || (st.installed[id] ? 'installed' : 'idle') };
  Wave.modelsPage = () => {
    const row = m => {
      const s = Wave.localModel.status(m.id);
      const label = s === 'loading' ? `Downloading ${m.progress || 0}%` : s === 'ready' || s === 'installed' ? 'Ready' : s === 'error' ? 'Could not download' : 'Not installed';
      return h('div', { class: 'model-row' },
        h('div', { class: 'mr-t' }, h('strong', {}, `${m.name} · ${m.size}`), h('span', { class: 'hint' }, m.role),
          s === 'error' ? h('span', { class: 'hint' }, m.error || '') : null,
          s === 'loading' ? h('div', { class: 'mr-bar' }, h('i', { style: `width:${m.progress || 0}%` })) : null),
        h('span', { class: 'hint' }, label),
        s === 'ready' || s === 'installed'
          ? h('button', { class: 'btn', onclick: () => remove(m.id) }, 'Remove')
          : h('button', { class: 'btn primary', disabled: s === 'loading', onclick: () => install(m.id) }, 'Install'));
    };
    return [Object.values(MODELS).map(row), st.mode];
  };
  Wave.setModelMode = mode => { st.mode = mode; Wave.save(); emit(); };
})();
