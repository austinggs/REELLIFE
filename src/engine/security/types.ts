/**
 * Security & legal pipeline (System 48).
 *
 * "Security and justice are processes of detection, authority, evidence,
 * adjudication, and consequence" (System 48 core principle). Every type here
 * exists to keep one of those five things from quietly collapsing into another:
 *
 *   1. **An incident is not a case.** Something happened; whether anyone
 *      noticed is a separate record, and *detection is allowed to fail* — most
 *      crimes go unrecorded precisely because nobody was there. The pipeline
 *      therefore starts at an incident that may never become anything.
 *   2. **A charge is not a conviction.** `Charge` quotes the sanctions System 41
 *      *declared*; `Penalty` is what this system actually applies, and the two
 *      are different records with different ids so that "the law said a fine was
 *      possible" can never be read as "a fine was levied".
 *   3. **Evidence cuts both ways.** Every item is stance-tagged and weight-tagged,
 *      can be inadmissible (obtained without authority) or degraded
 *      (tampered), and a charge with no admissible evidence is *dismissed*
 *      rather than quietly convicted. A false accusation has to be reachable as
 *      an outcome, not merely unlikely.
 *   4. **Jurisdiction is checked, not assumed.** A charge names the rule and the
 *      jurisdiction it was brought in; a mismatch is refused at the door, which
 *      is what makes cross-border incidents a real problem rather than a
 *      formality.
 *   5. **Appeals are part of the record.** A judgment can be appealed and
 *      overturned, and an overturned penalty is *vacated* — not deleted, because
 *      the fact that it was levied and then undone is itself the history.
 *
 * This system owns the pipeline and its history. It does **not** own law
 * definitions (41), organization structure (32), reputation (22), criminal
 * intent (16/17) or medical care (11); where it needs one of those it records a
 * reference to it.
 */

import type { RuleSanction } from "../laws/types.ts";
import type { WorldTime } from "../primitives/time.ts";

/** The classes of occurrence the pipeline handles. */
export const INCIDENT_KINDS = [
  // crime
  "theft",
  "fraud",
  "assault",
  "vandalism",
  "trespass",
  "smuggling",
  "organized_crime",
  "market_irregularity",
  // emergency
  "fire",
  "accident",
  "medical",
  "disaster",
  "security",
] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const CRIME_KINDS = [
  "theft",
  "fraud",
  "assault",
  "vandalism",
  "trespass",
  "smuggling",
  "organized_crime",
  "market_irregularity",
] as const satisfies readonly IncidentKind[];
export type CrimeKind = (typeof CRIME_KINDS)[number];

export const EMERGENCY_KINDS = [
  "fire",
  "accident",
  "medical",
  "disaster",
  "security",
] as const satisfies readonly IncidentKind[];
export type EmergencyKind = (typeof EMERGENCY_KINDS)[number];

/** How the pipeline is being asked to treat an incident. */
export const INCIDENT_CLASSES = ["crime", "emergency"] as const;
export type IncidentClass = (typeof INCIDENT_CLASSES)[number];

export function classOf(kind: IncidentKind): IncidentClass {
  return (CRIME_KINDS as readonly IncidentKind[]).includes(kind) ? "crime" : "emergency";
}

export interface Incident {
  readonly id: string;
  readonly at: WorldTime;
  readonly locationId: string;
  readonly kind: IncidentKind;
  readonly summary: string;
  /** System 32 organization this happened at or against, when there is one. */
  readonly organizationId?: string;
  /** The System 35 market, for a grey/black-market incident. */
  readonly marketId?: string;
  readonly severity: number;
}

/**
 * What was there to notice the incident.
 *
 * `witnesses`, `physicalEvidence`, `institutionalCapacity` and
 * `jurisdictionReach` help detection; `concealment` and `misinformation` work
 * against it. All 0..1 and all supplied by the caller, because every one of them
 * belongs to another system or to the world at large — the engine will not
 * assume there were witnesses just because it is convenient.
 */
export interface DetectionConditions {
  readonly witnesses: number;
  readonly physicalEvidence: number;
  readonly institutionalCapacity: number;
  readonly jurisdictionReach: number;
  readonly concealment: number;
  readonly misinformation: number;
}

/** Signed weights: positive factors enable detection, negative ones suppress. */
export const DETECTION_WEIGHTS = {
  witnesses: 0.25,
  physicalEvidence: 0.25,
  institutionalCapacity: 0.15,
  jurisdictionReach: 0.15,
  concealment: -0.15,
  misinformation: -0.05,
} as const;

export interface DetectionAssessment {
  readonly probability: number;
  /** The factors, in the order applied, so the number can be explained. */
  readonly factors: readonly string[];
}

/** Whether anyone noticed, and on what basis. */
export interface DetectionRecord {
  readonly id: string;
  readonly incidentId: string;
  readonly at: WorldTime;
  readonly detected: boolean;
  readonly probability: number;
  readonly roll: number;
  readonly detectedById?: string;
  readonly note?: string;
}

export const CASE_STAGES = [
  "reported",
  "investigating",
  "charged",
  "adjudicated",
  "appealed",
  "closed",
] as const;
export type CaseStage = (typeof CASE_STAGES)[number];

/** A reported incident, under some authority's hand. */
export interface Case {
  readonly id: string;
  readonly incidentId: string;
  readonly openedAt: WorldTime;
  readonly jurisdictionId: string;
  readonly reporterId?: string;
  readonly investigatorId?: string;
  readonly suspectIds: readonly string[];
  readonly stage: CaseStage;
  readonly note?: string;
}

export const EVIDENCE_KINDS = [
  "physical",
  "testimony",
  "document",
  "circumstantial",
  "expert",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** Evidence cuts both ways; this is why the stance is on the record. */
export const EVIDENCE_STANCES = [
  "supports_accusation",
  "supports_defense",
  "neutral",
] as const;
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];

/** Evidence below this integrity is reported as suspect however heavy it is. */
export const DEGRADED_INTEGRITY = 0.5;

export interface EvidenceItem {
  readonly id: string;
  readonly caseId: string;
  readonly at: WorldTime;
  readonly kind: EvidenceKind;
  readonly stance: EvidenceStance;
  /** How much it says, 0..1. */
  readonly weight: number;
  readonly collectedBy: string;
  /** False when obtained without authority, or by a party that should not have. */
  readonly admissible: boolean;
  /** 0..1. Tampering or poor handling lowers it without erasing the item. */
  readonly integrity: number;
  readonly description: string;
}

export interface Charge {
  readonly id: string;
  readonly caseId: string;
  readonly at: WorldTime;
  readonly suspectId: string;
  /** The System 41 rule this charge rests on. */
  readonly ruleId: string;
  /** The action that rule speaks to, quoted for the record. */
  readonly action: string;
  readonly jurisdictionId: string;
  /**
   * Sanctions System 41 *declared* for a breach of that rule, quoted verbatim.
   * This is what a conviction could carry — not a penalty, and never one.
   */
  readonly declaredSanctions: readonly RuleSanction[];
  readonly note?: string;
}

export const HEARING_OUTCOMES = ["convicted", "acquitted", "dismissed"] as const;
export type HearingOutcome = (typeof HEARING_OUTCOMES)[number];

export interface Hearing {
  readonly id: string;
  readonly caseId: string;
  readonly at: WorldTime;
  readonly chairId: string;
  readonly chargeIds: readonly string[];
  readonly outcome: HearingOutcome;
  readonly rationale: string;
  /** The evidence balance that decided it, quoted from the reading. */
  readonly factors: readonly string[];
}

export const PENALTY_STATUSES = ["declared", "applied", "vacated"] as const;
export type PenaltyStatus = (typeof PENALTY_STATUSES)[number];

/** A sanction this system actually applied, as distinct from one merely declared. */
export interface Penalty {
  readonly id: string;
  readonly chargeId: string;
  readonly caseId: string;
  readonly at: WorldTime;
  readonly suspectId: string;
  readonly sanction: RuleSanction;
  readonly status: PenaltyStatus;
  /** The System 25 ledger entry, once money has actually moved. */
  readonly ledgerEntryId?: string;
  /** Why it was vacated, when an appeal succeeded. */
  readonly vacatedReason?: string;
}

export const APPEAL_RESULTS = ["upheld", "overturned", "modified"] as const;
export type AppealResult = (typeof APPEAL_RESULTS)[number];

export interface Appeal {
  readonly id: string;
  readonly caseId: string;
  readonly at: WorldTime;
  readonly grounds: string;
  readonly result?: AppealResult;
  readonly resolvedAt?: WorldTime;
  readonly note?: string;
}

/** What the evidence on a case currently says, in both directions. */
export interface CaseReading {
  readonly caseId: string;
  readonly evidenceCount: number;
  /** Inadmissible or neutral items count for nothing. */
  readonly forAccusation: number;
  readonly forDefence: number;
  /** Signed balance; below zero means the defence case is the stronger one. */
  readonly net: number;
  /** Admissible evidence that has been tampered with or badly handled. */
  readonly degradedCount: number;
  readonly factors: readonly string[];
}

export const OPERATION_KINDS = [
  "smuggling",
  "extortion",
  "fraud_ring",
  "protection_racket",
  "black_market",
] as const;
export type OperationKind = (typeof OPERATION_KINDS)[number];

export const OPERATION_STATUSES = ["active", "disrupted", "shut_down"] as const;
export type OperationStatus = (typeof OPERATION_STATUSES)[number];

/**
 * A criminal organization's *operational* state. The organization, its members
 * and its lifecycle belong to System 32; this is only what it is currently
 * doing, and it is a reference rather than a second structure.
 */
export interface CriminalOperation {
  readonly id: string;
  readonly organizationId: string;
  readonly kind: OperationKind;
  readonly at: WorldTime;
  readonly status: OperationStatus;
  readonly incidentIds: readonly string[];
  readonly note?: string;
}

export interface SecurityHistoryEntry {
  readonly id: string;
  readonly at: WorldTime;
  readonly kind: string;
  readonly summary: string;
  readonly incidentId?: string;
  readonly caseId?: string;
}

export interface SecuritySystemState {
  readonly incidents: readonly Incident[];
  readonly detections: readonly DetectionRecord[];
  readonly cases: readonly Case[];
  readonly evidence: readonly EvidenceItem[];
  readonly charges: readonly Charge[];
  readonly hearings: readonly Hearing[];
  readonly penalties: readonly Penalty[];
  readonly appeals: readonly Appeal[];
  readonly operations: readonly CriminalOperation[];
  readonly history: readonly SecurityHistoryEntry[];
}

export function emptySecurityState(): SecuritySystemState {
  return {
    incidents: [],
    detections: [],
    cases: [],
    evidence: [],
    charges: [],
    hearings: [],
    penalties: [],
    appeals: [],
    operations: [],
    history: [],
  };
}
