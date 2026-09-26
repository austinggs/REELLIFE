/**
 * M3 — debug console (System 57; UI/UX 22).
 *
 * The console is the one surface allowed to show authoritative state, and the
 * one surface where a mistake becomes a state change. These tests pin its two
 * contracts: reads never mutate, and mutations always travel through the
 * command pipeline with an audited origin rather than reaching into state.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import { parseConsoleInput } from "../../src/engine/console/parser.ts";
import { executeConsoleInstruction } from "../../src/engine/console/execute.ts";
import {
  getCommandLogView,
  getEntityInspectorView,
  getLifeSituation,
} from "../../src/engine/query/lifeViews.ts";
import { getClockView } from "../../src/engine/query/projections.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-m3-console";

function world(): { sim: Simulation; playerId: string } {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true, seedSlice: true });
  return { sim, playerId: seedPlayableSlice(sim).playerId };
}

function hungerLevel(sim: Simulation, personId: string): number {
  const needs = sim.world.systems.needs as {
    readonly persons: readonly {
      readonly personId: string;
      readonly needs: readonly { readonly kind: string; readonly level: number }[];
    }[];
  };
  const entry = needs.persons.find((person) => person.personId === personId);
  return entry?.needs.find((need) => need.kind === "hunger")?.level ?? -1;
}

describe("console parsing (System 57)", () => {
  it("separates reads from dispatches", () => {
    const { sim } = world();

    const read = parseConsoleInput("time", sim.registry);
    expect(read.kind).toBe("read");

    const entity = parseConsoleInput(`entity ${M2_SETTLEMENT_ID}`, sim.registry);
    expect(entity.kind).toBe("read");
    if (entity.kind === "read") expect(entity.argument).toBe(M2_SETTLEMENT_ID);

    const dispatch = parseConsoleInput("time.set_speed speed=100", sim.registry);
    expect(dispatch.kind).toBe("command");
    if (dispatch.kind === "command") {
      expect(dispatch.commandType).toBe("time.set_speed");
      expect(dispatch.params).toEqual({ speed: 100 });
    }
  });

  it("types parameters explicitly and allows quoted values with spaces", () => {
    const { sim } = world();
    const named = parseConsoleInput('world.save slotName="evening run"', sim.registry);
    expect(named.kind).toBe("command");
    if (named.kind === "command") expect(named.params).toEqual({ slotName: "evening run" });

    const quotedNumber = parseConsoleInput('world.save slotName="4"', sim.registry);
    if (quotedNumber.kind === "command") expect(quotedNumber.params).toEqual({ slotName: "4" });

    const bare = parseConsoleInput("time.set_speed 100", sim.registry);
    expect(bare.kind).toBe("error");
    if (bare.kind === "error") expect(bare.message).toContain("key=value");
  });

  it("reports unknown input with suggestions and treats blank input as empty", () => {
    const { sim } = world();
    const unknown = parseConsoleInput("time.set_speeed speed=100", sim.registry);
    expect(unknown.kind).toBe("error");
    if (unknown.kind === "error") {
      expect(unknown.suggestions.length).toBeGreaterThan(0);
      expect(unknown.suggestions.some((type) => type.startsWith("time."))).toBe(true);
    }
    expect(parseConsoleInput("   ", sim.registry).kind).toBe("empty");
  });
});

describe("console authority (System 57)", () => {
  it("lets a player read but refuses to mutate on their behalf", () => {
    const { sim, playerId } = world();
    const actorId = asEntityId<"person">(playerId);

    const read = executeConsoleInstruction(sim, parseConsoleInput("state", sim.registry), {
      actorId,
      authority: "player",
    });
    expect(read.status).toBe("ok");
    expect(read.lines.some((line) => line.kind === "read")).toBe(true);

    const denied = executeConsoleInstruction(
      sim,
      parseConsoleInput("time.set_speed speed=100", sim.registry),
      { actorId, authority: "player" },
    );
    expect(denied.status).toBe("denied");
    // Nothing was dispatched, so nothing changed and nothing was logged.
    expect(getClockView(sim).speed).toBe(1);
    expect(getCommandLogView(sim)).toHaveLength(0);
  });

  it("dispatches debug mutations through the pipeline and audits the origin", () => {
    const { sim, playerId } = world();
    const actorId = asEntityId<"person">(playerId);

    const result = executeConsoleInstruction(
      sim,
      parseConsoleInput("time.set_speed speed=100", sim.registry),
      { actorId, authority: "debug" },
    );

    expect(result.status).toBe("ok");
    expect(result.commandResult?.status).toBe("applied");
    expect(getClockView(sim).speed).toBe(100);

    const log = getCommandLogView(sim, { limit: 5 });
    expect(log[0]?.type).toBe("time.set_speed");
    expect(log[0]?.origin).toBe("console");
    expect(log[0]?.actor).toBe(playerId);
  });

  it("changes needs only through the pipeline, and the reads agree", () => {
    const { sim, playerId } = world();
    const actorId = asEntityId<"person">(playerId);
    const before = hungerLevel(sim, playerId);

    const result = executeConsoleInstruction(sim, parseConsoleInput("person.eat", sim.registry), {
      actorId,
      authority: "debug",
    });

    expect(result.status).toBe("ok");
    expect(hungerLevel(sim, playerId)).toBeGreaterThan(before);
    expect(
      getLifeSituation(sim, actorId).needs.find((need) => need.kind === "hunger")?.level,
    ).toBeGreaterThan(before);
  });

  it("refuses to attribute a command when no person is acting", () => {
    const { sim } = world();
    const result = executeConsoleInstruction(
      sim,
      parseConsoleInput("time.set_speed speed=100", sim.registry),
      { actorId: null, authority: "debug" },
    );
    expect(result.status).toBe("denied");
    expect(getCommandLogView(sim)).toHaveLength(0);
  });

  it("refuses an unregistered command type instead of inventing one", () => {
    const { sim, playerId } = world();
    const parsed = parseConsoleInput("person.fly", sim.registry);
    expect(parsed.kind).toBe("error");
    const result = executeConsoleInstruction(sim, parsed, {
      actorId: asEntityId<"person">(playerId),
      authority: "debug",
    });
    expect(result.status).toBe("error");
    expect(getCommandLogView(sim)).toHaveLength(0);
  });
});

describe("debug entity inspection (UI/UX 22)", () => {
  it("resolves people, places and residents, and reports unknown ids", () => {
    const { sim, playerId } = world();

    const person = getEntityInspectorView(sim, playerId);
    expect(person.found).toBe(true);
    expect(person.kind).toBe("person");
    expect(person.title.length).toBeGreaterThan(0);

    const place = getEntityInspectorView(sim, M2_SETTLEMENT_ID);
    expect(place.found).toBe(true);
    expect(place.kind).toBe("place");

    const missing = getEntityInspectorView(sim, "PERSON-9999999");
    expect(missing.found).toBe(false);
    expect(missing.fields).toHaveLength(0);
  });

  it("exposes the inspector through the console as a read", () => {
    const { sim, playerId } = world();
    const result = executeConsoleInstruction(
      sim,
      parseConsoleInput(`entity ${M2_SETTLEMENT_ID}`, sim.registry),
      { actorId: asEntityId<"person">(playerId), authority: "player" },
    );
    expect(result.status).toBe("ok");
    expect(result.lines[0]?.text).toContain(M2_SETTLEMENT_ID);
    // A read leaves no command-log trace.
    expect(getCommandLogView(sim)).toHaveLength(0);
  });
});

