/**
 * M8 — save migrations with fixtures (System 06).
 *
 * A migration registry with nothing registered is not a migration system, and a
 * migration that has never been run against a *real* old save is a guess. These
 * tests do both: they run the v1 fixture — hand-authored from the v1 contract in
 * `tests/fixtures/reel/v1Save.ts` — through the registry and assert what the
 * loaded world then contains.
 *
 * The failure paths matter as much as the happy one, and they are the ones that
 * would hurt a player: a save with no migration path must be *refused* with an
 * explanation rather than loaded partially.
 */

import { describe, expect, it } from "vitest";
import {
  MigrationError,
  MigrationRegistry,
  V1_TO_V2_CONTINUITY_LIFECYCLE,
  createMigrationRegistry,
  type SaveMigration,
} from "../../src/engine/persistence/migrations.ts";
import { SIMULATION_VERSION } from "../../src/engine/config/defaults.ts";
import { validateHeader, assertValidReelFile, checksumOf } from "../../src/engine/persistence/validate.ts";
import { checksum32Hex, canonicalJson } from "../../src/engine/rng/hash.ts";
import { LifeContinuityEngine } from "../../src/engine/continuity/engine.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { v1Fixture, V1_FIXTURE_BODY } from "../fixtures/reel/v1Save.ts";
import type { ReelFile } from "../../src/engine/persistence/format.ts";

function continuityOf(file: ReelFile): Record<string, unknown> {
  const world = file.body.world as Record<string, unknown>;
  const systems = world.systems as Record<string, unknown>;
  return systems.continuity as Record<string, unknown>;
}

describe("save migrations (M8)", () => {
  it("the registry ships with a real migration, and the current version needs none", () => {
    const registry = createMigrationRegistry();
    expect(registry.list()).toContain(V1_TO_V2_CONTINUITY_LIFECYCLE);
    expect(registry.list()).toHaveLength(1);
    // A save already at the current version needs no steps at all.
    expect(registry.path(SIMULATION_VERSION, SIMULATION_VERSION)).toEqual([]);
  });

  it("refuses a migration that does not advance exactly one version", () => {
    const registry = new MigrationRegistry();
    const skipping: SaveMigration = {
      from: 1,
      to: 3,
      description: "skips a version",
      migrate: (body) => body,
    };
    expect(() => registry.register(skipping)).toThrow(MigrationError);
    expect(() => registry.register(skipping)).toThrow(/exactly one version/);
  });

  it("computes the migration path in order, and returns null when it cannot", () => {
    const registry = createMigrationRegistry();
    const steps = registry.path(1, 2);
    expect(steps).toHaveLength(1);
    expect(steps?.[0]).toBe(V1_TO_V2_CONTINUITY_LIFECYCLE);
    // There is no path forward from a version nothing has been written for.
    expect(registry.path(0, 2)).toBeNull();
    // And migrations never run backwards.
    expect(registry.path(2, 1)).toBeNull();
  });

  it("the v1 fixture is a valid v1 save before anything is done to it", () => {
    const file = v1Fixture();
    expect(file.header.simulationVersion).toBe(1);
    // The fixture's own integrity data must be right, or it proves nothing.
    expect(file.header.checksum).toBe(checksum32Hex(canonicalJson(file.body)));
    expect(validateHeader(file.header)).toEqual([]);
  });

  it("v1 continuity really is only two collections", () => {
    // If this ever stops being true, the migration is no longer grounded in the
    // real v1 contract and has to be rewritten rather than trusted.
    const continuity = continuityOf(v1Fixture());
    expect(Object.keys(continuity).sort()).toEqual(["deaths", "statuses"]);
    expect(continuity.deaths).toHaveLength(1);
  });

  it("migrates the v1 fixture to the current version", () => {
    const migrated = createMigrationRegistry().migrate(v1Fixture(), SIMULATION_VERSION);
    expect(migrated.header.simulationVersion).toBe(SIMULATION_VERSION);
    // The header checksum must cover the *new* body, or the migrated save is
    // correct but reads as corrupt.
    expect(migrated.header.checksum).toBe(checksum32Hex(canonicalJson(migrated.body)));
    expect(checksumOf(migrated.body)).toBe(migrated.header.checksum);
    expect(validateHeader(migrated.header)).toEqual([]);
    expect(() => assertValidReelFile(migrated)).not.toThrow();
  });

  it("adds the five M7 collections empty, and preserves what v1 recorded", () => {
    const migrated = createMigrationRegistry().migrate(v1Fixture(), SIMULATION_VERSION);
    const continuity = continuityOf(migrated);

    // The v1 facts survive untouched, including the lifecycle statuses.
    expect(continuity.statuses).toEqual({ "PER-000001": "historical", "PER-000002": "active" });
    const v1Deaths = (
      (V1_FIXTURE_BODY.world as { systems: { continuity: { deaths: unknown } } }).systems
        .continuity.deaths
    );
    expect(continuity.deaths).toEqual(v1Deaths);

    // The new collections are present and empty. A v1 world genuinely had no
    // determinations, no estates and no heirs, and inventing any would be
    // fabricating a history that never happened.
    expect(continuity.determinations).toEqual([]);
    expect(continuity.records).toEqual([]);
    expect(continuity.controlTransfers).toEqual([]);
    expect(continuity.testaments).toEqual([]);
    expect(continuity.estates).toEqual([]);
  });

  it("the migrated world loads into the engine and reads as the v1 world did", () => {
    const migrated = createMigrationRegistry().migrate(v1Fixture(), SIMULATION_VERSION);
    const world = { systems: (migrated.body.world as { systems: Record<string, unknown> }).systems };
    const continuity = LifeContinuityEngine.peek(permissiveScope(), world as never);

    // The deceased ancestor is still historical, and still dead: the migration
    // preserved the lifecycle rather than resetting it.
    const ancestor = "PER-000001" as never;
    expect(continuity.statusOf(ancestor)).toBe("historical");
    expect(continuity.deathOf(ancestor)).toMatchObject({ cause: "old age" });
    // And the successor the v1 file never mentioned is still active.
    expect(continuity.statusOf("PER-000002" as never)).toBe("active");
    // No determination, because v1 had none. It is not invented on load.
    expect(continuity.determinationOf(ancestor)).toBeUndefined();
  });

  it("a v1 world with no continuity slot at all still migrates into a valid one", () => {
    const bare: ReelFile = {
      ...v1Fixture(),
      body: { world: { systems: { identity: { persons: [] } } } },
    };
    const migrated = createMigrationRegistry().migrate(bare, SIMULATION_VERSION);
    const continuity = continuityOf(migrated);
    expect(continuity.statuses).toEqual({});
    expect(continuity.deaths).toEqual([]);
    expect(continuity.estates).toEqual([]);
    expect(migrated.header.checksum).toBe(checksum32Hex(canonicalJson(migrated.body)));
  });

  it("refuses a save it cannot migrate, and says why", () => {
    const future = { ...v1Fixture(), header: { ...v1Fixture().header, simulationVersion: 99 } };
    expect(() => createMigrationRegistry().migrate(future, SIMULATION_VERSION)).toThrow(
      MigrationError,
    );
    expect(() => createMigrationRegistry().migrate(future, SIMULATION_VERSION)).toThrow(
      /No migration path from simulation version 99/,
    );
  });

  it("refuses a save whose step is missing, rather than loading it partially", () => {
    // A registry deliberately missing the v1->v2 step. This is the failure a
    // player would hit after an incomplete release, and it must be loud.
    const incomplete = new MigrationRegistry();
    const old = v1Fixture();
    expect(() => incomplete.migrate(old, SIMULATION_VERSION)).toThrow(MigrationError);
  });

  it("leaves an already-current save byte-identical", () => {
    const current: ReelFile = {
      ...v1Fixture(),
      header: { ...v1Fixture().header, simulationVersion: SIMULATION_VERSION },
    };
    const out = createMigrationRegistry().migrate(current, SIMULATION_VERSION);
    // No steps means no rewrite: the same object comes back.
    expect(out).toBe(current);
  });

  it("migration is idempotent: migrating twice changes nothing more", () => {
    const registry = createMigrationRegistry();
    const once = registry.migrate(v1Fixture(), SIMULATION_VERSION);
    const twice = registry.migrate(once, SIMULATION_VERSION);
    expect(twice.body).toBe(once.body);
    expect(canonicalJson(twice.body)).toBe(canonicalJson(once.body));
  });
});
