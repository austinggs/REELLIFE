/**
 * ReelLife authoritative clock (System 02).
 *
 * There is exactly one authoritative clock. Simulation speed changes the
 * processing cadence, never temporal truth: 1000x does not make time pass
 * "differently", it only means more quanta are processed per real second.
 * Pausing freezes authoritative time completely.
 *
 * Every advance is a whole number of quanta. That keeps time monotonic,
 * serializable and replayable, and it makes "same-time" ordering well defined
 * because ordering keys include timestamp, priority and sequence.
 */

import { atTime, durationOf, type Duration, type WorldTime } from "../primitives/time.ts";

export const SIMULATION_SPEEDS = [1, 10, 100, 1000] as const;
export type SimulationSpeed = (typeof SIMULATION_SPEEDS)[number];

/** One authoritative quantum. Activities, needs and schedules resolve at this resolution. */
export const DEFAULT_QUANTUM_MINUTES = 1;

export interface WorldClockSnapshot {
  readonly currentTime: WorldTime;
  readonly speed: SimulationSpeed;
  readonly paused: boolean;
  readonly stepIndex: number;
  readonly quantumMinutes: number;
  readonly startTime: WorldTime;
}

export interface AdvanceResult {
  readonly from: WorldTime;
  readonly to: WorldTime;
  readonly steps: number;
  /** True when a catch-up was clipped because the requested span was too large. */
  readonly clipped: boolean;
}

/**
 * Default safety bound for offline catch-up. A return after a long absence must
 * not try to simulate millions of quanta at full resolution; the relevance and
 * materialization systems exist precisely so that long spans can be compressed.
 */
export const DEFAULT_MAX_CATCHUP_QUANTA = 5_000_000;

export class WorldClock {
  private currentTime: WorldTime;
  private speed: SimulationSpeed;
  private paused: boolean;
  private step: number;
  readonly quantumMinutes: number;
  readonly startTime: WorldTime;

  constructor(init: {
    startTime: WorldTime;
    speed?: SimulationSpeed;
    paused?: boolean;
    stepIndex?: number;
    quantumMinutes?: number;
  }) {
    this.quantumMinutes = init.quantumMinutes ?? DEFAULT_QUANTUM_MINUTES;
    if (!Number.isInteger(this.quantumMinutes) || this.quantumMinutes <= 0) {
      throw new Error(`Clock quantum must be a positive integer, received ${this.quantumMinutes}`);
    }
    this.startTime = init.startTime;
    this.currentTime = init.startTime;
    this.speed = init.speed ?? 1;
    this.paused = init.paused ?? true;
    this.step = init.stepIndex ?? 0;
  }

  get time(): WorldTime {
    return this.currentTime;
  }

  get simulationSpeed(): SimulationSpeed {
    return this.speed;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get stepIndex(): number {
    return this.step;
  }

  get quantum(): Duration {
    return durationOf(this.quantumMinutes);
  }

  setSpeed(speed: SimulationSpeed): void {
    if (!SIMULATION_SPEEDS.includes(speed)) {
      throw new RangeError(`Unsupported simulation speed: ${String(speed)}`);
    }
    this.speed = speed;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Advances exactly one quantum. Time is strictly monotonic. */
  advanceQuantum(): WorldTime {
    this.currentTime = atTime((this.currentTime as number) + this.quantumMinutes);
    this.step += 1;
    return this.currentTime;
  }

  /**
   * Advances to a target time in whole quanta WITHOUT running the simulation.
   *
   * This is a clock-level jump used by tooling, tests and restore paths. It
   * deliberately does not process events or step systems; use
   * `Simulation.advanceTo` for a real catch-up, because jumping the clock and
   * then stepping the same span would advance the world twice.
   */
  advanceTo(target: WorldTime, maxQuanta = DEFAULT_MAX_CATCHUP_QUANTA): AdvanceResult {
    const from = this.currentTime;
    const deltaMinutes = (target as number) - (from as number);
    if (deltaMinutes <= 0) {
      return { from, to: from, steps: 0, clipped: false };
    }

    const requested = Math.ceil(deltaMinutes / this.quantumMinutes);
    const steps = Math.min(requested, maxQuanta);
    const clipped = steps < requested;

    this.currentTime = atTime((from as number) + steps * this.quantumMinutes);
    this.step += steps;

    return { from, to: this.currentTime, steps, clipped };
  }

  serialize(): WorldClockSnapshot {
    return {
      currentTime: this.currentTime,
      speed: this.speed,
      paused: this.paused,
      stepIndex: this.step,
      quantumMinutes: this.quantumMinutes,
      startTime: this.startTime,
    };
  }

  static deserialize(snapshot: WorldClockSnapshot): WorldClock {
    const clock = new WorldClock({
      startTime: snapshot.startTime,
      speed: snapshot.speed,
      paused: snapshot.paused,
      stepIndex: snapshot.stepIndex,
      quantumMinutes: snapshot.quantumMinutes,
    });
    // Restore the absolute time directly so a save resumes at the exact moment.
    clock.currentTime = snapshot.currentTime;
    return clock;
  }

  /**
   * Moves the clock to an exact time without stepping (used by save/load and by
   * deterministic test fixtures). Rejects backwards movement to protect
   * monotonicity.
   */
  restoreTime(time: WorldTime): void {
    if ((time as number) < (this.currentTime as number)) {
      throw new RangeError("Authoritative time is monotonic and cannot move backwards");
    }
    this.currentTime = time;
  }
}
