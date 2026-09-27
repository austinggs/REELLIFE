/**
 * Institutions engine (System 42).
 *
 * Owns `systems.institutions`: institutions with mandates and jurisdictions,
 * and the concrete inventory of their memory — procedures, records,
 * precedents, staff and capacity. Every write asserts ownership; reads are
 * scope-free.
 *
 * Memory here is *things that can be lost*, not a trait. That is what makes
 * turnover and reform meaningful: losing a procedure is a distinct event
 * from losing a record, and both are distinct from an institution simply
 * deciding to behave differently.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  MEMORY_LOSS_CAUSES,
  type Institution,
  type InstitutionsSystemState,
  type InstitutionalRecord,
  type MemoryLossCause,
  type MemoryRetention,
  type Precedent,
  type Procedure,
} from "./types.ts";

export interface EstablishInstitutionRequest {
  readonly id: string;
  readonly organizationId: string;
  readonly mandate: string;
  readonly jurisdictionId: string;
  readonly capacity?: number;
  readonly staffIds?: readonly string[];
  readonly procedures?: readonly Omit<Procedure, "adoptedAt" | "retained">[];
}

export class InstitutionsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.institutions) {
      this.scope.assertOwner("institutions");
      this.world.systems.institutions = { institutions: [] } satisfies InstitutionsSystemState;
    }
  }

  private get state(): InstitutionsSystemState {
    return this.world.systems.institutions as InstitutionsSystemState;
  }

  private set state(value: InstitutionsSystemState) {
    this.world.systems.institutions = value;
  }

  // ---------------------------------------------------------------- reads ---

  institutions(): readonly Institution[] {
    return this.state.institutions;
  }

  institution(id: string): Institution | undefined {
    return this.state.institutions.find((candidate) => candidate.id === id);
  }

  requireInstitution(id: string, caller: string): Institution {
    const found = this.institution(id);
    if (found === undefined) {
      throw new Error(`InstitutionsEngine.${caller}: unknown institution ${id}`);
    }
    return found;
  }

  /** Institutions serving a jurisdiction (System 39 owns the jurisdiction). */
  institutionsIn(jurisdictionId: string): readonly Institution[] {
    return this.state.institutions.filter((entry) => entry.jurisdictionId === jurisdictionId);
  }

  // -------------------------------------------------------------- derived ---

  /**
   * How much of an institution's memory survives, derived from its
   * inventory. A brand-new institution with nothing written down has no
   * memory to lose, so its retention is `undefined` rather than zero:
   * "nothing remembered" and "everything forgotten" are different states.
   */
  memoryRetention(id: string): MemoryRetention {
    const institution = this.requireInstitution(id, "memoryRetention");
    const total =
      institution.records.length + institution.procedures.length + institution.precedents.length;
    const retained =
      institution.records.filter((entry) => entry.retained).length +
      institution.procedures.filter((entry) => entry.retained).length +
      institution.precedents.filter((entry) => entry.retained).length;
    return {
      institutionId: id,
      recordsRetained: institution.records.filter((entry) => entry.retained).length,
      recordsTotal: institution.records.length,
      proceduresRetained: institution.procedures.filter((entry) => entry.retained).length,
      proceduresTotal: institution.procedures.length,
      precedentsRetained: institution.precedents.filter((entry) => entry.retained).length,
      retention: total === 0 ? undefined : round4(retained / total),
    };
  }

  /**
   * Whether a precedent can still be relied on: it must survive, and the
   * rule it was read against must not have been superseded since.
   */
  canRelyOnPrecedent(
    institutionId: string,
    precedentId: string,
    supersededRuleIds: readonly string[],
  ): boolean {
    const institution = this.requireInstitution(institutionId, "canRelyOnPrecedent");
    const precedent = institution.precedents.find((entry) => entry.id === precedentId);
    if (precedent === undefined) {
      throw new Error(
        `InstitutionsEngine.canRelyOnPrecedent: ${institutionId} has no precedent ${precedentId}`,
      );
    }
    if (!precedent.retained) return false;
    return precedent.ruleId === undefined || !supersededRuleIds.includes(precedent.ruleId);
  }

  // --------------------------------------------------------------- writes ---

  establishInstitution(request: EstablishInstitutionRequest, at: WorldTime): Institution {
    this.scope.assertOwner("institutions");
    if (this.institution(request.id) !== undefined) {
      throw new Error(`InstitutionsEngine.establishInstitution: ${request.id} already exists`);
    }
    if (!this.knownOrganization(request.organizationId)) {
      throw new Error(
        `InstitutionsEngine.establishInstitution: ${request.organizationId} is not a registered organization (System 32)`,
      );
    }
    requireRatio(request.capacity ?? 0.5, "capacity", "establishInstitution");
    const institution: Institution = {
      id: request.id,
      organizationId: request.organizationId,
      mandate: request.mandate,
      jurisdictionId: request.jurisdictionId,
      capacity: request.capacity ?? 0.5,
      staffIds: [...(request.staffIds ?? [])],
      procedures: (request.procedures ?? []).map((procedure) => ({
        ...procedure,
        adoptedAt: at,
        retained: true,
      })),
      records: [],
      precedents: [],
      history: [{ at, kind: "established", note: request.mandate }],
    };
    this.state = { ...this.state, institutions: [...this.state.institutions, institution] };
    return institution;
  }

  /** Files a record. Records are how an institution remembers. */
  recordEntry(ids: IdAllocator, institutionId: string, title: string, at: WorldTime): InstitutionalRecord {
    this.scope.assertOwner("institutions");
    const institution = this.requireInstitution(institutionId, "recordEntry");
    if (title.trim().length === 0) {
      throw new Error("InstitutionsEngine.recordEntry: a record needs a title");
    }
    const record: InstitutionalRecord = { id: `rec-${ids.next("activity")}`, title, at, retained: true };
    this.write({ ...institution, records: [...institution.records, record] });
    return record;
  }

  /** Sets a precedent — a decision the institution will be read against. */
  setPrecedent(
    ids: IdAllocator,
    institutionId: string,
    request: { readonly ruling: string; readonly ruleId?: string },
    at: WorldTime,
  ): Precedent {
    this.scope.assertOwner("institutions");
    const institution = this.requireInstitution(institutionId, "setPrecedent");
    if (request.ruling.trim().length === 0) {
      throw new Error("InstitutionsEngine.setPrecedent: a precedent needs a ruling");
    }
    const precedent: Precedent = {
      id: `prc-${ids.next("activity")}`,
      ruling: request.ruling,
      at,
      retained: true,
      ...(request.ruleId === undefined ? {} : { ruleId: request.ruleId }),
    };
    this.write({
      ...institution,
      precedents: [...institution.precedents, precedent],
      history: [...institution.history, { at, kind: "precedent", note: request.ruling }],
    });
    return precedent;
  }

  /**
   * Loses memory, with a stated cause. Records are marked unretained rather
   * than deleted: "we cannot find it any more" and "it was never written
   * down" are different, and only one of them is a loss.
   */
  loseMemory(
    institutionId: string,
    kind: "records" | "procedures" | "precedents",
    cause: MemoryLossCause,
    at: WorldTime,
  ): Institution {
    this.scope.assertOwner("institutions");
    if (!MEMORY_LOSS_CAUSES.includes(cause)) {
      throw new Error(`InstitutionsEngine.loseMemory: unknown cause ${String(cause)}`);
    }
    const institution = this.requireInstitution(institutionId, "loseMemory");
    const history = [...institution.history, { at, kind: "memory_loss", note: `${kind} lost to ${cause}` }];
    if (kind === "records") {
      return this.write({
        ...institution,
        history,
        records: institution.records.map((entry) =>
          entry.retained ? { ...entry, retained: false, lostAt: at, lostCause: cause } : entry,
        ),
      });
    }
    if (kind === "procedures") {
      return this.write({
        ...institution,
        history,
        procedures: institution.procedures.map((entry) =>
          entry.retained ? { ...entry, retained: false } : entry,
        ),
      });
    }
    return this.write({
      ...institution,
      history,
      precedents: institution.precedents.map((entry) =>
        entry.retained ? { ...entry, retained: false } : entry,
      ),
    });
  }

  /**
   * Staff turnover: people leave, and what they alone knew goes with them.
   * Recorded as an event, because a system that quietly lost a person would
   * make every other fact about staffing a mystery.
   */
  recordTurnover(
    institutionId: string,
    staffIds: readonly string[],
    at: WorldTime,
    note: string,
  ): Institution {
    this.scope.assertOwner("institutions");
    const institution = this.requireInstitution(institutionId, "recordTurnover");
    const leaving = institution.staffIds.filter((id) => staffIds.includes(id));
    if (leaving.length === 0) {
      throw new Error(`InstitutionsEngine.recordTurnover: none of those staff belong to ${institutionId}`);
    }
    return this.write({
      ...institution,
      staffIds: institution.staffIds.filter((id) => !staffIds.includes(id)),
      history: [...institution.history, { at, kind: "turnover", note: `${leaving.join(", ")} left: ${note}` }],
    });
  }

  /** Reform: procedures are replaced, and the old ones kept as history. */
  reform(
    institutionId: string,
    procedures: readonly Omit<Procedure, "adoptedAt" | "retained">[],
    at: WorldTime,
  ): Institution {
    this.scope.assertOwner("institutions");
    const institution = this.requireInstitution(institutionId, "reform");
    return this.write({
      ...institution,
      procedures: [
        ...institution.procedures.map((entry) => ({ ...entry, retained: false })),
        ...procedures.map((procedure) => ({ ...procedure, adoptedAt: at, retained: true })),
      ],
      history: [
        ...institution.history,
        { at, kind: "reform", note: procedures.map((entry) => entry.title).join(", ") },
      ],
    });
  }

  /** Administrative capacity, supplied by whoever staffs the institution. */
  setCapacity(institutionId: string, capacity: number, at: WorldTime, note: string): Institution {
    this.scope.assertOwner("institutions");
    requireRatio(capacity, "capacity", "setCapacity");
    const institution = this.requireInstitution(institutionId, "setCapacity");
    return this.write({
      ...institution,
      capacity,
      history: [...institution.history, { at, kind: "capacity", note: `${round2(capacity)} — ${note}` }],
    });
  }

  private write(institution: Institution): Institution {
    this.state = {
      ...this.state,
      institutions: this.state.institutions.map((entry) => (entry.id === institution.id ? institution : entry)),
    };
    return institution;
  }

  private knownOrganization(id: string): boolean {
    const state = this.world.systems.organizations as
      | { readonly organizations: readonly { readonly id: string }[] }
      | undefined;
    if (state === undefined) return true;
    return state.organizations.some((entry) => entry.id === id);
  }
}

// --------------------------------------------------------------- helpers ---

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `InstitutionsEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}
