/**
 * Legal identity engine (System 40).
 *
 * Owns administrative records: birth/death registrations, IDs, citizenship
 * and residency records. Records are institutional *representations* — they
 * can lag, be corrected or be disputed, and corrections append history
 * instead of overwriting it. Access to records is permission sensitive.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  type LegalIdentitySystemState,
  type LegalRecord,
  type LegalRecordAccess,
  type LegalRecordStatus,
  type LegalRecordType,
} from "./types.ts";

/** Fields a correction can retarget; status changes go through setStatus. */
export const CORRECTABLE_LEGAL_FIELDS = ["identifier", "authority", "access", "validUntil"] as const;
export type CorrectableLegalField = (typeof CORRECTABLE_LEGAL_FIELDS)[number];

export interface IssueLegalRecordRequest {
  readonly type: LegalRecordType;
  readonly subject: EntityId<"person">;
  readonly authority: string;
  readonly identifier?: string;
  readonly validUntil?: WorldTime;
  readonly status?: LegalRecordStatus;
  readonly access?: LegalRecordAccess;
}

export class LegalIdentityEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.legalIdentity) {
      this.scope.assertOwner("legalIdentity");
      this.world.systems.legalIdentity = { records: [] } satisfies LegalIdentitySystemState;
    }
  }

  private get state(): LegalIdentitySystemState {
    return this.world.systems.legalIdentity as LegalIdentitySystemState;
  }

  private set state(value: LegalIdentitySystemState) {
    this.world.systems.legalIdentity = value;
  }

  private replace(updated: LegalRecord): void {
    this.state = {
      ...this.state,
      records: this.state.records.map((record) => (record.id === updated.id ? updated : record)),
    };
  }

  get(id: string): LegalRecord | undefined {
    return this.state.records.find((record) => record.id === id);
  }

  all(): readonly LegalRecord[] {
    return this.state.records;
  }

  recordsFor(person: EntityId<"person">): readonly LegalRecord[] {
    return this.state.records.filter((record) => record.subject === person);
  }

  ofType(person: EntityId<"person">, type: LegalRecordType): readonly LegalRecord[] {
    return this.recordsFor(person).filter((record) => record.type === type);
  }

  issue(ids: IdAllocator, request: IssueLegalRecordRequest, now: WorldTime): LegalRecord {
    this.scope.assertOwner("legalIdentity");
    if (!request.authority) {
      throw new Error("LegalIdentityEngine.issue: authority is required");
    }
    const record: LegalRecord = {
      id: ids.next("record"),
      type: request.type,
      subject: request.subject,
      authority: request.authority,
      identifier: request.identifier,
      issuedAt: now,
      validUntil: request.validUntil,
      status: request.status ?? "valid",
      access: request.access ?? "authority",
      corrections: [],
    };
    this.state = { ...this.state, records: [...this.state.records, record] };
    return record;
  }

  /** True when the record is valid at `at`, considering expiry. */
  isValidAt(record: LegalRecord, at: WorldTime): boolean {
    if (record.status !== "valid") return false;
    if (record.validUntil !== undefined && (record.validUntil as number) <= (at as number)) {
      return false;
    }
    return true;
  }

  /**
   * Access check: public records are open; subject-only records are sealed to
   * everyone else; authority-gated records are visible to the subject (their
   * own permit) and to holders of authority.
   */
  canAccess(record: LegalRecord, viewer: EntityId<"person">, viewerHasAuthority: boolean): boolean {
    if (record.access === "public") return true;
    if (record.access === "subject") return record.subject === viewer;
    return record.subject === viewer || viewerHasAuthority;
  }

  /**
   * Applies a correction: the record takes the new value and the previous one
   * is preserved on the correction history — never silently overwritten.
   * `previous` is read from the record itself so history cannot disagree with
   * what was actually on file.
   */
  correct(
    recordId: string,
    field: CorrectableLegalField,
    current: string | LegalRecordAccess | WorldTime | undefined,
    now: WorldTime,
    reason?: string,
  ): LegalRecord {
    this.scope.assertOwner("legalIdentity");
    const record = this.get(recordId);
    if (!record) throw new Error(`LegalIdentityEngine.correct: unknown record ${recordId}`);
    const previous = record[field];
    if (previous === current) return record;

    let updated: LegalRecord;
    switch (field) {
      case "identifier":
        updated = { ...record, identifier: current as string | undefined };
        break;
      case "authority":
        updated = { ...record, authority: current as string };
        break;
      case "access":
        updated = { ...record, access: current as LegalRecordAccess };
        break;
      case "validUntil":
        updated = { ...record, validUntil: current as WorldTime | undefined };
        break;
    }
    updated = {
      ...updated,
      corrections: [
        ...record.corrections,
        { at: now, field, previous, current, ...(reason ? { reason } : {}) },
      ],
    };
    this.replace(updated);
    return updated;
  }

  setStatus(recordId: string, status: LegalRecordStatus, now: WorldTime): LegalRecord {
    this.scope.assertOwner("legalIdentity");
    const record = this.get(recordId);
    if (!record) throw new Error(`LegalIdentityEngine.setStatus: unknown record ${recordId}`);
    if (record.status === status) return record;
    const updated: LegalRecord = {
      ...record,
      status,
      corrections: [
        ...record.corrections,
        { at: now, field: "status", previous: record.status, current: status },
      ],
    };
    this.replace(updated);
    return updated;
  }
}
