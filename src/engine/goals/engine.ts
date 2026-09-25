import type { EntityId, IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import { clamp } from "../rng/distributions.ts";
import type {
  GoalHistoryEntry,
  GoalRecord,
  GoalStatus,
  GoalTimeHorizon,
  GoalsSystemState,
  MotivationSource,
  PersonGoalsState,
} from "./types.ts";

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

export interface CreateGoalRequest {
  readonly title: string;
  readonly domain: string;
  readonly horizon: GoalTimeHorizon;
  readonly motivation: MotivationSource;
  readonly priority: number;
  readonly urgency: number;
  readonly commitment: number;
  readonly deadline?: WorldTime;
  readonly parentGoalId?: string;
}

export class GoalsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.goals) {
      this.scope.assertOwner("goals");
      this.world.systems.goals = { persons: [] } satisfies GoalsSystemState;
    }
  }

  private get state(): GoalsSystemState {
    return this.world.systems.goals as GoalsSystemState;
  }

  private set state(value: GoalsSystemState) {
    this.world.systems.goals = value;
  }

  registerPerson(personId: EntityId<"person">): PersonGoalsState {
    this.scope.assertOwner("goals");
    const existing = this.getPerson(personId);
    if (existing) return existing;

    const pgs: PersonGoalsState = {
      personId,
      goals: [],
      history: [],
    };

    this.state = {
      ...this.state,
      persons: [...this.state.persons, pgs],
    };
    return pgs;
  }

  getPerson(personId: EntityId<"person">): PersonGoalsState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly PersonGoalsState[] {
    return this.state.persons;
  }

  getGoal(personId: EntityId<"person">, goalId: string): GoalRecord | undefined {
    return this.getPerson(personId)?.goals.find((g) => g.id === goalId);
  }

  createGoal(
    ids: IdAllocator,
    personId: EntityId<"person">,
    request: CreateGoalRequest,
    now: WorldTime,
  ): GoalRecord {
    this.scope.assertOwner("goals");
    const pgs = this.getPerson(personId);
    if (!pgs) throw new Error(`Unknown person in goals: ${personId}`);

    const goalId = `goal-${ids.next("activity")}`;
    const goal: GoalRecord = {
      id: goalId,
      title: request.title,
      domain: request.domain,
      horizon: request.horizon,
      motivation: request.motivation,
      priority: clamp01(request.priority),
      urgency: clamp01(request.urgency),
      commitment: clamp01(request.commitment),
      progress: 0,
      status: "active",
      createdAt: now,
      updatedAt: now,
      deadline: request.deadline,
      parentGoalId: request.parentGoalId,
      subGoalIds: [],
    };

    this._mutatePerson(personId, (p) => {
      let updatedGoals = [...p.goals, goal];
      if (request.parentGoalId) {
        updatedGoals = updatedGoals.map((g) =>
          g.id === request.parentGoalId
            ? { ...g, subGoalIds: [...g.subGoalIds, goalId] }
            : g,
        );
      }
      return {
        ...p,
        goals: updatedGoals,
        history: [
          ...p.history,
          {
            timestamp: now,
            goalId,
            previousStatus: "active",
            newStatus: "active",
            reason: "created",
          },
        ],
      };
    });

    return goal;
  }

  updateProgress(
    personId: EntityId<"person">,
    goalId: string,
    delta: number,
    now: WorldTime,
  ): GoalRecord | undefined {
    this.scope.assertOwner("goals");
    const pgs = this.getPerson(personId);
    if (!pgs) return undefined;

    const goal = pgs.goals.find((g) => g.id === goalId);
    if (!goal || goal.status !== "active") return undefined;

    const newProgress = clamp01(goal.progress + delta);
    const completed = newProgress >= 1.0;
    const newStatus: GoalStatus = completed ? "completed" : goal.status;

    const updated: GoalRecord = {
      ...goal,
      progress: newProgress,
      status: newStatus,
      updatedAt: now,
    };

    this._mutatePerson(personId, (p) => {
      const historyEntry: GoalHistoryEntry | null = completed
        ? {
            timestamp: now,
            goalId,
            previousStatus: goal.status,
            newStatus: "completed",
            reason: "progress_complete",
          }
        : null;

      return {
        ...p,
        goals: p.goals.map((g) => (g.id === goalId ? updated : g)),
        history: historyEntry ? [...p.history, historyEntry] : p.history,
      };
    });

    return updated;
  }

  setStatus(
    personId: EntityId<"person">,
    goalId: string,
    status: GoalStatus,
    reason: string,
    now: WorldTime,
  ): GoalRecord | undefined {
    this.scope.assertOwner("goals");
    const pgs = this.getPerson(personId);
    if (!pgs) return undefined;

    const goal = pgs.goals.find((g) => g.id === goalId);
    if (!goal || goal.status === status) return goal;

    const updated: GoalRecord = {
      ...goal,
      status,
      updatedAt: now,
    };

    this._mutatePerson(personId, (p) => ({
      ...p,
      goals: p.goals.map((g) => (g.id === goalId ? updated : g)),
      history: [
        ...p.history,
        {
          timestamp: now,
          goalId,
          previousStatus: goal.status,
          newStatus: status,
          reason,
        },
      ],
    }));

    return updated;
  }

  tick(personId: EntityId<"person">, now: WorldTime): PersonGoalsState | undefined {
    this.scope.assertOwner("goals");
    const pgs = this.getPerson(personId);
    if (!pgs) return undefined;

    const expiredEntries: GoalHistoryEntry[] = [];
    const updatedGoals = pgs.goals.map((g) => {
      if (g.status === "active" && g.deadline !== undefined && (now as number) > (g.deadline as number)) {
        expiredEntries.push({
          timestamp: now,
          goalId: g.id,
          previousStatus: g.status,
          newStatus: "expired",
          reason: "deadline_passed",
        });
        return {
          ...g,
          status: "expired" as const,
          updatedAt: now,
        };
      }
      return g;
    });

    const updatedPgs: PersonGoalsState = {
      ...pgs,
      goals: updatedGoals,
      history: [...pgs.history, ...expiredEntries],
    };

    this._mutatePerson(personId, () => updatedPgs);
    return updatedPgs;
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (pgs: PersonGoalsState) => PersonGoalsState,
  ): void {
    const pgs = this.getPerson(personId);
    if (!pgs) throw new Error(`Unknown person in goals: ${personId}`);
    const updated = fn(pgs);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
  }
}
