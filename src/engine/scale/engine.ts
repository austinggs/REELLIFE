/**
 * Scale engine (System 07): resolution, relevance and materialization state.
 *
 * Owns settlement aggregates (abstract population) and the registry of
 * materialized residents. The actual person/identity/legal records are owned
 * by their respective systems; `materialize.ts` orchestrates writes across
 * them through sequential ownership scopes.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import {
  type AgeBand,
  type AgeStructureBand,
  type ResidentContext,
  type ScaleSystemState,
  type SettlementAggregate,
} from "./types.ts";

/** Provisional age structure for slice settlements; real demographics arrive with M4. */
export const DEFAULT_AGE_STRUCTURE: readonly AgeStructureBand[] = [
  { band: "child", share: 0.24 },
  { band: "youngAdult", share: 0.18 },
  { band: "adult", share: 0.38 },
  { band: "senior", share: 0.2 },
];

export class ScaleEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.scale) {
      this.scope.assertOwner("scale");
      this.world.systems.scale = { settlements: [], residents: [] } satisfies ScaleSystemState;
    }
  }

  private get state(): ScaleSystemState {
    return this.world.systems.scale as ScaleSystemState;
  }

  private set state(value: ScaleSystemState) {
    this.world.systems.scale = value;
  }

  aggregateFor(settlementId: string): SettlementAggregate | undefined {
    return this.state.settlements.find((entry) => entry.settlementId === settlementId);
  }

  /** Declares a settlement's abstract population. Idempotent: redefinition is a no-op. */
  defineSettlement(
    settlementId: string,
    totalPopulation: number,
    ageStructure: readonly AgeStructureBand[] = DEFAULT_AGE_STRUCTURE,
  ): SettlementAggregate {
    this.scope.assertOwner("scale");
    if (!Number.isFinite(totalPopulation) || totalPopulation <= 0) {
      throw new Error("ScaleEngine.defineSettlement: totalPopulation must be positive");
    }
    const shareSum = ageStructure.reduce((sum, band) => sum + band.share, 0);
    if (Math.abs(shareSum - 1) > 1e-9) {
      throw new Error("ScaleEngine.defineSettlement: age structure shares must sum to 1");
    }
    const existing = this.aggregateFor(settlementId);
    if (existing) return existing;
    const aggregate: SettlementAggregate = {
      settlementId,
      totalPopulation: Math.floor(totalPopulation),
      ageStructure: [...ageStructure],
    };
    this.state = { ...this.state, settlements: [...this.state.settlements, aggregate] };
    return aggregate;
  }

  residentsAt(settlementId: string): readonly ResidentContext[] {
    return this.state.residents.filter((resident) => resident.settlementId === settlementId);
  }

  residentFor(personId: EntityId<"person">): ResidentContext | undefined {
    return this.state.residents.find((resident) => resident.personId === personId);
  }

  recordResident(resident: ResidentContext): void {
    this.scope.assertOwner("scale");
    if (!this.aggregateFor(resident.settlementId)) {
      throw new Error(
        `ScaleEngine.recordResident: settlement ${resident.settlementId} has no aggregate`,
      );
    }
    if (this.residentFor(resident.personId)) {
      throw new Error(
        `ScaleEngine.recordResident: person ${resident.personId} is already materialized`,
      );
    }
    this.state = { ...this.state, residents: [...this.state.residents, resident] };
  }

  countMaterialized(settlementId: string): number {
    return this.residentsAt(settlementId).length;
  }

  /** Age bands currently represented by materialized residents of a settlement. */
  materializedAgeBands(settlementId: string): readonly AgeBand[] {
    const seen: AgeBand[] = [];
    for (const resident of this.residentsAt(settlementId)) {
      if (!seen.includes(resident.ageBand)) seen.push(resident.ageBand);
    }
    return seen;
  }
}
