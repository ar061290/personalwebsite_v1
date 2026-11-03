// Ported from the Drama Collective site (src/ui/themeRing.js); only its colours are this site's.
//
// The ring that carries the theme switch across the page (./themeSwitch.js): a thin line on the
// edge of the widening circle, star glints twinkling along it, a little glitter shed behind it, and
// two or three ripples trailing inside it, as from a stone dropped in water. It is drawn on its own
// canvas over the page (under the intro and the cursor), frame by frame, at the radius the circle
// has reached: the caller hands it the circle's own eased progress, so the two never drift apart.
//
// Each side of the edge is coloured for the theme on that side: inside, the theme being brought in;
// outside, the one being left. The colours are each theme's tokens (global.css, read by the switch):
// in the light the rose --accent on the paper, in the dark the milk --ink on the black (its glow
// warmed by a touch of the --accent); the troughs of the ripples are each side's --bg, deepened in
// the dark and paled in the light.

const TAU = Math.PI * 2;
// the site's four-pointed star (the drawn cursor's), 20 units across
const STAR = 'M0 -10C1 -2 2 -1 10 0 2 1 1 2 0 10 -1 2 -2 1 -10 0 -2 -1 -1 -2 0 -10Z';

/** '#rgb', '#rrggbb', 'rgb(r, g, b)' or 'r g b' to [r, g, b]. */
function rgb(css, fallback = [235, 216, 140]) {
  const s = String(css || '').trim();
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = s.match(/^#([0-9a-f]{6})$/i);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = s.match(/(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/);
  if (m) return [+m[1], +m[2], +m[3]];
  return fallback;
}
const css = ([r, g, b], a = 1) => `rgba(${r | 0},${g | 0},${b | 0},${a})`;
const mix = (a, b, k) => a.map((v, i) => v + (b[i] - v) * k);
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/**
 * One theme's colours, as the ring needs them. `t`: { ink, accent, rule, bg, dark } read from its
 * tokens. In the light, the line, the glints and their glow are the rose accent, the glints a little
 * deeper (the one colour on the paper, as the gold is on the Drama Collective's plum); in the dark
 * they are the milk ink, the glow warmed by the accent. Without the tokens, the line is the --rule.
 */
function palette(t) {
  const ink = rgb(t.ink, t.dark ? [245, 238, 227] : [12, 12, 12]);
  const accent = rgb(t.accent || t.rule, [232, 121, 143]);
  const bg = rgb(t.bg, t.dark ? [16, 13, 12] : [246, 243, 237]);
  const star = t.dark ? ink : mix(accent, ink, 0.18);
  const glow = t.dark ? mix(ink, accent, 0.18) : accent;
  return {
    rule: t.dark ? ink : accent,
    star,
    glow,
    // the trough of a ripple: its own ground, deepened in the dark theatre, paled in daylight
    shade: t.dark ? mix(bg, [0, 0, 0], 0.55) : mix(bg, [255, 255, 255], 0.7),
    dark: t.dark,
  };
}

/** A glint: the star with its halo, drawn once and then stamped at any size. */
function sprite(p, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const h = size / 2;
  const halo = g.createRadialGradient(h, h, 0, h, h, h);
  halo.addColorStop(0, css(p.glow, p.dark ? 0.55 : 0.4));
  halo.addColorStop(0.35, css(p.glow, p.dark ? 0.16 : 0.12));
  halo.addColorStop(1, css(p.glow, 0));
  g.fillStyle = halo;
  g.fillRect(0, 0, size, size);
  g.translate(h, h);
  g.scale(size / 26, size / 26);
  g.fillStyle = css(p.dark ? mix(p.glow, [255, 255, 255], 0.35) : p.star);
  g.fill(new Path2D(STAR));
  // a bright point at the heart (in daylight a deeper gold, so it still reads on the pale ground)
  g.beginPath();
  g.arc(0, 0, 1.6, 0, TAU);
  g.fillStyle = p.dark ? 'rgba(255,255,255,.95)' : css(mix(p.star, [0, 0, 0], 0.15));
  g.fill();
  return c;
}

/**
 * @param {{ x: number, y: number, radius: number, from: object, to: object }} o
 *   the circle's centre and full radius (CSS px); `from`/`to`: the old and new theme's colours
 * @returns {{ canvas: HTMLCanvasElement, run: (progress: () => (number|null)) => void, stop: () => void }}
 */
export function themeRing({ x, y, radius, from, to }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'theme-ring';
  canvas.setAttribute('aria-hidden', 'true');
  const W = innerWidth, H = innerHeight;
  const dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');

  const inner = palette(to), outer = palette(from);
  const glint = { in: sprite(inner), out: sprite(outer) };
  const small = W < 700;
  const sparks = []; // glints riding the edge
  const dust = []; // glitter left behind it
  let raf = 0, progress = null, last = 0, began = 0, stopped = false;

  // how much of a circle of radius r is on screen (in CSS px of arc), from a few points round it
  const onScreen = (r) => {
    let n = 0;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (px > -20 && px < W + 20 && py > -20 && py < H + 20) n++;
    }
    return (n / 48) * TAU * r;
  };
  // an angle whose point on the circle is on screen (a few tries; the edge is mostly off it late on)
  const pickAngle = (r) => {
    let a = Math.random() * TAU;
    for (let i = 0; i < 10; i++) {
      const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
      if (px > 0 && px < W && py > 0 && py < H) break;
      a = Math.random() * TAU;
    }
    return a;
  };

  // a ring that wavers a little, as water does (`amp` px), drawn as a fine polygon
  const wavy = (r, amp, phase) => {
    const n = Math.max(48, Math.min(360, Math.round((TAU * r) / 10)));
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const rr = r + amp * Math.sin(a * 7 + phase) * Math.sin(a * 3 - phase * 0.6);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py);
    }
  };
  const ring = (r, width, colour, alpha) => {
    if (r <= 0 || alpha <= 0.004) return;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.lineWidth = width;
    ctx.strokeStyle = css(colour, alpha);
    ctx.stroke();
  };
  // a soft band round the centre from radius r0 to r1, its colour and strength given at radii
  // between (in order): [radius, colour, alpha]
  const band = (r0, r1, stops) => {
    r0 = Math.max(0, r0);
    if (r1 <= r0 + 0.5) return;
    const g = ctx.createRadialGradient(x, y, r0, x, y, r1);
    for (const [r, colour, a] of stops) g.addColorStop(Math.min(1, Math.max(0, (r - r0) / (r1 - r0))), css(colour, Math.max(0, a)));
    ctx.beginPath();
    ctx.arc(x, y, r1, 0, TAU);
    ctx.arc(x, y, r0, 0, TAU, true);
    ctx.fillStyle = g;
    ctx.fill();
  };

  const draw = (p, now) => {
    const dt = Math.min(50, now - (last || now));
    last = now;
    const t = (now - began) / 1000;
    const R = radius * p;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // everything gives way as the circle reaches the far corner, so nothing is left when it ends
    const end = 1 - smooth(0.82, 1, p);
    const start = smooth(0, 0.04, p);

    // ripples, trailing inside the edge, further apart the further they have spread and fainter in
    // turn: each a crest catching the light (a glow behind a fine line that wavers, as water does)
    // with its trough just ahead of it
    const gap = 16 + R * 0.065;
    for (let i = 1; i <= 3; i++) {
      const r = R - gap * i * (1 + 0.18 * (i - 1));
      if (r <= 3) continue;
      const a = (0.62 - 0.14 * i) * end * start;
      const amp = Math.min(1.4, 0.4 + r / 600);
      const phase = t * 3 + i * 1.7;
      band(r - 14, r + 1.5, [[r - 14, inner.glow, 0], [r - 1.5, inner.glow, a * 0.42], [r + 1.5, inner.glow, 0]]);
      ctx.lineWidth = 2.2;
      ctx.strokeStyle = css(inner.shade, a * 0.8);
      wavy(r + 3.4, amp, phase);
      ctx.stroke();
      ctx.lineWidth = 1.1;
      ctx.strokeStyle = css(inner.star, a * 0.9);
      wavy(r, amp, phase);
      ctx.stroke();
    }

    // the edge: a soft glow either side, each in its own side's gold, and on it the gold rule
    if (R > 0.5) {
      const e = end * start;
      band(R - 32, R, [[R - 32, inner.glow, 0], [R - 9, inner.glow, 0.1 * e], [R, inner.glow, 0.36 * e]]);
      band(R, R + 26, [[R, outer.glow, 0.4 * e], [R + 7, outer.glow, 0.12 * e], [R + 26, outer.glow, 0]]);
      ring(R, 1.7, inner.rule, 0.95 * e);
    }

    // glints: kept to a steady number along whatever of the edge is on screen
    const want = Math.min(small ? 30 : 56, Math.round(onScreen(Math.max(R, 6)) / (small ? 28 : 32))) * end;
    let spawn = 4;
    while (sparks.length < want && spawn-- > 0 && R > 1) {
      sparks.push({
        a: pickAngle(R),
        off: -10 + Math.random() * 17, // inside (negative) or outside the line
        size: 12 + Math.random() * 18,
        born: now,
        life: 280 + Math.random() * 520,
        spin: (Math.random() - 0.5) * 1.2,
        drift: (Math.random() - 0.5) * 60, // px a second along the edge
        tw: 9 + Math.random() * 14,
        phase: Math.random() * TAU,
      });
    }
    // glitter: shed by the edge where it passes, left to fade where it fell
    if (R > 8 && end > 0.2) {
      const shed = (onScreen(R) / 1000) * (dt / 1000) * (small ? 40 : 60);
      for (let n = shed + Math.random(); n >= 1; n--) {
        const a = pickAngle(R);
        const r = R - Math.random() * 14;
        dust.push({ x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, born: now, life: 380 + Math.random() * 420, size: 0.6 + Math.random() * 1.3 });
      }
    }
    for (let i = dust.length - 1; i >= 0; i--) {
      const d = dust[i];
      const k = (now - d.born) / d.life;
      if (k >= 1) { dust.splice(i, 1); continue; }
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.size, 0, TAU);
      ctx.fillStyle = css(inner.glow, (1 - k) * 0.8);
      ctx.fill();
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      const age = now - s.born;
      if (age >= s.life) { sparks.splice(i, 1); continue; }
      s.a += (s.drift * dt) / 1000 / Math.max(R, 40);
      const life = Math.sin(Math.PI * (age / s.life));
      const twinkle = 0.6 + 0.4 * Math.sin((age / 1000) * s.tw + s.phase);
      const alpha = Math.min(1, life * twinkle * end * 1.15);
      if (alpha <= 0.01) continue;
      const r = R + s.off;
      const px = x + Math.cos(s.a) * r, py = y + Math.sin(s.a) * r;
      const size = s.size * (0.55 + 0.45 * life);
      const rot = s.spin * (age / 1000) + s.phase;
      const c = Math.cos(rot) * dpr, n = Math.sin(rot) * dpr;
      ctx.setTransform(c, n, -n, c, px * dpr, py * dpr);
      ctx.globalAlpha = alpha;
      ctx.drawImage(s.off < 0 ? glint.in : glint.out, -size / 2, -size / 2, size, size);
    }
    ctx.globalAlpha = 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const frame = (now) => {
    if (stopped) return;
    const p = progress?.();
    if (p == null) { if (began) { stop(); return; } } // the circle has finished
    else {
      if (!began) began = now;
      draw(Math.min(1, Math.max(0, p)), now);
    }
    raf = requestAnimationFrame(frame);
  };

  function stop() {
    stopped = true;
    cancelAnimationFrame(raf);
    canvas.remove();
  }

  return {
    canvas,
    run(fn) {
      progress = fn;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(frame);
    },
    stop,
  };
}
