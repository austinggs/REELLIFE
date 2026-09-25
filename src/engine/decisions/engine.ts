import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  AutonomyMode,
  CandidateAction,
  DecisionMode,
  DecisionRecord,
  DecisionsSystemState,
  EvaluatedAction,
  Intention,
  PersonDecisionsState,
} from "./types.ts";

export interface DecisionContext {
  readonly personId: EntityId<"person">;
  readonly now: WorldTime;
  readonly mode: DecisionMode;
  readonly riskTolerance?: number; // 0..1 from traits
  readonly energyFactor?: number;  // 0..1 from health/needs
}

export type ActionEligibilityFn = (action: CandidateAction, context: DecisionContext) => {
  readonly eligible: boolean;
  readonly reason?: string;
};

export class DecisionsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.decisions) {
      this.scope.assertOwner("decisions");
      this.world.systems.decisions = { persons: [] } satisfies DecisionsSystemState;
    }
  }

  private get state(): DecisionsSystemState {
    return this.world.systems.decisions as DecisionsSystemState;
  }

  private set state(value: DecisionsSystemState) {
    this.world.systems.decisions = value;
  }

  registerPerson(
    personId: EntityId<"person">,
    autonomyMode: AutonomyMode = "full",
  ): PersonDecisionsState {
    this.scope.assertOwner("decisions");
    const existing = this.getPerson(personId);
    if (existing) return existing;

    const pds: PersonDecisionsState = {
      personId,
      autonomyMode,
      history: [],
    };

    this.state = {
      ...this.state,
      persons: [...this.state.persons, pds],
    };
    return pds;
  }

  getPerson(personId: EntityId<"person">): PersonDecisionsState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly PersonDecisionsState[] {
    return this.state.persons;
  }

  setAutonomyMode(personId: EntityId<"person">, mode: AutonomyMode): void {
    this.scope.assertOwner("decisions");
    this._mutatePerson(personId, (p) => ({ ...p, autonomyMode: mode }));
  }

  evaluateActions(
    candidates: readonly CandidateAction[],
    context: DecisionContext,
    eligibilityCheck?: ActionEligibilityFn,
  ): readonly EvaluatedAction[] {
    const riskTolerance = context.riskTolerance ?? 0.5;
    const energy = context.energyFactor ?? 1.0;

    return candidates.map((action) => {
      let eligible = true;
      let ineligibilityReason: string | undefined;

      if (eligibilityCheck) {
        const res = eligibilityCheck(action, context);
        eligible = res.eligible;
        ineligibilityReason = res.reason;
      }

      if (!eligible) {
        return {
          ...action,
          eligible: false,
          ineligibilityReason,
          finalScore: 0,
        };
      }

      const reward = action.estimatedReward ?? 0;
      const cost = (action.estimatedCost ?? 0) * (2.0 - energy);
      const riskPenalty = (action.estimatedRisk ?? 0) * (1.5 - riskTolerance);

      const utility = action.baseScore + reward - cost - riskPenalty;
      const finalScore = Math.max(0.001, utility);

      return {
        ...action,
        eligible: true,
        finalScore,
      };
    });
  }

  decide(
    ids: IdAllocator,
    context: DecisionContext,
    candidates: readonly CandidateAction[],
    eligibilityCheck?: ActionEligibilityFn,
  ): Intention | undefined {
    this.scope.assertOwner("decisions");
    const pds = this.getPerson(context.personId);
    if (!pds) throw new Error(`Unknown person in decisions: ${context.personId}`);

    if (pds.autonomyMode === "player_controlled") {
      return undefined;
    }

    const evaluated = this.evaluateActions(candidates, context, eligibilityCheck);
    const eligibleActions = evaluated.filter((a) => a.eligible);

    if (eligibleActions.length === 0) {
      return undefined;
    }

    // Best action by score
    let best = eligibleActions[0]!;
    for (const a of eligibleActions) {
      if (a.finalScore > best.finalScore) {
        best = a;
      }
    }

    const intention: Intention = {
      actionId: best.id,
      actionType: best.type,
      score: best.finalScore,
      formedAt: context.now,
      mode: context.mode,
      payload: best.payload,
    };

    const record: DecisionRecord = {
      id: `dec-${ids.next("activity")}`,
      timestamp: context.now,
      mode: context.mode,
      selectedAction: best,
      consideredCount: candidates.length,
      justification: `Selected highest utility score (${best.finalScore.toFixed(2)}) under ${context.mode} mode`,
    };

    this._mutatePerson(context.personId, (p) => ({
      ...p,
      activeIntention: intention,
      history: [...p.history, record],
    }));

    return intention;
  }

  clearIntention(personId: EntityId<"person">): void {
    this.scope.assertOwner("decisions");
    this._mutatePerson(personId, (p) => ({ ...p, activeIntention: undefined }));
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (pds: PersonDecisionsState) => PersonDecisionsState,
  ): void {
    const pds = this.getPerson(personId);
    if (!pds) throw new Error(`Unknown person in decisions: ${personId}`);
    const updated = fn(pds);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
  }
}

