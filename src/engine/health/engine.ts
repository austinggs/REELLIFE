/**
 * ReelLife System 11 — Physical Health & Medicine.
 *
 * Models physical conditions, injuries, symptoms, treatment and recovery.
 * Diagnosis is an interpretation; the engine holds body truth.
 * Death physiology feeds Life Continuity (System 53), not this system.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { MINUTES_PER_HOUR } from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  FunctionalCapacity,
  HealthCondition,
  HealthConditionSeverity,
  HealthState,
  HealthSystemState,
  Medication,
  RiskFactor,
  Treatment,
  VitalState,
} from "./types.ts";

function computeOverallCondition(
  conditions: readonly HealthCondition[],
): HealthState["overallCondition"] {
  const active = conditions.filter(
    (c) => c.status === "active" || c.status === "recovering",
  );
  if (active.length === 0) return "healthy";
  const worst = active.reduce<HealthConditionSeverity>(
    (acc, c) => {
      const order = { mild: 0, moderate: 1, severe: 2, critical: 3 } as const;
      return order[c.severity] > order[acc] ? c.severity : acc;
    },
    "mild",
  );
  return worst;
}

function computeFunctionalCapacity(
  conditions: readonly HealthCondition[],
): FunctionalCapacity {
  const activeImpairment = conditions
    .filter((c) => c.status === "active" || c.status === "chronic")
    .reduce((sum, c) => sum + c.functionalImpairment, 0);
  const physical = Math.max(0, 1 - activeImpairment);
  return { physical, cognitive: physical, social: physical };
}

function computeVitalState(
  conditions: readonly HealthCondition[],
): VitalState {
  if (conditions.some((c) => c.status === "active" && c.severity === "critical")) return "critical";
  if (conditions.some((c) => c.status === "active" && c.severity === "severe")) return "deteriorating";
  return "stable";
}

function initialHealthState(personId: EntityId<"person">): HealthState {
  return {
    personId,
    overallCondition: "healthy",
    vitalState: "stable",
    conditions: [],
    treatments: [],
    medications: [],
    allergies: [],
    riskFactors: [],
    functionalCapacity: { physical: 1.0, cognitive: 1.0, social: 1.0 },
    history: [],
  };
}

export class HealthEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.health) {
      this.scope.assertOwner("health");
      this.world.systems.health = { persons: [] } satisfies HealthSystemState;
    }
  }

  private get state(): HealthSystemState {
    return this.world.systems.health as HealthSystemState;
  }

  private set state(value: HealthSystemState) {
    this.world.systems.health = value;
  }

  registerPerson(personId: EntityId<"person">): HealthState {
    this.scope.assertOwner("health");
    const hs = initialHealthState(personId);
    this.state = { ...this.state, persons: [...this.state.persons, hs] };
    return hs;
  }

  addCondition(personId: EntityId<"person">, condition: HealthCondition): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => {
      const conditions = [...hs.conditions, condition];
      return {
        ...hs,
        conditions,
        overallCondition: computeOverallCondition(conditions),
        functionalCapacity: computeFunctionalCapacity(conditions),
        vitalState: computeVitalState(conditions),
      };
    });
  }

  resolveCondition(
    personId: EntityId<"person">,
    conditionId: string,
    at: WorldTime,
  ): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => {
      const conditions = hs.conditions.map((c) =>
        c.id === conditionId ? { ...c, status: "resolved" as const, resolvedAt: at } : c,
      );
      return {
        ...hs,
        conditions,
        overallCondition: computeOverallCondition(conditions),
        functionalCapacity: computeFunctionalCapacity(conditions),
        vitalState: computeVitalState(conditions),
      };
    });
  }

  /**
   * Progress conditions over elapsed time. Worsening conditions increase severity.
   * Call this during the tick loop for active persons.
   */
  tick(personId: EntityId<"person">, elapsedMinutes: number): HealthState | undefined {
    this.scope.assertOwner("health");
    const hs = this.getPerson(personId);
    if (!hs) return undefined;

    const conditions = hs.conditions.map((c) => {
      if (c.status === "resolved" || c.status === "terminal") return c;
      // Severity progression: progressionRate > 0 = worsening
      const delta = (c.progressionRate * elapsedMinutes) / MINUTES_PER_HOUR;
      if (Math.abs(delta) < 0.05) return c; // not enough change
      // Simple step model: cross integer thresholds to change severity
      const order = ["mild", "moderate", "severe", "critical"] as const;
      const idx = order.indexOf(c.severity);
      const newIdx = Math.max(0, Math.min(3, Math.round(idx + delta)));
      return { ...c, severity: order[newIdx]! };
    });

    const updated: HealthState = {
      ...hs,
      conditions,
      overallCondition: computeOverallCondition(conditions),
      functionalCapacity: computeFunctionalCapacity(conditions),
      vitalState: computeVitalState(conditions),
    };
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
    return updated;
  }

  addTreatment(personId: EntityId<"person">, treatment: Treatment): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => ({
      ...hs,
      treatments: [...hs.treatments, treatment],
    }));
  }

  addMedication(personId: EntityId<"person">, medication: Medication): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => ({
      ...hs,
      medications: [...hs.medications, medication],
    }));
  }

  addRiskFactor(personId: EntityId<"person">, risk: RiskFactor): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => ({
      ...hs,
      riskFactors: [...hs.riskFactors.filter((r) => r.id !== risk.id), risk],
    }));
  }

  setVitalState(personId: EntityId<"person">, vitalState: VitalState, note: string, at: WorldTime): void {
    this.scope.assertOwner("health");
    this._mutatePerson(personId, (hs) => ({
      ...hs,
      vitalState,
      history: [...hs.history, { timestamp: at, note }],
    }));
  }

  getPerson(personId: EntityId<"person">): HealthState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (hs: HealthState) => HealthState,
  ): void {
    const hs = this.getPerson(personId);
    if (!hs) throw new Error(`Unknown person in health: ${personId}`);
    const updated = fn(hs);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) =>
        p.personId === personId ? updated : p,
      ),
    };
  }
}
