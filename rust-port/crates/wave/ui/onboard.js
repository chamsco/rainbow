'use strict';
/* The first thing Wave does on a new install: a drop falls into still water, the ripples spread, flatten
   into waves, and the water settles into the app. It is drawn, not played from a file, so it takes the
   colours of the first space and costs nothing to ship. `Wave.onboard()` plays it again. */
(() => {
  const { h, $ } = Wave;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const ease = t => t * t * (3 - 2 * t);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const seg = (t, a, b) => clamp((t - a) / (b - a));   // 0..1 progress of t inside [a, b]

  function play() {
    return new Promise(done => {
      const root = h('div', { class: 'onboard', role: 'presentation' }, h('canvas', {}), h('div', { class: 'ob-word' }, 'Wave'));
      document.body.append(root);
      const canvas = root.querySelector('canvas'), g = canvas.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const A = css.getPropertyValue('--a').trim() || '#7fb2c9', B = css.getPropertyValue('--b').trim() || '#c8d9c0';
      const fit = () => { canvas.width = innerWidth; canvas.height = innerHeight; };
      fit();
      const W = () => canvas.width, H = () => canvas.height;
      const TOTAL = REDUCED ? 700 : 4600;
      let t0 = 0, raf = 0;

      const frame = now => {
        t0 ||= now;
        const ms = now - t0, t = ms / TOTAL;
        const w = W(), hgt = H(), cx = w / 2, cy = hgt * .52;
        // Still water: a deep gradient in the space's own colours.
        const bg = g.createLinearGradient(0, 0, 0, hgt);
        bg.addColorStop(0, '#0e1a22'); bg.addColorStop(1, '#16303a');
        g.fillStyle = bg; g.fillRect(0, 0, w, hgt);

        // 1. The drop falls (0 .. .2), quickening, a small bright bead.
        const fall = seg(t, 0, .2);
        if (fall > 0 && fall < 1) {
          const y = -20 + (cy + 20) * fall * fall;
          g.fillStyle = 'rgba(235,248,252,.95)';
          g.beginPath(); g.ellipse(cx, y, 5, 9 + 10 * fall, 0, 0, Math.PI * 2); g.fill();
        }
        // 2. It lands: rings leave the point, each later and softer (.2 .. .62).
        const hit = seg(t, .2, .62);
        if (hit > 0) {
          for (let i = 0; i < 5; i++) {
            const k = clamp(hit * 1.5 - i * .16);
            if (k <= 0 || k >= 1) continue;
            const r = ease(k) * Math.max(w, hgt) * .62;
            g.strokeStyle = `rgba(220,240,248,${(1 - k) * .75})`;
            g.lineWidth = 2.2 - i * .3;
            g.beginPath(); g.ellipse(cx, cy, r, r * .34, 0, 0, Math.PI * 2); g.stroke();
          }
        }
        // 3. The rings straighten into waves that fill the water (.44 .. .86).
        const wave = ease(seg(t, .44, .86));
        if (wave > 0) {
          for (let l = 0; l < 6; l++) {
            const y0 = cy + (l - 2.5) * 34 * (.4 + wave * .6), amp = (26 - l * 3) * wave;
            const col = l % 2 ? A : B;
            g.beginPath();
            for (let x = 0; x <= w; x += 8) {
              const y = y0 + Math.sin(x * .011 + ms * .0021 + l * 1.3) * amp + Math.sin(x * .027 - ms * .0016) * amp * .35;
              x ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.strokeStyle = col; g.globalAlpha = .55 * wave * (1 - l * .08); g.lineWidth = 3; g.stroke(); g.globalAlpha = 1;
          }
        }
        // 4. The name rises out of the water, then the water clears (.74 .. 1).
        const word = $('.ob-word', root);
        word.style.opacity = String(ease(seg(t, .68, .84)));
        word.style.transform = `translateY(${(1 - ease(seg(t, .68, .86))) * 14}px)`;
        word.style.letterSpacing = `${.5 - ease(seg(t, .68, 1)) * .32}em`;
        root.style.opacity = String(1 - ease(seg(t, .9, 1)));

        if (t < 1) raf = requestAnimationFrame(frame);
        else { cancelAnimationFrame(raf); root.remove(); done(); }
      };
      root.addEventListener('pointerdown', () => { t0 = performance.now() - TOTAL * .9; });   // a click skips ahead
      raf = requestAnimationFrame(frame);
    });
  }

  /* A page is a native view above the chrome, so it is hidden while the water plays. */
  async function onboard() {
    await Wave.veilOn();
    $('#veil').hidden = true;
    await play();
    Wave.veilOff();
  }
  Wave.onboard = onboard;
  if (Wave.state.onboard === 'pending') { Wave.state.onboard = 'done'; Wave.save(); setTimeout(onboard, 300); }
})();
