/**
 * ReelLife save migrations (System 06).
 *
 * Migrations are explicit rather than silent: a save that cannot be migrated to
 * the running engine is refused with an explanation. Changing the meaning of an
 * old save without recording how is exactly the class of bug that destroys
 * continuity across generations.
 */

import { FORMAT_VERSION, type ReelBody, type ReelFile } from "./format.ts";

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

    return {
      header: { ...file.header, simulationVersion: targetSimulationVersion },
      body,
    };
  }
}

export const FORMAT_VERSION_SUPPORTED = FORMAT_VERSION;
