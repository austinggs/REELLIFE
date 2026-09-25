/**
 * ReelLife metrics (System 59).
 *
 * Metrics are engineering telemetry, never simulation truth. They answer
 * questions such as: how long does a step take, how many entities are active,
 * how large is the event queue, what is the resolution distribution?
 *
 * Wall-clock timing is injected as a host function so that authoritative
 * simulation code never reads a real clock itself (see eslint.config.js).
 */

export interface MetricsSnapshot {
  readonly counters: Readonly<Record<string, number>>;
  readonly gauges: Readonly<Record<string, number>>;
  readonly timings: Readonly<Record<string, TimingSummary>>;
}

export interface TimingSummary {
  readonly count: number;
  readonly totalMs: number;
  readonly maxMs: number;
  readonly lastMs: number;
}

export interface HostClock {
  nowMs(): number;
}

/** Deterministic host clock for tests and replay: counts instead of measuring. */
export function countingHostClock(stepMs = 1): HostClock {
  let current = 0;
  return {
    nowMs(): number {
      current += stepMs;
      return current;
    },
  };
}

export class MetricsCollector {
  private readonly hostClock: HostClock;
  private readonly counters = new Map<string, number>();
  private readonly gauges = new Map<string, number>();
  private readonly timings = new Map<string, TimingSummary>();

  constructor(hostClock: HostClock) {
    this.hostClock = hostClock;
  }

  increment(name: string, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + amount);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  /** Measures `fn`, recording a timing sample under `name`. */
  measure<T>(name: string, fn: () => T): T {
    const started = this.hostClock.nowMs();
    try {
      return fn();
    } finally {
      this.observe(name, this.hostClock.nowMs() - started);
    }
  }

  observe(name: string, durationMs: number): void {
    const existing = this.timings.get(name);
    if (existing) {
      this.timings.set(name, {
        count: existing.count + 1,
        totalMs: existing.totalMs + durationMs,
        maxMs: Math.max(existing.maxMs, durationMs),
        lastMs: durationMs,
      });
      return;
    }
    this.timings.set(name, { count: 1, totalMs: durationMs, maxMs: durationMs, lastMs: durationMs });
  }

  count(name: string): number {
    return this.counters.get(name) ?? 0;
  }

  gauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  snapshot(): MetricsSnapshot {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      gauges: Object.fromEntries(this.gauges.entries()),
      timings: Object.fromEntries(this.timings.entries()),
    };
  }

  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.timings.clear();
  }
}
