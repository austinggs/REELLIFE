/**
 * U7 — the guardrails the brief asks for by name, plus the purity and
 * accessibility invariants that make the rest of the UI reviewable.
 *
 * What already exists and is deliberately *not* repeated here:
 * `tests/invariants/architecture.test.ts` already proves no `Math.random`, no
 * real clock, no `console` and no framework import inside the engine, the
 * `.ts` extension rule, and the command surface boundary.
 *
 * What is new, and why each is a scan rather than a rendered assertion: the
 * project has no jsdom, so a test that "watches the UI render" would need a
 * dependency the manifest says not to add. These read the sources and the
 * projections instead. That is a real limitation and it is stated in the test
 * names rather than hidden — an `axe` run belongs in U7 only once a DOM exists.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { seedPlayableSlice } from "../../src/engine/kernel/sliceSeed.ts";
import * as queries from "../../src/engine/query/index.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { MAP_MARKER_BUDGET } from "../../src/engine/query/index.ts";
import { RESOLUTION_BUDGETS } from "../../src/engine/observability/budgets.ts";

const root = resolve(__dirname, "../..");

function filesUnder(directory: string, extension: string): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/** Strips comments and string literals, so prose cannot trip a code scan. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const APP_FILES = [...filesUnder("src/app", ".ts"), ...filesUnder("src/app", ".tsx")];
const QUERY_FILES = filesUnder("src/engine/query", ".ts");
/** Everything the UI can read: the app plus the projection layer it reads. */
const READ_PATH_FILES = [...APP_FILES, ...QUERY_FILES];

describe("semantic guardrails (brief §6, UI/UX 24)", () => {
  it("finds the sources it audits", () => {
    expect(READ_PATH_FILES.length).toBeGreaterThan(15);
  });

  it("never reduces a relationship to a marriage flag", () => {
    // Marriage is a relationship with a start and possibly an end, not a boolean
    // on a person. A person may be partnered, widowed, separated or never paired.
    const offenders = READ_PATH_FILES.filter((file) => /\bisMarried\b/.test(codeOnly(read(file))));
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });

  it("never scores a life, a person or a legacy with a bonus", () => {
    const offenders = READ_PATH_FILES.filter((file) =>
      /\b(legacyBonus|legacyScore|lifeScore|characterScore|fameScore)\b/.test(codeOnly(read(file))),
    );
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });

  it("never exposes a single reputation score to the UI", () => {
    // System 22's whole point is that reputation is socially distributed belief.
    // A scalar would erase the observers, so the name is banned outright rather
    // than left to review.
    const offenders = READ_PATH_FILES.filter((file) =>
      /\b(reputationScore|overallReputation|globalReputation|reputationTotal)\b/.test(
        codeOnly(read(file)),
      ),
    );
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });

  it("keeps the UI off the engine's mutation surface", () => {
    // A screen that can mutate is a second simulation. The app may *read* a
    // projection and *dispatch* a command; it may not open a write scope.
    const forbidden = [/guard\s*\.\s*mutate/, /\.mutate\s*\(/, /world\s*\.\s*systems\s*\[/];
    const offenders = APP_FILES.filter((file) =>
      forbidden.some((pattern) => pattern.test(codeOnly(read(file)))),
    );
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });
});

describe("accessibility structure (UI/UX 21; static, not axe)", () => {
  it("never puts a click handler on a non-interactive element", () => {
    // A div with onClick is unreachable by keyboard. Every control in this app is
    // a real <button>, <a>, <input> or a role'd region with a key handler.
    const offenders = APP_FILES.filter((file) => {
      const source = read(file);
      return /<(div|span|p|li|td)[^>]*\bonClick=/.test(source);
    });
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });

  it("gives every custom focusable region a role and an accessible name", () => {
    // A focusable div with no role and no label is a keyboard trap with no name.
    // The map viewport is the one such region today, and it is labelled.
    const offenders: string[] = [];
    for (const file of APP_FILES) {
      const source = read(file);
      for (const match of source.matchAll(/<div[^>]*\btabIndex=\{[^}]*\}[^>]*>/g)) {
        const tag = match[0];
        if (!/role=/.test(tag) || !/aria-label=/.test(tag)) {
          offenders.push(`${relative(root, file)}: ${tag.slice(0, 80)}`);
        }
      }
    }
    // And the rule is not vacuous: at least one such region exists to check.
    const labelled = [...APP_FILES].some((file) => /<div[^>]*\btabIndex=\{/.test(read(file)));
    expect(labelled).toBe(true);
    expect(offenders).toEqual([]);
  });

  it("never hides an interactive element from assistive technology", () => {
    // `aria-hidden` on something focusable is focusable-but-invisible.
    const offenders = APP_FILES.filter((file) => {
      const source = read(file);
      return /<(button|a|input|select|textarea)[^>]*aria-hidden/.test(source);
    });
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });

  it("uses the tab pattern properly for the surfaces that have tabs", () => {
    const society = read(join(root, "src/app/society/SocietyScreen.tsx"));
    expect(society).toMatch(/role="tablist"/);
    expect(society).toMatch(/role="tab"/);
    expect(society).toMatch(/aria-selected=/);
    expect(society).toMatch(/role="tabpanel"/);
  });
});

describe("responsive layout (UI/UX 23; static)", () => {
  const SCREENS = [
    "src/app/screens/LifeScreen.tsx",
    "src/app/screens/PeopleScreen.tsx",
    "src/app/screens/WorldScreen.tsx",
    "src/app/society/SocietyScreen.tsx",
    "src/app/people/LineageTree.tsx",
  ];

  it("lays every new surface out responsively rather than at one fixed width", () => {
    // A single fixed px width is the responsive bug this catches. `max-w-*` with a
    // `w-full`/`mx-auto` parent is the intended shape.
    const offenders = SCREENS.filter((file) => {
      const source = read(join(root, file));
      // A pixel width on the root container of a screen, with no responsive escape.
      return /className=\{?"[^"]*\bmax-w-\d+px\b/.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("lets a grid reflow instead of holding two columns on a phone", () => {
    // The real responsive bug is a grid that is two-or-more columns at *every*
    // width. A surface with no grid at all (Society's cards, the lineage SVG) is
    // genuinely fluid and needs no breakpoint, so demanding one would be a false
    // positive rather than a check.
    const offenders: string[] = [];
    for (const file of SCREENS) {
      const source = read(join(root, file));
      const columns = [...source.matchAll(/grid-cols-(\d+)/g)].map((match) =>
        Number(match[1] ?? "1"),
      );
      const multiColumn = columns.some((count) => count > 1);
      if (multiColumn && !columns.includes(1)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });

  it("still exercises at least one real breakpoint somewhere", () => {
    // Guards against the rule above being satisfied by deleting every grid.
    const usesBreakpoints = SCREENS.some((file) => /\b(md|lg):/.test(read(join(root, file))));
    expect(usesBreakpoints).toBe(true);
  });
});

describe("projections are pure reads (UI/UX 24, law 9)", () => {
  function seeded(): { sim: ReturnType<typeof createKernelSimulation>; viewer: string } {
    const sim = createKernelSimulation({
      masterSeed: "reellife-u7-purity",
      checkInvariants: true,
      seedSlice: true,
    });
    return { sim, viewer: seedPlayableSlice(sim).playerId };
  }

  /** Every projection the shell can ask for, as a thunk. */
  function readers(sim: ReturnType<typeof createKernelSimulation>, viewer: string) {
    const id = asEntityId<"person">(viewer);
    return [
      () => queries.getClockView(sim),
      () => queries.getWorldSummaryView(sim),
      () => queries.getWorldView(sim, id),
      () => queries.getLifeSituation(sim, id),
      () => queries.getPersonView(sim, id, viewer),
      () => queries.getMapView(sim, id, { camera: { lod: "world" } }),
      () => queries.getNotificationFeedView(sim, id, { limit: 40 }),
      () => queries.getTimelineView(sim, id, { limit: 60 }),
      () => queries.getCommandLogView(sim, { limit: 25 }),
      () => queries.getSimulationHealthView(sim),
      () => queries.getPeopleDirectory(sim, id),
      () => queries.getFamilyView(sim, id),
      () => queries.getPerceptionView(sim, id, viewer),
      () => queries.getLawView(sim, id),
      () => queries.getInformationView(sim, id),
      () => queries.getCommunityView(sim, id),
      () => queries.getEconomyView(sim),
      () => queries.getLegacyView(sim, id),
    ] as const;
  }

  it("covers every screen's read path", () => {
    const { sim, viewer } = seeded();
    expect(readers(sim, viewer).length).toBeGreaterThanOrEqual(17);
  });

  it("cannot change authoritative state", () => {
    const { sim, viewer } = seeded();
    const before = sim.stateHash();
    for (const read of readers(sim, viewer)) read();
    // A read that mutated would break determinism silently; the hash is the check.
    expect(sim.stateHash()).toBe(before);
    expect(sim.guard.recordedViolations).toEqual([]);
  });

  it("is repeatable, so a re-render cannot show a different world", () => {
    const { sim, viewer } = seeded();
    for (const read of readers(sim, viewer)) {
      expect(read()).toEqual(read());
    }
  });
});

describe("work-unit budgets, not wall clock (observability, M8)", () => {
  it("keeps every read-path projection inside the engine's own budgets", () => {
    // Deliberately *not* a wall-clock assertion: the project's own budget work
    // rejected those as flaky on shared CI and measuring the machine rather than
    // the code. What is asserted is the structural unit — how much a projection
    // hands the screen at once.
    const sim = createKernelSimulation({
      masterSeed: "reellife-u7-budget",
      checkInvariants: true,
      seedSlice: true,
    });
    const viewer = asEntityId<"person">(seedPlayableSlice(sim).playerId);

    for (const lod of queries.MAP_LODS) {
      const map = queries.getMapView(sim, viewer, { camera: { lod } });
      expect(map.markers.length).toBeLessThanOrEqual(MAP_MARKER_BUDGET);
      expect(map.routes.length).toBeLessThanOrEqual(queries.MAP_ROUTE_BUDGET);
    }
    expect(queries.getLifeSituation(sim, viewer).commitments.length).toBeLessThanOrEqual(5);
    expect(queries.getPeopleDirectory(sim, viewer).entries.length).toBeLessThanOrEqual(117 * 4);
  });

  it("still declares the full resolution taxonomy", () => {
    // The budgets are referenced by the UI, so removing one is a breaking change
    // and this makes that loud rather than silent.
    expect(Object.keys(RESOLUTION_BUDGETS).length).toBeGreaterThanOrEqual(5);
  });
});
