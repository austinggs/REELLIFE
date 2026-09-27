/**
 * Provisional culture content for the Arden slice (M6 / System 44).
 *
 * The World Bible authors seven religions and a long list of cultural
 * material, but it authors no *local* communities: no congregations, no
 * workplace customs, no quarter traditions, and — deliberately — no religious
 * population shares (deferred canon, see docs/CONTENT_GAPS.md). So this module
 * does the same thing System 41's law content did: it authors only the culture
 * the slice's existing content already implies.
 *
 *   - **The quay working community** — the docks are authored with a 140-strong
 *     stevedore workforce and a pilotage crew, so a shift bell, an injury rule
 *     and a pay tally follow from the work itself.
 *   - **The mill's bakehouse** — the bakery is authored as baking overnight, so
 *     the night oven is a practice rather than an invention.
 *   - **The Fenwick quarter** — the fenwick market stall is authored, so a
 *     dawn-opening custom belongs to that ground.
 *   - **The grain-basin mutual** — the cooperative's own surplus-sharing norm.
 *   - **A quiet-day congregation** — present because System 44 must be able to
 *     represent religion, and because the *interesting* part of a faith in a
 *     simulation is not its theology but the friction between its trading norms
 *     and everyone else's. It carries no `religionId`: which of Aurelia's seven
 *     faiths it belongs to is canon this module will not guess at.
 *
 * Two norm conflicts fall out of this without being authored, which is the
 * point: the Fenwick's dawn-opening and the congregation's closed day both
 * govern "trade" in the same city, and the Fenwick's fair-weights value and the
 * mutual's surplus-sharing value both govern "reward". Neither pair is written
 * down anywhere as a feud; `normConflicts()` finds them by looking.
 *
 * Nothing here is canon.
 */

import type { CultureEngine } from "../../engine/culture/engine.ts";
import type { CulturalGroupKind, TraditionKind, TraditionState } from "../../engine/culture/types.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { M2_SETTLEMENT_ID } from "./geography.ts";

export interface AureliaTraditionSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: TraditionKind;
  /** The situation this tradition governs; drives norm-conflict detection. */
  readonly domain: string;
  readonly state?: TraditionState;
}

export interface AureliaCultureGroupSpec {
  readonly id: string;
  readonly name: string;
  readonly kind: CulturalGroupKind;
  readonly organizationId?: string;
  readonly note?: string;
  readonly traditions: readonly AureliaTraditionSpec[];
}

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no local communities (M6/S44 gap list).";

export const AURELIA_CULTURE_GROUP_COUNT = 5;
export const AURELIA_CULTURE_TRADITION_COUNT = 11;

/** The cultural groups of the slice city, and what they hold. */
export const AURELIA_CULTURE_GROUPS: readonly AureliaCultureGroupSpec[] = [
  {
    id: "CG-ARDEN-QUAY",
    name: "Arden quay working community",
    kind: "professional",
    organizationId: "ORG-ARDEN-DOCKS",
    note: "Stevedores, pilots and tallymen; the workplace as community.",
    traditions: [
      {
        id: "TRD-QUAY-SHIFT-BELL",
        name: "The watch begins at the harbour bell",
        kind: "norm",
        domain: "workday",
      },
      {
        id: "TRD-QUAY-CRIT-KNEE",
        name: "Report an injury before the hour ends",
        kind: "norm",
        domain: "injury",
      },
      {
        id: "TRD-QUAY-TALLY",
        name: "The tally is settled at the end of the watch",
        kind: "practice",
        domain: "payment",
      },
      {
        id: "TRD-QUAY-OLD-HORN",
        name: "The long horn calls the last lighter in",
        kind: "symbol",
        domain: "leisure",
        state: "weakening",
      },
      {
        id: "TRD-QUAY-CROSS-TIDE",
        name: "Swim the tide at the slack, not the ebb",
        kind: "practice",
        domain: "leisure",
        state: "emerging",
      },
    ],
  },
  {
    id: "CG-ARDEN-MILL",
    name: "Arden mill bakehouse",
    kind: "professional",
    organizationId: "ORG-ARDEN-MILL-BAKERY",
    note: "The bakehouse is a craft community, not just a shift pattern.",
    traditions: [
      {
        id: "TRD-MILL-NIGHT-OVEN",
        name: "The oven is lit before the second watch",
        kind: "practice",
        domain: "workday",
      },
      {
        id: "TRD-MILL-FLOUR-SWEEP",
        name: "Flour is swept to the bin, never the street",
        kind: "norm",
        domain: "workplace",
      },
    ],
  },
  {
    id: "CG-ARDEN-FENWICK",
    name: "The Fenwick quarter",
    kind: "geographic",
    note: "A ground rather than a faith: belonging to the quarter is what it means.",
    traditions: [
      {
        id: "TRD-FENWICK-DAWN-STALL",
        name: "Stalls open at first light and trade ends at the bell",
        kind: "norm",
        domain: "trade",
      },
      {
        id: "TRD-FENWICK-WEIGHTS-FAIR",
        name: "The stallholder's weights are checked by the neighbour",
        kind: "value",
        domain: "reward",
        state: "contested",
      },
    ],
  },
  {
    id: "CG-ARDEN-QUIET-DAY",
    name: "Arden quiet-day congregation",
    kind: "religious",
    note: "One practice only. No religionId: which of the seven faiths this is, is deferred canon.",
    traditions: [
      {
        id: "TRD-QUIET-DAY-CLOSED",
        name: "No trade is done on the quiet day",
        kind: "norm",
        domain: "trade",
      },
    ],
  },
  {
    id: "CG-ARDEN-MUTUAL",
    name: "Grain-basin mutual society",
    kind: "organizational",
    organizationId: "ORG-GRAIN-BASIN-COOP",
    note: "The cooperative's members as a community; System 32 owns the organization itself.",
    traditions: [
      {
        id: "TRD-MUTUAL-SHARE-SURPLUS",
        name: "Surplus follows contribution, not seniority",
        kind: "value",
        domain: "reward",
      },
    ],
  },
];

/** Registers the slice's groups and traditions. Idempotent by id. */
export function registerAureliaCulture(engine: CultureEngine, at: WorldTime): void {
  for (const group of AURELIA_CULTURE_GROUPS) {
    engine.registerGroup(
      {
        id: group.id,
        name: group.name,
        kind: group.kind,
        locationId: M2_SETTLEMENT_ID,
        ...(group.organizationId === undefined ? {} : { organizationId: group.organizationId }),
        note: `${group.note ?? ""} ${PROVISIONAL_NOTE}`.trim(),
      },
      at,
    );
    for (const tradition of group.traditions) {
      engine.registerTradition(
        {
          id: tradition.id,
          groupId: group.id,
          name: tradition.name,
          kind: tradition.kind,
          domain: tradition.domain,
          ...(tradition.state === undefined ? {} : { state: tradition.state }),
        },
        at,
      );
    }
  }
}
