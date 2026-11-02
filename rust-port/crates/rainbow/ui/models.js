'use strict';
/* The one local model, running on this machine:

     Sorter   a sentence-embedding model. It reads a Trove card and says which topic it sits closest to.

   Screenshots are read by Windows' own OCR and the Sorter classifies the text locally, so nothing is
   uploaded. The model is not installed by default: installing downloads it once from its public host into
   this browser's cache, and after that every classification is made here.

   `Rainbow.localModel.classify(card)` is the one call the Trove makes. It answers null when nothing is
   installed, and the Trove falls back to its keyword scorer. */
(() => {
  const { h } = Rainbow;
  const RUNTIME = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/+esm';
  const MODELS = {
    sorter: { id: 'sorter', name: 'Sorter', role: 'Files Trove cards under the right topic', repo: 'Xenova/all-MiniLM-L6-v2', task: 'feature-extraction', size: '~23 MB', opts: { dtype: 'q8' } },
  };
  const st = Rainbow.state.models ||= { installed: {} };
  const pipes = {}, status = {};   // loaded pipelines; 'idle' | 'loading' | 'ready' | 'error'
  let lib = null;

  const emit = () => Rainbow.onModels?.();
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
      pipes[id] = await pipeline(m.task, m.repo, { ...m.opts, device: 'wasm',
        progress_callback: p => { if (p.status === 'progress' && p.total) { m.progress = Math.round(p.loaded / p.total * 100); emit(); } } });
      st.installed[id] = true; status[id] = 'ready'; Rainbow.save();
    } catch (e) {
      status[id] = 'error'; m.error = String(e.message || e);
    }
    emit();
  }
  async function remove(id) {
    delete pipes[id]; status[id] = 'idle'; st.installed[id] = false; Rainbow.save();
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

  /* ---- the Sorter: nearest topic by meaning ---- */
  let protos = null;   // topic name -> unit vector
  async function embed(text) {
    const p = await ready('sorter');
    if (!p) return null;
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
    if (!v) return [];
    // Meaning first; a few exact keyword hits nudge it, so "useEffect" never lands under Music.
    const words = new Set(`${card.title || ''} ${card.text || ''}`.toLowerCase().split(/[^a-z0-9]+/));
    return Object.entries(protosNow).filter(([, p]) => p).map(([topic, p]) => ({ topic, score: dot(v, p) + .04 * Math.min(3, topics[topic].filter(k => words.has(k)).length) })).sort((a, b) => b.score - a.score);
  }

  /* ---- what the Trove calls ---- */
  async function classify(card) {
    const topics = Rainbow.trove?.topicWords?.();
    if (!topics || !st.installed.sorter) return null;
    const ranked = await nearest(card, topics);
    return ranked[0]?.topic ?? null;
  }

  Rainbow.localModel = { classify, install, remove, MODELS, status: id => status[id] || (st.installed[id] ? 'installed' : 'idle') };
  Rainbow.modelsPage = () => {
    const row = m => {
      const s = Rainbow.localModel.status(m.id);
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
    return Object.values(MODELS).map(row);
  };
})();
