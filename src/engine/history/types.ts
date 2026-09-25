/**
 * ReelLife history records (System 54, UI/UX 17).
 *
 * Three presentation concepts sit on top of persisted history:
 *
 *   Timeline   curated chronology of meaningful occurrences
 *   Journal    player-perspective record of what the player experienced or was told
 *   Statistics derived aggregates computed at query time
 *
 * Only the records themselves are persisted. Statistics are never stored as
 * authoritative state: they are derived, and derived state stays derived
 * (architectural law 9).
 *
 * Retention is explicit. The raw event queue is the causal record; the timeline
 * is curated and therefore allowed to compress low-importance entries. Anything
 * with importance >= 3 is retained permanently, so causal milestones cannot be
 * quietly discarded.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";

export const HISTORY_KINDS = [
  "birth",
  "death",
  "lifeEvent",
  "milestone",
  "relationship",
  "household",
  "work",
  "education",
  "finance",
  "health",
  "legal",
  "housing",
  "travel",
  "worldEvent",
  "information",
  "decision",
  "system",
] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

/** Importance 1..5; 3 and above is retained permanently. */
export const RETAINED_IMPORTANCE = 3;

export interface TimelineEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly kind: HistoryKind;
  readonly summary: string;
  readonly detail?: string;
  readonly personId?: EntityId<"person">;
  readonly locationId?: string;
  readonly eventId?: EntityId<"event">;
  /** Event type and origin, retained so feeds can explain what kind of thing happened. */
  readonly eventType?: string;
  readonly causeKind?: string;
  readonly causalChainId?: string;
  readonly importance: number;
  readonly visibility: Visibility;
  readonly knownBy: readonly EntityId<"person">[];
  readonly tags: readonly string[];
}

export interface JournalEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly personId: EntityId<"person">;
  readonly text: string;
  readonly kind: HistoryKind;
  /** Set when the entry records something believed rather than verified. */
  readonly claimId?: EntityId<"claim">;
  readonly timelineEntryId?: string;
}

export interface HistoryState {
  readonly entries: readonly TimelineEntry[];
  readonly journal: readonly JournalEntry[];
  readonly sequence: number;
  /** Number of low-importance entries evicted by retention policy. */
  readonly compressedCount: number;
}

export interface HistoryLimits {
  readonly maxTimelineEntries: number;
  readonly maxJournalEntries: number;
}

export const DEFAULT_HISTORY_LIMITS: HistoryLimits = {
  maxTimelineEntries: 20_000,
  maxJournalEntries: 10_000,
};
