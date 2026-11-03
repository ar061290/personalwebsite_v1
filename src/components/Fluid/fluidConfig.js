// lumina-cursor demo values, plus the knobs for ink-on-white. Every key can be
// overridden as a prop on <FluidBackground>, e.g. CURL={20}.
export const FLUID_DEFAULTS = {
  SIM_RESOLUTION: 128,
  DYE_RESOLUTION: 512,
  PRESSURE_ITERATIONS: 24,
  DENSITY_DISSIPATION: 3.0,
  VELOCITY_DISSIPATION: 2.0,
  PRESSURE: 0.8,
  CURL: 30,
  SPLAT_RADIUS: 0.25,
  SPLAT_FORCE: 6000,
  COLOR_UPDATE_SPEED: 15,
  SHADING: true,
  // Click/tap burst (original: 10 ring splats at 15× ink). Off on this site:
  // clicks place stickers, they shouldn't also dump ink.
  CLICK_INTENSITY: 0,
  // Opacity = INK_MAX_ALPHA × (1 − e^(−density × INK_GAIN)).
  INK_GAIN: 2.4,
  INK_MAX_ALPHA: 0.86,
  // How much of the original slope shading tints the ink (0 = flat).
  SHADE_AMOUNT: 0.45,
  // Chance a colour pick is rind green, how much of it is deposited (it must
  // locally outweigh the rose to show at all), and its opacity relative to rose.
  GREEN_CHANCE: 0.14,
  GREEN_STRENGTH: 1.0,
  GREEN_OPACITY: 0.55,
  // Display palette: 'rose' (light theme) or 'milk' (dark theme), fluidSim.js.
  PALETTE: 'rose',
}

// Dark theme (html[data-theme='dark']): white milk on black paper, composited
// normally in paper.css instead of multiply. Merged over the defaults,
// under any explicit props.
// Thin milk over black reads as grey smoke, so it saturates sooner (higher gain
// and ceiling) and is shaded less, to stay a creamy white.
export const FLUID_DARK = {
  PALETTE: 'milk',
  INK_GAIN: 4.2,
  INK_MAX_ALPHA: 0.96,
  SHADE_AMOUNT: 0.3,
  GREEN_OPACITY: 0.9,
}
