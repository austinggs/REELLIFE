/**
 * ReelLife history store (System 54).
 *
 * Presentation reads history; the simulation appends to it. This store is the
 * single authoritative owner of timeline and journal records.
 *
 * Visible/hidden separation is preserved here as everywhere else: an entry knows
 * who may see it, and the query layer filters for the viewer. History is never a
 * back door around the information model.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import {
  DEFAULT_HISTORY_LIMITS,
  RETAINED_IMPORTANCE,
  type HistoryKind,
  type HistoryLimits,
  type HistoryState,
  type JournalEntry,
  type TimelineEntry,
} from "./types.ts";

export interface RecordTimelineInput {
  readonly at: WorldTime;
  readonly kind: HistoryKind;
  readonly summary: string;
  readonly detail?: string;
  readonly personId?: EntityId<"person">;
  readonly locationId?: string;
  readonly eventId?: EntityId<"event">;
  readonly eventType?: string;
  readonly causeKind?: string;
  readonly causalChainId?: string;
  readonly importance?: number;
  readonly visibility?: Visibility;
  readonly knownBy?: readonly EntityId<"person">[];
  readonly tags?: readonly string[];
}

export interface RecordJournalInput {
  readonly at: WorldTime;
  readonly personId: EntityId<"person">;
  readonly text: string;
  readonly kind: HistoryKind;
  readonly claimId?: EntityId<"claim">;
  readonly timelineEntryId?: string;
}

export class HistoryStore {
  private readonly scope: SystemScope;
  private readonly limits: HistoryLimits;
  private entries: TimelineEntry[];
  private journal: JournalEntry[];
  private nextSequence: number;
  private compressed = 0;

  constructor(
    scope: SystemScope,
    state?: HistoryState,
    limits: HistoryLimits = DEFAULT_HISTORY_LIMITS,
  ) {
    this.scope = scope;
    this.limits = limits;
    this.entries = [...(state?.entries ?? [])];
    this.journal = [...(state?.journal ?? [])];
    this.nextSequence = state?.sequence ?? 0;
    this.compressed = state?.compressedCount ?? 0;
  }

  // ---------------------------------------------------------------- reads

  all(): readonly TimelineEntry[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  compressedCount(): number {
    return this.compressed;
  }

  /** Entries at or before `time`, newest first. */
  recent(limit: number, before?: WorldTime): readonly TimelineEntry[] {
    const filtered =
      before === undefined
        ? this.entries
        : this.entries.filter((entry) => (entry.at as number) <= (before as number));
    return [...filtered].reverse().slice(0, Math.max(0, limit));
  }

  forPerson(personId: EntityId<"person">): readonly TimelineEntry[] {
    return this.entries.filter((entry) => entry.personId === personId);
  }

  forChain(causalChainId: string): readonly TimelineEntry[] {
    return this.entries.filter((entry) => entry.causalChainId === causalChainId);
  }

  journalFor(personId: EntityId<"person">): readonly JournalEntry[] {
    return this.journal.filter((entry) => entry.personId === personId);
  }

  // ------------------------------------------------------------- mutations

  record(input: RecordTimelineInput): TimelineEntry {
    this.scope.assertOwner("history");
    this.nextSequence += 1;
    const entry: TimelineEntry = {
      id: `HIS-${String(this.nextSequence).padStart(8, "0")}`,
      at: input.at,
      kind: input.kind,
      summary: input.summary,
      ...(input.detail === undefined ? {} : { detail: input.detail }),
      ...(input.personId === undefined ? {} : { personId: input.personId }),
      ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
      ...(input.eventId === undefined ? {} : { eventId: input.eventId }),
      ...(input.eventType === undefined ? {} : { eventType: input.eventType }),
      ...(input.causeKind === undefined ? {} : { causeKind: input.causeKind }),
      ...(input.causalChainId === undefined ? {} : { causalChainId: input.causalChainId }),
      importance: clampImportance(input.importance ?? 2),
      visibility: input.visibility ?? "public",
      knownBy: input.knownBy ?? [],
      tags: input.tags ?? [],
    };
    this.entries.push(entry);
    this.compressIfNeeded();
    return entry;
  }

  recordJournal(input: RecordJournalInput): JournalEntry {
    this.scope.assertOwner("history");
    this.nextSequence += 1;
    const entry: JournalEntry = {
      id: `JRN-${String(this.nextSequence).padStart(8, "0")}`,
      at: input.at,
      personId: input.personId,
      text: input.text,
      kind: input.kind,
      ...(input.claimId === undefined ? {} : { claimId: input.claimId }),
      ...(input.timelineEntryId === undefined ? {} : { timelineEntryId: input.timelineEntryId }),
    };
    this.journal.push(entry);
    if (this.journal.length > this.limits.maxJournalEntries) {
      this.journal.splice(0, this.journal.length - this.limits.maxJournalEntries);
    }
    return entry;
  }

  /**
   * Retention: low-importance entries are evicted oldest-first once the cap is
   * reached. Milestones (importance >= 3) are never evicted, so the causal record
   * of a life survives compression.
   */
  private compressIfNeeded(): void {
    if (this.entries.length <= this.limits.maxTimelineEntries) return;
    let overflow = this.entries.length - this.limits.maxTimelineEntries;
    for (let index = 0; index < this.entries.length && overflow > 0; ) {
      const entry = this.entries[index];
      if (entry === undefined) break;
      if (entry.importance >= RETAINED_IMPORTANCE) {
        index += 1;
        continue;
      }
      this.entries.splice(index, 1);
      this.compressed += 1;
      overflow -= 1;
    }
  }

  serialize(): HistoryState {
    return {
      entries: [...this.entries],
      journal: [...this.journal],
      sequence: this.nextSequence,
      compressedCount: this.compressed,
    };
  }

  static deserialize(scope: SystemScope, state: HistoryState, limits?: HistoryLimits): HistoryStore {
    return new HistoryStore(scope, state, limits ?? DEFAULT_HISTORY_LIMITS);
  }
}

function clampImportance(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(5, Math.round(value)));
}

