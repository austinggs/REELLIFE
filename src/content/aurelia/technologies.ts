/**
 * Provisional technology content for the Arden slice (M6 / System 51).
 *
 * The World Bible is said to author eleven technology eras and nine development
 * stages. **Neither is in this repository** — `canon.ts` has eight history eras
 * and seventeen active world developments, and no technology era table at all.
 * Encoding an eleven-row table from memory would be inventing canon, so this
 * module does not try. It authors only the technologies the slice's *existing*
 * content already implies, and the gap is recorded in docs/CONTENT_GAPS.md.
 *
 *   - **Water wheel and millstone** — the bakery owns a mill and bakes
 *     overnight, so a mill exists, and a mill needs power and grinding.
 *   - **Controlled oven** — the bakehouse lights its oven before the second
 *     watch, so the oven is controlled rather than a banked fire.
 *   - **Tidal berth with pilotage** — the docks run a 140-strong workforce with
 *     pilotage, so the berth is dredged and navigated rather than accidental.
 *   - **Loading gauge and certification register** — System 41 certifies
 *     stevedores and caps crane load, so measurement and its record-keeping are
 *     technologies with prerequisites of their own.
 *   - **Mechanical crane** — uncrewed crane work is prohibited by System 41's
 *     rule register, so cranes are already in the slice's authorised world.
 *
 * The chain matters more than the list: the crane requires the berth *and* the
 * gauge. That is what makes `availability()` do something.
 *
 * Every invention date is placed at the world's start, because these are the
 * slice's settled present rather than a timeline being simulated. Nothing here is
 * canon, and no date is a claim about Aurelia's history.
 */

import type { TechnologyEngine } from "../../engine/technology/engine.ts";
import type { TechnologyCategory } from "../../engine/technology/types.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";

export interface AureliaTechnologySpec {
  readonly id: string;
  readonly name: string;
  readonly category: TechnologyCategory;
  readonly prerequisites?: readonly string[];
  readonly capabilities?: readonly string[];
  readonly knowledgeRequirement: number;
  readonly productionRequirement: number;
  readonly infrastructureRequirement: number;
  readonly note?: string;
}

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors technology eras and development stages, " +
  "but neither table exists in this repository yet (M6/S51 gap list).";

export const AURELIA_TECHNOLOGY_COUNT = 6;

/**
 * The slice's settled technologies, in dependency order — registration order
 * *is* build order here, because a technology cannot be registered before the
 * thing it stands on.
 */
export const AURELIA_TECHNOLOGIES: readonly AureliaTechnologySpec[] = [
  {
    id: "TECH-ARDEN-WATER-WHEEL",
    name: "Under-shot water wheel",
    category: "power",
    capabilities: ["turns_a_shaft", "grinds_by_weight"],
    knowledgeRequirement: 0.3,
    productionRequirement: 0.4,
    infrastructureRequirement: 0.5,
    note: "Power before machinery: the slice's mills run on falling water.",
  },
  {
    id: "TECH-ARDEN-MILLSTONE",
    name: "Cut millstone",
    category: "production",
    prerequisites: ["TECH-ARDEN-WATER-WHEEL"],
    capabilities: ["grinds_flour_consistently"],
    knowledgeRequirement: 0.4,
    productionRequirement: 0.5,
    infrastructureRequirement: 0.5,
    note: "The bakery's mill implies stone that keeps its edge.",
  },
  {
    id: "TECH-ARDEN-CONTROLLED-OVEN",
    name: "Controlled bake oven",
    category: "production",
    prerequisites: ["TECH-ARDEN-MILLSTONE"],
    capabilities: ["bakes_to_a_routine"],
    knowledgeRequirement: 0.45,
    productionRequirement: 0.5,
    infrastructureRequirement: 0.4,
    // The bakehouse is already authored as lighting its oven before the second
    // watch, so this is in the slice's present, not its future.
    note: "Already settled: the bakehouse lights its oven before the second watch.",
  },
  {
    id: "TECH-ARDEN-TIDAL-BERTH",
    name: "Dredged tidal berth",
    category: "transport",
    capabilities: ["takes_a_deep_hull"],
    knowledgeRequirement: 0.5,
    productionRequirement: 0.6,
    infrastructureRequirement: 0.7,
    note: "The docks run pilotage, which implies a berth worth piloting to.",
  },
  {
    id: "TECH-ARDEN-LOADING-GAUGE",
    name: "Loading gauge and certification register",
    category: "administrative",
    prerequisites: ["TECH-ARDEN-TIDAL-BERTH"],
    capabilities: ["measures_load", "records_a_credential"],
    knowledgeRequirement: 0.4,
    productionRequirement: 0.3,
    infrastructureRequirement: 0.3,
    // System 41 certifies stevedores and caps crane load; a rule that refers to
    // a measurement is standing on the measurement.
    note: "System 41's rules already refer to this, which is why it is not optional.",
  },
  {
    id: "TECH-ARDEN-MECHANICAL-CRANE",
    name: "Mechanical quay crane",
    category: "transport",
    prerequisites: ["TECH-ARDEN-TIDAL-BERTH", "TECH-ARDEN-LOADING-GAUGE"],
    capabilities: ["unloads_faster_than_a_gang"],
    knowledgeRequirement: 0.55,
    productionRequirement: 0.7,
    infrastructureRequirement: 0.7,
    // Uncrewed crane work is prohibited by the stevedore rule, so cranes are in
    // the slice's authorised world and their absence would be the odd thing.
    note: "Already regulated: System 41 prohibits uncrewed crane work.",
  },
];

/** Registers the slice's technologies. Idempotent by id. */
export function registerAureliaTechnologies(engine: TechnologyEngine, at: WorldTime): void {
  for (const technology of AURELIA_TECHNOLOGIES) {
    engine.registerTechnology(
      {
        id: technology.id,
        name: technology.name,
        category: technology.category,
        knowledgeRequirement: technology.knowledgeRequirement,
        productionRequirement: technology.productionRequirement,
        infrastructureRequirement: technology.infrastructureRequirement,
        ...(technology.prerequisites === undefined
          ? {}
          : { prerequisites: technology.prerequisites }),
        ...(technology.capabilities === undefined ? {} : { capabilities: technology.capabilities }),
        note: `${technology.note ?? ""} ${PROVISIONAL_NOTE}`.trim(),
      },
      at,
    );
  }
}
