/**
 * Life continuity engine (System 53).
 *
 * Owns the death lifecycle registry (ACTIVE -> DECEASED -> HISTORICAL), the
 * determinations and records behind it, player control handoff, and the estate
 * cases. It records lifecycle truth; identity keeps the person's own record (the
 * `death` field) and `pronounceDeath` below coordinates the two through
 * sequential ownership scopes — one owner per write.
 *
 * Cross-system processes (the death pipeline, mortality checking, estate
 * settlement) live in `death.ts`, `mortality.ts` and `estate.ts`: each performs
 * its writes one owner at a time, exactly like materialization and seeding do,
 * because a nested mutation scope is a defect, not a shortcut.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { IdentityEngine } from "../identity/engine.ts";
import {
  emptyContinuityState,
  type ContinuityDeathRecord,
  type ContinuitySystemState,
  type Beneficiary,
  type ControlTransfer,
  type DeathCause,
  type DeathDetermination,
  type DeathEntry,
  type EstateCase,
  type EstateStatus,
  type LifeStatus,
  type SuccessionBasis,
  type Testament,
} from "./types.ts";

/** Everything continuity knows about one person, assembled on demand. */
export interface ContinuityReading {
  readonly personId: EntityId<"person">;
  readonly status: LifeStatus;
  readonly death?: DeathEntry;
  readonly determination?: DeathDetermination;
  readonly record?: ContinuityDeathRecord;
  /** The transfer that put this person in control, if one did. */
  readonly assumedControlAt?: ControlTransfer;
}

export class LifeContinuityEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;
  /** False for read-only handles, which must not claim the state slot. */
  private readonly claimsState: boolean;

  constructor(scope: SystemScope, world: WorldState, options?: { readonly readOnly?: boolean }) {
    this.scope = scope;
    this.world = world;
    this.claimsState = options?.readOnly !== true;
    if (this.claimsState && !this.world.systems.continuity) {
      this.scope.assertOwner("continuity");
      this.world.systems.continuity = emptyContinuityState();
    }
  }

  /**
   * A handle for reading continuity state without the right to claim it.
   *
   * Constructing the engine normally initializes `systems.continuity` on first
   * use, and that is a *write*. Read paths (does this person still hold
   * control? is the estate still open?) must not need a mutation scope, or every
   * reader would be forced to open one — which is how a read ends up asserting
   * ownership it does not have. The state getter already tolerates a missing
   * slot, so a read-only handle is honest about a world that has never had a
   * death in it.
   */
  static peek(scope: SystemScope, world: WorldState): LifeContinuityEngine {
    return new LifeContinuityEngine(scope, world, { readOnly: true });
  }

  /**
   * The authoritative state, with any field an older save predates filled in
   * with its empty value. Reads therefore never fabricate and never throw;
   * writes replace the whole record, so the shape converges on first write.
   */
  private get state(): ContinuitySystemState {
    const raw = this.world.systems.continuity as Partial<ContinuitySystemState> | undefined;
    return {
      statuses: raw?.statuses ?? {},
      deaths: raw?.deaths ?? [],
      determinations: raw?.determinations ?? [],
      records: raw?.records ?? [],
      controlTransfers: raw?.controlTransfers ?? [],
      testaments: raw?.testaments ?? [],
      estates: raw?.estates ?? [],
    };
  }

  private set state(value: ContinuitySystemState) {
    if (!this.claimsState) {
      throw new Error(
        "LifeContinuityEngine: this is a read-only handle (LifeContinuityEngine.peek); " +
          "open a continuity mutation scope and construct the engine normally to write.",
      );
    }
    this.world.systems.continuity = value;
  }

  // ------------------------------------------------------------------ reads

  statusOf(personId: EntityId<"person">): LifeStatus {
    return this.state.statuses[String(personId)] ?? "active";
  }

  deathOf(personId: EntityId<"person">): DeathEntry | undefined {
    return this.state.deaths.find((entry) => entry.personId === personId);
  }

  all(): readonly DeathEntry[] {
    return this.state.deaths;
  }

  determinationsOf(personId: EntityId<"person">): readonly DeathDetermination[] {
    return this.state.determinations.filter((entry) => entry.personId === personId);
  }

  determinationOf(personId: EntityId<"person">): DeathDetermination | undefined {
    return this.determinationsOf(personId)[0];
  }

  allDeterminations(): readonly DeathDetermination[] {
    return this.state.determinations;
  }

  recordOf(personId: EntityId<"person">): ContinuityDeathRecord | undefined {
    return this.state.records.find((entry) => entry.personId === personId);
  }

  allRecords(): readonly ContinuityDeathRecord[] {
    return this.state.records;
  }

  controlTransfers(): readonly ControlTransfer[] {
    return this.state.controlTransfers;
  }

  /**
   * Who currently holds control, if a transfer ever moved it. Derived from the
   * transfer list: no separate "controlled person" flag is persisted, so a load
   * cannot disagree with the history that produced it.
   */
  currentControllerId(): EntityId<"person"> | undefined {
    return this.state.controlTransfers[this.state.controlTransfers.length - 1]?.toPersonId;
  }

  testaments(): readonly Testament[] {
    return this.state.testaments;
  }

  /** The will that currently applies to a person: the last one not revoked. */
  testamentFor(personId: EntityId<"person">): Testament | undefined {
    return [...this.state.testaments]
      .filter((entry) => entry.testatorId === personId && entry.revokedAt === undefined)
      .pop();
  }

  estates(): readonly EstateCase[] {
    return this.state.estates;
  }

  estate(id: string): EstateCase | undefined {
    return this.state.estates.find((entry) => entry.id === id);
  }

  estatesOf(personId: EntityId<"person">): readonly EstateCase[] {
    return this.state.estates.filter((entry) => entry.deceasedId === personId);
  }

  /** A single reading for one person; presentation and tests both use this. */
  readingOf(personId: EntityId<"person">): ContinuityReading {
    const death = this.deathOf(personId);
    const determination = this.determinationOf(personId);
    const record = this.recordOf(personId);
    const assumedControlAt = this.state.controlTransfers.find(
      (entry) => entry.toPersonId === personId,
    );
    return {
      personId,
      status: this.statusOf(personId),
      ...(death === undefined ? {} : { death }),
      ...(determination === undefined ? {} : { determination }),
      ...(record === undefined ? {} : { record }),
      ...(assumedControlAt === undefined ? {} : { assumedControlAt }),
    };
  }
  // ----------------------------------------------------------------- writes

  /**
   * Registers a death. Refuses a second death for the same person: a life ends
   * once, and "died twice" would corrupt every causal walk that reads it.
   */
  registerDeath(
    personId: EntityId<"person">,
    declaredAt: WorldTime,
    cause?: string,
    determinationId?: string,
  ): void {
    this.scope.assertOwner("continuity");
    if (this.statusOf(personId) !== "active") {
      throw new Error(
        `LifeContinuityEngine.registerDeath: ${personId} is ${this.statusOf(personId)}, not active`,
      );
    }
    this.state = {
      ...this.state,
      statuses: { ...this.state.statuses, [String(personId)]: "deceased" },
      deaths: [
        ...this.state.deaths,
        {
          personId,
          declaredAt,
          ...(cause ? { cause } : {}),
          ...(determinationId ? { determinationId } : {}),
        },
      ],
    };
  }

  /** Records how a death was determined, and on what evidence. */
  determineDeath(id: string, determination: Omit<DeathDetermination, "id">): DeathDetermination {
    this.scope.assertOwner("continuity");
    if (this.state.determinations.some((entry) => entry.id === id)) {
      throw new Error(`LifeContinuityEngine.determineDeath: determination ${id} already exists`);
    }
    if (determination.evidence.length === 0) {
      // A determination with no evidence is exactly the "arbitrary hidden
      // modifier" the architecture forbids: it could not be explained later.
      throw new Error(
        "LifeContinuityEngine.determineDeath: a determination must cite at least one fact",
      );
    }
    const record: DeathDetermination = { id, ...determination };
    this.state = { ...this.state, determinations: [...this.state.determinations, record] };
    return record;
  }

  /** Files the continuity-side death record. Separate from the determination. */
  recordDeathRecord(
    id: string,
    input: {
      readonly personId: EntityId<"person">;
      readonly determinationId: string;
      readonly recordedAt: WorldTime;
      readonly cause: DeathCause;
    },
  ): ContinuityDeathRecord {
    this.scope.assertOwner("continuity");
    if (this.recordOf(input.personId)) {
      throw new Error(
        `LifeContinuityEngine.recordDeathRecord: ${input.personId} already has a death record`,
      );
    }
    const record: ContinuityDeathRecord = { id, ...input };
    this.state = { ...this.state, records: [...this.state.records, record] };
    return record;
  }

  /** Attaches the System 40 administrative record once it has been issued. */
  linkCivilRecord(recordId: string, civilRecordId: string): ContinuityDeathRecord {
    this.scope.assertOwner("continuity");
    const existing = this.state.records.find((entry) => entry.id === recordId);
    if (!existing) {
      throw new Error(`LifeContinuityEngine.linkCivilRecord: unknown record ${recordId}`);
    }
    const updated: ContinuityDeathRecord = { ...existing, civilRecordId };
    this.state = {
      ...this.state,
      records: this.state.records.map((entry) => (entry.id === recordId ? updated : entry)),
    };
    return updated;
  }

  /** Deceased lives become historical once no active matter remains. */
  markHistorical(personId: EntityId<"person">): void {
    this.scope.assertOwner("continuity");
    if (this.statusOf(personId) !== "deceased") {
      throw new Error(`LifeContinuityEngine.markHistorical: ${personId} is not deceased`);
    }
    this.state = {
      ...this.state,
      statuses: { ...this.state.statuses, [String(personId)]: "historical" },
    };
  }

  /** Records a control handoff. The world is not reset, and nothing is re-keyed. */
  recordControlTransfer(
    id: string,
    input: {
      readonly fromPersonId: EntityId<"person">;
      readonly toPersonId: EntityId<"person">;
      readonly at: WorldTime;
      readonly basis: SuccessionBasis;
      readonly estateId?: string;
      readonly reason?: string;
    },
  ): ControlTransfer {
    this.scope.assertOwner("continuity");
    if (input.fromPersonId === input.toPersonId) {
      throw new Error(
        "LifeContinuityEngine.recordControlTransfer: a person cannot take over from themselves",
      );
    }
    if (this.state.controlTransfers.some((entry) => entry.id === id)) {
      throw new Error(`LifeContinuityEngine.recordControlTransfer: transfer ${id} already exists`);
    }
    const transfer: ControlTransfer = { id, ...input };
    this.state = { ...this.state, controlTransfers: [...this.state.controlTransfers, transfer] };
    return transfer;
  }

  /** Records a declared will. A revocation is a separate write, never a deletion. */
  declareTestament(
    id: string,
    input: {
      readonly testatorId: EntityId<"person">;
      readonly declaredAt: WorldTime;
      readonly beneficiaries: readonly Beneficiary[];
      readonly executorId?: EntityId<"person">;
    },
  ): Testament {
    this.scope.assertOwner("continuity");
    if (this.state.testaments.some((entry) => entry.id === id)) {
      throw new Error(`LifeContinuityEngine.declareTestament: testament ${id} already exists`);
    }
    const shareTotal = input.beneficiaries.reduce((sum, entry) => sum + entry.share, 0);
    if (input.beneficiaries.length > 0 && Math.abs(shareTotal - 1) > 1e-9) {
      // Shares that do not sum to 1 would silently leave part of the estate
      // unassigned; refusing is the honest answer.
      throw new Error(
        `LifeContinuityEngine.declareTestament: beneficiary shares sum to ${String(shareTotal)}, not 1`,
      );
    }
    const testament: Testament = { id, ...input };
    this.state = { ...this.state, testaments: [...this.state.testaments, testament] };
    return testament;
  }

  /** Revokes a will. The record stays; it stops applying from `at`. */
  revokeTestament(id: string, at: WorldTime): Testament {
    this.scope.assertOwner("continuity");
    const existing = this.state.testaments.find((entry) => entry.id === id);
    if (!existing) throw new Error(`LifeContinuityEngine.revokeTestament: unknown testament ${id}`);
    const updated: Testament = { ...existing, revokedAt: at };
    this.state = {
      ...this.state,
      testaments: this.state.testaments.map((entry) => (entry.id === id ? updated : entry)),
    };
    return updated;
  }

  /** Opens an estate case. The case holds references; it never holds title. */
  addEstate(estate: EstateCase): EstateCase {
    this.scope.assertOwner("continuity");
    if (this.estate(estate.id)) {
      throw new Error(`LifeContinuityEngine.addEstate: estate ${estate.id} already exists`);
    }
    this.state = { ...this.state, estates: [...this.state.estates, estate] };
    return estate;
  }

  /** Replaces one estate case, e.g. to record applications or settle it. */
  replaceEstate(updated: EstateCase): EstateCase {
    this.scope.assertOwner("continuity");
    if (!this.estate(updated.id)) {
      throw new Error(`LifeContinuityEngine.replaceEstate: unknown estate ${updated.id}`);
    }
    this.state = {
      ...this.state,
      estates: this.state.estates.map((entry) => (entry.id === updated.id ? updated : entry)),
    };
    return updated;
  }

  /** Moves an estate between statuses, keeping the reason it moved. */
  setEstateStatus(id: string, status: EstateStatus, note?: string): EstateCase {
    const estate = this.estate(id);
    if (!estate) throw new Error(`LifeContinuityEngine.setEstateStatus: unknown estate ${id}`);
    return this.replaceEstate({
      ...estate,
      status,
      ...(status === "settled" ? { settledAt: estate.settledAt } : {}),
      ...(note === undefined ? {} : { note }),
    });
  }

}

/**
 * Pronounces a death without a determination: identity records it on the
 * person, continuity advances the lifecycle. PersonId survives both writes
 * unchanged (System 53).
 *
 * This is the minimal path, kept for callers that hold no evidence to cite — a
 * bare declaration. The full pipeline (determination, records, household,
 * employment, history) is `processDeath` in `death.ts`.
 */
export function pronounceDeath(
  sim: {
    guard: { mutate<T>(owner: string, fn: () => T): T };
    scope: SystemScope;
    world: WorldState;
  },
  personId: EntityId<"person">,
  declaredAt: WorldTime,
  cause?: string,
): void {
  sim.guard.mutate("identity", () => {
    new IdentityEngine(sim.scope, sim.world).recordDeath(personId, declaredAt, cause);
  });
  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).registerDeath(personId, declaredAt, cause);
  });
}

