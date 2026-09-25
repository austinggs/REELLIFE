import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { TIME_COMMAND_TYPES } from "../../src/engine/commands/builtin/timeCommands.ts";
import {
  MissingWriterContextError,
  OwnershipGuard,
  OwnershipViolationError,
  permissiveScope,
} from "../../src/engine/core/access.ts";
import { guardWorldState } from "../../src/engine/core/worldState.ts";
import type { SharedState, WorldState } from "../../src/engine/core/worldState.ts";
import { SYSTEM_IDS } from "../../src/engine/core/ownership.ts";
import { EntitiesActivityProbe } from "./probe.ts";

/** View used to drive the runtime guard on the readonly `shared` section. */
type SharedWriter = { shared: SharedState };

describe("ownership guard (System 01, architectural law 1)", () => {
  it("allows a system to write the section it owns", () => {
    const simulation = createKernelSimulation({
      masterSeed: "reellife-ownership-seed",
      checkInvariants: false,
    });
    expect(() => {
      simulation.guard.mutate("core", () => {
        (simulation.world as SharedWriter).shared = {
          ...simulation.world.shared,
          notes: ["audited"],
        };
      });
    }).not.toThrow();
    expect(simulation.world.shared.notes).toEqual(["audited"]);
  });

  it("rejects a system writing a section owned by another system", () => {
    const simulation = createKernelSimulation({
      masterSeed: "reellife-ownership-seed",
      checkInvariants: false,
    });
    expect(() =>
      simulation.guard.mutate("needs", () => {
        (simulation.world as SharedWriter).shared = {
          ...simulation.world.shared,
          notes: ["not mine"],
        };
      }),
    ).toThrow(OwnershipViolationError);
  });

  it("records the violation for observability instead of failing silently", () => {
    const guard = new OwnershipGuard();
    guard.enforce = false;
    guard.mutate("needs", () => {
      guard.checkWrite("systems.weather");
    });
    expect(guard.recordedViolations).toHaveLength(1);
    expect(guard.recordedViolations[0]?.message).toMatch(/owned by "weather"/);
  });

  it("rejects any write that happens outside a system context", () => {
    const state: WorldState = {
      meta: {
        worldId: "WORLD-TEST",
        worldName: "Test",
        schemaVersion: 1,
        simulationVersion: 1,
        contentVersion: "test",
        rngVersion: 1,
        createdAtLabel: "test",
        startTime: 0 as never,
        generation: 1,
        mode: "standard",
        difficulty: "standard",
        masterSeed: "master-seed-0001",
      },
      shared: { idAllocator: { counters: {} }, notes: [] },
      config: {} as never,
      systems: {},
    };
    const guard = new OwnershipGuard();
    const guarded = guardWorldState(state, guard);

    // This is the protection that stops presentation code from mutating truth.
    expect(() => {
      guarded.systems.needs = { hacked: true };
    }).toThrow(MissingWriterContextError);

    expect(() => {
      guard.mutate("needs", () => {
        guarded.systems.needs = { ok: true };
      });
    }).not.toThrow();
  });

  it("rejects nested mutation scopes because they hide the real writer", () => {
    const guard = new OwnershipGuard();
    guard.mutate("core", () => {
      expect(() => guard.mutate("needs", () => undefined)).toThrow(/Nested mutation scope/);
    });
  });

  it("lets a system write an explicitly granted additional section", () => {
    const guard = new OwnershipGuard();
    guard.allowAdditionalWrite("observability", "history");
    expect(() => {
      guard.mutate("observability", () => guard.checkWrite("history"));
    }).not.toThrow();
  });

  it("exposes the active writer while a mutation is in progress", () => {
    const guard = new OwnershipGuard();
    expect(guard.writer).toBeNull();
    guard.mutate("markets", () => {
      expect(guard.writer).toBe("markets");
    });
    expect(guard.writer).toBeNull();
  });

  it("polices engine-held state through the system scope", () => {
    const guard = new OwnershipGuard();
    const probe = new EntitiesActivityProbe(guard);

    // The activities engine owns its own state, so an unrelated system cannot
    // mutate it even though the state is not inside the proxied world object.
    expect(() => guard.mutate("needs", () => probe.touch())).toThrow(OwnershipViolationError);
    expect(() => guard.mutate("activities", () => probe.touch())).not.toThrow();
    expect(() => probe.touch()).toThrow(MissingWriterContextError);
  });

  it("permits a permissive scope for tests and headless tools", () => {
    const scope = permissiveScope();
    expect(() => scope.assertOwner("needs")).not.toThrow();
  });

  it("keeps the command log owned by the core", () => {
    const simulation = createKernelSimulation({
      masterSeed: "reellife-ownership-seed",
      checkInvariants: false,
    });
    expect(() => simulation.commandLog.mintId()).toThrow(MissingWriterContextError);
    expect(() => simulation.guard.mutate("core", () => simulation.commandLog.mintId())).not.toThrow();
  });

  it("confirms command types declare a valid owning system", () => {
    const simulation = createKernelSimulation({
      masterSeed: "reellife-ownership-seed",
      checkInvariants: false,
    });
    const owners = simulation.registry.byOwner();
    expect(Object.keys(owners).sort()).toEqual(
      ["employment", "finance", "housing", "inventory", "needs", "time"],
    );
    expect(owners.time).toContain(TIME_COMMAND_TYPES.setSpeed);
    // Every declared owner must be an approved system id.
    for (const owner of Object.keys(owners)) {
      expect(SYSTEM_IDS).toContain(owner);
    }
  });
});
