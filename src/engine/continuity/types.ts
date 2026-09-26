/**
 * Life continuity state (System 53, M2 partial): the death lifecycle.
 *
 * PersonId persists after death — this section records *that* a life ended
 * and the context it ended in; it never erases identity, relationships or
 * causal history. Estate/inheritance mechanics arrive in M7.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/** ACTIVE -> DECEASED -> HISTORICAL (System 53 lifecycle). */
export const LIFE_STATUSES = ["active", "deceased", "historical"] as const;
export type LifeStatus = (typeof LIFE_STATUSES)[number];

export interface DeathEntry {
  readonly personId: EntityId<"person">;
  readonly declaredAt: WorldTime;
  readonly cause?: string;
}

export interface ContinuitySystemState {
  /** PersonId-keyed lifecycle; a person absent from here is `active`. */
  readonly statuses: Readonly<Record<string, LifeStatus>>;
  readonly deaths: readonly DeathEntry[];
}
