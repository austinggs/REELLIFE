/**
 * Security & legal pipeline engine (System 48).
 *
 * Owns `systems.security`: the incident -> detection -> report -> case ->
 * investigation -> charge -> hearing -> penalty -> appeal pipeline, plus
 * criminal operations and the security history. Every write asserts ownership on
 * that slot; reads are scope-free.
 *
 * The engine takes `LawsEngine` as a dependency rather than re-implementing law,
 * because a charge has to quote a real rule and check its jurisdiction. It never
 * copies a rule: it holds the rule id and the declared sanctions, so when System
 * 41 amends something the charge still points at what was in force.
 *
 * As with System 44, the stochastic step is `recordDetection`, and it refuses to
 * run without an injected `RandomSource` rather than reaching for ambient
 * randomness. Adjudication, by contrast, is deliberately deterministic: given the
 * evidence on a case it returns the same outcome every time, and returns the
 * factors that produced it.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { LawsEngine } from "../laws/engine.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { RandomSource } from "../rng/distributions.ts";
import {
  DETECTION_WEIGHTS,
  DEGRADED_INTEGRITY,
  classOf,
  emptySecurityState,
  type Appeal,
  type AppealResult,
  type Case,
  type CaseReading,
  type CaseStage,
  type Charge,
  type CriminalOperation,
  type DetectionAssessment,
  type DetectionConditions,
  type DetectionRecord,
  type EvidenceItem,
  type EvidenceKind,
  type EvidenceStance,
  type Hearing,
  type HearingOutcome,
  type Incident,
  type IncidentKind,
  type OperationKind,
  type OperationStatus,
  type Penalty,
  type SecurityHistoryEntry,
  type SecuritySystemState,
} from "./types.ts";

/** Below this much usable evidence for the prosecution, a charge does not stand. */
export const MIN_USABLE_EVIDENCE = 0.4;

/** Degraded evidence counts, but not at face value. Disclosed, not hidden. */
export const DEGRADED_EVIDENCE_FACTOR = 0.5;

export interface RecordIncidentRequest {
  readonly id: string;
  readonly locationId: string;
  readonly kind: IncidentKind;
  readonly summary: string;
  readonly severity: number;
  readonly organizationId?: string;
  /** For a grey/black-market incident; the market itself is System 35's. */
  readonly marketId?: string;
}

export interface OpenCaseRequest {
  readonly incidentId: string;
  readonly jurisdictionId: string;
  readonly suspectIds: readonly string[];
  readonly reporterId?: string;
  readonly note?: string;
}

export interface CollectEvidenceRequest {
  readonly caseId: string;
  readonly kind: EvidenceKind;
  readonly stance: EvidenceStance;
  readonly weight: number;
  readonly collectedBy: string;
  readonly admissible: boolean;
  readonly integrity: number;
  readonly description: string;
}

export interface FileChargeRequest {
  readonly caseId: string;
  readonly suspectId: string;
  readonly ruleId: string;
  readonly note?: string;
}

export interface StartOperationRequest {
  readonly organizationId: string;
  readonly kind: OperationKind;
  readonly incidentIds: readonly string[];
  readonly note?: string;
}

export interface AdjudicationPreview {
  readonly caseId: string;
  readonly chargeIds: readonly string[];
  readonly outcome: HearingOutcome;
  readonly rationale: string;
  readonly factors: readonly string[];
  readonly reading: CaseReading;
}

export class SecurityEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;
  private readonly laws: LawsEngine;
  private readonly random?: RandomSource;

  constructor(scope: SystemScope, world: WorldState, laws: LawsEngine, random?: RandomSource) {
    this.scope = scope;
    this.world = world;
    this.laws = laws;
    this.random = random;
    if (!this.world.systems.security) {
      this.scope.assertOwner("security");
      this.world.systems.security = emptySecurityState();
    }
  }

  private get state(): SecuritySystemState {
    return this.world.systems.security as SecuritySystemState;
  }

  private set state(value: SecuritySystemState) {
    this.world.systems.security = value;
  }

  // ---------------------------------------------------------------- reads ---

  incidents(): readonly Incident[] {
    return this.state.incidents;
  }

  incident(id: string): Incident | undefined {
    return this.state.incidents.find((entry) => entry.id === id);
  }

  requireIncident(id: string, caller: string): Incident {
    const found = this.incident(id);
    if (found === undefined) {
      throw new Error(`SecurityEngine.${caller}: unknown incident ${id}`);
    }
    return found;
  }

  detections(): readonly DetectionRecord[] {
    return this.state.detections;
  }

  detectionOf(incidentId: string): DetectionRecord | undefined {
    return this.state.detections.find((entry) => entry.incidentId === incidentId);
  }

  /** True once anyone has noticed. An incident nobody noticed has no detection. */
  isDetected(incidentId: string): boolean {
    return this.detectionOf(incidentId)?.detected === true;
  }

  cases(): readonly Case[] {
    return this.state.cases;
  }

  case(id: string): Case | undefined {
    return this.state.cases.find((entry) => entry.id === id);
  }

  requireCase(id: string, caller: string): Case {
    const found = this.case(id);
    if (found === undefined) {
      throw new Error(`SecurityEngine.${caller}: unknown case ${id}`);
    }
    return found;
  }

  casesForIncident(incidentId: string): readonly Case[] {
    return this.state.cases.filter((entry) => entry.incidentId === incidentId);
  }

  evidenceOf(caseId: string): readonly EvidenceItem[] {
    return this.state.evidence.filter((entry) => entry.caseId === caseId);
  }

  charges(): readonly Charge[] {
    return this.state.charges;
  }

  chargesOf(caseId: string): readonly Charge[] {
    return this.state.charges.filter((entry) => entry.caseId === caseId);
  }

  charge(id: string): Charge | undefined {
    return this.state.charges.find((entry) => entry.id === id);
  }

  hearings(): readonly Hearing[] {
    return this.state.hearings;
  }

  hearingFor(caseId: string): Hearing | undefined {
    return this.state.hearings.find((entry) => entry.caseId === caseId);
  }

  penalties(): readonly Penalty[] {
    return this.state.penalties;
  }

  penaltiesOf(caseId: string): readonly Penalty[] {
    return this.state.penalties.filter((entry) => entry.caseId === caseId);
  }

  appeals(): readonly Appeal[] {
    return this.state.appeals;
  }

  appealsFor(caseId: string): readonly Appeal[] {
    return this.state.appeals.filter((entry) => entry.caseId === caseId);
  }

  operations(): readonly CriminalOperation[] {
    return this.state.operations;
  }

  operationsOf(organizationId: string): readonly CriminalOperation[] {
    return this.state.operations.filter((entry) => entry.organizationId === organizationId);
  }

  history(): readonly SecurityHistoryEntry[] {
    return this.state.history;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * How likely anyone is to notice an incident, and why.
   *
   * Witnesses, physical evidence, institutional capacity and jurisdiction reach
   * add; concealment and misinformation subtract. All six come from the caller
   * because each belongs to another system or to the world: the engine will not
   * assume there were witnesses just because that makes for a livelier world.
   * The total is capped at 1 — a crime in a watched market with two witnesses is
   * still only ever *probably* noticed.
   */
  assessDetection(
    conditions: DetectionConditions,
    caller = "assessDetection",
  ): DetectionAssessment {
    const parts: readonly (readonly [string, number])[] = [
      ["witnesses", DETECTION_WEIGHTS.witnesses],
      ["physicalEvidence", DETECTION_WEIGHTS.physicalEvidence],
      ["institutionalCapacity", DETECTION_WEIGHTS.institutionalCapacity],
      ["jurisdictionReach", DETECTION_WEIGHTS.jurisdictionReach],
      ["concealment", DETECTION_WEIGHTS.concealment],
      ["misinformation", DETECTION_WEIGHTS.misinformation],
    ];
    let total = 0;
    const factors: string[] = [];
    for (const [name, weight] of parts) {
      const value = requireRatio(conditions[name as keyof DetectionConditions], name, caller);
      total += weight * value;
      factors.push(`${name}=${value.toFixed(2)}`);
    }
    return { probability: round4(clamp01(total)), factors };
  }

  /**
   * What the evidence on a case currently says, in both directions.
   *
   * Admissible, non-neutral evidence contributes its weight, halved when its
   * integrity is below `DEGRADED_INTEGRITY` — the halving is disclosed here and
   * in `factors`, not applied silently. Inadmissible evidence counts for nothing
   * at all, and the excluded counts are reported, so a case that fails for want
   * of admissible proof says that is what happened.
   */
  caseReading(caseId: string): CaseReading {
    this.requireCase(caseId, "caseReading");
    const items = this.evidenceOf(caseId);
    let forAccusation = 0;
    let forDefence = 0;
    let degradedCount = 0;
    let inadmissibleCount = 0;
    let neutralCount = 0;
    for (const item of items) {
      if (!item.admissible) {
        inadmissibleCount += 1;
        continue;
      }
      if (item.stance === "neutral") {
        neutralCount += 1;
        continue;
      }
      const degraded = item.integrity < DEGRADED_INTEGRITY;
      if (degraded) degradedCount += 1;
      const usable = item.weight * (degraded ? DEGRADED_EVIDENCE_FACTOR : 1);
      if (item.stance === "supports_accusation") forAccusation += usable;
      else forDefence += usable;
    }
    return {
      caseId,
      evidenceCount: items.length,
      forAccusation: round4(forAccusation),
      forDefence: round4(forDefence),
      net: round4(forAccusation - forDefence),
      degradedCount,
      factors: [
        `forAccusation=${round4(forAccusation).toFixed(2)}`,
        `forDefence=${round4(forDefence).toFixed(2)}`,
        ...(degradedCount > 0 ? [`degraded=${degradedCount}`] : []),
        ...(inadmissibleCount > 0 ? [`inadmissible=${inadmissibleCount}`] : []),
        ...(neutralCount > 0 ? [`neutral=${neutralCount}`] : []),
      ],
    };
  }

  /**
   * What a hearing would decide on the evidence as it stands, without deciding
   * it. Deterministic, so the same case always reads the same way.
   *
   * The three outcomes are kept distinct because they mean different things:
   *
   *   - `dismissed`  — there is nothing to hear: no charge, no evidence, or none
   *                    that is admissible and usable. The charge falls without
   *                    anyone being pronounced innocent.
   *   - `acquitted`  — there was a hearing and the defence case is the stronger
   *                    one. This is the outcome a false accusation reaches, so it
   *                    has to be reachable and not merely improbable.
   *   - `convicted`  — enough usable evidence for the prosecution.
   */
  adjudicationPreview(caseId: string, chargeIds: readonly string[]): AdjudicationPreview {
    const reading = this.caseReading(caseId);
    const charges: Charge[] = [];
    for (const chargeId of chargeIds) {
      const charge = this.charge(chargeId);
      if (charge === undefined) {
        throw new Error(`SecurityEngine.adjudicationPreview: unknown charge ${chargeId}`);
      }
      if (charge.caseId !== caseId) {
        throw new Error(
          `SecurityEngine.adjudicationPreview: charge ${chargeId} belongs to case ` +
            `${charge.caseId}, not ${caseId}`,
        );
      }
      charges.push(charge);
    }
    const usable = round4(reading.forAccusation - reading.forDefence);
    const usableFactor = `usable=${usable.toFixed(2)}`;

    if (charges.length === 0) {
      return {
        caseId,
        chargeIds,
        outcome: "dismissed",
        rationale: "no charge was brought on this case",
        factors: reading.factors,
        reading,
      };
    }
    if (reading.evidenceCount === 0) {
      return {
        caseId,
        chargeIds,
        outcome: "dismissed",
        rationale: "nothing was put in evidence, so there is nothing to decide",
        factors: reading.factors,
        reading,
      };
    }
    if (usable < 0) {
      return {
        caseId,
        chargeIds,
        outcome: "acquitted",
        rationale: "the evidence on record favours the defence",
        factors: [...reading.factors, usableFactor],
        reading,
      };
    }
    if (reading.forAccusation < MIN_USABLE_EVIDENCE) {
      return {
        caseId,
        chargeIds,
        outcome: "dismissed",
        rationale:
          `usable evidence for the charge (${reading.forAccusation.toFixed(2)}) is below ` +
          `the ${MIN_USABLE_EVIDENCE} needed to hear it`,
        factors: reading.factors,
        reading,
      };
    }
    return {
      caseId,
      chargeIds,
      outcome: "convicted",
      rationale:
        `usable evidence for the charge (${reading.forAccusation.toFixed(2)}) meets ` +
        `the ${MIN_USABLE_EVIDENCE} threshold`,
      factors: [...reading.factors, usableFactor],
      reading,
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Records that something happened.
   *
   * This is deliberately the earliest and weakest record in the system: it
   * asserts only that an occurrence took place, and nothing about whether it was
   * noticed, reported, lawful, or anyone's fault. Whether an act is even unlawful
   * is a question for `fileCharge`, against a rule, in a jurisdiction.
   */
  recordIncident(request: RecordIncidentRequest, at: WorldTime, ids: IdAllocator): Incident {
    const existing = this.incident(request.id);
    if (existing !== undefined) return existing;
    this.scope.assertOwner("security");
    const incident: Incident = {
      id: request.id,
      at,
      locationId: request.locationId,
      kind: request.kind,
      summary: request.summary,
      severity: round4(requireRatio(request.severity, "severity", "recordIncident")),
      ...(request.organizationId === undefined ? {} : { organizationId: request.organizationId }),
      ...(request.marketId === undefined ? {} : { marketId: request.marketId }),
    };
    this.state = { ...this.state, incidents: [...this.state.incidents, incident] };
    this.appendHistory("incident", `${classOf(incident.kind)}: ${incident.summary}`, at, ids, {
      incidentId: incident.id,
    });
    return incident;
  }

  /**
   * Records whether anyone noticed an incident.
   *
   * The roll is the only stochastic step in the system, and it refuses to run
   * without an injected source rather than inventing a probability source. An
   * undetected incident is *not* an error: it is the ordinary case for most
   * crimes, and the engine records that it went unnoticed rather than leaving the
   * world looking as though nothing had happened.
   */
  recordDetection(
    incidentId: string,
    conditions: DetectionConditions,
    at: WorldTime,
    ids: IdAllocator,
    detectedById?: string,
  ): DetectionRecord {
    if (this.random === undefined) {
      throw new Error(
        "SecurityEngine.recordDetection: no RandomSource was injected. Pass the " +
          "world's RNG stream, or use assessDetection() to ask what would happen.",
      );
    }
    this.requireIncident(incidentId, "recordDetection");
    const { probability } = this.assessDetection(conditions, "recordDetection");
    const roll = this.random.nextFloat();
    const detected = roll < probability;
    const record: DetectionRecord = {
      id: `det-${ids.next("activity")}`,
      incidentId,
      at,
      detected,
      probability,
      roll,
      ...(detectedById === undefined ? {} : { detectedById }),
      ...(detected ? {} : { note: "nothing was noticed; no case follows from this" }),
    };
    this.scope.assertOwner("security");
    this.state = { ...this.state, detections: [...this.state.detections, record] };
    this.appendHistory(
      detected ? "detected" : "undetected",
      detected ? `incident ${incidentId} was noticed` : `incident ${incidentId} went unnoticed`,
      at,
      ids,
      { incidentId },
    );
    return record;
  }

  /**
   * Opens a case on a detected incident.
   *
   * Refuses for an undetected incident: a case exists because someone brought
   * something to an authority, and an incident nobody noticed has not been
   * brought to anyone. That refusal is the difference between a legal system and
   * a magic one.
   */
  openCase(request: OpenCaseRequest, at: WorldTime, ids: IdAllocator): Case {
    const incident = this.requireIncident(request.incidentId, "openCase");
    if (!this.isDetected(request.incidentId)) {
      throw new Error(
        `SecurityEngine.openCase: incident ${request.incidentId} has not been detected; ` +
          "there is nothing to report",
      );
    }
    this.scope.assertOwner("security");
    const record: Case = {
      id: `case-${ids.next("activity")}`,
      incidentId: incident.id,
      openedAt: at,
      jurisdictionId: request.jurisdictionId,
      suspectIds: [...request.suspectIds],
      stage: "reported",
      ...(request.reporterId === undefined ? {} : { reporterId: request.reporterId }),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, cases: [...this.state.cases, record] };
    this.appendHistory("case_opened", `case opened on "${incident.summary}"`, at, ids, {
      incidentId: incident.id,
      caseId: record.id,
    });
    return record;
  }

  /** Puts an investigator on a case, and moves it into investigation. */
  assignInvestigator(caseId: string, investigatorId: string): Case {
    const current = this.requireCase(caseId, "assignInvestigator");
    if (current.stage !== "reported" && current.stage !== "investigating") {
      throw new Error(
        `SecurityEngine.assignInvestigator: case ${caseId} is at stage ` +
          `"${current.stage}" and is no longer being investigated`,
      );
    }
    this.scope.assertOwner("security");
    const next: Case = { ...current, investigatorId, stage: "investigating" };
    this.state = {
      ...this.state,
      cases: this.state.cases.map((entry) => (entry.id === caseId ? next : entry)),
    };
    return next;
  }

  /**
   * Adds an item of evidence to a case.
   *
   * Inadmissibility and integrity are recorded, not decided: whether something
   * was obtained with authority belongs to whoever grants authority, and this
   * engine's job is to carry the answer through to the reading rather than
   * quietly dropping the item on the way.
   */
  collectEvidence(request: CollectEvidenceRequest, at: WorldTime, ids: IdAllocator): EvidenceItem {
    const record = this.requireCase(request.caseId, "collectEvidence");
    if (record.stage !== "investigating" && record.stage !== "charged") {
      throw new Error(
        `SecurityEngine.collectEvidence: case ${request.caseId} is at stage ` +
          `"${record.stage}"; evidence belongs to an investigation`,
      );
    }
    this.scope.assertOwner("security");
    const item: EvidenceItem = {
      id: `ev-${ids.next("activity")}`,
      caseId: request.caseId,
      at,
      kind: request.kind,
      stance: request.stance,
      weight: requireRatio(request.weight, "weight", "collectEvidence"),
      collectedBy: request.collectedBy,
      admissible: request.admissible,
      integrity: requireRatio(request.integrity, "integrity", "collectEvidence"),
      description: request.description,
    };
    this.state = { ...this.state, evidence: [...this.state.evidence, item] };
    return item;
  }

  /**
   * Brings a charge against a suspect, on a real System 41 rule.
   *
   * Four things are checked here and each is a refusal a reader can learn from:
   * the suspect must be on the case, the rule must exist, it must be **in force
   * at the time of the charge**, and its jurisdiction must be the jurisdiction
   * the case is being heard in. That last check is what makes a cross-border
   * incident a real problem: the charge cannot simply be filed wherever it is
   * convenient.
   *
   * The declared sanctions are *copied from* the rule rather than re-declared
   * here, which is the whole point of the split: this system can apply them, and
   * System 41 is the only thing that defines them.
   */
  fileCharge(request: FileChargeRequest, at: WorldTime, ids: IdAllocator): Charge {
    const record = this.requireCase(request.caseId, "fileCharge");
    if (!record.suspectIds.includes(request.suspectId)) {
      throw new Error(
        `SecurityEngine.fileCharge: ${request.suspectId} is not a suspect on case ` +
          `${record.id}`,
      );
    }
    const rule = this.laws.requireRule(request.ruleId, "fileCharge");
    if (!this.laws.isInForce(request.ruleId, at)) {
      throw new Error(
        `SecurityEngine.fileCharge: rule ${request.ruleId} was not in force at the time ` +
          "of the charge",
      );
    }
    if (rule.jurisdictionId !== record.jurisdictionId) {
      throw new Error(
        `SecurityEngine.fileCharge: rule ${request.ruleId} governs ${rule.jurisdictionId} ` +
          `but case ${record.id} is being heard in ${record.jurisdictionId}`,
      );
    }
    this.scope.assertOwner("security");
    const charge: Charge = {
      id: `chg-${ids.next("activity")}`,
      caseId: record.id,
      at,
      suspectId: request.suspectId,
      ruleId: rule.id,
      action: rule.action,
      jurisdictionId: record.jurisdictionId,
      declaredSanctions: rule.sanctions.map((sanction) => ({ ...sanction })),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, charges: [...this.state.charges, charge] };
    this.setStage(record.id, "charged");
    this.appendHistory("charge_filed", `charge under ${rule.id} against ${request.suspectId}`, at, ids, {
      caseId: record.id,
      incidentId: record.incidentId,
    });
    return charge;
  }

  /**
   * Holds the hearing and records its outcome, applying the declared sanctions
   * only if the outcome is a conviction.
   *
   * The decision itself is `adjudicationPreview`'s, so a reader can ask what
   * would happen before it happens. A penalty is created *only* here and *only*
   * on a conviction — which is the difference between a rule saying a fine is
   * possible and a fine that was actually levied.
   */
  adjudicate(
    caseId: string,
    chargeIds: readonly string[],
    chairId: string,
    at: WorldTime,
    ids: IdAllocator,
  ): { hearing: Hearing; penalties: readonly Penalty[] } {
    const record = this.requireCase(caseId, "adjudicate");
    if (record.stage !== "charged" && record.stage !== "investigating") {
      throw new Error(
        `SecurityEngine.adjudicate: case ${caseId} is at stage "${record.stage}"; ` +
          "only a charged case can be adjudicated",
      );
    }
    const preview = this.adjudicationPreview(caseId, chargeIds);
    this.scope.assertOwner("security");
    const hearing: Hearing = {
      id: `hrg-${ids.next("activity")}`,
      caseId,
      at,
      chairId,
      chargeIds: [...chargeIds],
      outcome: preview.outcome,
      rationale: preview.rationale,
      factors: preview.factors,
    };
    this.state = { ...this.state, hearings: [...this.state.hearings, hearing] };

    const penalties: Penalty[] = [];
    if (preview.outcome === "convicted") {
      for (const chargeId of chargeIds) {
        const charge = this.charge(chargeId);
        if (charge === undefined) continue;
        for (const sanction of charge.declaredSanctions) {
          penalties.push({
            id: `pen-${ids.next("activity")}`,
            chargeId,
            caseId,
            at,
            suspectId: charge.suspectId,
            sanction,
            status: "applied",
          });
        }
      }
      this.state = { ...this.state, penalties: [...this.state.penalties, ...penalties] };
    }
    this.setStage(caseId, "adjudicated");
    this.appendHistory(
      "adjudicated",
      `${preview.outcome}: ${preview.rationale}`,
      at,
      ids,
      { caseId, incidentId: record.incidentId },
    );
    return { hearing, penalties };
  }

  /** Files an appeal against a case that has been adjudicated. */
  fileAppeal(caseId: string, grounds: string, at: WorldTime, ids: IdAllocator): Appeal {
    const record = this.requireCase(caseId, "fileAppeal");
    if (record.stage !== "adjudicated") {
      throw new Error(
        `SecurityEngine.fileAppeal: case ${caseId} is at stage "${record.stage}"; ` +
          "only an adjudicated case can be appealed",
      );
    }
    this.scope.assertOwner("security");
    const appeal: Appeal = { id: `apl-${ids.next("activity")}`, caseId, at, grounds };
    this.state = { ...this.state, appeals: [...this.state.appeals, appeal] };
    this.setStage(caseId, "appealed");
    this.appendHistory("appeal_filed", grounds, at, ids, { caseId });
    return appeal;
  }

  /**
   * Resolves an appeal.
   *
   * An overturned appeal *vacates* the penalties rather than deleting them: the
   * fact that a penalty was levied and then undone is part of what happened to
   * the person it was levied on, and a record that quietly forgets it would be
   * exactly the tidy history this project exists to avoid.
   */
  resolveAppeal(
    appealId: string,
    result: AppealResult,
    at: WorldTime,
    ids: IdAllocator,
    note?: string,
  ): Appeal {
    const appeal = this.state.appeals.find((entry) => entry.id === appealId);
    if (appeal === undefined) {
      throw new Error(`SecurityEngine.resolveAppeal: unknown appeal ${appealId}`);
    }
    if (appeal.result !== undefined) return appeal;
    this.scope.assertOwner("security");
    const resolved: Appeal = {
      ...appeal,
      result,
      resolvedAt: at,
      ...(note === undefined ? {} : { note }),
    };
    this.state = {
      ...this.state,
      appeals: this.state.appeals.map((entry) => (entry.id === appealId ? resolved : entry)),
    };
    if (result === "overturned") {
      const reason = `appeal ${appealId}: ${appeal.grounds}`;
      this.state = {
        ...this.state,
        penalties: this.state.penalties.map((penalty) =>
          penalty.caseId === appeal.caseId && penalty.status === "applied"
            ? { ...penalty, status: "vacated", vacatedReason: reason }
            : penalty,
        ),
      };
    }
    this.setStage(appeal.caseId, "closed");
    this.appendHistory("appeal_resolved", `appeal ${result}`, at, ids, { caseId: appeal.caseId });
    return resolved;
  }

  /**
   * Records what a criminal organization is currently doing.
   *
   * A reference, not a second organization: structure, membership and lifecycle
   * are System 32's, and a grey or black market is pointed at its System 35
   * market rather than growing a private price list.
   */
  startOperation(
    request: StartOperationRequest,
    at: WorldTime,
    ids: IdAllocator,
  ): CriminalOperation {
    for (const incidentId of request.incidentIds) {
      this.requireIncident(incidentId, "startOperation");
    }
    this.scope.assertOwner("security");
    const operation: CriminalOperation = {
      id: `op-${ids.next("activity")}`,
      organizationId: request.organizationId,
      kind: request.kind,
      at,
      status: "active",
      incidentIds: [...request.incidentIds],
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, operations: [...this.state.operations, operation] };
    this.appendHistory("operation_started", `${request.kind} operation begun`, at, ids);
    return operation;
  }

  setOperationStatus(operationId: string, status: OperationStatus, note?: string): CriminalOperation {
    const current = this.state.operations.find((entry) => entry.id === operationId);
    if (current === undefined) {
      throw new Error(`SecurityEngine.setOperationStatus: unknown operation ${operationId}`);
    }
    if (current.status === status) return current;
    this.scope.assertOwner("security");
    const next: CriminalOperation = {
      ...current,
      status,
      ...(note === undefined ? {} : { note }),
    };
    this.state = {
      ...this.state,
      operations: this.state.operations.map((entry) => (entry.id === operationId ? next : entry)),
    };
    return next;
  }

  private setStage(caseId: string, stage: CaseStage): void {
    this.state = {
      ...this.state,
      cases: this.state.cases.map((entry) => (entry.id === caseId ? { ...entry, stage } : entry)),
    };
  }

  private appendHistory(
    kind: string,
    summary: string,
    at: WorldTime,
    ids: IdAllocator,
    refs?: { incidentId?: string; caseId?: string },
  ): void {
    const entry: SecurityHistoryEntry = {
      id: `sh-${ids.next("activity")}`,
      at,
      kind,
      summary,
      ...(refs?.incidentId === undefined ? {} : { incidentId: refs.incidentId }),
      ...(refs?.caseId === undefined ? {} : { caseId: refs.caseId }),
    };
    this.state = { ...this.state, history: [...this.state.history, entry] };
  }

  serialize(): SecuritySystemState {
    return this.state;
  }
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`SecurityEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

