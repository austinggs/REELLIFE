/**
 * ReelLife save migrations (M8, System 06).
 *
 * Migrations are explicit rather than silent: a save that cannot be migrated to
 * the running engine is refused with an explanation. Changing the meaning of an
 * old save without recording how is exactly the class of bug that destroys
 * continuity across generations.
 *
 * The registry is empty in M1 and gained its first real entry in M8, because
 * M7 was the first milestone to change a save-visible shape. That entry is
 * `V1_TO_V2_CONTINUITY_LIFECYCLE` below, and it is written from the *actual*
 * v1 shape rather than a guess: v1's `systems.continuity` was exactly
 * `{ statuses, deaths }`, and v2 added five more collections. Filling them with
 * empty values is the honest migration — a v1 world genuinely had no
 * determinations, no estates and no heirs, and inventing any of them would be
 * fabricating a history that never happened.
 */

import { FORMAT_VERSION, type ReelBody, type ReelFile } from "./format.ts";
import { canonicalJson, checksum32Hex } from "../rng/hash.ts";

export interface SaveMigration {
  /** Simulation version this migration upgrades from. */
  readonly from: number;
  /** Simulation version this migration upgrades to. */
  readonly to: number;
  readonly description: string;
  migrate(body: ReelBody): ReelBody;
}


export class MigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationError";
  }
}

export class MigrationRegistry {
  private readonly migrations: SaveMigration[] = [];

  register(migration: SaveMigration): void {
    if (migration.to !== migration.from + 1) {
      throw new MigrationError(
        `Migration ${migration.from}->${migration.to} must advance exactly one version`,
      );
    }
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.from - b.from);
  }

  list(): readonly SaveMigration[] {
    return this.migrations;
  }

  /** Returns the ordered migration path, or null when none exists. */
  path(from: number, to: number): SaveMigration[] | null {
    if (from === to) return [];
    if (to < from) return null;
    const steps: SaveMigration[] = [];
    let current = from;
    while (current < to) {
      const step = this.migrations.find((migration) => migration.from === current);
      if (!step) return null;
      steps.push(step);
      current = step.to;
    }
    return steps;
  }

  migrate(file: ReelFile, targetSimulationVersion: number): ReelFile {
    const from = file.header.simulationVersion;
    if (from === targetSimulationVersion) return file;

    const steps = this.path(from, targetSimulationVersion);
    if (steps === null) {
      throw new MigrationError(
        `No migration path from simulation version ${from} to ${targetSimulationVersion}. ` +
          "The save cannot be loaded by this engine version.",
      );
    }

    let body = file.body;
    for (const step of steps) {
      body = step.migrate(body);
    }

    // The checksum covers the body, and the body just changed, so it has to be
    // recomputed here. Leaving the original checksum in place would produce a
    // file that is *correct* but that `validateHeader` rejects as corrupt —
    // which reads as "migration broke the save" and is the single most
    // confusing failure this file could have.
    return {
      header: {
        ...file.header,
        simulationVersion: targetSimulationVersion,
        checksum: checksum32Hex(canonicalJson(body)),
      },
      body,
    };
  }
}


/**
 * The v1 -> v2 continuity migration.
 *
 * v1 recorded a lifecycle and a list of deaths. v2 (M7) added determinations,
 * records, control transfers, testaments and estates. Every added collection
 * becomes an empty list.
 *
 * What is deliberately *not* done here: inferring a determination from a v1
 * death, or inventing an estate. A v1 world had deaths that were never
 * determined, and that is the truth about it. A migration that manufactured the
 * missing history would be the most dangerous kind of bug in a save system —
 * invisible, and a lie that the rest of the engine would then treat as canon.
 */
export const V1_TO_V2_CONTINUITY_LIFECYCLE: SaveMigration = {
  from: 1,
  to: 2,
  description:
    "backfill the five continuity collections M7 added (determinations, records, controlTransfers, testaments, estates) with empty values",
  migrate(body: ReelBody): ReelBody {
    const world = body.world;
    if (typeof world !== "object" || world === null || Array.isArray(world)) return body;
    const record = world as Record<string, unknown>;
    const systems = record.systems;
    if (typeof systems !== "object" || systems === null || Array.isArray(systems)) return body;

    const systemBag = systems as Record<string, unknown>;
    const continuity = systemBag.continuity;
    if (typeof continuity !== "object" || continuity === null || Array.isArray(continuity)) {
      // A v1 world with no deaths at all may have no continuity slot either.
      // v2 still expects one, so it is created empty rather than left absent.
      systemBag.continuity = {
        statuses: {},
        deaths: [],
        determinations: [],
        records: [],
        controlTransfers: [],
        testaments: [],
        estates: [],
      };
      return { world: { ...record, systems: systemBag } };
    }

    const legacy = continuity as Record<string, unknown>;
    const migrated = {
      statuses: legacy.statuses ?? {},
      deaths: Array.isArray(legacy.deaths) ? legacy.deaths : [],
      determinations: [],
      records: [],
      controlTransfers: [],
      testaments: [],
      estates: [],
    };
    systemBag.continuity = migrated;
    return { world: { ...record, systems: systemBag } };
  },
};

/**
 * A registry preloaded with every known migration, oldest first.
 *
 * Exposed as a factory rather than a shared singleton so a test can build a
 * registry that deliberately lacks a step and assert that loading such a save is
 * *refused* — the failure path matters as much as the happy one.
 */
export function createMigrationRegistry(extra: readonly SaveMigration[] = []): MigrationRegistry {
  const registry = new MigrationRegistry();
  registry.register(V1_TO_V2_CONTINUITY_LIFECYCLE);
  for (const migration of extra) registry.register(migration);
  return registry;
}

export const FORMAT_VERSION_SUPPORTED = FORMAT_VERSION;
