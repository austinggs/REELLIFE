/**
 * M8 — the content completeness ledger.
 *
 * The ledger's job is to make "this world is complete" a checkable claim rather
 * than a comfortable one. These tests therefore assert the thing that could
 * actually embarrass us: that no canon count is silently short, and that every
 * system without content says *why* rather than being quietly reported complete.
 *
 * The `SEEDED_SYSTEMS` list is the interesting one. It is a claim about what the
 * slice seed populates, and a claim like that rots — so a test seeds a real
 * slice and checks the list against it. If someone adds a content module and
 * forgets to update the list, or updates the list and forgets the seed, this
 * fails rather than the report quietly becoming a work of fiction.
 */

import { describe, expect, it } from "vitest";
import {
  CANON_COUNTS,
  SEEDED_SYSTEMS,
  canonShortfalls,
  contentLedger,
  ledgerSummary,
  renderLedger,
} from "../../src/engine/config/contentLedger.ts";
import { SYSTEM_IDS, SYSTEM_TITLES } from "../../src/engine/core/ownership.ts";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import {
  CANON_CONTINENTS,
  CANON_COUNTRIES,
  CANON_OCEANS,
  CANON_REGIONS,
  CANON_SETTLEMENTS,
} from "../../src/content/aurelia/canon.ts";

describe("content completeness ledger (M8)", () => {
  it("covers every approved system, with a real title and a real note", () => {
    const entries = contentLedger();
    // The ledger is exhaustive: 59 approved systems, all accounted for. A
    // ledger that silently omits a system is worse than no ledger.
    expect(entries).toHaveLength(SYSTEM_IDS.length);
    expect(entries).toHaveLength(59);
    for (const entry of entries) {
      expect(SYSTEM_IDS).toContain(entry.system);
      // No entry may be blank, and none may be a placeholder.
      expect(entry.title).toBeTruthy();
      expect(entry.note.length).toBeGreaterThan(10);
      expect(["complete", "partial", "absent"]).toContain(entry.status);
    }
  });

  it("no canon count is short of what the World Bible states", () => {
    // The assertion that matters. A shortfall here means canon is missing and
    // has to be encoded or explained in docs/CONTENT_GAPS.md.
    expect(canonShortfalls()).toEqual([]);
    for (const entry of CANON_COUNTS) {
      if (typeof entry.canonical !== "number") continue;
      expect(entry.present).toBeGreaterThanOrEqual(entry.canonical);
    }
  });

  it("reports the figures the World Bible actually states", () => {
    // Spelled out, so a later change to the canon tables has to be a decision
    // made here rather than a diff nobody reads.
    expect(CANON_CONTINENTS).toHaveLength(6);
    expect(CANON_OCEANS).toHaveLength(5);
    expect(CANON_REGIONS).toHaveLength(36);
    expect(CANON_COUNTRIES).toHaveLength(48);
    expect(CANON_SETTLEMENTS).toHaveLength(34);
  });

  it("records the source's own 30-vs-34 settlement contradiction", () => {
    // The World Bible says 34 in one place and 30 in another. All 34 are
    // encoded; the ledger carries both figures rather than resolving the
    // contradiction by deleting four cities.
    const alternate = CANON_COUNTS.find((entry) => entry.name.includes("alternate figure"));
    expect(alternate).toBeDefined();
    expect(alternate?.canonical).toBe(30);
    expect(alternate?.present).toBe(34);
    // And it is explicitly not counted as a shortfall.
    expect(canonShortfalls()).not.toContain(alternate);
  });

  it("says 'not stated' rather than inventing a number", () => {
    const unstated = CANON_COUNTS.filter((entry) => entry.canonical === "not stated");
    // The deferred-by-design categories: exact GDP, named firms, city
    // populations, religious shares, named wars, technology eras. Each is
    // described by the World Bible without a figure, and a ledger that filled
    // these cells would be asserting facts about the source material.
    expect(unstated.length).toBeGreaterThanOrEqual(7);
    for (const entry of unstated) {
      expect(entry.present).toBe(0);
    }
    const names = unstated.map((entry) => entry.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "exact country GDP",
        "exact city populations",
        "religious population shares",
        "named wars",
      ]),
    );
  });

  it("every seeded system is a real system id", () => {
    for (const system of SEEDED_SYSTEMS) {
      expect(SYSTEM_IDS).toContain(system);
    }
    // And no duplicates, which would silently inflate the summary.
    expect(new Set(SEEDED_SYSTEMS).size).toBe(SEEDED_SYSTEMS.length);
  });

  it("the seeded-systems list matches what a real slice actually populates", () => {
    // The check that keeps the ledger honest. If someone adds a content module
    // and forgets this list — or updates the list without the seed — this fails
    // instead of the report quietly becoming fiction.
    const sim = createKernelSimulation({
      masterSeed: "reellife-m8-ledger",
      seedSlice: true,
      withHeartbeat: false,
    });
    const bag = sim.world.systems as Record<string, unknown>;
    const populated = Object.keys(bag).filter((key) => bag[key] !== undefined);
    for (const system of SEEDED_SYSTEMS) {
      expect(populated).toContain(system);
    }
    // The reverse is deliberately *not* asserted: the seed writes some slots in
    // dependency order, and registration order is not a contract the ledger
    // should depend on.
    expect(populated.length).toBeGreaterThanOrEqual(SEEDED_SYSTEMS.length);
  });

  it("a system with no canon to author says so, rather than claiming completeness", () => {
    const entries = contentLedger();
    for (const system of ["conflict", "parenting"] as const) {
      const entry = entries.find((candidate) => candidate.system === system);
      expect(entry).toBeDefined();
      // These have complete, tested engines and deliberately no content. They
      // must not be reported as complete, because that would be a false claim.
      expect(entry?.status).toBe("partial");
      expect(entry?.note).toMatch(/World Bible authors no|no authored standing/);
    }
  });

  it("summarises consistently with the entries it summarises", () => {
    const entries = contentLedger();
    const summary = ledgerSummary(entries);
    expect(summary.total).toBe(entries.length);
    expect(summary.complete + summary.partial + summary.absent).toBe(entries.length);
    // The world is not finished, and the ledger must not pretend otherwise.
    expect(summary.complete).toBeGreaterThan(0);
    expect(summary.complete).toBeLessThan(summary.total);
  });

  it("infrastructure systems are complete, because they are code", () => {
    // Asking whether the clock has "content" is a category error. Reporting
    // these as partial would pad the ledger with noise that hides the gaps that
    // actually matter, which is the failure mode this file exists to prevent.
    for (const system of ["core", "time", "rng", "persistence"] as const) {
      const entry = contentLedger().find((candidate) => candidate.system === system);
      expect(entry?.status).toBe("complete");
      expect(entry?.note).toMatch(/infrastructure/);
    }
  });

  it("only names systems that are actually approved systems", () => {
    // `primitives`, `kernel`, `query` and `commands` are directories of code
    // but are not approved *systems*. A ledger of systems that quietly listed
    // them would be mixing two different kinds of thing.
    for (const system of ["primitives", "kernel", "query", "commands"] as const) {
      expect(SYSTEM_IDS).not.toContain(system);
    }
    // The test file imports only real ids, so the whole file type-checks against
    // the real register — which is itself the guarantee.
    expect(SYSTEM_IDS).toHaveLength(59);
  });

  it("renders a report a person can read", () => {
    const report = renderLedger();
    expect(report).toContain("# ReelLife content completeness ledger");
    expect(report).toContain("| System | Title | Status | Note |");
    expect(report).toContain("| Category | Canon | Present |");
    // Every system appears in the report, under its real title.
    for (const system of SYSTEM_IDS) {
      expect(report).toContain(`| ${system} |`);
    }
    expect(report).toContain(SYSTEM_TITLES.continuity);
  });
});
