/**
 * Host clock adapter (System 02 / System 06 boundary).
 *
 * The engine must never read a real-world clock for simulation decisions, so this
 * is the single place where the browser/Node wall clock is allowed to be touched.
 * It is used only for:
 *   - non-authoritative metadata labels (when a save was written, when a world was
 *     created),
 *   - performance measurement passed into the metrics collector,
 *   - the UI's animation pacing.
 *
 * Nothing here can influence simulation outcomes.
 */

import type { HostClock } from "@/engine/observability/metrics.ts";

export const hostClock: HostClock = {
  nowMs(): number {
    return Date.now();
  },
};

/** ISO-8601 label for save/world metadata. Never authoritative simulation time. */
export function hostTimestampLabel(): string {
  return new Date(Date.now()).toISOString();
}

/** Short human label for "last saved at" style UI. */
export function hostClockLabel(): string {
  return new Date(Date.now()).toLocaleString();
}
