/**
 * System 42 — Institutions & Institutional Memory.
 *
 * "Institutions remember through records, procedures, practices, and
 * continuity — not a magical collective mind" (System 42 core principle).
 *
 * Memory here is a *concrete inventory*: records that exist, procedures
 * that were written, precedents that were set, and the people still there
 * to apply them. Each of those is something that can be lost — by fire, by
 * turnover, by corruption, by secrecy, by a dead filing system — which is
 * exactly how institutions lose memory in the world. A derived
 * `memoryRetention` is the share of the inventory still intact, and it goes
 * down when records are lost and up when new ones are added. Nothing here
 * gives an institution a mind; it gives it a filing cabinet with a history.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/** What can be done to an institution's memory (the spec's loss causes). */
export const MEMORY_LOSS_CAUSES = [
  "destruction",
  "turnover",
  "corruption",
  "poor_records",
  "secrecy",
  "technology_failure",
] as const;
export type MemoryLossCause = (typeof MEMORY_LOSS_CAUSES)[number];

export interface InstitutionalRecord {
  readonly id: string;
  readonly title: string;
  readonly at: WorldTime;
  /** `false` once the record has been lost; the record itself stays. */
  readonly retained: boolean;
  readonly lostAt?: WorldTime;
  readonly lostCause?: MemoryLossCause;
}

export interface Precedent {
  readonly id: string;
  /** What was decided. */
  readonly ruling: string;
  readonly at: WorldTime;
  readonly retained: boolean;
  /** The rule id this precedent was read against, when any. */
  readonly ruleId?: string;
}

export interface Procedure {
  readonly id: string;
  readonly title: string;
  /** The rule this procedure implements, if any. */
  readonly ruleId?: string;
  readonly adoptedAt: WorldTime;
  /** Procedures are also memory: an institution that forgot its procedure lost it. */
  readonly retained: boolean;
}

export interface Institution {
  readonly id: string;
  /** The System 32 organization that is the institution. */
  readonly organizationId: EntityId<"organization"> | string;
  readonly mandate: string;
  readonly jurisdictionId: string;
  readonly procedures: readonly Procedure[];
  readonly records: readonly InstitutionalRecord[];
  readonly precedents: readonly Precedent[];
  /** 0..1 administrative capacity, supplied by whoever staffs it. */
  readonly capacity: number;
  readonly staffIds: readonly string[];
  readonly history: readonly { readonly at: WorldTime; readonly kind: string; readonly note: string }[];
}

export interface InstitutionsSystemState {
  readonly institutions: readonly Institution[];
}

/** How much of an institution's memory is still intact, 0..1. */
export interface MemoryRetention {
  readonly institutionId: string;
  readonly recordsRetained: number;
  readonly recordsTotal: number;
  readonly proceduresRetained: number;
  readonly proceduresTotal: number;
  readonly precedentsRetained: number;
  readonly retention: number | undefined;
}
