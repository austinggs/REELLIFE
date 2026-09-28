/**
 * People-screen projections (UI/UX 02).
 *
 * Three reads, each present because the screen must not invent what it shows:
 *
 *   1. `getPeopleDirectory` — everyone the viewer can actually *name*. It is not
 *      a gazetteer: someone the viewer has never met stays a nameless row, and
 *      the people they cannot name are counted, never filled in.
 *   2. `getFamilyView` — System 19 read back: the household, its membership
 *      *stints* (leaving stamps `leftAt`, so turnover is readable), the recorded
 *      kinship edges, and the ancestor/descendant walks the engine performs.
 *      Affection is System 18 and is deliberately absent: living together and
 *      being related are structural facts, feeling is not.
 *   3. `getPerceptionView` — System 22 read back. There is no single reputation
 *      score in this world and this module must not synthesize one: every
 *      observer's view of every domain comes back separately, with its evidence
 *      count and how stale it is.
 *
 * Nothing here mutates. Each `Engine` is constructed only to *derive*: a decayed
 * reading is System 22's algorithm and a lineage walk is System 19's, so
 * re-implementing either here would be exactly the drift this layer exists to
 * prevent. Both constructors are guarded so a read can never create state.
 */

import type { EntityId } from "../primitives/ids.ts";
import { asEntityId } from "../primitives/ids.ts";
import type { KnowledgeState } from "../primitives/information.ts";
import type { IdentityState } from "../identity/types.ts";
import type { GeographySystemState } from "../geography/types.ts";
import type { RelationshipsSystemState } from "../relationships/types.ts";
import type { ScaleSystemState } from "../scale/types.ts";
import type { FamilySystemState } from "../family/types.ts";
import { FamilyEngine } from "../family/engine.ts";
import {
  REPUTATION_DOMAINS,
  type ReputationDomain,
  type ReputationSystemState,
} from "../reputation/types.ts";
import { ReputationEngine } from "../reputation/engine.ts";
import type { Simulation } from "../core/simulation.ts";
import { bag, displayNameOf, lifeStageOf } from "./projections.ts";

/** How many lineage generations a family view will lay out. */
const MAX_DISPLAYED_GENERATIONS = 6;

/** Observers, so a domain with many is still summarised rather than dumped. */
const MAX_OBSERVERS_PER_DOMAIN = 8;

export type DirectoryRelation = "self" | "household" | "known";

export interface DirectoryEntryView {
  readonly personId: string;
  readonly displayName: string;
  readonly knowledge: KnowledgeState;
  readonly relation: DirectoryRelation;
  readonly relationLabel: string;
  readonly householdRole?: string;
  /** Exact for the viewer, an aggregate band for anyone else. */
  readonly ageLabel?: string;
  readonly lifeStageLabel?: string;
  readonly locationName?: string;
  readonly canOpen: boolean;
}

export interface PeopleDirectoryView {
  readonly viewerId: string;
  readonly entries: readonly DirectoryEntryView[];
  /** People nearby the viewer cannot name: counted, never invented. */
  readonly unnamedNearbyCount: number;
  readonly notes: readonly string[];
}


/**
 * Everyone in the viewer's world they can identify.
 *
 * Membership is taken from the systems that already decided it — household
 * membership (System 19) and recorded ties (System 18) — rather than guessed from
 * proximity. Someone sharing a settlement but not a household or a tie is
 * *nearby*, not known, and appears here only as a count.
 */
export function getPeopleDirectory(
  sim: Simulation,
  viewer: EntityId<"person">,
): PeopleDirectoryView {
  const identity = bag<IdentityState>(sim, "identity");
  const scale = bag<ScaleSystemState>(sim, "scale");
  const geography = bag<GeographySystemState>(sim, "geography");
  const family = bag<FamilySystemState>(sim, "family");
  const relationships = bag<RelationshipsSystemState>(sim, "relationships");

  const placeNameOf = (settlementId: string | undefined): string | undefined =>
    settlementId === undefined
      ? undefined
      : geography?.places.find((place) => place.id === settlementId)?.name;

  const residents = scale?.residents ?? [];
  const viewerResident = residents.find((entry) => entry.personId === viewer);
  const residentOf = (personId: string) => residents.find((entry) => entry.personId === personId);
  const personOf = (personId: string) =>
    identity?.persons.find((candidate) => candidate.id === personId);

  const household = (family?.households ?? []).find(
    (candidate) =>
      !candidate.dissolvedAt &&
      candidate.members.some((member) => member.personId === viewer && member.leftAt === undefined),
  );
  const currentMembers = (household?.members ?? []).filter((member) => member.leftAt === undefined);

  const relatedIds = new Set<string>();
  for (const relationship of relationships?.relationships ?? []) {
    if (relationship.from === viewer) relatedIds.add(relationship.to);
    else if (relationship.to === viewer) relatedIds.add(relationship.from);
  }

  const roleOf = (personId: string): string | undefined =>
    currentMembers.find((member) => member.personId === personId)?.role;

  /** Exact age for the viewer; the engine's aggregate band for anyone else. */
  const ageOf = (personId: string, isSelf: boolean): { ageLabel?: string; stage?: string } => {
    if (isSelf) {
      const person = personOf(personId);
      if (person === undefined) return {};
      const ageYears = Math.max(
        0,
        Math.floor(
          ((sim.clock.time as number) - (person.birth.dateOfBirth as number)) / (365.2425 * 1440),
        ),
      );
      return { ageLabel: `${ageYears} years`, stage: lifeStageOf(ageYears) };
    }
    const band = residentOf(personId)?.ageBand;
    if (band === undefined) return {};
    return { ageLabel: `${band} (estimated)`, stage: band };
  };

  const entryFor = (
    personId: string,
    relation: DirectoryRelation,
    role: string | undefined,
  ): DirectoryEntryView => {
    const age = ageOf(personId, relation === "self");
    const place = placeNameOf(residentOf(personId)?.settlementId);
    return {
      personId,
      displayName: displayNameOf(personOf(personId)),
      knowledge: "known",
      relation,
      relationLabel:
        relation === "self"
          ? "yourself"
          : relation === "household"
            ? "household member"
            : "someone you know",
      ...(role === undefined ? {} : { householdRole: role }),
      ...(age.ageLabel === undefined ? {} : { ageLabel: age.ageLabel }),
      ...(age.stage === undefined ? {} : { lifeStageLabel: age.stage }),
      ...(place === undefined ? {} : { locationName: place }),
      canOpen: true,
    };
  };

  const byName = (a: string, b: string): number =>
    displayNameOf(personOf(a)).localeCompare(displayNameOf(personOf(b)));

  const householdEntries: DirectoryEntryView[] = currentMembers
    .map((member) => member.personId)
    .filter((personId) => personId !== viewer)
    .sort(byName)
    .map((personId) => entryFor(personId, "household", roleOf(personId)));

  const householdIdSet: ReadonlySet<string> = new Set(
    currentMembers.map((member) => String(member.personId)),
  );
  const knownEntries: DirectoryEntryView[] = [...relatedIds]
    .filter((personId) => personId !== viewer && !householdIdSet.has(personId))
    .sort(byName)
    .map((personId) => entryFor(personId, "known", undefined));

  const named = new Set<string>([viewer, ...householdIdSet, ...relatedIds]);
  const unnamedNearbyCount = residents.filter(
    (entry) => entry.settlementId === viewerResident?.settlementId && !named.has(entry.personId),
  ).length;

  const notes: string[] = [];
  const settlementName = placeNameOf(viewerResident?.settlementId);
  if (unnamedNearbyCount > 0) {
    // The figure leads the sentence rather than sitting inside it: a bare count
    // interpolated into prose cannot survive translation (UI/UX 21).
    notes.push(
      `Not listed: ${unnamedNearbyCount}. These are people in ${settlementName ?? "this settlement"} you have not met, so you cannot name them.`,
    );
  }
  if ((relationships?.relationships ?? []).length === 0) {
    notes.push(
      "No ties are recorded yet. System 18 records a tie once two people actually interact, so this list stays short until they do.",
    );
  }

  return {
    viewerId: viewer,
    entries: [entryFor(viewer, "self", roleOf(viewer)), ...householdEntries, ...knownEntries],
    unnamedNearbyCount,
    notes,
  };
}

export interface HouseholdStintView {
  readonly role: string;
  readonly joinedAtLabel: string;
  /** Absent while the person is still in the household. */
  readonly leftAtLabel?: string;
  readonly leftReason?: string;
  readonly ended: boolean;
}

export interface RelativeView {
  readonly personId: string;
  readonly displayName: string;
  readonly knowledge: KnowledgeState;
  readonly lifeStageLabel?: string;
  readonly ageLabel?: string;
  /** System 19's recorded parents of this person, for drawing honest edges. */
  readonly parentIds: readonly string[];
}

/** One row of a lineage graph: who sits this many generations from the subject. */
export interface LineageLevelView {
  readonly generationsAway: number;
  readonly label: string;
  readonly people: readonly RelativeView[];
}

export interface FamilyView {
  readonly personId: string;
  readonly displayName: string;
  readonly householdName?: string;
  readonly householdRole?: string;
  /** Entry/exit stints in the current household, earliest first. */
  readonly stints: readonly HouseholdStintView[];
  readonly parents: readonly RelativeView[];
  readonly partners: readonly RelativeView[];
  readonly children: readonly RelativeView[];
  readonly siblings: readonly RelativeView[];
  readonly ancestors: readonly LineageLevelView[];
  readonly descendants: readonly LineageLevelView[];
  /** False when System 19 holds neither a household nor a lineage link. */
  readonly recorded: boolean;
  readonly notes: readonly string[];
}

/** Row heading for a lineage generation, kept plain beyond "great". */
function lineageLabel(generationsAway: number, direction: "ancestor" | "descendant"): string {
  if (generationsAway === 1) return direction === "ancestor" ? "Parents" : "Children";
  if (generationsAway === 2) return direction === "ancestor" ? "Grandparents" : "Grandchildren";
  if (generationsAway === 3) {
    return direction === "ancestor" ? "Great-grandparents" : "Great-grandchildren";
  }
  return direction === "ancestor"
    ? `${generationsAway} generations back`
    : `${generationsAway} generations on`;
}


/** System 16's age bands as words, so a band never leaks as `youngAdult`. */
const AGE_BAND_LABELS: Readonly<Record<string, string>> = {
  child: "child",
  youngAdult: "young adult",
  adult: "adult",
  senior: "senior",
};

/**
 * The subject's recorded family structure (System 19).
 *
 * Defaults to the viewer's own family, which is the one structure a person is
 * entitled to know in full. The household, the stints and the kinship edges are
 * all read *through the engine*: "who is your parent" and "what counts as an
 * ancestor" stay System 19's answers, and only the grouping into rows for the
 * graph happens here.
 */
export function getFamilyView(
  sim: Simulation,
  viewer: EntityId<"person">,
  subjectId: string = viewer,
): FamilyView {
  const actor = asEntityId<"person">(subjectId);
  const identity = bag<IdentityState>(sim, "identity");
  const scale = bag<ScaleSystemState>(sim, "scale");
  const familyState = bag<FamilySystemState>(sim, "family");
  const personOf = (personId: string) =>
    identity?.persons.find((candidate) => candidate.id === personId);

  const relativeView = (personId: string): RelativeView => {
    const person = personOf(personId);
    const band = scale?.residents.find((entry) => entry.personId === personId)?.ageBand;
    const bandLabel = band === undefined ? undefined : (AGE_BAND_LABELS[band] ?? band);
    return {
      personId,
      displayName: displayNameOf(person),
      // A recorded kinship edge without an identity record is a real gap, and
      // saying so is better than printing a plausible name for it.
      knowledge: person === undefined ? "unknown" : "known",
      ...(bandLabel === undefined
        ? {}
        : { lifeStageLabel: bandLabel, ageLabel: `${bandLabel} (estimated)` }),
      parentIds: family.parentsOf(asEntityId<"person">(personId)).map(String),
    };
  };

  if (familyState === undefined) {
    return {
      personId: subjectId,
      displayName: displayNameOf(personOf(subjectId)),
      stints: [],
      parents: [],
      partners: [],
      children: [],
      siblings: [],
      ancestors: [],
      descendants: [],
      recorded: false,
      notes: [
        "System 19 holds no family records in this world, so there is nothing to read rather than something being missing.",
      ],
    };
  }

  const family = new FamilyEngine(sim.scope, sim.world);
  const record = family.familyRecord(actor);

  const stints: HouseholdStintView[] = record.membershipHistory.map((member) => ({
    role: member.role,
    joinedAtLabel: sim.calendar.formatDate(member.joinedAt),
    ...(member.leftAt === undefined ? {} : { leftAtLabel: sim.calendar.formatDate(member.leftAt) }),
    ...(member.leftReason === undefined ? {} : { leftReason: member.leftReason }),
    ended: member.leftAt !== undefined,
  }));

  /** Groups one direction of the lineage walk into display rows. */
  const level = (
    edges: (id: string) => readonly string[],
    membership: readonly string[],
    direction: "ancestor" | "descendant",
  ): LineageLevelView[] => {
    const allowed = new Set(membership);
    const seen = new Set<string>([String(actor)]);
    const rows: LineageLevelView[] = [];
    let frontier: readonly string[] = edges(String(actor)).filter((id) => allowed.has(id));
    for (let away = 1; away <= MAX_DISPLAYED_GENERATIONS && frontier.length > 0; away += 1) {
      const here = frontier.filter((id) => !seen.has(id));
      for (const id of here) seen.add(id);
      if (here.length > 0) {
        rows.push({
          generationsAway: away,
          label: lineageLabel(away, direction),
          people: here.map(relativeView),
        });
      }
      frontier = here.flatMap((id) => edges(id).filter((next) => allowed.has(next)));
    }
    return rows;
  };

  // The engine's walks decide *membership*; the rows above only order them.
  const ancestorIds = family.ancestorsOf(actor).map(String);
  const descendantIds = family.descendantsOf(actor).map(String);
  const parentsOf = (id: string) => family.parentsOf(asEntityId<"person">(id)).map(String);
  const childrenOf = (id: string) => family.childrenOf(asEntityId<"person">(id)).map(String);

  const notes: string[] = [];
  if (stints.length > 1) {
    notes.push(
      "You have joined this household more than once. Every stint is kept, so a move leaves a trail instead of disappearing.",
    );
  }
  if (record.household === undefined) {
    notes.push("No household is on record for this person.");
  }
  if (ancestorIds.length === 0) {
    notes.push(
      "No ancestry is on record. System 19 writes a link when a birth actually happens in this world, and a founding household has none behind it yet.",
    );
  }
  notes.push(
    "Kinship here is recorded structure, not feeling. How two people behave toward each other is System 18, and it is read on the person view.",
  );

  return {
    personId: subjectId,
    displayName: displayNameOf(personOf(subjectId)),
    ...(record.household === undefined ? {} : { householdName: record.household.name }),
    ...(record.role === undefined ? {} : { householdRole: record.role }),
    stints,
    parents: record.parents.map(String).map(relativeView),
    partners: record.householdPartners.map(String).map(relativeView),
    children: record.children.map(String).map(relativeView),
    siblings: record.siblings.map(String).map(relativeView),
    ancestors: level(parentsOf, ancestorIds, "ancestor"),
    descendants: level(childrenOf, descendantIds, "descendant"),
    recorded: record.household !== undefined || ancestorIds.length > 0 || descendantIds.length > 0,
    notes,
  };
}


export interface PerceptionReadingView {
  readonly observerId: string;
  readonly observerLabel: string;
  /** System 22's -1..1 reading, absent when the observer holds no evidence. */
  readonly value?: number;
  readonly valueLabel?: string;
  readonly confidence?: number;
  readonly evidenceCount: number;
  readonly staleDays: number;
  readonly staleLabel: string;
}

export interface PerceptionDomainView {
  readonly domain: ReputationDomain;
  readonly domainLabel: string;
  readonly readings: readonly PerceptionReadingView[];
  /** The mean of the views actually held — a summary, not a score. */
  readonly collectiveValueLabel?: string;
  /** Widest gap between two observers, 0..1, when at least two hold a view. */
  readonly widestDisagreement?: number;
  readonly disagreementLabel?: string;
}

export interface PerceptionView {
  readonly subjectId: string;
  readonly displayName: string;
  readonly domains: readonly PerceptionDomainView[];
  /** False when System 22 holds no perception at all about this subject. */
  readonly recorded: boolean;
  readonly notes: readonly string[];
}

/** Presentation bucketing of System 22's -1..1 reading, not a threshold rule. */
function valenceLabel(value: number): string {
  if (value <= -0.6) return "strongly negative";
  if (value <= -0.2) return "negative";
  if (value < 0.2) return "mixed";
  if (value < 0.6) return "positive";
  return "strongly positive";
}

function disagreementLabel(widest: number | undefined): string | undefined {
  if (widest === undefined) return undefined;
  if (widest >= 0.67) return "these observers openly disagree";
  if (widest >= 0.34) return "these observers disagree somewhat";
  return "these observers broadly agree";
}

function staleLabelOf(days: number): string {
  const rounded = Math.round(days);
  if (rounded <= 0) return "current";
  if (rounded === 1) return "a day old";
  if (rounded < 60) return `${rounded} days old`;
  const years = Math.round(days / 365);
  return years <= 1 ? "about a year old" : `about ${years} years old`;
}

/**
 * What is believed about a person, observer by observer (System 22).
 *
 * The read path returns a *distribution*, never a score: each observer keeps
 * their own view of each domain, and an observer the viewer cannot name is
 * counted but not identified. Reputation is what people believe was shown, so
 * being wrong is a state this view must be able to express.
 */
export function getPerceptionView(
  sim: Simulation,
  viewer: EntityId<"person">,
  subjectId: string,
): PerceptionView {
  const identity = bag<IdentityState>(sim, "identity");
  const family = bag<FamilySystemState>(sim, "family");
  const relationships = bag<RelationshipsSystemState>(sim, "relationships");
  const reputationState = bag<ReputationSystemState>(sim, "reputation");

  const displayName = displayNameOf(
    identity?.persons.find((candidate) => candidate.id === subjectId),
  );

  const empty = (notes: readonly string[]): PerceptionView => ({
    subjectId,
    displayName,
    domains: [],
    recorded: false,
    notes,
  });

  if (reputationState === undefined) {
    return empty([
      "System 22 holds no perceptions in this world, so nothing is being withheld.",
    ]);
  }
  if (reputationState.perceptions.length === 0) {
    return empty([
      "No perceptions have been recorded yet. System 22 stores a belief once someone has actually observed something, and nothing has been observed here. A person with no recorded views is not a person everyone approves of — they are a person nothing is yet believed about.",
    ]);
  }

  const aboutSubject = reputationState.perceptions.filter(
    (perception) => perception.subjectId === subjectId,
  );
  if (aboutSubject.length === 0) {
    return empty([
      "Nothing is believed about this person yet. No observer has recorded a view of them.",
    ]);
  }

  // Observer identity is knowledge-filtered: you see the view, not a name you
  // were never given. Household and recorded ties are what make a name available.
  const household = (family?.households ?? []).find(
    (candidate) =>
      !candidate.dissolvedAt &&
      candidate.members.some((member) => member.personId === viewer && member.leftAt === undefined),
  );
  const nameable = new Set<string>([
    ...(household?.members ?? []).map((member) => String(member.personId)),
  ]);
  for (const relationship of relationships?.relationships ?? []) {
    if (relationship.from === viewer) nameable.add(relationship.to);
    else if (relationship.to === viewer) nameable.add(relationship.from);
  }

  const observerLabel = (observerId: string): string => {
    if (observerId === viewer) return "you";
    if (observerId.startsWith("community:")) return "the local view";
    if (!nameable.has(observerId)) return "someone you have not met";
    return displayNameOf(identity?.persons.find((candidate) => candidate.id === observerId));
  };

  const engine = new ReputationEngine(sim.scope, sim.world);
  const now = sim.clock.time;

  // Domains in the engine's own declaration order, so the page is stable.
  const present = REPUTATION_DOMAINS.filter((domain) =>
    aboutSubject.some((perception) => perception.domain === domain),
  );

  const domains: PerceptionDomainView[] = present.map((domain) => {
    const perceptions = engine.perceptionsOf(subjectId, domain);
    const readings: PerceptionReadingView[] = perceptions
      .map((perception) => {
        const reading = engine.decayedReading(perception.observerId, subjectId, domain, now);
        return {
          observerId: perception.observerId,
          observerLabel: observerLabel(perception.observerId),
          ...(reading.value === undefined
            ? {}
            : { value: reading.value, valueLabel: valenceLabel(reading.value) }),
          ...(reading.confidence === undefined ? {} : { confidence: reading.confidence }),
          evidenceCount: reading.evidenceCount,
          staleDays: reading.staleDays,
          staleLabel: staleLabelOf(reading.staleDays),
        } satisfies PerceptionReadingView;
      })
      .sort((a, b) => {
        const self = Number(b.observerId === viewer) - Number(a.observerId === viewer);
        return self !== 0 ? self : a.observerLabel.localeCompare(b.observerLabel);
      })
      .slice(0, MAX_OBSERVERS_PER_DOMAIN);

    const valued = readings.filter(
      (reading): reading is PerceptionReadingView & { value: number } =>
        reading.value !== undefined,
    );
    let widest: number | undefined;
    for (let i = 0; i < valued.length; i += 1) {
      for (let j = i + 1; j < valued.length; j += 1) {
        const gap = engine.divergence(
          subjectId,
          domain,
          valued[i].observerId,
          valued[j].observerId,
          now,
        );
        if (gap !== undefined && (widest === undefined || gap > widest)) widest = gap;
      }
    }

    const collective = engine.collectiveReading(subjectId, domain, now);
    return {
      domain,
      domainLabel: domain.charAt(0).toUpperCase() + domain.slice(1),
      readings,
      ...(collective.value === undefined
        ? {}
        : { collectiveValueLabel: valenceLabel(collective.value) }),
      ...(widest === undefined
        ? {}
        : { widestDisagreement: widest, disagreementLabel: disagreementLabel(widest) }),
    } satisfies PerceptionDomainView;
  });

  const notes = [
    "No single reputation score exists in this world, so none is shown. Each line is one observer's own view.",
    "The summary is the mean of the views actually held, not something the world keeps.",
  ];
  const withheld = domains.some((domain) =>
    domain.readings.some((reading) => reading.observerLabel === "someone you have not met"),
  );
  if (withheld) {
    notes.push(
      "Some views are held by people you have not met. Their view still counts toward the summary; only their name is withheld.",
    );
  }

  return { subjectId, displayName, domains, recorded: domains.length > 0, notes };
}

