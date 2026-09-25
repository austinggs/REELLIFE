/**
 * ReelLife trace log (System 59).
 *
 * The important trace is:
 *   Command -> Validation -> Action -> Event -> Consequences -> State Changes
 *
 * A bounded ring buffer is used because traces are an engineering artifact, not
 * authoritative state: they must never grow without bound and they must never be
 * persisted as if they were simulation truth.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemId } from "../core/ownership.ts";

export const TRACE_KINDS = [
  "command",
  "validation",
  "authority",
  "resolution",
  "event",
  "consequence",
  "stateChange",
  "system",
  "metric",
  "invariant",
  "warning",
  "error",
] as const;
export type TraceKind = (typeof TRACE_KINDS)[number];

export interface TraceEntry {
  readonly index: number;
  readonly at: WorldTime;
  readonly step: number;
  readonly kind: TraceKind;
  readonly systemId?: SystemId;
  readonly commandId?: EntityId<"command">;
  readonly eventId?: EntityId<"event">;
  readonly causalChainId?: string;
  readonly message: string;
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface TraceLimits {
  readonly maxEntries: number;
  /** Number of "error" and "warning" entries always retained. */
  readonly keepDiagnostics: number;
}

export const DEFAULT_TRACE_LIMITS: TraceLimits = { maxEntries: 5_000, keepDiagnostics: 500 };

export class TraceLog {
  private readonly entries: TraceEntry[] = [];
  private readonly diagnostics: TraceEntry[] = [];
  private nextIndex = 0;
  private readonly limits: TraceLimits;

  constructor(limits: TraceLimits = DEFAULT_TRACE_LIMITS) {
    this.limits = limits;
  }

  get size(): number {
    return this.entries.length;
  }

  record(entry: Omit<TraceEntry, "index">): TraceEntry {
    const full: TraceEntry = { index: this.nextIndex, ...entry };
    this.nextIndex += 1;
    this.entries.push(full);
    while (this.entries.length > this.limits.maxEntries) this.entries.shift();
    if (full.kind === "error" || full.kind === "warning" || full.kind === "invariant") {
      this.diagnostics.push(full);
      while (this.diagnostics.length > this.limits.keepDiagnostics) this.diagnostics.shift();
    }
    return full;
  }

  all(): readonly TraceEntry[] {
    return this.entries;
  }

  latest(count: number): readonly TraceEntry[] {
    return this.entries.slice(Math.max(0, this.entries.length - count));
  }

  /** Diagnostics survive ring-buffer eviction so failures remain explainable. */
  diagnosticEntries(): readonly TraceEntry[] {
    return this.diagnostics;
  }

  /** Full causal view for one event chain, in occurrence order. */
  forChain(causalChainId: string): readonly TraceEntry[] {
    return this.entries.filter((entry) => entry.causalChainId === causalChainId);
  }

  forCommand(commandId: EntityId<"command">): readonly TraceEntry[] {
    return this.entries.filter((entry) => entry.commandId === commandId);
  }

  clear(): void {
    this.entries.length = 0;
    this.diagnostics.length = 0;
  }
}
