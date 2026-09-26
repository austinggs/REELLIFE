/**
 * Legal identity state (System 40): institutional representations of people.
 *
 * A LegalRecord is what an authority says about a person — never the person
 * themselves (architectural law 5). Records can be missing, disputed or
 * corrected; corrections are appended, never silently overwritten.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

export const LEGAL_RECORD_TYPES = [
  "birthRegistration",
  "deathRegistration",
  "nationalId",
  "citizenship",
  "residency",
  "marriageCertificate",
  "professionalLicense",
  "permit",
] as const;
export type LegalRecordType = (typeof LEGAL_RECORD_TYPES)[number];

export const LEGAL_RECORD_STATUSES = [
  "pending",
  "valid",
  "expired",
  "revoked",
  "disputed",
] as const;
export type LegalRecordStatus = (typeof LEGAL_RECORD_STATUSES)[number];

export const LEGAL_RECORD_ACCESS = ["public", "authority", "subject"] as const;
export type LegalRecordAccess = (typeof LEGAL_RECORD_ACCESS)[number];

/** An appended correction; the previous value is preserved, never erased. */
export interface LegalCorrection {
  readonly at: WorldTime;
  readonly field: string;
  readonly previous: unknown;
  readonly current: unknown;
  readonly reason?: string;
}

export interface LegalRecord {
  readonly id: EntityId<"record">;
  readonly type: LegalRecordType;
  /** The person the record is *about* — distinct from the record itself. */
  readonly subject: EntityId<"person">;
  /** Organization (or state authority slug) that issued the record. */
  readonly authority: string;
  /** Document/registry number, when the authority issues one. */
  readonly identifier?: string;
  readonly issuedAt: WorldTime;
  readonly validUntil?: WorldTime;
  readonly status: LegalRecordStatus;
  readonly access: LegalRecordAccess;
  readonly corrections: readonly LegalCorrection[];
}

export interface LegalIdentitySystemState {
  readonly records: readonly LegalRecord[];
}
