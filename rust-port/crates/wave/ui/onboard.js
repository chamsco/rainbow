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

  /* style: 'smooth' draws at full resolution; 'pixel' draws the same scene on a coarse grid (one square = 6 px),
     in a handful of colours, with the name set in a blocky face, like a game's title screen. */
  function play(style = 'smooth') {
    const pixel = style === 'pixel', PX = 6;
    return new Promise(done => {
      const root = h('div', { class: 'onboard', role: 'presentation' }, h('canvas', { class: pixel ? 'pixel' : '' }), pixel ? null : h('div', { class: 'ob-word' }, 'Wave'));
      document.body.append(root);
      const canvas = root.querySelector('canvas'), g = canvas.getContext('2d');
      const css = getComputedStyle(document.documentElement);
      const A = css.getPropertyValue('--a').trim() || '#7fb2c9', B = css.getPropertyValue('--b').trim() || '#c8d9c0';
      // The scene is always laid out in window pixels; the pixel style only changes how big a dot is.
      canvas.width = pixel ? Math.ceil(innerWidth / PX) : innerWidth; canvas.height = pixel ? Math.ceil(innerHeight / PX) : innerHeight;
      const W = () => innerWidth, H = () => innerHeight;
      const TOTAL = REDUCED ? 700 : 4600;
      let t0 = 0, raf = 0;

      const frame = now => {
        t0 ||= now;
        const ms = now - t0, t = ms / TOTAL;
        const w = W(), hgt = H(), cx = w / 2, cy = hgt * .52;
        g.setTransform(pixel ? 1 / PX : 1, 0, 0, pixel ? 1 / PX : 1, 0, 0);
        // Still water: a deep gradient in the space's own colours.
        const bg = g.createLinearGradient(0, 0, 0, hgt);
        bg.addColorStop(0, '#0e1a22'); bg.addColorStop(1, '#16303a');
        if (pixel) {   // flat bands, as a pixel scene would have them, not a smooth gradient
          ['#0a2630', '#0c2d39', '#0f3643', '#12404f'].forEach((c, i) => { g.fillStyle = c; g.fillRect(0, hgt / 4 * i, w, hgt / 4 + 1); });
        } else { g.fillStyle = bg; g.fillRect(0, 0, w, hgt); }

        // 1. The drop falls (0 .. .2), quickening, a small bright bead.
        const fall = seg(t, 0, .2);
        if (fall > 0 && fall < 1) {
          const y = -20 + (cy + 20) * fall * fall;
          g.fillStyle = pixel ? '#e8fbff' : 'rgba(235,248,252,.95)';
          g.beginPath(); g.ellipse(cx, y, pixel ? 9 : 5, (pixel ? 14 : 9) + 10 * fall, 0, 0, Math.PI * 2); g.fill();
        }
        // 2. It lands: rings leave the point, each later and softer (.2 .. .62).
        const hit = seg(t, .2, .62);
        if (hit > 0) {
          for (let i = 0; i < 5; i++) {
            const k = clamp(hit * 1.5 - i * .16);
            if (k <= 0 || k >= 1) continue;
            const r = ease(k) * Math.max(w, hgt) * .62;
            g.strokeStyle = pixel ? `rgba(190,240,246,${Math.max(.25, 1 - k)})` : `rgba(220,240,248,${(1 - k) * .75})`;
            g.lineWidth = pixel ? 7 : 2.2 - i * .3;
            g.beginPath(); g.ellipse(cx, cy, r, r * .34, 0, 0, Math.PI * 2); g.stroke();
          }
        }
        // 3. The rings straighten into waves that fill the water (.44 .. .86).
        const wave = ease(seg(t, .44, .86));
        if (wave > 0) {
          for (let l = 0; l < 6; l++) {
            const y0 = cy + (l - 2.5) * 34 * (.4 + wave * .6), amp = (26 - l * 3) * wave;
            const col = pixel ? ['#4fc3d0', '#9be8ee', '#2f95b0'][l % 3] : (l % 2 ? A : B);
            g.beginPath();
            for (let x = 0; x <= w; x += 8) {
              const y = y0 + Math.sin(x * .011 + ms * .0021 + l * 1.3) * amp + Math.sin(x * .027 - ms * .0016) * amp * .35;
              x ? g.lineTo(x, y) : g.moveTo(x, y);
            }
            g.strokeStyle = col; g.globalAlpha = pixel ? Math.min(1, wave * 1.4) : .55 * wave * (1 - l * .08); g.lineWidth = pixel ? 8 : 3; g.stroke(); g.globalAlpha = 1;
          }
        }
        // 4. The name rises out of the water, then the water clears (.74 .. 1).
        const wordA = ease(seg(t, .68, .84)), rise = (1 - ease(seg(t, .68, .86))) * 14;
        if (pixel) {
          // A blocky name, drawn on the coarse grid so its edges are squares too.
          g.save(); g.globalAlpha = wordA; g.fillStyle = '#eaf5f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.font = `800 ${Math.round(Math.min(w * .16, 150))}px ui-monospace, Consolas, "Courier New", monospace`;
          g.letterSpacing = `${Math.round(Math.min(w * .02, 22))}px`;
          g.fillText('WAVE', cx, cy + rise); g.restore();
          // Few colours and hard edges: every channel is snapped to one of a handful of levels.
          const img = g.getImageData(0, 0, canvas.width, canvas.height), d = img.data, L = 9;
          for (let i = 0; i < d.length; i += 4) { d[i] = Math.round(d[i] / 255 * L) / L * 255; d[i + 1] = Math.round(d[i + 1] / 255 * L) / L * 255; d[i + 2] = Math.round(d[i + 2] / 255 * L) / L * 255; }
          g.setTransform(1, 0, 0, 1, 0, 0); g.putImageData(img, 0, 0);
        } else {
          const word = $('.ob-word', root);
          word.style.opacity = String(wordA);
          word.style.transform = `translateY(${rise}px)`;
          word.style.letterSpacing = `${.5 - ease(seg(t, .68, 1)) * .32}em`;
        }
        root.style.opacity = String(1 - ease(seg(t, .9, 1)));

        if (t < 1) raf = requestAnimationFrame(frame);
        else { cancelAnimationFrame(raf); root.remove(); done(); }
      };
      root.addEventListener('pointerdown', () => { t0 = performance.now() - TOTAL * .9; });   // a click skips ahead
      raf = requestAnimationFrame(frame);
    });
  }

  /* A page is a native view above the chrome, so it is hidden while the water plays. */
  async function onboard(style = Wave.state.settings.welcome || 'smooth') {
    await Wave.veilOn();
    $('#veil').hidden = true;
    if (style === 'both') { await play('smooth'); await play('pixel'); } else await play(style);
    Wave.veilOff();
  }
  Wave.onboard = onboard;
  if (Wave.state.onboard === 'pending') { Wave.state.onboard = 'done'; Wave.save(); setTimeout(onboard, 300); }
})();
