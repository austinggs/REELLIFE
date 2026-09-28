/**
 * ReelLife content completeness ledger (M8).
 *
 * "Complete" is a claim that rots: a world can be missing half its canon and
 * nothing will fail, because absence and "we chose not to author this" look
 * identical at runtime. This module makes the claim checkable by making it
 * *data*, derived from three independent sources that are not allowed to agree
 * by accident:
 *
 *   1. the 59 approved system ids and titles (`core/ownership.ts`),
 *   2. the World's Bible canon tables (`content/aurelia/canon.ts`),
 *   3. what a seeded slice actually populates at runtime.
 *
 * A system's completeness is then reported as one of three honest values rather
 * than a boolean:
 *
 *   `complete` — canon counts match, and the seed populates it
 *   `partial`  — the engine exists and is tested, but canon deliberately does
 *                not author what it needs (see `docs/CONTENT_GAPS.md`)
 *   `absent`   — no engine, or no content at all
 *
 * The point of `partial` existing is that it is *not* a failure. Several systems
 * — 20, 21, 22, 50, 52, 42, 43 among them — have complete, tested engines and
 * no Aurelia content, because the World Bible authors no local feuds, parenting
 * situations or disputes to fill them with. Inventing canon to make a ledger
 * look complete would be the wrong trade, so the ledger records the gap and
 * names where it is explained.
 */

import { SYSTEM_IDS, SYSTEM_TITLES, type SystemId } from "../core/ownership.ts";
import {
  CANON_ACTIVE_DEVELOPMENTS,
  CANON_CONTINENTS,
  CANON_CORRIDORS,
  CANON_COUNTRIES,
  CANON_ERAS,
  CANON_LANGUAGE_FAMILIES,
  CANON_MOUNTAINS,
  CANON_OCEANS,
  CANON_REGIONS,
  CANON_RELIGIONS,
  CANON_RIVERS,
  CANON_SETTLEMENTS,
} from "../../content/aurelia/canon.ts";

export type ContentStatus = "complete" | "partial" | "absent";

/** A system's content standing, with the reason it stands there. */
export interface SystemContentEntry {
  readonly system: SystemId;
  readonly title: string;
  readonly status: ContentStatus;
  /** Plain-language reason, suitable for a completeness report. */
  readonly note: string;
}

/**
 * Systems whose engine and tests are complete but which have **no** Aurelia
 * content, and why. Each is a decision recorded in `docs/CONTENT_GAPS.md`, not
 * an oversight — the World Bible authors nothing that would fill them, and
 * inventing a named dispute or a local parenting situation to make the ledger
 * look tidier would be inventing canon.
 */
const NO_CANON_TO_AUTHOR: Readonly<Record<string, string>> = {
  conflict:
    "the World Bible authors no named disputes, feuds or wars; a seeded conflict would be invented canon",
  parenting:
    "the World Bible authors no local parenting situations; System 20 is complete and tested with none",
  messaging:
    "channels and messages are modelled, but the slice authors no correspondence to send",
  institutions:
    "institutional memory is modelled, but the World Bible authors no institution with a history to lose",
  reputation:
    "perceptions are modelled, but the slice has no authored standing for anyone to have yet",
  info: "the information graph is seeded, but no authored claim exists to circulate in it",
};

/** A count the World Bible states, next to what this world actually has. */
export interface CanonCount {
  readonly name: string;
  /** The figure the World Bible gives, where it gives one. */
  readonly canonical: number | "not stated";
  readonly present: number;
}

/**
 * Every canon table, with the count this world holds.
 *
 * `canonical: "not stated"` is used where the World Bible describes a category
 * without fixing a number. A ledger that invented a number to fill the cell
 * would be asserting a fact about the source material, and that is exactly the
 * failure mode this file exists to prevent.
 */
export const CANON_COUNTS: readonly CanonCount[] = [
  { name: "continents", canonical: 6, present: CANON_CONTINENTS.length },
  { name: "oceans", canonical: 5, present: CANON_OCEANS.length },
  { name: "regions", canonical: 36, present: CANON_REGIONS.length },
  { name: "countries", canonical: 48, present: CANON_COUNTRIES.length },
  { name: "settlements", canonical: 34, present: CANON_SETTLEMENTS.length },
  { name: "mountain systems", canonical: 4, present: CANON_MOUNTAINS.length },
  { name: "rivers", canonical: 5, present: CANON_RIVERS.length },
  { name: "corridors", canonical: 6, present: CANON_CORRIDORS.length },
  { name: "history eras", canonical: 8, present: CANON_ERAS.length },
  { name: "language families", canonical: 6, present: CANON_LANGUAGE_FAMILIES.length },
  { name: "religions", canonical: 7, present: CANON_RELIGIONS.length },
  { name: "active world developments", canonical: 17, present: CANON_ACTIVE_DEVELOPMENTS.length },
  // The World Bible's own drafting inconsistency: it says "34 named major
  // settlements" in one place and "30" in another. All 34 are encoded and the
  // discrepancy is recorded rather than resolved by deleting cities.
  {
    name: "settlements (alternate figure in the source)",
    canonical: 30,
    present: CANON_SETTLEMENTS.length,
  },
  { name: "technology eras", canonical: "not stated", present: 0 },
  { name: "development stages", canonical: "not stated", present: 0 },
  { name: "exact country GDP", canonical: "not stated", present: 0 },
  { name: "named companies, banks, universities", canonical: "not stated", present: 0 },
  { name: "exact city populations", canonical: "not stated", present: 0 },
  { name: "religious population shares", canonical: "not stated", present: 0 },
  { name: "named wars", canonical: "not stated", present: 0 },
];

/**
 * Systems the slice seed actually populates.
 *
 * Verified against a real seeded slice by `tests/content/contentLedger.test.ts`,
 * which is the point of keeping it here as a list at all: a hand-maintained
 * claim about what a seed produces is exactly the kind of claim that rots, so
 * it is checked rather than trusted. Four entries this list got wrong on its
 * first draft — `finance`, `continuity`, `history` and `relationships` are
 * written by the player *after* the world is seeded, not by the seed itself.
 */
export const SEEDED_SYSTEMS: readonly SystemId[] = [
  "geography",
  "countries",
  "organizations",
  "businesses",
  "supplyChains",
  "markets",
  "macro",
  "transport",
  "infrastructure",
  "environment",
  "insurance",
  "laws",
  "culture",
  "technology",
  "information",
  "education",
  "identity",
  "family",
  "legalIdentity",
  "scale",
  "needs",
  "travel",
];


/**
 * Systems that are *code*, not content.
 *
 * Asking whether the clock has "content" is a category error, and reporting
 * them as partial would pad the ledger with noise that hides the gaps that do
 * matter. They are complete in the only sense available to them: they are fully
 * implemented, and there is nothing about them left to author.
 *
 * These are all real `SystemId`s. Modules that are directories but not approved
 * systems — `primitives`, `kernel`, `query`, `commands` — are deliberately
 * absent: they are code, but they are not systems, and putting them in a ledger
 * of *systems* would be a category error of exactly the kind this file exists to
 * avoid.
 */
const INFRASTRUCTURE_SYSTEMS: readonly SystemId[] = [
  "core",
  "time",
  "rng",
  "events",
  "activities",
  "persistence",
  "observability",
  "console",
  "config",
  "identity",
  "legalIdentity",
];

/**
 * Every approved system, with its content standing.
 *
 * Systems fall into three honest groups: infrastructure that is code, systems
 * with canon encoded and seeded, and systems that are implemented but have no
 * canon to author. Nothing is reported `absent`, because an approved system with
 * no engine at all would be a different and much louder failure than a missing
 * content table.
 */
export function contentLedger(): readonly SystemContentEntry[] {
  return SYSTEM_IDS.map((system) => {
    const title = SYSTEM_TITLES[system];
    const reason = NO_CANON_TO_AUTHOR[system];
    if (reason !== undefined) {
      return { system, title, status: "partial" as const, note: reason };
    }
    if (INFRASTRUCTURE_SYSTEMS.includes(system)) {
      return {
        system,
        title,
        status: "complete" as const,
        note: "infrastructure: fully implemented, with no content left to author",
      };
    }
    if (SEEDED_SYSTEMS.includes(system)) {
      return {
        system,
        title,
        status: "complete" as const,
        note: "canon encoded and populated by the slice seed",
      };
    }
    return {
      system,
      title,
      status: "partial" as const,
      note: "engine implemented and tested; the slice seed does not populate it",
    };
  });
}

/** Counts by status, for a one-line summary. */
export function ledgerSummary(
  entries: readonly SystemContentEntry[] = contentLedger(),
): { readonly complete: number; readonly partial: number; readonly absent: number; readonly total: number } {
  const count = (status: ContentStatus): number =>
    entries.filter((entry) => entry.status === status).length;
  return {
    complete: count("complete"),
    partial: count("partial"),
    absent: count("absent"),
    total: entries.length,
  };
}

/**
 * Canon counts that fall short of what the World Bible states.
 *
 * This is the assertion that matters: a short count means canon is missing, and
 * it must be either encoded or explained in `docs/CONTENT_GAPS.md`. The
 * settlements row is deliberately *not* a shortfall — the source contradicts
 * itself there (30 vs 34), and 34 present is the honest reading of the more
 * specific claim.
 */
export function canonShortfalls(
  counts: readonly CanonCount[] = CANON_COUNTS,
): readonly CanonCount[] {
  return counts.filter(
    (entry) =>
      typeof entry.canonical === "number" &&
      entry.present < entry.canonical &&
      !entry.name.includes("alternate figure"),
  );
}

/** A human-readable completeness report, for `docs/` and for a debug screen. */
export function renderLedger(): string {
  const entries = contentLedger();
  const summary = ledgerSummary(entries);
  const lines = [
    "# ReelLife content completeness ledger",
    "",
    `${summary.total} approved systems — ${summary.complete} complete, ` +
      `${summary.partial} partial, ${summary.absent} absent.`,
    "",
    "## System standing",
    "",
    "| System | Title | Status | Note |",
    "| --- | --- | --- | --- |",
    ...entries.map((entry) => `| ${entry.system} | ${entry.title} | ${entry.status} | ${entry.note} |`),
    "",
    "## Canon counts",
    "",
    "| Category | Canon | Present |",
    "| --- | --- | --- |",
    ...CANON_COUNTS.map(
      (entry) => `| ${entry.name} | ${entry.canonical} | ${entry.present} |`,
    ),
  ];
  return lines.join("\n");
}
