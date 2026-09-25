/**
 * ReelLife resolution primitive (System 03).
 *
 * A ResolutionObject records how an uncertain outcome was decided:
 * applicability, conditions, candidate outcomes, eligibility, weights or
 * probabilities, the selected outcome, and the RNG/debug metadata needed to
 * replay and explain it.
 *
 * Two rules are structural, not stylistic:
 *  - eligibility is evaluated separately from probability (an ineligible
 *    candidate is never merely "unlikely"),
 *  - an all-zero probability set is an explicit failure, not a silent default.
 */

import type { EntityId } from "./ids.ts";
import type { WorldTime } from "./time.ts";

export interface ResolutionCandidate {
  readonly id: string;
  /** Relative weight or probability. Must be >= 0. */
  readonly weight: number;
  readonly eligible: boolean;
  readonly ineligibleReason?: string;
  /** Effects this candidate produces when selected. */
  readonly effectType?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RngAudit {
  /** Named RNG stream used, e.g. "person:PER-000004" or "events". */
  readonly stream: string;
  /** Raw roll in [0, 1) produced by the stream. */
  readonly roll: number;
  readonly distribution?: string;
  readonly parameters?: Readonly<Record<string, number>>;
}

export type ResolutionOutcomeKind = "selected" | "no-eligible-candidate" | "empty-candidate-set" | "not-applicable";

export interface ResolutionObject {
  readonly id: EntityId<"event"> | string;
  readonly purpose: string;
  readonly at: WorldTime;
  readonly applicable: boolean;
  readonly notApplicableReason?: string;
  readonly conditions: readonly string[];
  readonly candidates: readonly ResolutionCandidate[];
  readonly outcomeKind: ResolutionOutcomeKind;
  readonly selectedCandidateId?: string;
  readonly rng?: RngAudit;
  readonly debug?: Readonly<Record<string, unknown>>;
}

export class ResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ResolutionError";
  }
}

export function totalEligibleWeight(candidates: readonly ResolutionCandidate[]): number {
  let total = 0;
  for (const candidate of candidates) {
    if (!candidate.eligible) continue;
    if (candidate.weight < 0) {
      throw new ResolutionError(`Candidate ${candidate.id} has negative weight`);
    }
    total += candidate.weight;
  }
  return total;
}

/**
 * Turns a raw roll into a selected candidate. The caller supplies the roll from
 * a named seeded stream; this function contains no randomness of its own so it
 * can be unit tested exhaustively.
 */
export function selectByWeight(
  candidates: readonly ResolutionCandidate[],
  roll: number,
): ResolutionCandidate | null {
  if (roll < 0 || roll >= 1) {
    throw new ResolutionError(`Roll must be in [0, 1), received ${String(roll)}`);
  }
  const eligible = candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) return null;

  const total = totalEligibleWeight(eligible);
  if (total <= 0) {
    // All eligible candidates have zero weight: no valid outcome was declared.
    throw new ResolutionError(
      "Eligible candidates all have zero weight; declare an explicit fallback candidate instead",
    );
  }

  let cursor = roll * total;
  for (const candidate of eligible) {
    cursor -= candidate.weight;
    if (cursor < 0) return candidate;
  }
  // Floating-point guard: the last eligible candidate owns the remainder.
  return eligible[eligible.length - 1] ?? null;
}

export function describeResolution(resolution: ResolutionObject): string {
  if (!resolution.applicable) {
    return `${resolution.purpose}: not applicable (${resolution.notApplicableReason ?? "unspecified"})`;
  }
  if (resolution.selectedCandidateId === undefined) {
    return `${resolution.purpose}: no outcome (${resolution.outcomeKind})`;
  }
  return `${resolution.purpose}: ${resolution.selectedCandidateId} (${resolution.outcomeKind})`;
}
