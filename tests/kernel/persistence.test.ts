import { describe, expect, it } from "vitest";
import {
  MemorySaveStore,
  SaveNotFoundError,
  slotInfoOf,
} from "../../src/engine/persistence/store.ts";
import { MigrationError, MigrationRegistry } from "../../src/engine/persistence/migrations.ts";
import {
  SaveValidationError,
  assertValidReelFile,
  checksumOf,
  validateReelFile,
} from "../../src/engine/persistence/validate.ts";
import { FORMAT_VERSION, REEL_FORMAT, type ReelFile } from "../../src/engine/persistence/format.ts";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { addTime, days } from "../../src/engine/primitives/time.ts";

function sampleFile(): ReelFile {
  const sim = createKernelSimulation({
    masterSeed: "reellife-persistence-seed",
    checkInvariants: false,
  });
  sim.advanceTo(addTime(sim.clock.time, days(2)));
  return sim.toSave("sample", "unit test");
}

describe(".reel format and integrity (System 06)", () => {
  it("writes a canonical header naming every version", () => {
    const file = sampleFile();
    expect(file.header.format).toBe(REEL_FORMAT);
    expect(file.header.formatVersion).toBe(FORMAT_VERSION);
    expect(file.header.saveId).toBe("SAVE-sample-2880");
    expect(file.header.stepIndex).toBe(2_880);
    expect(file.header.worldDateLabel).toBe("3 January 2042");
    expect(file.header.contentVersion.length).toBeGreaterThan(0);
    expect(file.header.commandCount).toBe(0);
  });

  it("accepts a well-formed document", () => {
    expect(validateReelFile(sampleFile())).toHaveLength(0);
  });

  it("rejects a bad checksum", () => {
    const file = sampleFile();
    const tampered: ReelFile = { header: { ...file.header, checksum: "deadbeef" }, body: file.body };
    const issues = validateReelFile(tampered);
    expect(issues.some((issue) => issue.code === "checksum_mismatch")).toBe(true);
    expect(() => assertValidReelFile(tampered)).toThrow(SaveValidationError);
  });

  it("detects tampering with the saved body", () => {
    const file = sampleFile();
    const mutated: ReelFile = {
      header: file.header,
      body: JSON.parse(JSON.stringify(file.body).replace('"generation":1', '"generation":9')) as ReelFile["body"],
    };
    expect(validateReelFile(mutated).some((issue) => issue.code === "checksum_mismatch")).toBe(true);
  });

  it("reports a simulation-version mismatch instead of loading blindly", () => {
    const file = sampleFile();
    const issues = validateReelFile(file, { simulationVersion: 99, rngVersion: 1 });
    expect(issues.some((issue) => issue.code === "simulation_version_mismatch")).toBe(true);
    expect(() => assertValidReelFile(file, { simulationVersion: 99, rngVersion: 1 })).toThrow(
      /migration is required/,
    );
  });

  it("reports an RNG-version mismatch", () => {
    const issues = validateReelFile(sampleFile(), { simulationVersion: 1, rngVersion: 2 });
    expect(issues.some((issue) => issue.code === "rng_version_mismatch")).toBe(true);
  });

  it("rejects documents that are not saves at all", () => {
    expect(validateReelFile(null)[0]?.code).toBe("not_a_save");
    expect(validateReelFile({ header: {}, body: {} })[0]?.severity).toBe("error");
  });

  it("computes a stable checksum over the canonical body", () => {
    const file = sampleFile();
    expect(checksumOf(file.body)).toBe(file.header.checksum);
  });
});

describe("save storage (System 06)", () => {
  it("writes, lists, reads and deletes slots", async () => {
    const store = new MemorySaveStore();
    const file = sampleFile();

    expect(await store.has("slot-1")).toBe(false);
    const info = await store.write("slot-1", file);
    expect(info.slotName).toBe("slot-1");
    expect(info.sizeBytes).toBeGreaterThan(0);
    expect(await store.has("slot-1")).toBe(true);

    expect((await store.listSlots()).map((slot) => slot.slotName)).toEqual(["slot-1"]);
    expect((await store.read("slot-1"))?.header.checksum).toBe(file.header.checksum);

    await store.delete("slot-1");
    expect(await store.read("slot-1")).toBeNull();
    expect(await store.listSlots()).toHaveLength(0);
  });

  it("surfaces corruption rather than repairing it silently", async () => {
    const store = new MemorySaveStore();
    await store.write("slot-1", sampleFile());
    store.corrupt("slot-1", (text) => text.replace('"generation":1', '"generation":4'));
    await expect(store.read("slot-1")).rejects.toThrow(/failed validation/);
  });

  it("refuses to corrupt a slot that does not exist", () => {
    const store = new MemorySaveStore();
    expect(() => store.corrupt("nope", (text) => text)).toThrow(SaveNotFoundError);
  });

  it("describes a slot for the save/load screen", () => {
    const info = slotInfoOf("slot-9", sampleFile(), 123);
    expect(info.worldName).toBe("Aurelia");
    expect(info.generation).toBe(1);
    expect(info.formatVersion).toBe(FORMAT_VERSION);
    expect(info.sizeBytes).toBe(123);
  });
});

describe("save migrations (System 06)", () => {
  function registryWithPath(): MigrationRegistry {
    const registry = new MigrationRegistry();
    registry.register({
      from: 1,
      to: 2,
      description: "add a marker",
      migrate: (body) => ({ ...body, migratedAt: 2 }),
    });
    registry.register({
      from: 2,
      to: 3,
      description: "advance the marker",
      migrate: (body) => ({ ...body, migratedAt: 3 }),
    });
    return registry;
  }

  it("migrates a body forward through an explicit path", () => {
    const registry = registryWithPath();
    expect(registry.path(1, 3)).toHaveLength(2);

    const file = sampleFile();
    const migrated = registry.migrate(
      { header: { ...file.header, simulationVersion: 1 }, body: file.body },
      3,
    );
    expect(migrated.header.simulationVersion).toBe(3);
    expect((migrated.body as unknown as Record<string, unknown>).migratedAt).toBe(3);
  });

  it("refuses to guess when no migration path exists", () => {
    const registry = registryWithPath();
    const file = sampleFile();
    expect(() =>
      registry.migrate({ header: { ...file.header, simulationVersion: 1 }, body: file.body }, 5),
    ).toThrow(MigrationError);
    expect(() =>
      registry.migrate({ header: { ...file.header, simulationVersion: 3 }, body: file.body }, 2),
    ).toThrow(/No migration path/);
  });

  it("requires migrations to advance exactly one version", () => {
    const registry = new MigrationRegistry();
    expect(() =>
      registry.register({ from: 1, to: 3, description: "skip", migrate: (body) => body }),
    ).toThrow(/exactly one version/);
  });

  it("treats a same-version save as already migrated", () => {
    const registry = registryWithPath();
    const file = sampleFile();
    expect(registry.migrate(file, file.header.simulationVersion)).toBe(file);
  });
});
