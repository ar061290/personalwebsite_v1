// A spring, as react-spring makes them (the react-spring-physics skill's model), for code that
// steps its own time: a value pulled toward its target by a spring of the given tension, slowed by
// friction, with the given mass. The damping ratio is friction / (2 * sqrt(tension * mass)): below
// 1 the value passes its target and comes back (once, if just below 1); at 1 or above it never
// passes it. Changing the target or the config mid-way keeps the velocity the value has, so an
// interrupted motion turns rather than restarts. This is the same model in plain JS (ported from the
// Drama Collective site), stepped with whatever fixed time step its owner uses
// (src/components/ThemeToggle/earringsScene.js steps it with its physics).

/** The damping ratio of a config: under 1 overshoots, 1 is critically damped. */
export const dampingRatio = ({ mass = 1, tension, friction }) => friction / (2 * Math.sqrt(tension * mass));

export class Spring {
  /**
   * @param {object} [o]
   * @param {number} [o.value]   where it starts (at rest there unless given a velocity)
   * @param {number} [o.velocity]
   * @param {{ mass?: number, tension: number, friction: number, precision?: number }} [o.config]
   */
  constructor({ value = 0, velocity = 0, config = { mass: 1, tension: 170, friction: 26 } } = {}) {
    this.value = value;
    this.velocity = velocity;
    this.target = value;
    this.config = config;
    this.resting = velocity === 0;
  }

  /** A new target, and optionally a new config; the velocity it has is kept. */
  to(target, config) {
    this.target = target;
    if (config) this.config = config;
    this.resting = false;
    return this;
  }

  /** Put it somewhere at once, with the given velocity (0: at rest). */
  jump(value, velocity = 0) {
    this.value = value;
    this.velocity = velocity;
    this.resting = velocity === 0 && value === this.target;
    return this;
  }

  /**
   * Advance by dt seconds (semi-implicit Euler: react-spring steps every millisecond; a step of a
   * few milliseconds is as close). Returns true once it is at rest: within `precision` of the
   * target and moving slower than ten times that per second (react-spring's test, in seconds).
   */
  step(dt) {
    if (this.resting) return true;
    const { mass = 1, tension, friction, precision = 0.001 } = this.config;
    const a = (-tension * (this.value - this.target) - friction * this.velocity) / mass;
    this.velocity += a * dt;
    this.value += this.velocity * dt;
    if (Math.abs(this.value - this.target) < precision && Math.abs(this.velocity) < precision * 10) {
      this.value = this.target;
      this.velocity = 0;
      this.resting = true;
    }
    return this.resting;
  }
}
