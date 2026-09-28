/**
 * The death pipeline (System 53).
 *
 *   cause -> determination -> person state -> records -> relationships ->
 *   household -> employment -> finance -> estate -> information -> descendants
 *
 * The pipeline is an *orchestrator*, not an engine: it performs one write per
 * owner, each inside that owner's scope, exactly as `materializeSettlement`
 * does. Systems never reach into each other's state, and the estate and the
 * control handoff stay separate calls because probate and succession are
 * decisions the world takes deliberately rather than side effects of dying.
 *
 * Every write below names the system that owns it:
 *
 *   08 identity       the person's own death field
 *   11 health         the body's vital state (only when health knows them)
 *   53 continuity     lifecycle, determination, record
 *   40 legalIdentity  the civil registration
 *   19 family         household membership exit
 *   24 employment     orphaned responsibilities end (they are not inherited)
 *   54 history        the timeline entry
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { IdentityEngine } from "../identity/engine.ts";
import { HealthEngine } from "../health/engine.ts";
import type { HealthState } from "../health/types.ts";
import { LegalIdentityEngine } from "../legalIdentity/engine.ts";
import { EmploymentEngine } from "../employment/engine.ts";
import { FamilyEngine } from "../family/engine.ts";
import { LifeContinuityEngine } from "./engine.ts";
import {
  type ContinuityDeathRecord,
  type DeathCause,
  type DeathCertainty,
  type DeathDetermination,
  type DeathDeterminer,
  type FactRef,
} from "./types.ts";

/** Registry slug used when no jurisdiction is named (System 40 authority slug). */
export const DEFAULT_REGISTRAR = "AURELIA_CIVIL_REGISTRY";

export interface DeathRequest {
  readonly personId: EntityId<"person">;
  readonly cause: DeathCause;
  /** When the death is judged to have happened; defaults to `at`. */
  readonly occurredAt?: WorldTime;
  /** What killed them, from the system that recorded the condition. */
  readonly mechanism?: string;
  /** Short cause text stored on the death entry, e.g. "old age". */
  readonly causeNote?: string;
  readonly certainty?: DeathCertainty;
  readonly determinedBy?: DeathDeterminer;
  /** The facts the determination rests on, by reference. */
  readonly evidence?: readonly FactRef[];
  /** Authority slug for the System 40 record. */
  readonly registrar?: string;
  readonly certificateIdentifier?: string;
  /** Ends active employments. Defaults to true: a job does not outlive its holder. */
  readonly endEmployments?: boolean;
  readonly at: WorldTime;
}

export interface DeathOutcome {
  readonly personId: EntityId<"person">;
  readonly determination: DeathDetermination;
  readonly record: ContinuityDeathRecord;
  readonly civilRecordId?: string;
  /** Households the deceased was a current member of, when the stint ended. */
  readonly endedHouseholds: readonly string[];
  /** Employments ended because their holder died. */
  readonly endedEmployments: readonly string[];
  readonly timelineEntryId?: string;
}

function personLabel(sim: Simulation, personId: EntityId<"person">): string {
  const person = new IdentityEngine(sim.scope, sim.world).get(personId);
  if (!person) return String(personId);
  return `${person.name.first} ${person.name.last}`.trim();
}

/**
 * Reads a cause off System 11's conditions without diagnosing anything: the
 * most severe unresolved condition is mapped to a cause category, and the
 * condition itself is cited as the evidence. Severity is read, never invented.
 */
export function causeFromHealth(
  health: HealthState,
): { readonly cause: DeathCause; readonly mechanism?: string; readonly evidence: readonly FactRef[] } | undefined {
  const outstanding = health.conditions.filter((condition) => condition.status !== "resolved");
  if (outstanding.length === 0) return undefined;
  const rank = { mild: 0, moderate: 1, severe: 2, critical: 3 } as const;
  const worst = [...outstanding].sort((a, b) => {
    const terminal = (value: boolean): number => (value ? 4 : 0);
    return (
      rank[b.severity] + terminal(b.status === "terminal") -
      (rank[a.severity] + terminal(a.status === "terminal"))
    );
  })[0];
  if (!worst) return undefined;
  return {
    cause: worst.type === "injury" ? "injury" : "disease",
    mechanism: worst.name,
    evidence: [
      {
        system: "health",
        recordId: worst.id,
        field: "severity",
        note: `${worst.name} (${worst.severity}${worst.status === "terminal" ? ", terminal" : ""})`,
      },
    ],
  };
}

/** Cites the development record that made an age-based determination possible. */
export function laterLifeEvidence(
  personId: EntityId<"person">,
  lifeStage: string,
): FactRef {
  return {
    system: "aging",
    recordId: String(personId),
    field: "currentLifeStage",
    note: `life stage at the time of death: ${lifeStage}`,
  };
}

/**
 * Runs the death pipeline for one person. Returns what each owner wrote.
 *
 * Refuses a second death for the same person (continuity's lifecycle is the
 * gate) and leaves the world consistent when it does: everything is validated
 * before the first write.
 */
export function processDeath(sim: Simulation, request: DeathRequest): DeathOutcome {
  const { personId, cause, at } = request;
  const occurredAt = request.occurredAt ?? at;
  const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);

  if (continuity.statusOf(personId) !== "active") {
    throw new Error(`processDeath: ${personId} is already ${continuity.statusOf(personId)}`);
  }
  if (!new IdentityEngine(sim.scope, sim.world).get(personId)) {
    throw new Error(`processDeath: unknown person ${personId}`);
  }

  // A determination with nothing to cite is possible, but it is a *presumption*
  // and says so — never dressed up as a witnessed or medical finding.
  const cited = [...(request.evidence ?? [])];
  const presumed = cited.length === 0;
  const evidence: readonly FactRef[] = presumed
    ? [
        {
          system: "continuity",
          recordId: String(personId),
          field: "deaths",
          note: `declared without cited evidence; recorded as ${request.determinedBy ?? "registration"}`,
        },
      ]
    : cited;

  const causeNote = request.causeNote ?? cause;
  const label = personLabel(sim, personId);

  // 1. Identity owns the person's own record of their death.
  sim.guard.mutate("identity", () => {
    new IdentityEngine(sim.scope, sim.world).recordDeath(personId, occurredAt, causeNote);
  });

  // 2. Health owns the body's vital state. A person health never registered is
  //    not registered here either — inventing a medical record at death would
  //    be a diagnosis System 53 does not own.
  sim.guard.mutate("health", () => {
    const health = new HealthEngine(sim.scope, sim.world);
    if (!health.getPerson(personId)) return;
    health.setVitalState(
      personId,
      "deceased",
      `death determined: ${request.mechanism ?? causeNote}`,
      occurredAt,
    );
  });

  // 3. Continuity owns the lifecycle, the determination and the record.
  let determination!: DeathDetermination;
  let record!: ContinuityDeathRecord;
  sim.guard.mutate("continuity", () => {
    const engine = new LifeContinuityEngine(sim.scope, sim.world);
    determination = engine.determineDeath(sim.ids.next("record"), {
      personId,
      occurredAt,
      determinedAt: at,
      cause,
      ...(request.mechanism === undefined ? {} : { mechanism: request.mechanism }),
      certainty: request.certainty ?? (presumed ? "presumed" : "certain"),
      determinedBy: request.determinedBy ?? "registration",
      evidence,
    });
    engine.registerDeath(personId, at, causeNote, determination.id);
    record = engine.recordDeathRecord(sim.ids.next("record"), {
      personId,
      determinationId: determination.id,
      recordedAt: at,
      cause,
    });
  });


  // 4. Legal identity owns the administrative record of the death.
  let civilRecordId: string | undefined;
  sim.guard.mutate("legalIdentity", () => {
    civilRecordId = new LegalIdentityEngine(sim.scope, sim.world).issue(
      sim.ids,
      {
        type: "deathRegistration",
        subject: personId,
        authority: request.registrar ?? DEFAULT_REGISTRAR,
        ...(request.certificateIdentifier === undefined
          ? {}
          : { identifier: request.certificateIdentifier }),
        access: "public",
      },
      at,
    ).id;
  });
  if (civilRecordId !== undefined) {
    const civilId = civilRecordId;
    sim.guard.mutate("continuity", () => {
      new LifeContinuityEngine(sim.scope, sim.world).linkCivilRecord(record.id, civilId);
    });
  }

  // 5. Family owns household membership: the stint ends, the record stays.
  const endedHouseholds: string[] = [];
  sim.guard.mutate("family", () => {
    const family = new FamilyEngine(sim.scope, sim.world);
    for (const household of family.householdsOf(personId)) {
      if (family.removeHouseholdMember(household.id, personId, at, "death")) {
        endedHouseholds.push(household.id);
      }
    }
  });

  // 6. Employment owns the job: an orphaned responsibility ends, it is not
  //    inherited (the estate hands on *assets*, not obligations of work).
  const endedEmployments: string[] = [];
  if (request.endEmployments !== false) {
    sim.guard.mutate("employment", () => {
      const employment = new EmploymentEngine(sim.scope, sim.world);
      for (const active of employment.activeEmployments(personId)) {
        if (employment.terminate(active.id, "terminated", at)) endedEmployments.push(active.id);
      }
    });
  }

  // 7. History owns the timeline entry this becomes.
  let timelineEntryId: string | undefined;
  sim.guard.mutate("history", () => {
    timelineEntryId = sim.history.record({
      at,
      kind: "death",
      summary: `${label} died (${causeNote})`,
      detail: `determination ${determination.id} (${determination.certainty}, ${determination.determinedBy})`,
      personId,
      eventType: "life.death",
      causeKind: "system",
      importance: 5,
      visibility: "public",
      tags: ["continuity", "death"],
    }).id;
  });

  return {
    personId,
    determination,
    record,
    ...(civilRecordId === undefined ? {} : { civilRecordId }),
    endedHouseholds,
    endedEmployments,
    ...(timelineEntryId === undefined ? {} : { timelineEntryId }),
  };
}

/**
 * Archives a deceased life once nothing is outstanding: every estate of theirs
 * has settled. A deceased person with an open estate stays `deceased`, because
 * an unsettled estate is active matter.
 */
export function archiveLife(sim: Simulation, personId: EntityId<"person">): boolean {
  const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);
  if (continuity.statusOf(personId) !== "deceased") return false;
  const outstanding = continuity
    .estatesOf(personId)
    .some((estate) => estate.status === "open" || estate.status === "settling");
  if (outstanding) return false;
  sim.guard.mutate("continuity", () => {
    new LifeContinuityEngine(sim.scope, sim.world).markHistorical(personId);
  });
  return true;
}

