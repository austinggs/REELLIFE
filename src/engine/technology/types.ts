/**
 * Technology & historical change (System 51).
 *
 * "Technology expands action space; adoption is social, economic, institutional,
 * and geographic" (System 51 core principle). The second half of that sentence
 * is the one worth defending in code, because "a technology exists" is very
 * easily allowed to slide into "a technology is used", and the two are almost
 * never the same thing. Five separations do the work:
 *
 *   1. **Existence is not availability, and availability is not adoption.**
 *      Three separate records, each its own gate: a `Technology` exists; it is
 *      *available* to the world at a date only if it is in era and its
 *      prerequisites are met; and a *particular* subject adopts it only through
 *      a probability the caller supplies. A mill that has been invented is not a
 *      mill that has been built, and it is certainly not a mill somebody can
 *      afford.
 *   2. **Prerequisites are structural, and anachronism is refused by default.**
 *      A technology naming a prerequisite that is unavailable is anachronistic,
 *      not merely early — and only an explicit scenario permission lifts that.
 *   3. **Adoption is a fact about a subject.** `Adoption` names who took it up
 *      and when; the *rate* is derived from the record rather than stored, and a
 *      rate is only ever as meaningful as the population behind it, so the
 *      reading reports its own denominator.
 *   4. **Obsolescence is recorded, never silent.** A superseded technology
 *      keeps its history, because "this is how we did it then" is exactly the
 *      kind of context that disappears if the record is deleted on replacement.
 *   5. **This system invents nothing on its own.** It holds the catalogue, the
 *      prerequisites and the adoption record. It does not write skills (14),
 *      prices (35), laws (41) or construction detail (39); it references them.
 */

import type { WorldTime } from "../primitives/time.ts";

export const TECHNOLOGY_CATEGORIES = [
  "power",
  "transport",
  "production",
  "communication",
  "agriculture",
  "construction",
  "medicine",
  "administrative",
] as const;
export type TechnologyCategory = (typeof TECHNOLOGY_CATEGORIES)[number];

export interface Technology {
  readonly id: string;
  readonly name: string;
  readonly category: TechnologyCategory;
  /** When it came into being. An era gate is checked against this, not asserted. */
  readonly inventedAt: WorldTime;
  /** Ids of technologies that must be available first. Empty means standalone. */
  readonly prerequisites: readonly string[];
  /** What it makes possible. Referenced by other systems, never enacted here. */
  readonly capabilities: readonly string[];
  /** 0..1 — how much trained knowledge a subject needs before it can be used. */
  readonly knowledgeRequirement: number;
  /** 0..1 — how much manufacturing capacity a subject needs to make its own. */
  readonly productionRequirement: number;
  /** 0..1 — how much of the physical network must already exist. */
  readonly infrastructureRequirement: number;
  readonly note?: string;
}

/** Where an innovation came from (System 51 model). */
export const INNOVATION_SOURCES = [
  "research",
  "business",
  "university",
  "government",
  "individual",
  "accident",
  "recombination",
] as const;
export type InnovationSource = (typeof INNOVATION_SOURCES)[number];

export interface InnovationRecord {
  readonly id: string;
  readonly technologyId: string;
  readonly at: WorldTime;
  readonly source: InnovationSource;
  /** For `recombination`: what this was made out of. */
  readonly derivedFrom?: readonly string[];
  readonly note?: string;
}

/** One subject's adoption of one technology. */
export interface Adoption {
  readonly technologyId: string;
  readonly subjectId: string;
  readonly at: WorldTime;
  readonly note?: string;
}

export interface Obsolescence {
  readonly technologyId: string;
  readonly at: WorldTime;
  readonly replacedById?: string;
  readonly reason: string;
}

/**
 * Scenario permission to run outside the historical sequence.
 *
 * The spec's requirement is that prerequisites "prevent accidental anachronism
 * **unless scenario configuration explicitly permits them**". That "unless" is
 * the whole reason this is a distinct, *visible* record: a world that runs
 * ahead of its own technology has said so out loud, rather than having quietly
 * discovered that a prerequisite check can be turned off.
 */
export interface AnachronyPermission {
  readonly enabled: boolean;
  readonly reason?: string;
}

export interface TechnologySystemState {
  readonly technologies: readonly Technology[];
  readonly innovations: readonly InnovationRecord[];
  readonly adoptions: readonly Adoption[];
  readonly obsolescences: readonly Obsolescence[];
  readonly permission: AnachronyPermission;
}

export function emptyTechnologyState(): TechnologySystemState {
  return {
    technologies: [],
    innovations: [],
    adoptions: [],
    obsolescences: [],
    permission: { enabled: false },
  };
}

/**
 * Is this technology usable in this world at this date?
 *
 * `anachronistic` means a named prerequisite is unavailable — the technology
 * refers to something that does not exist yet, or exists only under another
 * permission. It is reported separately from "unavailable" because the two need
 * different fixes: one is a waiting problem, the other is a broken world.
 *
 * Named `TechnologyAvailability` rather than `Availability` because System 44
 * already exports an `Availability` for a different question entirely (what a
 * *place* makes culturally available to an arrival), and two exported types
 * meaning opposite things is how a reader ends up checking the wrong one.
 */
export interface TechnologyAvailability {
  readonly technologyId: string;
  readonly at: WorldTime;
  readonly available: boolean;
  readonly invented: boolean;
  /** Transitive prerequisites that are not available, in dependency order. */
  readonly unmetPrerequisites: readonly string[];
  readonly anachronistic: boolean;
  readonly replacedById?: string;
  readonly retired: boolean;
}

/**
 * The conditions a subject faces when deciding whether to take something up.
 *
 * Every field is 0..1 and every one is supplied by the caller, because each
 * belongs to another system: prices are System 35, skills are 14, institutions
 * are 42/43, culture is 44, and the physical network is 38. Adoption that
 * could be computed without asking any of them would be adoption by fiat.
 */
export interface AdoptionConditions {
  /** Affordability, 0..1 — from System 35's price against the subject's means. */
  readonly price: number;
  /** Whether the physical network is present, 0..1 — System 38. */
  readonly infrastructure: number;
  /** Whether the knowledge exists, 0..1 — System 14/23. */
  readonly knowledge: number;
  /** Whether institutions permit or support it, 0..1 — Systems 42/43. */
  readonly institutions: number;
  /** Whether the local culture tolerates it, 0..1 — System 44. */
  readonly culture: number;
  /** Whether regulation permits it, 0..1 — System 41. */
  readonly regulation: number;
  /** Whether it works with what the subject already has, 0..1. */
  readonly compatibility: number;
  /** Whether the subject can actually reach it, 0..1. */
  readonly geography: number;
  /** Whether others nearby already have it, 0..1 — the network effect. */
  readonly network: number;
}

/** The factors behind an adoption probability, in the order applied. */
export interface AdoptionDrivers {
  readonly probability: number;
  readonly factors: readonly string[];
}

/**
 * How far a technology has spread, and how much of that reading is sample.
 *
 * The denominator is returned because a technology "adopted by three" means
 * nothing without knowing how many could have adopted it, and the engine has no
 * way to guess the population behind an `eligible` figure the caller supplies.
 */
export interface DiffusionReading {
  readonly technologyId: string;
  readonly adopters: number;
  readonly eligible: number;
  /** 0..1 share of the eligible population that has taken it up. */
  readonly rate: number;
  readonly firstAdoptionAt?: WorldTime;
  readonly lastAdoptionAt?: WorldTime;
}

/** What stands between a subject and a technology, named. */
export interface Readiness {
  readonly technologyId: string;
  readonly subjectId: string;
  readonly ready: boolean;
  readonly blockers: readonly string[];
  /** 0..1: the weakest requirement the technology declares, against conditions. */
  readonly shortfall: number;
}
