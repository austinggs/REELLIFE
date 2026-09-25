/**
 * Scenario resolution helper (System 03).
 *
 * Turns a declared candidate set into a ResolutionObject, drawing exactly one
 * roll from a named stream when (and only when) a real choice exists.
 *
 * Invariants this function protects:
 *  - eligibility is decided by the caller, never by probability,
 *  - impossible differs from unlikely: no eligible candidate means "no outcome",
 *    and it is reported as such instead of silently picking something,
 *  - an inapplicable scenario consumes no randomness, so adding a guard clause
 *    to content cannot shift unrelated outcomes,
 *  - the roll and its stream are recorded for replay and explanation.
 */

import type { WorldTime } from "../primitives/time.ts";
import { selectByWeight, type ResolutionCandidate, type ResolutionObject } from "../primitives/resolution.ts";
import type { RngStream } from "./streams.ts";

export interface ScenarioResolutionInput {
  readonly purpose: string;
  readonly at: WorldTime;
  readonly applicable: boolean;
  readonly notApplicableReason?: string;
  readonly conditions?: readonly string[];
  readonly candidates: readonly ResolutionCandidate[];
  readonly debug?: Readonly<Record<string, unknown>>;
}

export function resolveScenario(stream: RngStream, input: ScenarioResolutionInput): ResolutionObject {
  const base = {
    id: `RES-${stream.path}@${String(input.at)}`,
    purpose: input.purpose,
    at: input.at,
    conditions: input.conditions ?? [],
    candidates: input.candidates,
    debug: input.debug,
  } as const;

  if (!input.applicable) {
    return {
      ...base,
      applicable: false,
      ...(input.notApplicableReason === undefined
        ? {}
        : { notApplicableReason: input.notApplicableReason }),
      outcomeKind: "not-applicable",
    };
  }

  if (input.candidates.length === 0) {
    return { ...base, applicable: true, outcomeKind: "empty-candidate-set" };
  }

  const eligible = input.candidates.filter((candidate) => candidate.eligible);
  if (eligible.length === 0) {
    return { ...base, applicable: true, outcomeKind: "no-eligible-candidate" };
  }

  const roll = stream.nextFloat();
  const selected = selectByWeight(input.candidates, roll);
  if (selected === null) {
    return { ...base, applicable: true, outcomeKind: "no-eligible-candidate" };
  }

  return {
    ...base,
    applicable: true,
    outcomeKind: "selected",
    selectedCandidateId: selected.id,
    rng: { stream: stream.path, roll, distribution: "weighted" },
  };
}
