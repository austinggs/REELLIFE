/**
 * Deterministic materialization (System 07).
 *
 * Reveals residents *from* a settlement's persisted aggregate rather than
 * inventing convenient NPCs: names, ages and household shapes are drawn from
 * the seeded `population` RNG stream in a fixed order, then identity, family
 * and legal records are created through their own ownership scopes (one owner
 * per write, never nested). Re-running with the same target is a no-op, so
 * re-materialization restores established lives instead of duplicating them.
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import { subtractTime, yearsApprox, type WorldTime } from "../primitives/time.ts";
import { IdentityEngine } from "../identity/engine.ts";
import type { PersonName } from "../identity/types.ts";
import { FamilyEngine } from "../family/engine.ts";
import type { HouseholdRole } from "../family/types.ts";
import { LegalIdentityEngine } from "../legalIdentity/engine.ts";
import { ScaleEngine, DEFAULT_AGE_STRUCTURE } from "./engine.ts";
import type { AgeBand, AgeStructureBand, ResidentContext } from "./types.ts";
import type { GeographySystemState } from "../geography/types.ts";
import {
  PROVISIONAL_FIRST_NAMES,
  PROVISIONAL_LAST_NAMES,
} from "../../content/aurelia/names.ts";

export interface MaterializeSettlementOptions {
  readonly settlementId: string;
  /** Total abstract population; required the first time the settlement is defined. */
  readonly totalPopulation?: number;
  /** Materialize up to this many residents *in total* (idempotent target). */
  readonly targetCount: number;
  readonly now: WorldTime;
}

interface ResidentPlan {
  readonly ageBand: AgeBand;
  readonly ageYears: number;
  readonly name: PersonName;
  readonly appearanceFoundationSeed: string;
}

const AGE_RANGES: Readonly<Record<AgeBand, readonly [number, number]>> = {
  child: [0, 17],
  youngAdult: [18, 29],
  adult: [30, 59],
  senior: [60, 89],
};

function drawAgeBand(structure: readonly AgeStructureBand[], roll: number): AgeBand {
  let cumulative = 0;
  for (const band of structure) {
    cumulative += band.share;
    if (roll < cumulative) return band.band;
  }
  return structure[structure.length - 1].band;
}

/** Country ancestor of a settlement, for identity origin; geography may be unseeded. */
function countryAncestorOf(sim: Simulation, settlementId: string): string | undefined {
  const geo = sim.world.systems.geography as GeographySystemState | undefined;
  if (!geo) return undefined;
  const byId = new Map(geo.places.map((place) => [place.id, place]));
  if (!byId.has(settlementId)) {
    throw new Error(`materializeSettlement: place ${settlementId} is not registered in geography`);
  }
  let current = byId.get(settlementId);
  let depth = 0;
  while (current?.parentId && depth < 16) {
    current = byId.get(current.parentId);
    if (current?.level === "country") return current.id;
    depth += 1;
  }
  return undefined;
}

/**
 * Materializes residents of a settlement up to `targetCount`. Returns every
 * materialized person of that settlement, existing ones included.
 */
export function materializeSettlement(
  sim: Simulation,
  options: MaterializeSettlementOptions,
): readonly EntityId<"person">[] {
  const { settlementId, targetCount, now } = options;
  if (!Number.isFinite(targetCount) || targetCount < 0) {
    throw new Error("materializeSettlement: targetCount must be a non-negative number");
  }
  const nationalityId = countryAncestorOf(sim, settlementId);

  // 1. Scale owns the aggregate and the resident registry.
  let existing: readonly ResidentContext[] = [];
  let structure: readonly AgeStructureBand[] = DEFAULT_AGE_STRUCTURE;
  sim.guard.mutate("scale", () => {
    const scale = new ScaleEngine(sim.scope, sim.world);
    if (!scale.aggregateFor(settlementId)) {
      if (options.totalPopulation === undefined) {
        throw new Error(`materializeSettlement: totalPopulation required to define ${settlementId}`);
      }
      scale.defineSettlement(settlementId, options.totalPopulation);
    }
    const aggregate = scale.aggregateFor(settlementId);
    if (aggregate && targetCount > aggregate.totalPopulation) {
      throw new Error(
        `materializeSettlement: target ${targetCount} exceeds aggregate population of ${settlementId}`,
      );
    }
    structure = aggregate?.ageStructure ?? DEFAULT_AGE_STRUCTURE;
    existing = scale.residentsAt(settlementId);
  });

  const alreadyMaterialized = existing.map((resident) => resident.personId);
  const needed = targetCount - existing.length;
  if (needed <= 0) return alreadyMaterialized;

  // 2. Draw every plan from the population stream in one fixed order.
  const rng = sim.rng.stream("population");
  const plans: ResidentPlan[] = [];
  for (let i = 0; i < needed; i += 1) {
    const ageBand = drawAgeBand(structure, rng.nextFloat());
    const [minAge, maxAge] = AGE_RANGES[ageBand];
    const ageYears = rng.nextInt(minAge, maxAge);
    const name: PersonName = {
      first: PROVISIONAL_FIRST_NAMES[rng.nextInt(0, PROVISIONAL_FIRST_NAMES.length - 1)],
      last: PROVISIONAL_LAST_NAMES[rng.nextInt(0, PROVISIONAL_LAST_NAMES.length - 1)],
    };
    plans.push({
      ageBand,
      ageYears,
      name,
      appearanceFoundationSeed: `${settlementId}:appearance:${existing.length + i}`,
    });
  }
  // Household shapes are drawn after all person draws, never interleaved.
  const householdSizes: number[] = [];
  let remaining = needed;
  while (remaining > 0) {
    const size = Math.min(rng.nextInt(1, 4), remaining);
    householdSizes.push(size);
    remaining -= size;
  }

  // 3. Identity owns person records.
  const created: { personId: EntityId<"person">; plan: ResidentPlan }[] = [];
  sim.guard.mutate("identity", () => {
    const identity = new IdentityEngine(sim.scope, sim.world);
    for (const plan of plans) {
      const person = identity.create(sim.ids, {
        name: plan.name,
        birth: {
          dateOfBirth: subtractTime(now, yearsApprox(plan.ageYears)),
          recordedTime: now,
        },
        origin: { birthplaceId: settlementId, ...(nationalityId ? { nationalityId } : {}) },
        appearanceFoundationSeed: plan.appearanceFoundationSeed,
      });
      created.push({ personId: person.id, plan });
    }
  });

  // 4. Family owns households; the oldest member of each group is the head.
  const householdByPerson = new Map<EntityId<"person">, string>();
  sim.guard.mutate("family", () => {
    const family = new FamilyEngine(sim.scope, sim.world);
    let cursor = 0;
    for (const size of householdSizes) {
      const group = created.slice(cursor, cursor + size);
      cursor += size;
      const head = [...group].sort((a, b) => b.plan.ageYears - a.plan.ageYears)[0];
      const household = family.createHousehold(
        sim.ids,
        `${head.plan.name.last} household`,
        head.personId,
        now,
        settlementId,
      );
      householdByPerson.set(head.personId, household.id);
      for (const member of group) {
        if (member.personId === head.personId) continue;
        const role: HouseholdRole = member.plan.ageYears < 18 ? "child" : "adult";
        family.addHouseholdMember(household.id, member.personId, role, now);
        householdByPerson.set(member.personId, household.id);
      }
    }
  });

  // 5. Legal identity owns administrative records.
  sim.guard.mutate("legalIdentity", () => {
    const legal = new LegalIdentityEngine(sim.scope, sim.world);
    created.forEach((entry, index) => {
      legal.issue(
        sim.ids,
        {
          type: "birthRegistration",
          subject: entry.personId,
          authority: "AURELIA_CIVIL_REGISTRY",
          identifier: `AUR-${settlementId.replace(/[^A-Z0-9]/gi, "")}-${String(existing.length + index).padStart(6, "0")}`,
          access: "authority",
        },
        now,
      );
    });
  });

  // 6. Scale reveals the residents inside the aggregate.
  sim.guard.mutate("scale", () => {
    const scale = new ScaleEngine(sim.scope, sim.world);
    for (const entry of created) {
      scale.recordResident({
        personId: entry.personId,
        settlementId,
        householdId: householdByPerson.get(entry.personId),
        ageBand: entry.plan.ageBand,
        materializedAt: now,
      });
    }
  });

  return [...alreadyMaterialized, ...created.map((entry) => entry.personId)];
}
