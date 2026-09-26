import type { LocationRef } from "../primitives/location.ts";

/**
 * Geography state (System 37): the authoritative spatial hierarchy.
 *
 * Places are stored as canonical LocationRefs (stable authored IDs such as
 * `CITY-ARDEN`), which survive save/load unchanged. The map UI reads this
 * state through projections; it never writes geography truth.
 */
export interface GeographySystemState {
  /** Canonical registration order: parents are always registered before children. */
  readonly places: readonly LocationRef[];
}
