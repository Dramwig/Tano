/* Retargetable springs and one shared frame loop for the drawn caret.
 *
 * A spring keeps its velocity when its target moves, so a new keystroke
 * mid-glide bends the caret's path instead of braking and relaunching it, and
 * a single press still lands with a little bounce. Typed-text fades use the
 * same loop so they are stepped in the same frame as the caret. */

export type SpringConfig = {
  /** Natural angular frequency (rad/s): how fast it reacts. */
  omega: number;
  /** Damping ratio: 1 = no overshoot, < 1 = springy. */
  zeta: number;
};

/** Single press: lands with a small (~4%) overshoot. */
export const CARET_SPRING: SpringConfig = { omega: 34, zeta: 0.72 };
/** Riding along with a block that is itself animating. */
export const CARET_FOLLOW_SPRING: SpringConfig = { omega: 60, zeta: 1 };

const REST_DISTANCE = 0.05;
const REST_VELOCITY = 4;

export class Spring {
  value: number;
  target: number;
  velocity = 0;
  config: SpringConfig;

  constructor(value = 0, config: SpringConfig = CARET_SPRING) {
    this.value = value;
    this.target = value;
    this.config = config;
  }

  /** Jump without motion (first appearance, far jumps, layout changes). */
  snap(value: number) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
  }

  /** Move the goal; the current velocity carries over. */
  retarget(target: number) { this.target = target; }

  get resting() {
    return Math.abs(this.value - this.target) < REST_DISTANCE && Math.abs(this.velocity) < REST_VELOCITY;
  }

  /** Advance by `dt` seconds with the closed-form damped-spring solution, so
   * long frames cannot make it explode or drift. Returns true while moving. */
  step(dt: number): boolean {
    if (this.resting) {
      this.value = this.target;
      this.velocity = 0;
      return false;
    }
    const { omega, zeta } = this.config;
    const x0 = this.value - this.target;
    const v0 = this.velocity;
    const decay = Math.exp(-zeta * omega * dt);
    let x: number, v: number;
    if (zeta < 1) {
      const damped = omega * Math.sqrt(1 - zeta * zeta);
      const b = (v0 + zeta * omega * x0) / damped;
      const cos = Math.cos(damped * dt), sin = Math.sin(damped * dt);
      x = decay * (x0 * cos + b * sin);
      v = decay * (v0 * cos - (zeta * omega * b + x0 * damped) * sin);
    } else {
      const b = v0 + omega * x0;
      x = decay * (x0 + b * dt);
      v = decay * (b - omega * (x0 + b * dt));
    }
    this.value = this.target + x;
    this.velocity = v;
    if (!this.resting) return true;
    this.value = this.target;
    this.velocity = 0;
    return false;
  }
}

/** A task runs once per frame and returns true while it still has work. */
export type FrameTask = (dt: number, now: number) => boolean;

/** One requestAnimationFrame loop for a set of tasks, run in insertion order
 * (the caret first, then whatever reads its position). Sleeps when idle. */
export class FrameLoop {
  private tasks: FrameTask[] = [];
  private frame = 0;
  private last = 0;

  add(task: FrameTask) { this.tasks.push(task); }

  wake() {
    if (this.frame || typeof requestAnimationFrame !== 'function') return;
    this.last = 0;
    this.frame = requestAnimationFrame(now => this.tick(now));
  }

  /** Run a frame right now (tests, or work that must not wait a frame). */
  flush(now = performance.now()) {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.tick(now);
  }

  stop() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  private tick(now: number) {
    this.frame = 0;
    // Cap the step: a backgrounded tab must not fling the caret.
    const dt = this.last ? Math.min(Math.max(now - this.last, 0), 64) / 1000 : 1 / 60;
    this.last = now;
    let busy = false;
    for (const task of this.tasks) if (task(dt, now)) busy = true;
    if (busy) {
      const last = this.last;
      this.frame = requestAnimationFrame(next => this.tick(next));
      this.last = last;
    }
  }
}
