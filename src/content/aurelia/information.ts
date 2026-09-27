/**
 * Provisional information content for the Arden slice (M6 / System 49).
 *
 * The World Bible authors no newspapers, social platforms, broadcasters or
 * rumour networks (deferred canon). So this module authors the *minimum a
 * working port already needs* â€” the things its own content implies:
 *
 *   - A **quayside notice board** at the docks: a place where shift notices,
 *     cargo manifests and complaints are pinned. Grounded in the authored
 *     "shift rotation" and "harbour pilotage" operations.
 *   - A **mill bakery market board**: price and availability notices for the
 *     stalls that sell its bread, which is the same channel the authored
 *     "sell at dawn" operation would use.
 *   - Two **spread** claims with no author attached, described only so the
 *     rumour substrate is named rather than invented: a claim needs an author
 *     and an audience, and putting those in residents' mouths at seed time
 *     would be fiction rather than a rumour.
 *
 * Every node that is an organization is a real System 32 organization from
 * the slice, and every person node is a real resident, so the graph holds no
 * invented actors. **No claim is seeded at all, and none is seeded as
 * verified**: verification is an act someone performs, and a seeded claim
 * would make the register lie about what has actually been said. Nothing
 * here is canon.
 */

import type {
  DefineChannelRequest,
  InformationEngine,
} from "../../engine/information/engine.ts";
import type { InformationNode } from "../../engine/information/types.ts";
import { M2_SETTLEMENT_ID } from "./geography.ts";

/** The slice's rumor substrate: no claims are seeded (see the file header). */
export const AURELIA_SEEDED_CLAIM_COUNT = 0;

/** The docks' board, and the bakery's market board. */
export const AURELIA_DOCKS_BOARD = "CH-ARDEN-QUAY-BOARD";
export const AURELIA_BAKERY_BOARD = "CH-ARDEN-MILL-BOARD";

/**
 * The slice's seeded nodes: the slice's own organizations, plus two places
 * that plausibly host notice boards. Resident nodes are registered by the
 * seed from the materialized population rather than invented here.
 */
export function aureliaArdenNodes(): readonly InformationNode[] {
  return [
    { id: "ORG-ARDIN-DOCKS", kind: "organization", name: "Arden Docks", credibility: 0.8 },
    { id: "ORG-ARDEN-MILL-BAKERY", kind: "organization", name: "Arden Mill Bakery", credibility: 0.7 },
    { id: "ORG-GRAIN-BASIN-COOP", kind: "cooperative", name: "Basin Grain Cooperative", credibility: 0.65 },
    { id: "ORG-QUAY-CAFE", kind: "organization", name: "Quay Cafe", credibility: 0.5 },
    { id: "ORG-FENWICK-STALL", kind: "organization", name: "Fenwick Stall", credibility: 0.45 },
    { id: M2_SETTLEMENT_ID, kind: "place", name: "Arden" },
    { id: "DISTRICT-ARDEN-RIVERFRONT", kind: "place", name: "Riverfront Commercial District" },
  ];
}

/** The slice's two notice boards. Neither is moderated â€” nobody polices a board. */
export function aureliaArdenChannels(): readonly DefineChannelRequest[] {
  return [
    {
      id: AURELIA_DOCKS_BOARD,
      kind: "notice_board",
      name: "Dockside shift board",
      operatorId: "ORG-ARDIN-DOCKS",
      reachBase: 0.7,
      moderated: false,
      audienceIds: ["ORG-ARDIN-DOCKS"],
    },
    {
      id: AURELIA_BAKERY_BOARD,
      kind: "market",
      name: "Mill market board",
      operatorId: "ORG-ARDEN-MILL-BAKERY",
      reachBase: 0.55,
      moderated: false,
      audienceIds: ["ORG-ARDEN-MILL-BAKERY", "ORG-FENWICK-STALL"],
    },
  ];
}

/**
 * Registers the slice's information substrate. Idempotent throughout, and
 * deliberately claim-free: no claim is published here, because a claim
 * needs an author and an audience, and inventing both at seed time would
 * put words in residents' mouths before anyone has spoken.
 */
export function registerAureliaInformation(
  engine: InformationEngine,
  residentIds: readonly string[],
): { readonly nodes: number; readonly channels: number } {
  let nodes = 0;
  for (const node of aureliaArdenNodes()) {
    if (engine.node(node.id) === undefined) {
      engine.defineNode(node);
      nodes += 1;
    }
  }
  // Residents are real people (System 07 materialization), registered as
  // information nodes so the social graph has real endpoints.
  for (const residentId of residentIds) {
    if (engine.node(residentId) !== undefined) continue;
    engine.defineNode({ id: residentId, kind: "person", name: residentId, credibility: 0.5 });
    nodes += 1;
  }
  let channels = 0;
  for (const channel of aureliaArdenChannels()) {
    if (engine.channel(channel.id) !== undefined) continue;
    engine.defineChannel(channel);
    channels += 1;
  }
  return { nodes, channels };
}
