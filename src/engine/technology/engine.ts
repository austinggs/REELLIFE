import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { RandomSource } from "../rng/distributions.ts";
import {
  emptyTechnologyState,
  type Adoption,
  type AdoptionConditions,
  type AdoptionDrivers,
  type DiffusionReading,
  type InnovationRecord,
  type InnovationSource,
  type Obsolescence,
  type Readiness,
  type Technology,
  type TechnologyAvailability,
  type TechnologyCategory,
  type TechnologySystemState,
} from "./types.ts";

/**
 * Adoption weights, applied to the conditions the caller supplies.
 *
 * Price and infrastructure lead because a technology nobody can reach or
 * afford is not adopted however willing the people are, and the network effect
 * is last because it is the one factor that changes *over time* rather than
 * describing the subject. Provisional — see docs/CONTENT_GAPS.md.
 */
export const ADOPTION_WEIGHTS = {
  price: 0.2,
  infrastructure: 0.15,
  knowledge: 0.12,
  institutions: 0.08,
  culture: 0.08,
  regulation: 0.07,
  compatibility: 0.1,
  geography: 0.08,
  network: 0.12,
} as const;

export type AdoptionFactor = keyof typeof ADOPTION_WEIGHTS;

export interface RegisterTechnologyRequest {
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

export interface RecordInnovationRequest {
  readonly technologyId: string;
  readonly source: InnovationSource;
  readonly derivedFrom?: readonly string[];
  readonly note?: string;
}

/**
 * The result of offering a technology to one subject.
 *
 * Three outcomes, deliberately distinguishable: `accepted` with
 * `alreadyAdopted` means it was already theirs; `accepted` without it means
 * they took it up now; and `accepted: false` means it was offered and refused,
 * which writes nothing at all — a decline is not a fact about the world.
 */
export interface AdoptionAttempt {
  readonly technologyId: string;
  readonly subjectId: string;
  readonly probability: number;
  readonly roll: number;
  readonly accepted: boolean;
  readonly alreadyAdopted: boolean;
  readonly adoption?: Adoption;
}

export class TechnologyEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;
  private readonly random?: RandomSource;

  constructor(scope: SystemScope, world: WorldState, random?: RandomSource) {
    this.scope = scope;
    this.world = world;
    this.random = random;
    if (!this.world.systems.technology) {
      this.scope.assertOwner("technology");
      this.world.systems.technology = emptyTechnologyState();
    }
  }

  private get state(): TechnologySystemState {
    return this.world.systems.technology as TechnologySystemState;
  }

  private set state(value: TechnologySystemState) {
    this.world.systems.technology = value;
  }

  // ---------------------------------------------------------------- reads ---

  technologies(): readonly Technology[] {
    return this.state.technologies;
  }

  technology(id: string): Technology | undefined {
    return this.state.technologies.find((entry) => entry.id === id);
  }

  requireTechnology(id: string, caller: string): Technology {
    const found = this.technology(id);
    if (found === undefined) {
      throw new Error(`TechnologyEngine.${caller}: unknown technology ${id}`);
    }
    return found;
  }

  /** Everything that lists `id` as a prerequisite — what it is standing on. */
  dependentsOf(id: string): readonly Technology[] {
    return this.state.technologies.filter((entry) => entry.prerequisites.includes(id));
  }

  innovations(): readonly InnovationRecord[] {
    return this.state.innovations;
  }

  adoptions(): readonly Adoption[] {
    return this.state.adoptions;
  }

  adoptionsOf(technologyId: string): readonly Adoption[] {
    return this.state.adoptions.filter((entry) => entry.technologyId === technologyId);
  }

  hasAdopted(technologyId: string, subjectId: string): boolean {
    return this.adoptionsOf(technologyId).some((entry) => entry.subjectId === subjectId);
  }

  obsolescences(): readonly Obsolescence[] {
    return this.state.obsolescences;
  }

  obsolescenceOf(technologyId: string): Obsolescence | undefined {
    return this.state.obsolescences.find((entry) => entry.technologyId === technologyId);
  }

  permission() {
    return this.state.permission;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Whether a technology is usable in this world at this date, and if not, why.
   *
   * Prerequisites are walked transitively and visited in declaration order, so a
   * chain reads the way it was built: the deepest missing link is reported
   * first. A cycle cannot occur through registration (see `registerTechnology`)
   * but is guarded here anyway, because a state loaded from a save file is not
   * something this engine gets to assume was well-formed.
   */
  availability(
    technologyId: string,
    at: WorldTime,
    caller = "availability",
  ): TechnologyAvailability {
    const technology = this.requireTechnology(technologyId, caller);
    const invented = technology.inventedAt <= at;
    const unmet: string[] = [];
    const seen = new Set<string>();
    const walk = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const entry = this.technology(id);
      if (entry === undefined) {
        // A prerequisite nobody has ever heard of is a catalogue error, and it
        // is treated as unmet rather than as satisfied.
        unmet.push(id);
        return;
      }
      if (entry.inventedAt > at) {
        unmet.push(id);
        return;
      }
      for (const prerequisite of entry.prerequisites) walk(prerequisite);
    };
    for (const prerequisite of technology.prerequisites) walk(prerequisite);

    const anachronistic = unmet.length > 0;
    const obsolescence = this.obsolescenceOf(technologyId);
    // Only from the date it was superseded. A technology replaced *next year*
    // is very much available today, and treating it as retired already would
    // erase the present tense of how the slice works — which is exactly what
    // "this is how the quay worked before" needs to stay answerable.
    const retired = obsolescence !== undefined && obsolescence.at <= at;
    return {
      technologyId,
      at,
      invented,
      available: invented && !anachronistic && !retired,
      unmetPrerequisites: unmet,
      anachronistic,
      retired,
      ...(obsolescence?.replacedById === undefined
        ? {}
        : { replacedById: obsolescence.replacedById }),
    };
  }

  /**
   * How likely a subject is to take a technology up, and why.
   *
   * The nine factors are the spec's own list, weighted rather than multiplied
   * so that one absent factor damps the result without annihilating it — a
   * technology adopted in spite of weak regulation is a real thing, and a
   * product of nine numbers would make it impossible to express.
   *
   * Pure: it says what *would* happen and draws nothing.
   */
  adoptionDrivers(
    technologyId: string,
    conditions: AdoptionConditions,
    caller = "adoptionDrivers",
  ): AdoptionDrivers {
    this.requireTechnology(technologyId, caller);
    let total = 0;
    const factors: string[] = [];
    for (const [name, weight] of Object.entries(ADOPTION_WEIGHTS) as readonly (
      | readonly [AdoptionFactor, number]
    )[]) {
      const value = requireRatio(conditions[name], name, caller);
      total += weight * value;
      factors.push(`${name}=${value.toFixed(2)}`);
    }
    return { probability: round4(clamp01(total)), factors };
  }

  /**
   * How far a technology has spread among a population the caller defines.
   *
   * `eligible` is supplied rather than derived because the engine has no claim
   * on who could have adopted something; a diffusion rate is meaningless
   * without a denominator, and inventing one would be the engine guessing at a
   * population that System 45/46 owns.
   */
  diffusion(technologyId: string, eligible: number): DiffusionReading {
    this.requireTechnology(technologyId, "diffusion");
    const population = Math.max(0, Math.floor(eligible));
    const records = this.adoptionsOf(technologyId);
    const times = records.map((entry) => entry.at).sort((a, b) => a - b);
    return {
      technologyId,
      adopters: records.length,
      eligible: population,
      rate: population === 0 ? 0 : round4(clamp01(records.length / population)),
      ...(times.length === 0 ? {} : { firstAdoptionAt: times[0] }),
      ...(times.length === 0 ? {} : { lastAdoptionAt: times[times.length - 1] }),
    };
  }

  /**
   * What stands between one subject and one technology, named.
   *
   * The technology's own three requirements are checked against the matching
   * conditions, and *every* shortfall is listed rather than only the worst — a
   * report that names one blocker at a time makes a subject look ready to three
   * successive readers when it is ready to none.
   */
  readiness(
    technologyId: string,
    subjectId: string,
    conditions: Pick<AdoptionConditions, "knowledge" | "infrastructure">,
  ): Readiness {
    const technology = this.requireTechnology(technologyId, "readiness");
    const blockers: string[] = [];
    if (conditions.knowledge < technology.knowledgeRequirement) {
      blockers.push(`knowledge ${conditions.knowledge.toFixed(2)} < ${technology.knowledgeRequirement}`);
    }
    if (
      conditions.infrastructure < technology.infrastructureRequirement
    ) {
      blockers.push(
        `infrastructure ${conditions.infrastructure.toFixed(2)} < ${technology.infrastructureRequirement}`,
      );
    }
    return {
      technologyId,
      subjectId,
      ready: blockers.length === 0,
      blockers,
      shortfall: round4(
        clamp01(
          Math.max(
            technology.knowledgeRequirement - conditions.knowledge,
            technology.infrastructureRequirement - conditions.infrastructure,
            0,
          ),
        ),
      ),
    };
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Adds a technology to the catalogue. Idempotent by id, like every catalogue
   * in this codebase: re-seeding must not rewrite history.
   *
   * A prerequisite must already be registered. That makes a forward reference —
   * a technology invented before the thing it depends on — a *registration*
   * error rather than a permanent anachronism nobody would notice until someone
   * finally asked whether it was available.
   */
  registerTechnology(request: RegisterTechnologyRequest, at: WorldTime): Technology {
    const existing = this.technology(request.id);
    if (existing !== undefined) return existing;
    for (const prerequisite of request.prerequisites ?? []) {
      if (this.technology(prerequisite) === undefined) {
        throw new Error(
          `TechnologyEngine.registerTechnology: ${request.id} requires ${prerequisite}, ` +
            "which is not in the catalogue",
        );
      }
    }
    this.scope.assertOwner("technology");
    const technology: Technology = {
      id: request.id,
      name: request.name,
      category: request.category,
      inventedAt: at,
      prerequisites: [...(request.prerequisites ?? [])],
      capabilities: [...(request.capabilities ?? [])],
      knowledgeRequirement: requireRatio(
        request.knowledgeRequirement,
        "knowledgeRequirement",
        "registerTechnology",
      ),
      productionRequirement: requireRatio(
        request.productionRequirement,
        "productionRequirement",
        "registerTechnology",
      ),
      infrastructureRequirement: requireRatio(
        request.infrastructureRequirement,
        "infrastructureRequirement",
        "registerTechnology",
      ),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, technologies: [...this.state.technologies, technology] };
    return technology;
  }

  /**
   * Records how a technology came to be.
   *
   * Innovation is not the same as invention: a technology can be defined and
   * then *arrive* later, from a source that has a name. A `recombination` must
   * say what it was made out of, because "we combined two things" without
   * naming them is how a technology ends up with no antecedents and therefore
   * no prerequisites.
   */
  recordInnovation(
    request: RecordInnovationRequest,
    at: WorldTime,
    ids: IdAllocator,
  ): InnovationRecord {
    this.requireTechnology(request.technologyId, "recordInnovation");
    if (request.source === "recombination" && (request.derivedFrom?.length ?? 0) === 0) {
      throw new Error(
        "TechnologyEngine.recordInnovation: a recombination must name what it was " +
          "recombined from",
      );
    }
    this.scope.assertOwner("technology");
    const record: InnovationRecord = {
      id: `inn-${ids.next("activity")}`,
      technologyId: request.technologyId,
      at,
      source: request.source,
      ...(request.derivedFrom === undefined ? {} : { derivedFrom: [...request.derivedFrom] }),
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = { ...this.state, innovations: [...this.state.innovations, record] };
    return record;
  }

  /**
   * Offers a technology to a subject, draws for it, and records the outcome.
   *
   * Returns an *attempt* rather than an adoption, because "declined" and
   * "already owns one" and "took it up" are three different facts and returning
   * a record in the first case would write a lie into the world.
   *
   * Two refusals, both deliberate: an unavailable technology cannot be adopted
   * (a world holding a quiet anachronism is exactly what the prerequisite chain
   * exists to prevent), and the roll is refused without an injected source
   * rather than taken from ambient randomness.
   */
  adopt(
    technologyId: string,
    subjectId: string,
    at: WorldTime,
    conditions: AdoptionConditions,
    note?: string,
  ): AdoptionAttempt {
    if (this.random === undefined) {
      throw new Error(
        "TechnologyEngine.adopt: no RandomSource was injected. Pass the world's " +
          "RNG stream, or use adoptionDrivers() to ask what would happen.",
      );
    }
    const check = this.availability(technologyId, at, "adopt");
    if (!check.available) {
      const why = check.unmetPrerequisites.length > 0
        ? `unmet prerequisites: ${check.unmetPrerequisites.join(", ")}`
        : check.retired
          ? "it has been superseded"
          : "it has not been invented yet";
      throw new Error(
        `TechnologyEngine.adopt: ${technologyId} is not available at this time (${why})`,
      );
    }
    const { probability } = this.adoptionDrivers(technologyId, conditions, "adopt");
    const roll = this.random.nextFloat();
    const base = { technologyId, subjectId, probability, roll };
    const existing = this.adoptionsOf(technologyId).find((e) => e.subjectId === subjectId);
    if (existing !== undefined) {
      return { ...base, accepted: true, alreadyAdopted: true, adoption: existing };
    }
    if (roll >= probability) {
      return { ...base, accepted: false, alreadyAdopted: false };
    }
    this.scope.assertOwner("technology");
    const record: Adoption = {
      technologyId,
      subjectId,
      at,
      ...(note === undefined ? {} : { note }),
    };
    this.state = { ...this.state, adoptions: [...this.state.adoptions, record] };
    return { ...base, accepted: true, alreadyAdopted: false, adoption: record };
  }

  /**
   * Records that a technology has been superseded.
   *
   * The technology stays in the catalogue with its history, because "this is how
   * the quay worked before" is only answerable if what came before is still on
   * file.
   */
  supersede(
    technologyId: string,
    at: WorldTime,
    reason: string,
    replacedById?: string,
  ): Obsolescence {
    const existing = this.obsolescenceOf(technologyId);
    if (existing !== undefined) return existing;
    this.requireTechnology(technologyId, "supersede");
    if (replacedById !== undefined) {
      this.requireTechnology(replacedById, "supersede");
    }
    this.scope.assertOwner("technology");
    const record: Obsolescence = {
      technologyId,
      at,
      reason,
      ...(replacedById === undefined ? {} : { replacedById }),
    };
    this.state = { ...this.state, obsolescences: [...this.state.obsolescences, record] };
    return record;
  }

  /**
   * Grants or revokes permission to run ahead of the historical sequence.
   *
   * Requires a reason either way. A world that has switched off its own
   * anachronism checks is a world whose timeline has become a scenario decision,
   * and the next reader should learn that in one line rather than by auditing
   * every availability call.
   */
  setAnachronyPermission(enabled: boolean, reason: string): void {
    if (reason.trim().length === 0) {
      throw new Error(
        "TechnologyEngine.setAnachronyPermission: a reason is required, because this " +
          "changes what the world is allowed to contain",
      );
    }
    this.scope.assertOwner("technology");
    this.state = { ...this.state, permission: { enabled, reason } };
  }

  serialize(): TechnologySystemState {
    return this.state;
  }
}

function requireRatio(value: number, field: string, caller: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`TechnologyEngine.${caller}: ${field} must be 0..1, received ${value}`);
  }
  return value;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
