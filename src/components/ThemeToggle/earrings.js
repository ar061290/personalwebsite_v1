// Ported from the Drama Collective site (src/ui/earrings.js): the same drop, physics, timings, grab,
// and phone and no-WebGL rules. Here the "curtain" is this site's intro (html.is-intro), the bar is the
// header the button sits in, and the custom cursor reads "drag" over the earring (data-cursor).
//
// The earrings that hang from the theme switch (docs/earrings/SPEC.md): the switch is clicked, and
// the earring for the theme just chosen (the sun for the light, the moon for the dark) comes down
// out of the button, hanging from it by the top loop of its star, dangling (the scene and its
// physics are src/scene/earrings.js). It is large: from the star's top loop to its lowest charm,
// 60% of a laptop's window's height (SIZE), beside the page's heading. It does not stay, and does
// not wait: it lands, and on its small jump back up carries straight on up into the button, its
// parts still swinging, gone about 1.3 s after it began to come down. Pointing at it does not keep
// it down. A visitor quick enough to take hold of it on the way keeps it while holding it, and can
// pull it about (and back out, if it was half way up); let go, it goes up at once. It also goes up
// at once when the theme is switched again (the other comes down as it goes), and when the button
// leaves the screen (the bar sliding away, or the publication's bar going back up).
//
// There are none on a phone's narrow screen (under 768 px wide): no model, no canvas, no WebGL; the
// switch works as ever. Nor are there any where WebGL does not run well (no WebGL, a software
// renderer, a weak device: src/util/env.js), and there nothing of theirs is fetched either. On the
// other screens, once the page is idle after its curtain has opened, the model's bytes are fetched
// ahead (and the scene's code), but the scene itself (its WebGL context, the earrings on the GPU,
// their shaders) is made only when it is likely to be wanted: when the pointer comes near the
// switch, the focus reaches it, or it is pressed. A switch made before the scene is ready changes
// the theme at once, and the earring comes down when it is ready if that is soon (LATE: 3 s, time
// for a tablet, where nothing points at the switch before the first tap, to make the scene) and the
// theme is still the one chosen, or not at all. Where the switch is above the page's heading (on a tablet held upright), the earring is
// drawn smaller, so that it hangs beside the heading and its lede rather than over them (FIT).
//
// One canvas under the button, drawn only while an earring moves. While an earring comes down or goes
// back up, the canvas shows nothing above the bar's lower edge but a narrow slot under the button, as
// wide as the top of the star that hangs in the bar at rest, so the pendant and its strands come out
// from behind the bar's edge and go back behind it, rather than being drawn over the bar and cut off
// across its middle. Over the earring, a transparent
// zone shaped to it (a clip-path of the parts' outlines) takes the pointer, and keeps a finger on
// the earring from scrolling the page, while the page around it keeps the pointer. With reduced
// motion there is no drop and no swing: the earring fades in hanging still and straight out again,
// and cannot be taken hold of. Without WebGL there is none.
import { probeWebGL, prefersStatic } from '../../lib/env.js';

const MODEL = new URL('../../assets/models/earrings.glb', import.meta.url).href;
const SCENE = () => import('./earringsScene.js');
const LATE = 3000; // ms: a switch clicked before the scene is ready drops it if ready by then
const STILL = { fadeIn: 300, hold: 600, fadeOut: 300 }; // ms: reduced motion's still earring
const TUCK = 1; // px under the button's glyph (the sun or the moon) where the top of the star's loop hangs
const CLIP = 4; // px above the glyph's foot where the earring comes out from behind it (the canvas's top)
const GROW = 4; // px the zone that takes the pointer reaches past the earring's outline
const NEAR = 200; // px from the button within which a pointer is taken to be heading for it
const SLOT = 3; // px the slot under the button that an earring comes down through is wider, each side, than the star's loop and tip in it
const LIFTS = []; // scratch: how far above its rest each earring coming down or going up is
// px: how tall an earring is drawn, from its star's top loop to its lowest charm: 60% of the
// window's height (540 px on a 1440 x 900 laptop), but no more than half its width (so that on a
// tablet held upright it does not cover the page's heading), and within min and max
const SIZE = { height: 0.6, width: 0.5, min: 380, max: 640 };
// px: hanging at rest, the earring keeps this far from the text of the heading and its lede; to
// keep it, it is drawn smaller, in steps of `step`, but never smaller than `floor` (where even
// that does not fit beside them, it hangs over them at that size)
const FIT = { gap: 16, step: 4, floor: 300 };
const WIDE = '(min-width: 768px)'; // narrower (a phone): no earrings
// the canvas, in earring heights: how far it reaches to each side of the button, and down from it
// (the earring and its jump below its rest, 15% of its height)
const REACH = { side: 1.05, down: 1.3 };

const noop = { drop() {}, cleanup() {} };

/**
 * @param {{ reduced: boolean, opened?: Promise<void>, button?: HTMLElement }} o
 * @returns {{ drop: (theme: string) => void, cleanup: () => void }}
 */
export function setupEarrings({ reduced, opened, button = document.querySelector('[data-theme-toggle]') }) {
  if (!button) return noop;
  const root = document.documentElement;
  const wide = matchMedia(WIDE);
  const debug = new URLSearchParams(location.search).has('debug');

  let scene = null; // the scene, once made
  let loading = null; // the promise of it
  let bytes = null; // the promise of the model's bytes, fetched ahead
  let code = null; // and of the scene's code
  let off = false; // no WebGL, a weak GPU, or the model failed: no earrings
  let gpu = null; // what probeWebGL found, once asked
  let gone = false; // cleaned up
  let curtain = false; // the page's curtain has opened
  let idleId = 0;
  let frame = 0;
  let last = 0;
  let current = null; // the earring out (coming down, or on its own way back up) that can be taken hold of
  let held = null; // the pointer holding it
  let hoverAt = null; // the pointer over the zone (CSS px), to test against the earring
  let hoverMoved = false; // and whether it has moved since it was last tested
  let pointing = false; // whether the pointer is on the earring itself (the cursor then takes its grab form)
  let zoneAt = ''; // where the zone was last put (its clip-path follows the earring)
  let still = null; // reduced motion: the fade under way
  let asked = null; // a drop asked for before the scene was ready: { name, theme, at }
  let size = 0; // ?debug: a height (px) to draw it at instead of the usual
  let fit = null; // the height it is drawn at, fitted beside the heading, and the window it was fitted in: { px, w, h }
  let bar = null; // the top bar the button is in
  let slotAt = ''; // the canvas's clip-path as last set
  let behind = 0; // while it is so clipped, the bar's lower edge (CSS px), above which only the slot is drawn
  let why = null; // ?debug: why it last went up

  // the zone over the earring that takes the pointer (data-holds-bar: on the publication pages,
  // the pointer on it keeps the bar down, src/publication/peekbar.js)
  const zone = document.createElement('div');
  zone.className = 'earring-grab';
  zone.hidden = true;
  zone.setAttribute('aria-hidden', 'true');
  zone.dataset.holdsBar = '';

  /** Whether WebGL runs well enough here for the earrings: asked once (the probe's context is let go at once). */
  const capable = () => {
    gpu ??= probeWebGL();
    return gpu.ok && !prefersStatic(gpu.renderer);
  };

  /** The model's bytes and the scene's code, fetched ahead: nothing is drawn, nothing is on the GPU. */
  const prefetch = () => {
    if (bytes || loading || off || gone || !wide.matches || navigator.connection?.saveData) return;
    if (!capable()) { off = true; return; }
    bytes = fetch(MODEL).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
    code = SCENE().catch(() => null);
  };

  /** Make the scene (its WebGL context, both earrings, their shaders): once, on a wide screen. */
  const load = () => {
    if (loading || off || gone || !wide.matches) return loading;
    unwatch();
    if (!capable()) { off = true; return null; }
    // the code and the bytes fetched ahead, if they came (or fetched now, if not)
    loading = Promise.all([code, bytes])
      .then(async ([mod, data]) => {
        bytes = null; // the scene has them now
        const { Earrings } = mod ?? (await SCENE());
        const made = await Earrings.create(data ?? MODEL, { reduced });
        if (gone) { made.dispose(); return null; }
        scene = made;
        if (debug) expose();
        // the shaders compiled and the textures uploaded now, so the first drop does not stall
        await made.warm();
        return made;
      })
      .catch((err) => { console.warn('earrings:', err); off = true; return null; });
    return loading;
  };

  // after the curtain has opened, in a quiet moment, the model is fetched ahead
  Promise.resolve(opened).then(() => {
    if (gone) return;
    curtain = true;
    const go = () => { idleId = 0; prefetch(); };
    idleId = window.requestIdleCallback ? requestIdleCallback(go, { timeout: 4000 }) : setTimeout(go, 1200);
  });

  // a pointer heading for the switch, the focus on it, or a press: the scene is made ahead of the click
  const onNear = (e) => {
    if (!curtain || !wide.matches || e.pointerType === 'touch') return;
    const r = button.getBoundingClientRect();
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    if (dx * dx + dy * dy < NEAR * NEAR) load();
  };
  const onReach = () => { if (wide.matches) load(); };
  window.addEventListener('pointermove', onNear, { passive: true });
  button.addEventListener('focus', onReach);
  button.addEventListener('pointerdown', onReach);
  let watching = true;
  function unwatch() {
    if (!watching) return;
    watching = false;
    window.removeEventListener('pointermove', onNear);
    button.removeEventListener('focus', onReach);
    button.removeEventListener('pointerdown', onReach);
  }

  /** The foot of the glyph drawn in the button (the sun or the moon, whichever is shown), or of its box. */
  const foot = (r) => {
    for (const svg of button.querySelectorAll('svg')) {
      const g = svg.getBoundingClientRect();
      if (g.height) return g.bottom;
    }
    return r.bottom;
  };

  /**
   * The lines of text of the page's heading and of the paragraphs beside it (its lede), on the
   * screen, those that can be seen: not those of a heading whose words are still to come in, nor
   * those only read out (.sr-only, whose box is a pixel).
   */
  const headingLines = () => {
    const h1 = [...document.querySelectorAll('h1')].find((el) => el.getBoundingClientRect().width > 2);
    if (!h1) return [];
    const lines = [];
    const range = document.createRange();
    const seen = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 2 || r.height <= 2) return false;
      return !el.checkVisibility || el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    };
    for (const block of [h1, ...h1.parentElement.querySelectorAll(':scope > p')]) {
      const walk = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      for (let t = walk.nextNode(); t; t = walk.nextNode()) {
        if (!t.textContent.trim() || !seen(t.parentElement)) continue;
        range.selectNodeContents(t);
        for (const q of range.getClientRects()) if (q.width > 0 && q.height > 0) lines.push(q);
      }
    }
    return lines;
  };

  /** How tall the earring is drawn (px): its usual size, or smaller where that would hang it over the heading. */
  const fitted = (cx, top) => {
    if (fit && fit.w === innerWidth && fit.h === innerHeight) return fit.px;
    const usual = Math.round(Math.min(SIZE.max, Math.max(SIZE.min, Math.min(innerHeight * SIZE.height, innerWidth * SIZE.width))));
    const lines = headingLines();
    let px = usual;
    while (px > FIT.floor && !scene.clears(px, cx, top, lines, FIT.gap)) px -= FIT.step;
    fit = { px: Math.max(px, Math.min(FIT.floor, usual)), w: innerWidth, h: innerHeight };
    return fit.px;
  };

  /** How large the earring is drawn and where the canvas and the loops' tops are, from the button. Returns whether the button is on the screen and in use. */
  const layout = () => {
    const r = button.getBoundingClientRect();
    const y = foot(r);
    const cx = r.left + r.width / 2;
    const px = size || fitted(cx, y + TUCK);
    scene.setScale(px);
    // a box under the button big enough for the earring, its jump and its swing, and for a strand
    // pulled hard aside, which the earring follows almost its whole length out from the button
    const reach = px * REACH.side;
    const left = Math.round(Math.max(0, cx - reach));
    const w = Math.round(Math.min(innerWidth, cx + reach)) - left;
    const h = Math.round(Math.min(px * REACH.down, innerHeight));
    // it hangs from the button's glyph, and comes out from behind it
    const top = Math.round(y - CLIP);
    scene.setBox(left, top, w, h);
    scene.setAnchor(cx, y + TUCK);
    // Coming down or going up, it is behind the bar (the canvas shows nothing above the bar's lower
    // edge) but for what of its star hangs in the bar at rest: a slot under the button, as wide as
    // the star's loop and tip, that moves with the star, so only they are drawn in the bar.
    bar ??= button.closest('[data-topbar], header');
    const band = bar ? Math.round(bar.getBoundingClientRect().bottom) - top : 0;
    const lifts = band > 0 ? scene.lifts(LIFTS) : [];
    let clip = '';
    if (lifts.length) {
      const rest = y + TUCK - top; // the top of the star's loop at rest, down the canvas
      const half = Math.ceil(scene.neck((band - rest) / px) * px) + SLOT, mid = Math.round(cx) - left;
      let d = `M0 ${band}H${w}V${h}H0Z`;
      for (const lift of lifts) {
        const from = Math.max(0, Math.round(rest - lift) - SLOT), to = Math.min(band, Math.round(band - lift));
        if (to > from) d += `M${mid - half} ${from}H${mid + half}V${to}H${mid - half}Z`;
      }
      clip = `path('${d}')`;
    }
    if (clip !== slotAt) { scene.canvas.style.clipPath = clip; slotAt = clip; }
    behind = clip ? top + band : 0;
    // the button can no longer be pressed while the bar is going away (nav.js, peekbar.js)
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(button).pointerEvents !== 'none';
  };

  const attach = () => {
    if (!scene.canvas.isConnected) document.body.append(scene.canvas, zone);
    scene.canvas.style.visibility = '';
  };

  const wake = () => { if (!frame && !gone) { last = 0; frame = requestAnimationFrame(tick); } };

  /** The pointer lets go of the earring, if it holds it (let go by the visitor, it then goes up: onUp). */
  const letGo = () => {
    if (held === null) return;
    try { zone.releasePointerCapture(held); } catch { /* already released */ }
    held = null;
    scene.release();
    root.classList.remove('is-grabbing');
    zone.classList.remove('is-held');
  };

  /**
   * The earring out goes back up at once (`reason`: for ?debug), or, if it has gone up into the
   * button on its own, is done with.
   */
  const retract = (reason = 'asked') => {
    if (!current) return;
    why = reason;
    letGo();
    scene.retract(current);
    current = null;
    hoverAt = null;
    pointing = false;
    zone.hidden = true;
    zone.classList.remove('is-over');
    delete zone.dataset.cursor;
    // whatever it held down (the publication's bar, src/publication/peekbar.js) looks again at where the pointer is
    zone.dispatchEvent(new Event('hanger:gone', { bubbles: true }));
  };

  /** Bring the named earring down (and send the other up). */
  const show = (name, theme) => {
    try {
      scene.setTheme(theme);
      fit = null; // the page may have been scrolled since: the heading is measured again
      attach();
      layout();
      if (reduced) { showStill(name); return; }
      letGo();
      if (current && current !== name) why = 'switch';
      for (const other of ['moon', 'sun']) if (other !== name) scene.retract(other);
      scene.drop(name);
      current = name;
      wake();
    } catch (err) {
      console.warn('earrings:', err);
    }
  };

  // reduced motion: it fades in hanging still, stays a moment, and fades out
  const showStill = (name) => {
    still?.cancel();
    scene.still(name);
    const total = STILL.fadeIn + STILL.hold + STILL.fadeOut;
    still = scene.canvas.animate(
      [{ opacity: 0 }, { opacity: 1, offset: STILL.fadeIn / total }, { opacity: 1, offset: (STILL.fadeIn + STILL.hold) / total }, { opacity: 0 }],
      { duration: total, easing: 'linear', fill: 'forwards' },
    );
    const mine = still;
    still.finished.then(() => { if (still === mine) endStill(); }, () => {});
    wake();
  };
  const endStill = () => {
    still?.cancel();
    still = null;
    for (const k of ['moon', 'sun']) scene.hide(k);
  };

  const tick = (now) => {
    frame = 0;
    if (gone || !scene) return;
    const dt = last ? Math.min((now - last) / 1000, 0.1) : 1 / 60;
    last = now;
    const there = layout();
    if (!there) {
      if (current) retract('button away');
      if (still) endStill();
    }
    const active = scene.step(dt);
    // gone up into the button on its own, after its landing
    if (current && scene.state(current) === 'in') retract('lifted');
    // over the earring the cursor takes its grab form (tested again as the earring moves under it)
    if (current && held === null && hoverAt && (hoverMoved || scene.steps)) {
      pointing = !!scene.pick(hoverAt.x, hoverAt.y, current);
      zone.classList.toggle('is-over', pointing);
      if (pointing) zone.dataset.cursor = 'drag'; else delete zone.dataset.cursor;
      hoverMoved = false;
    }
    scene.render();
    // the zone follows the earring that can be held, shaped to it (and, while what of it is in the
    // bar is not drawn, below the bar)
    const r = current ? scene.rect(current) : null;
    if (r) {
      const btn = button.getBoundingClientRect();
      const top = Math.round(Math.max(r.top - GROW, btn.bottom + 1, behind));
      const left = Math.round(Math.max(r.left - GROW, 0)), right = Math.round(Math.min(r.right + GROW, innerWidth));
      const bottom = Math.round(Math.min(r.bottom + GROW, innerHeight));
      if (right > left && bottom > top) {
        zone.hidden = false;
        const at = `${left} ${top} ${right} ${bottom}`;
        if (at !== zoneAt) {
          zone.style.transform = `translate(${left}px, ${top}px)`;
          zone.style.width = `${right - left}px`;
          zone.style.height = `${bottom - top}px`;
        }
        if (at !== zoneAt || scene.steps) zone.style.clipPath = `path('${scene.hitPath(current, left, top, GROW)}')`;
        zoneAt = at;
      } else zone.hidden = true;
    } else zone.hidden = true;
    if (active) { frame = requestAnimationFrame(tick); return; }
    // nothing out: an empty canvas, out of sight, and no frames until the next drop
    scene.clear();
    scene.canvas.style.visibility = 'hidden';
    zone.hidden = true;
    zoneAt = '';
    last = 0;
  };

  // ---- the pointer ----
  const onDown = (e) => {
    if (!current || held !== null || !scene) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault(); // nothing is selected, and the page does not take it
    const hit = scene.pick(e.clientX, e.clientY, current);
    if (!hit) return;
    held = e.pointerId;
    try { zone.setPointerCapture(e.pointerId); } catch { /* the pointer has gone */ }
    scene.grab(hit);
    scene.setPointer(e.clientX, e.clientY, true);
    root.classList.add('is-grabbing');
    zone.classList.add('is-held');
    wake();
  };
  const onZoneMove = (e) => {
    if (held === e.pointerId) { scene.dragTo(e.clientX, e.clientY); return; }
    if (e.pointerType !== 'touch') { hoverAt = { x: e.clientX, y: e.clientY }; hoverMoved = true; }
  };
  // let go, it goes up at once
  const onUp = (e) => { if (held === e.pointerId) retract('let go'); };
  const onZoneLeave = () => {
    hoverAt = null;
    if (held !== null) return;
    pointing = false;
    zone.classList.remove('is-over');
    delete zone.dataset.cursor;
  };
  // the cursor's gold lamp follows the pointer anywhere (a finger's only while it is down)
  const onMove = (e) => {
    if (!scene || !scene.active) return;
    if (e.pointerType === 'touch' && e.buttons === 0) return;
    scene.setPointer(e.clientX, e.clientY, true);
  };
  const onLeave = () => scene?.setPointer(0, 0, false);
  const onTouchEnd = (e) => { if (e.pointerType === 'touch') scene?.setPointer(0, 0, false); };
  // narrowed to a phone's width: whatever is out goes away at once, and nothing more comes down
  const onWide = () => {
    if (wide.matches || !scene) return;
    asked = null;
    if (still) endStill();
    if (current) { const name = current; retract('narrow'); scene.hide(name); }
    for (const k of ['moon', 'sun']) scene.hide(k);
    scene.clear();
    scene.canvas.style.visibility = 'hidden';
    zone.hidden = true;
  };

  zone.addEventListener('pointerdown', onDown);
  zone.addEventListener('pointermove', onZoneMove);
  zone.addEventListener('pointerup', onUp);
  zone.addEventListener('pointercancel', onUp);
  zone.addEventListener('lostpointercapture', onUp);
  zone.addEventListener('pointerleave', onZoneLeave);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerup', onTouchEnd, { passive: true });
  root.addEventListener('pointerleave', onLeave);
  wide.addEventListener('change', onWide);

  /** The theme has just been switched by the visitor (./themeSwitch.js): bring its earring down. */
  const drop = (theme) => {
    if (off || gone || !wide.matches) return;
    const name = theme === 'light' ? 'sun' : 'moon';
    if (scene) { show(name, theme); return; }
    const at = performance.now();
    asked = { name, theme, at };
    const p = load();
    p?.then((made) => {
      // only the latest switch, only while its theme is still the page's, only if it is still soon
      // after it, and only on a wide screen
      if (!made || asked?.at !== at || root.dataset.theme !== theme || performance.now() - at > LATE || !wide.matches) return;
      asked = null;
      show(name, theme);
    });
  };

  // ?debug: the state, the bodies, and how well the joints hold, for testing
  const expose = () => {
    window.__earrings = {
      get scene() { return scene; },
      get state() {
        return {
          current, held: held !== null, pointing,
          physicsFor: current ? Math.round(scene.earrings[current].clock * 1000) : null,
          // how far above its rest it is (px) and how fast it is going up (px/s)
          offsetPx: current ? +(scene.earrings[current].offset * scene.ppu).toFixed(1) : null,
          speedPx: current ? Math.round(scene.earrings[current].spring.velocity * scene.ppu) : null,
          moon: scene.state('moon'), sun: scene.state('sun'),
          canvas: scene.canvas.isConnected && scene.canvas.style.visibility !== 'hidden',
          looping: !!frame, physicsMs: +scene.cost.toFixed(3), steps: scene.steps, lastUp: why,
          px: Math.round(scene.ppu * scene.height), box: { ...scene.box }, pixelRatio: scene.renderer.getPixelRatio(), clip: slotAt,
        };
      },
      bodies: (name = current ?? 'moon') => {
        const rig = scene.earrings[name].rig;
        return rig.names.map((part, i) => ({ part, x: [...rig.x.subarray(3 * i, 3 * i + 3)], q: [...rig.q.subarray(4 * i, 4 * i + 4)], v: [...rig.v.subarray(3 * i, 3 * i + 3)], w: [...rig.w.subarray(3 * i, 3 * i + 3)] }));
      },
      /** The joints as drawn and as solved: the largest gap (model units and px) and stretch. */
      pivots: (name = current ?? 'moon') => {
        const m = scene.earrings[name].rig.measure(), ppu = scene.ppu;
        return {
          gapPx: m.gap * ppu, stretch: m.stretch, solverGapPx: m.solver.gap * ppu, solverStretch: m.solver.stretch,
          parts: m.parts.map((p) => ({ part: p.part, gapPx: +(p.gap * ppu).toFixed(5), distance: +p.distance.toFixed(5), rest: +p.rest.toFixed(5), stretch: p.stretch })),
        };
      },
      angles: (name = current ?? 'moon') => scene.earrings[name].rig.angles().map((a) => a.map((v) => +v.toFixed(1))),
      drop,
      retract,
      /** Draw it this many px tall (0: as usual), to look at it closely. */
      size: (px = 0) => { size = px; },
    };
  };

  const cleanup = () => {
    gone = true;
    if (idleId) (window.cancelIdleCallback ?? clearTimeout)(idleId);
    cancelAnimationFrame(frame);
    still?.cancel();
    letGo();
    unwatch();
    zone.removeEventListener('pointerdown', onDown);
    zone.removeEventListener('pointermove', onZoneMove);
    zone.removeEventListener('pointerup', onUp);
    zone.removeEventListener('pointercancel', onUp);
    zone.removeEventListener('lostpointercapture', onUp);
    zone.removeEventListener('pointerleave', onZoneLeave);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onTouchEnd);
    root.removeEventListener('pointerleave', onLeave);
    wide.removeEventListener('change', onWide);
    zone.remove();
    scene?.dispose();
    scene = null;
    if (window.__earrings) delete window.__earrings;
  };

  return { drop, cleanup };
}
