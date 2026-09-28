/**
 * Age mortality (System 53's "death can arise from age", wired to System 09).
 *
 * Age stays *derived* from the clock — System 09 owns that, and this module
 * therefore stores no age and no counter. It reads the development record, turns
 * the derived age into an annual hazard, draws from a named seeded stream, and
 * hands a death to the pipeline when the draw falls inside the hazard.
 *
 * Eligibility and probability are separate here, as System 03 requires. A person
 * with no development record is not assessed at all, and someone already dead is
 * skipped before any reading happens. A person *below* the minimum age is
 * assessed and reported with a hazard of zero — the answer "not eligible at this
 * age" is itself a finding, and hiding it would make a sweep silently
 * incomplete. What it never does is draw: a zero hazard takes no sample from the
 * stream, so a population of young people consumes no randomness at all. Nothing
 * in this module calls `Math.random()`; the stream path is
 * `continuity:mortality:<personId>`, so one person's draws can never shift
 * another's.
 *
 * The hazard constants are provisional and live in `AGE_MORTALITY`
 * (see docs/CONTENT_GAPS.md) — no canon table exists for Aurelian mortality.
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { streamPath } from "../rng/streams.ts";
import { AgingEngine, computeAgeYears } from "../aging/engine.ts";
import { LifeContinuityEngine } from "./engine.ts";
import { laterLifeEvidence, processDeath, type DeathOutcome } from "./death.ts";
import { AGE_MORTALITY, type DeathCause } from "./types.ts";

export interface MortalityAssessment {
  readonly personId: EntityId<"person">;
  readonly ageYears: number;
  /** Annual probability of dying of age at this age. */
  readonly annualHazard: number;
  /** The same hazard over the assessed period. */
  readonly periodHazard: number;
  /** Absent when the period hazard was zero, because no draw was taken. */
  readonly roll?: number;
  readonly died: boolean;
  readonly streamPath: string;
}

/** Annual hazard from age alone; zero below the minimum age. */
export function annualMortalityHazard(ageYears: number): number {
  if (!Number.isFinite(ageYears)) return 0;
  const { minimumAgeYears, annualHazardAtMinimum, hazardDoublingYears, maximumAnnualHazard } =
    AGE_MORTALITY;
  if (ageYears < minimumAgeYears) return 0;
  const over = ageYears - minimumAgeYears;
  const hazard = annualHazardAtMinimum * 2 ** (over / hazardDoublingYears);
  return Math.min(maximumAnnualHazard, hazard);
}

/** Converts an annual hazard into the hazard over `periodDays` (default a year). */
export function periodMortalityHazard(annualHazard: number, periodDays = 365): number {
  if (!(annualHazard > 0)) return 0;
  const clamped = Math.min(1, annualHazard);
  return 1 - (1 - clamped) ** (Math.max(0, periodDays) / 365);
}

export interface MortalityOptions {
  readonly periodDays?: number;
}

/**
 * Assesses one person. Returns `undefined` when no assessment is possible —
 * no development record (System 09 never saw them), so no age to reason from.
 */
export function assessMortality(
  sim: Simulation,
  personId: EntityId<"person">,
  at: WorldTime,
  options?: MortalityOptions,
): MortalityAssessment | undefined {
  const development = AgingEngine.peek(sim.scope, sim.world).get(personId);
  if (!development) return undefined;
  const ageYears = computeAgeYears(development.birthTimestamp, at);
  const annualHazard = annualMortalityHazard(ageYears);
  const periodHazard = periodMortalityHazard(annualHazard, options?.periodDays ?? 365);
  const path = streamPath("continuity", `mortality:${String(personId)}`);
  if (periodHazard <= 0) {
    return { personId, ageYears, annualHazard, periodHazard, died: false, streamPath: path };
  }
  const roll = sim.rng.stream(path).nextFloat();
  return {
    personId,
    ageYears,
    annualHazard,
    periodHazard,
    roll,
    died: roll < periodHazard,
    streamPath: path,
  };
}

export interface MortalitySweepResult {
  readonly assessments: readonly MortalityAssessment[];
  readonly deaths: readonly DeathOutcome[];
}

/**
 * Assesses a set of people in the order given and runs the pipeline for those
 * whose draw fell inside the hazard. Order is the caller's, so a sweep over
 * `scale.residents` resolves in materialization order and reproduces exactly.
 */
export function checkMortality(
  sim: Simulation,
  personIds: readonly EntityId<"person">[],
  at: WorldTime,
  options?: MortalityOptions & { readonly limit?: number },
): MortalitySweepResult {
  const assessments: MortalityAssessment[] = [];
  const deaths: DeathOutcome[] = [];
  const limit = options?.limit ?? Number.POSITIVE_INFINITY;
  for (const personId of personIds) {
    if (deaths.length >= limit) break;
    if (LifeContinuityEngine.peek(sim.scope, sim.world).statusOf(personId) !== "active") continue;
    const assessment = assessMortality(sim, personId, at, options);
    if (!assessment) continue;
    assessments.push(assessment);
    if (!assessment.died) continue;
    const development = AgingEngine.peek(sim.scope, sim.world).get(personId);
    const cause: DeathCause = "age";
    deaths.push(
      processDeath(sim, {
        personId,
        cause,
        causeNote: "old age",
        certainty: "probable",
        determinedBy: "inference",
        evidence: [laterLifeEvidence(personId, development?.currentLifeStage ?? "unknown")],
        at,
      }),
    );
  }
  return { assessments, deaths };
}
