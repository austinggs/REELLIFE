/**
 * Society-facing projections (U5; UI/UX 11, 15, 16 + Systems 41, 44, 49, 33-36).
 *
 * Four reads — the law you live under, what is being said, the communities you
 * could belong to, and the commerce around you. Each one exists because the
 * screen must not invent any of it, and each carries the same discipline:
 *
 *   1. **A catalogue is not an experience.** The playable slice ships four law
 *      rules and no permits, five cultural groups and no participation, seven
 *      goods and no transactions, three hundred information nodes and no claims.
 *      So each view reports *what exists* and *what has happened to you
 *      separately*, and never lets the first stand in for the second. A world
 *      with a law book and no licences is not a world where everyone is
 *      licensed.
 *   2. **Belief, truth and exposure are three different things.** System 49
 *      records that a claim *reached* someone; it does not record that they
 *      believed it, and the veracity status is the world's own finding rather
 *      than anyone's opinion. This view keeps all three apart.
 *   3. **Provisional content says so on its own row.** Several of these entries
 *      carry the World Bible's own gap note (there is no statute book, no local
 *      communities, no currencies in the source material). The note travels with
 *      the item instead of living only in a changelog.
 *
 * Everything here is read-only and derived.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { GeographySystemState } from "../geography/types.ts";
import type { IdentityState } from "../identity/types.ts";
import type { CountriesSystemState } from "../countries/types.ts";
import type { LawsSystemState } from "../laws/types.ts";
import type {
  CirculatingClaim,
  InformationSystemState,
  VeracityStatus,
} from "../information/types.ts";
import type {
  CultureSystemState,
  TraditionState,
} from "../culture/types.ts";
import type { MarketsSystemState, MarketStructure } from "../markets/types.ts";
import type { Simulation } from "../core/simulation.ts";
import { bag, displayNameOf, moneyLabel } from "./projections.ts";

function sentenceCase(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, " ");
}

export interface LawRuleView {
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  /** The action the rule speaks to, e.g. "operate_mill". */
  readonly action: string;
  readonly jurisdictionName: string;
  /** True when the rule binds a person, so it binds the viewer. */
  readonly bindsViewer: boolean;
  readonly requiredCredential?: string;
  /** Whether the viewer actually holds a valid permit for that credential. */
  readonly credentialHeld: boolean;
  /** What breaking it would cost, in words, copied from the rule. */
  readonly sanctions: readonly string[];
  readonly inForce: boolean;
  readonly inForceLabel: string;
  readonly provisional: boolean;
  readonly note?: string;
  /** Ambiguity the engine itself flagged rather than resolving. */
  readonly ambiguous: boolean;
}

export interface PermitView {
  readonly id: string;
  readonly ruleTitle: string;
  readonly issuedAtLabel: string;
  readonly expiresAtLabel?: string;
  readonly status: "valid" | "expired" | "revoked";
  readonly statusLabel: string;
}

export interface LawView {
  readonly rules: readonly LawRuleView[];
  readonly permits: readonly PermitView[];
  /** Permits the viewer holds that are not currently valid. */
  readonly lapsedPermitCount: number;
  readonly notes: readonly string[];
}

/**
 * The law in force around the viewer (System 41).
 *
 * Rules are reported as written, including the sanction amounts and any
 * ambiguity the engine flagged. Nothing is interpreted into "what you may do":
 * that is a decision surface's job, and it has to run through the command
 * pipeline where authority is checked.
 */
export function getLawView(sim: Simulation, viewer: EntityId<"person">): LawView {
  const laws = bag<LawsSystemState>(sim, "laws");
  const countries = bag<CountriesSystemState>(sim, "countries");
  const now = sim.clock.time;

  const nameOfJurisdiction = (id: string): string => {
    const jurisdiction = countries?.jurisdictions.find((entry) => entry.id === id);
    if (jurisdiction !== undefined) return jurisdiction.name;
    const country = countries?.countries.find((entry) => entry.id === id);
    return country?.name ?? id;
  };
  const scaleOf = (code: string | undefined): number | undefined =>
    countries?.currencies.find((entry) => entry.code === code)?.minorUnitScale;

  const notes: string[] = [];

  if (laws === undefined) {
    return {
      rules: [],
      permits: [],
      lapsedPermitCount: 0,
      notes: [
        "System 41 holds no rules in this world, so there is no law book to read rather than a missing one.",
      ],
    };
  }

  const heldCredentials = new Set(
    laws.permits
      .filter((permit) => permit.holderId === viewer && permit.status === "valid")
      .map((permit) => laws.rules.find((rule) => rule.id === permit.ruleId)?.requiredCredential)
      .filter((credential): credential is string => credential !== undefined),
  );

  const rules: LawRuleView[] = [...laws.rules]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((rule) => {
      const inForce =
        rule.effectiveTo === undefined || (rule.effectiveTo as number) >= (now as number);
      const requiredCredential = rule.requiredCredential;
      return {
        id: rule.id,
        title: rule.title,
        kindLabel: sentenceCase(rule.kind),
        action: rule.action,
        jurisdictionName: nameOfJurisdiction(rule.jurisdictionId),
        bindsViewer: rule.subjectKinds.includes("person"),
        ...(requiredCredential === undefined ? {} : { requiredCredential }),
        credentialHeld:
          requiredCredential !== undefined && heldCredentials.has(requiredCredential),
        sanctions: rule.sanctions.map((sanction) => {
          const amount = moneyLabel(sanction.amount, scaleOf(sanction.amount?.currency));
          return amount === undefined
            ? `${sentenceCase(sanction.kind)}: ${sanction.note}`
            : `${sentenceCase(sanction.kind)} of ${amount} (${sanction.note})`;
        }),
        inForce,
        inForceLabel: inForce
          ? "in force"
          : `no longer in force, ended ${sim.calendar.formatDate(rule.effectiveTo as never)}`,
        provisional: rule.note !== undefined && rule.note.includes("Provisional"),
        ...(rule.note === undefined ? {} : { note: rule.note }),
        ambiguous: rule.ambiguous ?? false,
      } satisfies LawRuleView;
    });

  const permits: PermitView[] = laws.permits
    .filter((permit) => permit.holderId === viewer)
    .map((permit) => ({
      id: permit.id,
      ruleTitle: laws.rules.find((rule) => rule.id === permit.ruleId)?.title ?? permit.ruleId,
      issuedAtLabel: sim.calendar.formatDate(permit.issuedAt),
      ...(permit.expiresAt === undefined
        ? {}
        : { expiresAtLabel: sim.calendar.formatDate(permit.expiresAt) }),
      status: permit.status,
      statusLabel: sentenceCase(permit.status),
    }));

  const lapsedPermitCount = permits.filter((permit) => permit.status !== "valid").length;

  if (permits.length === 0) {
    notes.push(
      "You hold no licence or permit. System 41 issues them when something is actually issued, and nothing has been issued to you — that is different from being free of any obligation.",
    );
  }
  const ambiguousCount = rules.filter((rule) => rule.ambiguous).length;
  if (ambiguousCount > 0) {
    notes.push(
      `${ambiguousCount} of these rules are marked ambiguous by the engine itself. An unclear rule is recorded as unclear rather than resolved into a confident answer.`,
    );
  }
  notes.push(
    "This is the law as written, not advice about it. What you are actually allowed to do is decided when you try, through the same pipeline that checks everything else.",
  );

  return { rules, permits, lapsedPermitCount, notes };
}

export interface ClaimView {
  readonly id: string;
  /** The claim as stated, in the words it was told in. */
  readonly text: string;
  readonly subjectLabel: string;
  /** How it entered the world: provenance, not credibility. */
  readonly originLabel: string;
  /** The world's own finding, which is not the same as anyone's belief. */
  readonly status: VeracityStatus;
  readonly statusLabel: string;
  readonly sourceCredibilityLabel: string;
  readonly noveltyLabel: string;
  readonly emotionalChargeLabel: string;
  readonly createdAtLabel: string;
  /** People a claim *reached*. Not the number of people who believed it. */
  readonly reachedCount: number;
  readonly exposureLabel: string;
  readonly derivedFromClaimId?: string;
  /** Moderation is a fact about a channel, not about the truth of a claim. */
  readonly moderations: readonly string[];
}

export interface ChannelView {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly reachLabel: string;
  readonly moderated: boolean;
  readonly audienceSize: number;
}

export interface InformationView {
  readonly claims: readonly ClaimView[];
  readonly channels: readonly ChannelView[];
  readonly nodeCount: number;
  readonly linkCount: number;
  /** Claims the viewer has actually been reached by. */
  readonly viewerReachCount: number;
  readonly notes: readonly string[];
}

const VERACITY_LABELS: Readonly<Record<VeracityStatus, string>> = {
  unverified: "Unverified — nobody has checked",
  verified_true: "Verified true",
  verified_false: "Verified false",
  partial: "Partly true",
  misleading: "Misleading",
  outdated: "Was true, no longer",
  disputed: "Disputed",
};

/** Bucketing a 0..1 engine value into a word, for prose the UI can place. */
function proportionLabel(value: number): string {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 0.75) return "high";
  if (value >= 0.4) return "moderate";
  if (value > 0) return "low";
  return "none";
}

/**
 * What is being said, and who it reached (System 49).
 *
 * The discipline here is that three different things never collapse into one:
 * whether a claim is *true* (the world's own `veracity` finding), whether someone
 * was *reached* by it (an `Exposure`), and what anyone *believed* — which System
 * 49 deliberately does not model. A claim that reached two hundred people and is
 * verified false is the interesting case, and a view that reported "reached" as
 * "believed" would hide exactly that.
 */
export function getInformationView(
  sim: Simulation,
  viewer: EntityId<"person">,
): InformationView {
  const information = bag<InformationSystemState>(sim, "information");
  const identity = bag<IdentityState>(sim, "identity");

  if (information === undefined) {
    return {
      claims: [],
      channels: [],
      nodeCount: 0,
      linkCount: 0,
      viewerReachCount: 0,
      notes: ["System 49 holds no information graph in this world, so there is nothing to read."],
    };
  }

  const nameOfNode = (id: string): string => {
    const person = identity?.persons.find((candidate) => candidate.id === id);
    return person === undefined ? id : displayNameOf(person);
  };

  const reachedByClaim = new Map<string, number>();
  let viewerReachCount = 0;
  for (const exposure of information.exposures) {
    reachedByClaim.set(exposure.claimId, (reachedByClaim.get(exposure.claimId) ?? 0) + 1);
    if (exposure.nodeId === viewer) viewerReachCount += 1;
  }

  const claims: ClaimView[] = [...information.claims]
    .sort((a, b) => (b.createdAt as number) - (a.createdAt as number))
    .map((claim) => toClaimView(claim, information, reachedByClaim, nameOfNode, sim));

  const channels: ChannelView[] = [...information.channels]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      kindLabel: sentenceCase(channel.kind),
      reachLabel: `carries ${proportionLabel(channel.reachBase)} of whatever passes through it`,
      moderated: channel.moderated,
      audienceSize: channel.audienceIds.length,
    }));

  const notes: string[] = [
    "Three different things, kept apart on purpose: whether a claim is true, whether someone was reached by it, and what anyone believed — which this system does not model at all.",
  ];
  if (information.claims.length === 0) {
    notes.push(
      "Nothing is circulating yet. The graph of people, places and organizations is there, but System 49 stores a claim only once somebody has actually said something, and nobody has yet.",
    );
  }
  if (information.claims.length > 0 && information.exposures.length === 0) {
    notes.push(
      "Claims exist but no one is recorded as having received one. A claim that exists has not, by itself, reached anybody.",
    );
  }
  if (viewerReachCount > 0) {
    notes.push(
      "You have been reached by something in this graph. What you make of it is yours; this record says only that it arrived.",
    );
  }
  if (information.nodes.length > 0 && information.links.length === 0) {
    notes.push(
      "The nodes are registered but none are linked to each other, so a claim could not travel between them even if one existed.",
    );
  }

  return {
    claims,
    channels,
    nodeCount: information.nodes.length,
    linkCount: information.links.length,
    viewerReachCount,
    notes,
  };
}

function toClaimView(
  claim: CirculatingClaim,
  information: InformationSystemState,
  reachedByClaim: ReadonlyMap<string, number>,
  nameOfNode: (id: string) => string,
  sim: Simulation,
): ClaimView {
  const reached = reachedByClaim.get(claim.id) ?? 0;
  return {
    id: claim.id,
    text: claim.text,
    subjectLabel: `${sentenceCase(claim.subject.kind)}: ${nameOfNode(claim.subject.id)}`,
    originLabel: sentenceCase(claim.origin),
    status: claim.status,
    statusLabel: VERACITY_LABELS[claim.status],
    sourceCredibilityLabel: proportionLabel(claim.sourceCredibility),
    noveltyLabel: proportionLabel(claim.novelty),
    emotionalChargeLabel: proportionLabel(claim.emotionalCharge),
    createdAtLabel: sim.calendar.formatDateTime(claim.createdAt),
    reachedCount: reached,
    exposureLabel:
      reached === 0
        ? "has not reached anyone yet"
        : `reached ${reached} ${reached === 1 ? "person" : "people"} — which is not the same as being believed`,
    ...(claim.derivedFromClaimId === undefined
      ? {}
      : { derivedFromClaimId: claim.derivedFromClaimId }),
    moderations: information.moderations
      .filter((record) => record.claimId === claim.id)
      .map(
        (record) =>
          `${sentenceCase(record.action)} on ${sim.calendar.formatDate(record.at)} (${record.reason})`,
      ),
  };
}

export interface TraditionView {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  /** The situation this tradition governs ("workday", "greeting", ...). */
  readonly domainLabel: string;
  readonly state: TraditionState;
  readonly stateLabel: string;
}

export interface CommunityGroupView {
  readonly id: string;
  readonly name: string;
  readonly kindLabel: string;
  readonly locationName?: string;
  readonly organizationId?: string;
  readonly traditions: readonly TraditionView[];
  readonly provisional: boolean;
  readonly note?: string;
}

export interface CommunityView {
  readonly groups: readonly CommunityGroupView[];
  /** Participation records belonging to the viewer. */
  readonly viewerParticipation: readonly string[];
  /** Two co-located traditions of one kind claiming one domain (System 44). */
  readonly normConflicts: readonly string[];
  readonly notes: readonly string[];
}

const TRADITION_STATE_LABELS: Readonly<Record<TraditionState, string>> = {
  emerging: "Emerging",
  established: "Established",
  contested: "Contested — people disagree about it",
  weakening: "Weakening",
  retired: "Retired — no longer kept, and still on the record",
};

/**
 * The communities and traditions available where the viewer is (System 44).
 *
 * The important separation is *availability* from *belonging*. System 44 is
 * explicit that arriving somewhere changes the menu of traditions available, not
 * the person: a catalogue of five groups says the world has communities, and
 * says nothing at all about whether the viewer is in one. So an empty
 * participation list is reported as its own fact and never padded with the
 * catalogue above it.
 */
export function getCommunityView(sim: Simulation, viewer: EntityId<"person">): CommunityView {
  const culture = bag<CultureSystemState>(sim, "culture");
  const geography = bag<GeographySystemState>(sim, "geography");

  if (culture === undefined) {
    return {
      groups: [],
      viewerParticipation: [],
      normConflicts: [],
      notes: ["System 44 holds no communities in this world, so there is nothing to read."],
    };
  }

  const placeName = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : geography?.places.find((place) => place.id === id)?.name;

  const groups: CommunityGroupView[] = [...culture.groups]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((group) => {
      const traditions: TraditionView[] = culture.traditions
        .filter((tradition) => tradition.groupId === group.id)
        .map((tradition) => ({
          id: tradition.id,
          name: tradition.name,
          kindLabel: sentenceCase(tradition.kind),
          domainLabel: sentenceCase(tradition.domain),
          state: tradition.state,
          stateLabel: TRADITION_STATE_LABELS[tradition.state],
        }));
      const locationName = placeName(group.locationId);
      return {
        id: group.id,
        name: group.name,
        kindLabel: sentenceCase(group.kind),
        ...(locationName === undefined ? {} : { locationName }),
        ...(group.organizationId === undefined ? {} : { organizationId: group.organizationId }),
        traditions,
        provisional: group.note !== undefined && group.note.includes("Provisional"),
        ...(group.note === undefined ? {} : { note: group.note }),
      } satisfies CommunityGroupView;
    });

  const groupName = (id: string): string =>
    culture.groups.find((group) => group.id === id)?.name ?? id;

  const viewerParticipation = culture.participation
    .filter((entry) => entry.personId === viewer)
    .map((entry) => {
      const group = culture.groups.find((candidate) => candidate.id === entry.groupId);
      const when = sim.calendar.formatDate(entry.since);
      return `${sentenceCase(entry.level)} in ${group?.name ?? entry.groupId} since ${when}${
        entry.context === undefined ? "" : ` (${entry.context})`
      }`;
    });

  // Two traditions of the same kind claiming one domain cannot both be obeyed.
  // That is System 44's own derivation, not an editorial judgement here.
  const normConflicts: string[] = [];
  for (const first of culture.traditions) {
    for (const second of culture.traditions) {
      if (first.id >= second.id) continue;
      if (first.kind === second.kind && first.domain === second.domain) {
        normConflicts.push(
          `"${first.name}" (${groupName(first.groupId)}) and "${second.name}" (${groupName(second.groupId)}) both govern ${first.domain}. They cannot both be followed.`,
        );
      }
    }
  }

  const notes: string[] = [
    "This is the menu available where you are, not your membership of it. System 44 is explicit that arriving somewhere changes what is available, never who you are.",
  ];
  if (viewerParticipation.length === 0) {
    notes.push(
      "You take part in none of these. A person in a world full of communities who joins none of them is an ordinary outcome, not a gap in the record.",
    );
  }
  if (culture.communityHistory.length === 0) {
    notes.push(
      "No community history is recorded. The World Bible authors no community with a past to lose, so the systems that would hold one are complete and unpopulated rather than absent.",
    );
  }

  return { groups, viewerParticipation, normConflicts, notes };
}

export interface MarketGoodPriceView {
  readonly goodId: string;
  readonly goodName: string;
  readonly unit: string;
  /** The market's own price, copied verbatim; this layer never recomputes one. */
  readonly priceLabel?: string;
  readonly landedCostLabel?: string;
  readonly transportCostLabel?: string;
  /** Set by System 41/39; the market applies it. */
  readonly taxLabel: string;
  readonly inventoryUnits: number;
  readonly supplyUnits: number;
  readonly demandUnits: number;
  /** Supply against demand, in words rather than a ratio the player must divide. */
  readonly tightnessLabel: string;
}

export interface MarketView {
  readonly id: string;
  readonly name: string;
  readonly locationName?: string;
  readonly structure: MarketStructure;
  readonly structureLabel: string;
  readonly provisional: boolean;
  readonly sellerCount: number;
  /**
   * Concentration of supply among the recorded sellers, as a word. This is a
   * property of the market, not of any single good: it is the largest single
   * share on record, not an index this layer invented.
   */
  readonly concentrationLabel: string;
  readonly goods: readonly MarketGoodPriceView[];
}

export interface EconomyView {
  readonly markets: readonly MarketView[];
  /** Goods defined in the catalogue, including any no market currently lists. */
  readonly catalogSize: number;
  readonly unlistedGoods: readonly string[];
  readonly transactionCount: number;
  readonly currencyNote?: string;
  readonly notes: readonly string[];
}

/**
 * The commerce around the viewer (Systems 33-36).
 *
 * Prices, costs, tax and supply are copied out of the market that computed them.
 * This view never derives a price, never divides supply by demand, and never
 * implies a price for a good no market lists — a catalogue entry is a thing that
 * *could* be traded, not something on sale today.
 */
export function getEconomyView(sim: Simulation): EconomyView {
  const markets = bag<MarketsSystemState>(sim, "markets");
  const countries = bag<CountriesSystemState>(sim, "countries");
  const geography = bag<GeographySystemState>(sim, "geography");

  if (markets === undefined) {
    return {
      markets: [],
      catalogSize: 0,
      unlistedGoods: [],
      transactionCount: 0,
      notes: ["System 35 holds no markets in this world, so there are no prices to show."],
    };
  }

  const currency = countries?.currencies[0];
  const scaleOf = (code: string | undefined): number | undefined =>
    code === undefined
      ? undefined
      : countries?.currencies.find((entry) => entry.code === code)?.minorUnitScale;
  const placeName = (id: string | undefined): string | undefined =>
    id === undefined ? undefined : geography?.places.find((place) => place.id === id)?.name;
  const goodOf = (id: string) => markets.goods.find((good) => good.id === id);

  const views: MarketView[] = [...markets.markets]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((market) => {
      const locationName = placeName(market.locationId);
      const scale = scaleOf(market.currency);
      const shares = market.participants.map((participant) => participant.shareOfSupply);
      // Concentration is the largest single share: a fact about the recorded
      // participants rather than a computed index dressed up as one.
      const largestShare = shares.length === 0 ? 0 : Math.max(...shares);
      return {
        id: market.id,
        name: market.name,
        ...(locationName === undefined ? {} : { locationName }),
        structure: market.structure,
        structureLabel: sentenceCase(market.structure),
        provisional: market.provisional ?? false,
        sellerCount: market.participants.length,
        concentrationLabel:
          largestShare >= 0.6
            ? "one seller holds most of the supply here"
            : largestShare >= 0.4
              ? "a few sellers share the supply here"
              : "supply is spread between sellers here",
        goods: market.goods.map((entry) => {
          const good = goodOf(entry.goodId);
          const price = moneyLabel(entry.price, scale, market.currency);
          const landedCost = moneyLabel(entry.landedCost, scale, market.currency);
          const transport = moneyLabel(entry.transportCostPerUnit, scale, market.currency);
          return {
            goodId: entry.goodId,
            goodName: good?.name ?? entry.goodId,
            unit: good?.unit ?? "unit",
            ...(price === undefined ? {} : { priceLabel: price }),
            ...(landedCost === undefined ? {} : { landedCostLabel: landedCost }),
            ...(transport === undefined ? {} : { transportCostLabel: transport }),
            taxLabel:
              entry.taxBasisPoints === 0
                ? "no tax recorded"
                : `tax of ${(entry.taxBasisPoints / 100).toFixed(2)}% set by law`,
            inventoryUnits: entry.inventoryUnits,
            supplyUnits: entry.supplyUnits,
            demandUnits: entry.demandUnits,
            tightnessLabel:
              entry.demandUnits > entry.supplyUnits
                ? "more wanted than offered"
                : entry.demandUnits < entry.supplyUnits
                  ? "more offered than wanted"
                  : "supply and demand match",
          } satisfies MarketGoodPriceView;
        }),
      } satisfies MarketView;
    });

  const listedIds = new Set(
    markets.markets.flatMap((market) => market.goods.map((entry) => entry.goodId)),
  );
  const unlistedGoods = markets.goods
    .filter((good) => !listedIds.has(good.id))
    .map((good) => good.name);

  const notes: string[] = [];
  if (markets.transactions.length === 0) {
    notes.push(
      "No trade has been recorded in any of these markets. The prices below are what the market asks today, not the result of a sale, and they have never been tested against a buyer.",
    );
  }
  if (unlistedGoods.length > 0) {
    notes.push(
      "Some goods exist in the catalogue that no market currently lists. A catalogue entry is a thing that could be traded, not something on sale.",
    );
  }
  notes.push(
    "Every price, cost and tax here is copied from the market that computed it. This screen does not estimate, forecast, or adjust a price of its own accord.",
  );

  return {
    markets: views,
    catalogSize: markets.goods.length,
    unlistedGoods,
    transactionCount: markets.transactions.length,
    ...(currency === undefined
      ? {}
      : { currencyNote: `${currency.name} (${currency.code}). ${currency.note ?? ""}`.trim() }),
    notes,
  };
}
