/**
 * M3 life-facing projections (UI/UX 04, 07, 08; Systems 55/56/57).
 *
 * Same contract as `projections.ts`: read-only, knowledge filtered, derived.
 * These views exist because the UI never reaches into system state directly —
 * it asks for "the viewer's situation" and renders what it is told, including
 * *how well* the viewer is supposed to know each fact (`KnowledgeState`).
 *
 * Rules applied here:
 *   - Self knowledge is known: you know your own needs, mood and beliefs.
 *   - Household and relationship context lets you name a person; without it a
 *     person is rendered as unknown rather than identified.
 *   - Another person's internal state (needs, mood, beliefs) is never exposed
 *     to the viewer: it is `hidden`, whatever the engine holds in memory.
 *   - Estimates are labelled as estimates; deterministic outcomes are labelled
 *     as deterministic (UI/UX 07 section 4).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { KnowledgeState, Visibility } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import { TERMINAL_ACTIVITY_STATES, type Activity } from "../primitives/activity.ts";
import type { NeedKind } from "../needs/types.ts";
import type { NeedsState } from "../needs/types.ts";
import type { IdentityState, PersonIdentity } from "../identity/types.ts";
import type { ScaleSystemState } from "../scale/types.ts";
import type { GeographySystemState } from "../geography/types.ts";
import type { FamilySystemState, HouseholdRecord } from "../family/types.ts";
import type { MentationSystemState } from "../mentation/types.ts";
import type { RelationshipsSystemState } from "../relationships/types.ts";
import type { Simulation } from "../core/simulation.ts";
import { getEventFeedView, getWorldSummaryView, visibleTo, type EventFeedItem } from "./projections.ts";

/** Human labels for needs; presentation formatting, not simulation rules. */
export const NEED_LABELS: Readonly<Record<NeedKind, string>> = {
  hunger: "Hunger",
  thirst: "Thirst",
  sleep: "Sleep",
  rest: "Rest",
  temperature: "Warmth",
  hygiene: "Hygiene",
  toilet: "Toilet",
  social_contact: "Social contact",
  personal_space: "Personal space",
  routine: "Routine",
  recreation: "Recreation",
};

/** Human labels for activity kinds. */
export const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  sleep: "Sleeping",
  rest: "Resting",
  eat: "Eating",
  drink: "Drinking",
  hygiene: "Washing up",
  workShift: "Working a shift",
  commute: "Commuting",
  travel: "Travelling",
  study: "Studying",
  school: "At school",
  appointment: "At an appointment",
  socialVisit: "Visiting someone",
  leisure: "Leisure",
  recreation: "Recreation",
  exercise: "Exercising",
  household: "Household chores",
  childcare: "Childcare",
  errand: "Running an errand",
  shopping: "Shopping",
};

function bag<T>(sim: Simulation, key: string): T | undefined {
  return sim.world.systems[key] as T | undefined;
}

function displayNameOf(person: PersonIdentity | undefined): string {
  if (!person) return "Unknown person";
  const name = person.name;
  const middle = name.middle === undefined ? "" : ` ${name.middle}`;
  return `${name.first}${middle} ${name.last}`.trim();
}

function lifeStageOf(ageYears: number): string {
  if (ageYears < 13) return "child";
  if (ageYears < 18) return "adolescent";
  if (ageYears < 30) return "young adult";
  if (ageYears < 60) return "adult";
  if (ageYears < 80) return "senior";
  return "elder";
}

/** Renders a stored `Visibility` as the viewer's knowledge relationship. */
function knowledgeFromVisibility(
  viewer: EntityId<"person"> | null,
  entry: { readonly visibility: Visibility; readonly personId?: EntityId<"person"> },
): KnowledgeState {
  switch (entry.visibility) {
    case "public":
      return "known";
    case "restricted":
      return viewer !== null ? "inference" : "unknown";
    case "private":
      return viewer !== null && entry.personId === viewer ? "known" : "hidden";
    case "secret":
      return entry.personId === viewer ? "known" : "hidden";
    default:
      return "unknown";
  }
}


export interface NeedView {
  readonly kind: NeedKind;
  readonly label: string;
  /** 0 = fully depleted, 1 = fully satisfied (engine convention). */
  readonly level: number;
  readonly urgency: string;
  readonly knowledge: KnowledgeState;
}

export interface ActivityView {
  readonly activityId: string;
  readonly kind: string;
  readonly label: string;
  readonly state: string;
  readonly locationId?: string;
  readonly scheduledStart: WorldTime;
  readonly scheduledEnd: WorldTime;
  readonly startsAtLabel: string;
  readonly endsAtLabel: string;
}

export interface CommitmentView extends ActivityView {
  /** True while the committed window covers the current authoritative time. */
  readonly isNow: boolean;
}

export interface NearbyPersonView {
  /**
   * Stable key for rendering. For someone the viewer has not met, the name is
   * withheld — the id is a list key, not an identification.
   */
  readonly personId: string;
  readonly displayName: string;
  readonly knowledge: KnowledgeState;
  readonly context: string;
}

export interface QuickActionView {
  readonly commandType: string;
  readonly label: string;
  /** Deterministic outcomes are stated as certainties; estimates are not. */
  readonly outcomeKind: "deterministic" | "estimate";
  readonly expectation: string;
  readonly needKind?: NeedKind;
}

export interface LifeSituationView {
  readonly viewerId: EntityId<"person">;
  readonly displayName: string;
  readonly nameKnowledge: KnowledgeState;
  readonly ageYears: number;
  readonly lifeStage: string;
  readonly moodLabel: string;
  readonly moodValence?: number;
  readonly locationId?: string;
  readonly locationName: string;
  readonly householdName?: string;
  readonly householdRole?: string;
  readonly needs: readonly NeedView[];
  readonly mostUrgentNeed?: NeedView;
  readonly currentActivity?: ActivityView;
  readonly commitments: readonly CommitmentView[];
  readonly nearbyPeople: readonly NearbyPersonView[];
  readonly quickActions: readonly QuickActionView[];
  readonly events: readonly EventFeedItem[];
  readonly timeLabel: string;
}

/**
 * Quick actions are drawn from the command registry, not hardcoded here: if a
 * command does not exist in this world, the action is not offered. Amounts are
 * deliberately *not* repeated in the label — the applier decides them — so the
 * text promises determinism without duplicating engine constants.
 */
const QUICK_ACTION_SPECS: readonly {
  readonly commandType: string;
  readonly label: string;
  readonly expectation: string;
  readonly needKind?: NeedKind;
}[] = [
  {
    commandType: "person.eat",
    label: "Eat a meal",
    expectation: "Deterministic: satisfies hunger by a fixed amount and takes a fixed time.",
    needKind: "hunger",
  },
  {
    commandType: "person.sleep",
    label: "Sleep",
    expectation: "Deterministic: restores sleep by a fixed amount; continues until you wake or are interrupted.",
    needKind: "sleep",
  },
  {
    commandType: "person.rest",
    label: "Rest",
    expectation: "Deterministic: a partial recovery, smaller than sleep.",
    needKind: "rest",
  },
  {
    commandType: "person.hygiene",
    label: "Wash up",
    expectation: "Deterministic: satisfies hygiene by a fixed amount.",
    needKind: "hygiene",
  },
  {
    commandType: "person.socialize",
    label: "Socialize",
    expectation: "Deterministic: satisfies social contact; who you reach is not guaranteed.",
    needKind: "social_contact",
  },
];

function activityView(sim: Simulation, activity: Activity): ActivityView {
  return {
    activityId: activity.id,
    kind: activity.kind,
    label: ACTIVITY_LABELS[activity.kind] ?? activity.kind,
    state: activity.state,
    ...(activity.locationId === undefined ? {} : { locationId: activity.locationId }),
    scheduledStart: activity.scheduledStart,
    scheduledEnd: activity.scheduledEnd,
    startsAtLabel: sim.calendar.formatDateTime(activity.scheduledStart),
    endsAtLabel: sim.calendar.formatDateTime(activity.scheduledEnd),
  };
}

/** The viewer's own situation: name, needs, mood, activity, commitments, feed. */
export function getLifeSituation(
  sim: Simulation,
  viewer: EntityId<"person">,
): LifeSituationView {
  const now = sim.clock.time;
  const identity = bag<IdentityState>(sim, "identity");
  const self = identity?.persons.find((person) => person.id === viewer);

  const needsState = bag<NeedsState>(sim, "needs");
  const personNeeds = needsState?.persons.find((entry) => entry.personId === viewer);
  const needs: NeedView[] = (personNeeds?.needs ?? []).map((need) => ({
    kind: need.kind,
    label: NEED_LABELS[need.kind],
    level: need.level,
    urgency: need.urgency,
    knowledge: "known",
  }));
  const mostUrgentNeed =
    needs.length === 0 ? undefined : [...needs].sort((a, b) => a.level - b.level)[0];

  const scale = bag<ScaleSystemState>(sim, "scale");
  const resident = scale?.residents.find((entry) => entry.personId === viewer);
  const geography = bag<GeographySystemState>(sim, "geography");
  const place = resident === undefined
    ? undefined
    : geography?.places.find((candidate) => candidate.id === resident.settlementId);

  const family = bag<FamilySystemState>(sim, "family");
  const household: HouseholdRecord | undefined = family?.households.find((candidate) =>
    candidate.members.some((member) => member.personId === viewer),
  );
  const householdRole = household?.members.find((member) => member.personId === viewer)?.role;

  const mentation = bag<MentationSystemState>(sim, "mentation");
  const mood = mentation?.persons.find((entry) => entry.personId === viewer)?.mood;

  const ageYears = self === undefined
    ? 0
    : Math.max(
        0,
        Math.floor(((now as number) - (self.birth.dateOfBirth as number)) / (365.2425 * 1440)),
      );

  const current = sim.activities.currentActivity(viewer, now);
  const commitments: CommitmentView[] = sim.activities
    .forActor(viewer)
    .filter(
      (activity) =>
        !TERMINAL_ACTIVITY_STATES.includes(activity.state) &&
        (activity.scheduledStart as number) >= (now as number),
    )
    .sort((a, b) => (a.scheduledStart as number) - (b.scheduledStart as number))
    .slice(0, 5)
    .map((activity) => ({
      ...activityView(sim, activity),
      isNow:
        (activity.scheduledStart as number) <= (now as number) &&
        (activity.scheduledEnd as number) > (now as number),
    }));

  const relationships = bag<RelationshipsSystemState>(sim, "relationships");
  const relatedIds = new Set<string>();
  for (const relationship of relationships?.relationships ?? []) {
    if (relationship.from === viewer) relatedIds.add(relationship.to);
    else if (relationship.to === viewer) relatedIds.add(relationship.from);
  }
  const householdIds = new Set<string>(
    household?.members.map((member) => member.personId) ?? [],
  );

  const others = (scale?.residents ?? []).filter(
    (entry) => entry.personId !== viewer && entry.settlementId === resident?.settlementId,
  );
  const nearbyPeople: NearbyPersonView[] = [...others]
    .sort((a, b) => Number(householdIds.has(b.personId)) - Number(householdIds.has(a.personId)))
    .slice(0, 8)
    .map((entry) => {
      const known = householdIds.has(entry.personId) || relatedIds.has(entry.personId);
      const person = known
        ? identity?.persons.find((candidate) => candidate.id === entry.personId)
        : undefined;
      return {
        personId: entry.personId,
        displayName: known ? displayNameOf(person) : "Stranger",
        knowledge: known ? "known" : "unknown",
        context: householdIds.has(entry.personId)
          ? "household member"
          : relatedIds.has(entry.personId)
            ? "someone you know"
            : "someone nearby",
      } satisfies NearbyPersonView;
    });

  const quickActions: QuickActionView[] = QUICK_ACTION_SPECS.filter((spec) =>
    sim.registry.has(spec.commandType),
  ).map((spec) => ({
    commandType: spec.commandType,
    label: spec.label,
    outcomeKind: "deterministic",
    expectation: spec.expectation,
    ...(spec.needKind === undefined ? {} : { needKind: spec.needKind }),
  }));

  return {
    viewerId: viewer,
    displayName: displayNameOf(self),
    nameKnowledge: self === undefined ? "unknown" : "known",
    ageYears,
    lifeStage: lifeStageOf(ageYears),
    moodLabel: mood?.label ?? "steady",
    ...(mood === undefined ? {} : { moodValence: mood.valence }),
    ...(resident === undefined ? {} : { locationId: resident.settlementId }),
    locationName: place?.name ?? "Unplaced",
    ...(household === undefined ? {} : { householdName: household.name }),
    ...(householdRole === undefined ? {} : { householdRole }),
    needs,
    ...(mostUrgentNeed === undefined ? {} : { mostUrgentNeed }),
    ...(current === undefined ? {} : { currentActivity: activityView(sim, current) }),
    commitments,
    nearbyPeople,
    quickActions,
    events: getEventFeedView(sim, viewer, { limit: 6, minimumImportance: 2 }),
    timeLabel: sim.calendar.formatDateTime(now),
  };
}



export interface PersonFieldView {
  readonly label: string;
  readonly value: string;
  readonly knowledge: KnowledgeState;
}

export type PersonRelationToViewer = "self" | "household" | "known" | "stranger";

export interface PersonView {
  readonly personId: string;
  readonly displayName: string;
  readonly nameKnowledge: KnowledgeState;
  readonly relation: PersonRelationToViewer;
  /** Observable, non-private facts (age band, household, where they live). */
  readonly summaryFields: readonly PersonFieldView[];
  /** Facts the viewer may or may not be entitled to (another person's inner life). */
  readonly privateFields: readonly PersonFieldView[];
  readonly notes: readonly string[];
}

/**
 * The viewer's picture of a person (UI/UX 02 section 3).
 *
 * The projection is deliberately *not* symmetric with the engine's knowledge:
 *   - you always know yourself;
 *   - household and relationship context lets you name someone and guess their
 *     broad age band (the aggregate band, not their real age);
 *   - another person's mood and needs are `hidden` no matter what the engine
 *     holds in memory, because seeing them would be telepathy, not simulation.
 */
export function getPersonView(
  sim: Simulation,
  viewer: EntityId<"person">,
  subjectId: string,
): PersonView {
  const identity = bag<IdentityState>(sim, "identity");
  const subject = identity?.persons.find((person) => person.id === subjectId);
  const scale = bag<ScaleSystemState>(sim, "scale");
  const resident = scale?.residents.find((entry) => entry.personId === subjectId);
  const geography = bag<GeographySystemState>(sim, "geography");
  const place = resident === undefined
    ? undefined
    : geography?.places.find((candidate) => candidate.id === resident.settlementId);

  const family = bag<FamilySystemState>(sim, "family");
  const household: HouseholdRecord | undefined = family?.households.find((candidate) =>
    candidate.members.some((member) => member.personId === subjectId),
  );
  const relationships = bag<RelationshipsSystemState>(sim, "relationships");
  const links = (relationships?.relationships ?? []).filter(
    (relationship) => relationship.from === viewer || relationship.to === viewer,
  );
  const isHouseholdMember = (household?.members ?? []).some(
    (member) => member.personId === viewer,
  );
  const isKnown = links.some(
    (relationship) => relationship.from === subjectId || relationship.to === subjectId,
  );
  const isSelf = subjectId === viewer;

  const relation: PersonRelationToViewer = isSelf
    ? "self"
    : isHouseholdMember
      ? "household"
      : isKnown
        ? "known"
        : "stranger";
  const nameKnown = relation !== "stranger";

  const summaryFields: PersonFieldView[] = [];
  if (isSelf) {
    const age =
      subject === undefined
        ? 0
        : Math.max(
            0,
            Math.floor(
              ((sim.clock.time as number) - (subject.birth.dateOfBirth as number)) /
                (365.2425 * 1440),
            ),
          );
    summaryFields.push({ label: "Age", value: `${age} years`, knowledge: "known" });
  } else if (resident !== undefined) {
    summaryFields.push({
      label: "Age band",
      value: `${resident.ageBand} (estimated)`,
      knowledge: nameKnown ? "estimate" : "unknown",
    });
  }
  summaryFields.push({
    label: "Lives in",
    value: place?.name ?? "Unknown",
    knowledge: nameKnown ? "known" : "estimate",
  });
  if (household !== undefined) {
    const role = household.members.find((member) => member.personId === subjectId)?.role;
    summaryFields.push({
      label: "Household",
      value: role === undefined ? household.name : `${household.name} (${role})`,
      knowledge: nameKnown ? "known" : "unknown",
    });
  }

  const ownMood = bag<MentationSystemState>(sim, "mentation")?.persons.find(
    (entry) => entry.personId === viewer,
  )?.mood.label;
  const privateFields: PersonFieldView[] = [
    {
      label: "Mood",
      value: isSelf ? (ownMood ?? "steady") : "Not observable",
      knowledge: isSelf ? "known" : "hidden",
    },
    {
      label: "Needs",
      value: isSelf ? "Visible to you" : "Not observable",
      knowledge: isSelf ? "known" : "hidden",
    },
  ];
  const ownAssessment = links.find(
    (relationship) => relationship.from === viewer && relationship.to === subjectId,
  );
  if (ownAssessment !== undefined) {
    privateFields.push({
      label: "Your read on them",
      value: `closeness ${Math.round(ownAssessment.evaluation.closeness)}, trust ${Math.round(ownAssessment.evaluation.trust)}`,
      knowledge: "inference",
    });
  }

  const notes: string[] = [];
  if (!nameKnown) notes.push("You have not met this person, so their name is not known to you.");
  if (!isSelf) notes.push("Another person's mood and needs are theirs to know; they are not shown.");

  return {
    personId: String(subjectId),
    displayName: nameKnown ? displayNameOf(subject) : "Stranger",
    nameKnowledge: isSelf ? "known" : nameKnown ? "estimate" : "unknown",
    relation,
    summaryFields,
    privateFields,
    notes,
  };
}

export const NOTIFICATION_CATEGORIES = [
  "work",
  "financial",
  "social",
  "health",
  "world",
  "system",
  "milestone",
  "general",
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

/** How loudly a notification is allowed to interrupt (UI/UX 08 section 3). */
export type NotificationDelivery = "interrupt" | "inbox" | "optional";

export interface NotificationView {
  readonly id: string;
  readonly eventId: string;
  readonly at: WorldTime;
  readonly timeLabel: string;
  readonly title: string;
  readonly detail?: string;
  readonly category: NotificationCategory;
  readonly delivery: NotificationDelivery;
  /** Ranked relevance; importance plus whether the viewer was involved. */
  readonly relevance: number;
  readonly involvedViewer: boolean;
  readonly knowledge: KnowledgeState;
  readonly causalChainId?: string;
}

export interface NotificationFeedView {
  readonly notifications: readonly NotificationView[];
  readonly urgentCount: number;
  readonly inboxCount: number;
}

const CATEGORY_KEYWORDS: readonly (readonly [NotificationCategory, readonly string[]])[] = [
  ["work", ["employment", "work", "career", "job", "shift", "dismiss", "hire", "employer"]],
  ["financial", ["finance", "ledger", "money", "rent", "wage", "bill", "payment", "account", "debt"]],
  ["social", ["social", "relationship", "family", "household", "visit", "message", "apology", "friend"]],
  ["health", ["health", "need", "injury", "illness", "nutrition", "sleep", "medical"]],
  ["world", ["world", "geography", "weather", "environment", "disaster", "market", "place"]],
  ["system", ["system", "save", "config", "kernel", "persistence"]],
  ["milestone", ["milestone", "birth", "death", "marriage", "graduat", "legacy", "election"]],
];

function categorize(entry: { readonly eventType?: string; readonly kind: string; readonly tags: readonly string[] }): NotificationCategory {
  const haystack = `${entry.eventType ?? entry.kind} ${entry.tags.join(" ")}`.toLowerCase();
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return "general";
}

/**
 * The notification feed is the *event feed, ranked*. Nothing here is invented:
 * a notification is a view of an event the viewer is entitled to know about
 * (information is not truth, and a notification is not a resolution).
 *
 * Read/acknowledged state is intentionally absent — that is UI-local state,
 * not simulation state, so it never enters the projection (UI/UX 24).
 */
export function getNotificationFeedView(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
  options?: { readonly limit?: number; readonly minimumImportance?: number },
): NotificationFeedView {
  const limit = options?.limit ?? 30;
  const minimumImportance = options?.minimumImportance ?? 2;
  const notifications: NotificationView[] = [];

  for (const entry of sim.history.recent(limit * 4)) {
    if (!visibleTo(viewer, entry.visibility)) continue;
    if (entry.importance < minimumImportance) continue;

    const involvedViewer = viewer !== null && entry.personId === viewer;
    const category = categorize(entry);
    const relevance = entry.importance + (involvedViewer ? 2 : 0);
    const delivery: NotificationDelivery =
      entry.importance >= 5 || (involvedViewer && entry.importance >= 3)
        ? "interrupt"
        : entry.importance >= 3
          ? "inbox"
          : "optional";

    notifications.push({
      id: entry.id,
      eventId: entry.eventId ?? entry.id,
      at: entry.at,
      timeLabel: sim.calendar.formatDateTime(entry.at),
      title: entry.summary,
      ...(entry.detail === undefined ? {} : { detail: entry.detail }),
      category,
      delivery,
      relevance,
      involvedViewer,
      knowledge: knowledgeFromVisibility(viewer, entry),
      ...(entry.causalChainId === undefined ? {} : { causalChainId: entry.causalChainId }),
    });
    if (notifications.length >= limit) break;
  }

  return {
    notifications,
    urgentCount: notifications.filter((notification) => notification.delivery === "interrupt").length,
    inboxCount: notifications.filter((notification) => notification.delivery === "inbox").length,
  };
}

/** Debug inspector entry: one label/value pair, with its knowledge state. */
export interface InspectorFieldView {
  readonly label: string;
  readonly value: string;
  readonly knowledge: KnowledgeState;
}

export interface EntityInspectorView {
  readonly id: string;
  readonly kind: string;
  /** True when the id resolved to a record anywhere in the world bag. */
  readonly found: boolean;
  readonly title: string;
  readonly fields: readonly InspectorFieldView[];
}

export interface CommandLogViewItem {
  readonly id: string;
  readonly type: string;
  readonly origin: string;
  readonly actor: string;
  readonly status: string;
  readonly issuedAt: WorldTime;
  readonly issuedAtLabel: string;
  readonly reasons: readonly string[];
  readonly eventCount: number;
  readonly params: Readonly<Record<string, unknown>>;
}


function scalarFields(source: unknown, limit = 14): InspectorFieldView[] {
  if (source === null || typeof source !== "object") return [];
  const fields: InspectorFieldView[] = [];
  for (const [key, value] of Object.entries(source as Record<string, unknown>)) {
    if (fields.length >= limit) break;
    if (value === null || value === undefined) continue;
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        fields.push({ label: key, value: `[${value.length}]`, knowledge: "known" });
      }
      continue;
    }
    fields.push({ label: key, value: String(value), knowledge: "known" });
  }
  return fields;
}

/**
 * Debug entity inspector (System 57; UI/UX 22).
 *
 * This surface runs under debug authority, so it reads authoritative state on
 * purpose — that is exactly what makes it a debug tool rather than a player
 * view. It is never wired into a player-facing screen. Lookups are generic so
 * new systems become inspectable without editing this function.
 */
export function getEntityInspectorView(sim: Simulation, id: string): EntityInspectorView {
  const bags = sim.world.systems as Record<string, unknown>;
  const keys = Object.keys(bags).sort();

  // Known shapes first, so the most useful summary wins over a generic dump.
  const identity = bags.identity as IdentityState | undefined;
  const person = identity?.persons.find((candidate) => candidate.id === id);
  if (person !== undefined) {
    return {
      id,
      kind: "person",
      found: true,
      title: displayNameOf(person),
      fields: [
        { label: "name", value: displayNameOf(person), knowledge: "known" },
        { label: "dateOfBirth", value: sim.calendar.formatDateTime(person.birth.dateOfBirth), knowledge: "known" },
        { label: "generation", value: String(person.generation), knowledge: "known" },
        ...scalarFields(person.origin),
      ],
    };
  }

  const geography = bags.geography as GeographySystemState | undefined;
  const place = geography?.places.find((candidate) => candidate.id === id);
  if (place !== undefined) {
    return {
      id,
      kind: "place",
      found: true,
      title: place.name,
      fields: [
        { label: "name", value: place.name, knowledge: "known" },
        { label: "level", value: place.level, knowledge: "known" },
        ...(place.parentId === undefined
          ? []
          : [{ label: "parentId", value: place.parentId, knowledge: "known" as const }]),
      ],
    };
  }

  const scale = bags.scale as ScaleSystemState | undefined;
  const resident = scale?.residents.find((candidate) => candidate.personId === id);
  const aggregate = scale?.settlements.find((candidate) => candidate.settlementId === id);
  if (resident !== undefined) {
    return {
      id,
      kind: "resident",
      found: true,
      title: id,
      fields: scalarFields(resident),
    };
  }
  if (aggregate !== undefined) {
    return {
      id,
      kind: "settlementAggregate",
      found: true,
      title: aggregate.settlementId,
      fields: [
        { label: "totalPopulation", value: String(aggregate.totalPopulation), knowledge: "known" },
        {
          label: "materializedResidents",
          value: String(scale?.residents.filter((r) => r.settlementId === id).length ?? 0),
          knowledge: "known",
        },
      ],
    };
  }

  // Generic fallback: any bag entry that carries this id.
  for (const key of keys) {
    const value = bags[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value as readonly unknown[]) {
      if (entry === null || typeof entry !== "object") continue;
      const record = entry as Record<string, unknown>;
      if (record.id !== id && record.personId !== id && record.eventId !== id) continue;
      return {
        id,
        kind: key,
        found: true,
        title: typeof record.name === "string" ? record.name : `${key}:${id}`,
        fields: scalarFields(record),
      };
    }
  }

  return {
    id,
    kind: "unknown",
    found: false,
    title: `No record for ${id}`,
    fields: [],
  };
}

/** Recent commands, newest first — the debug console's audit trail. */
export function getCommandLogView(
  sim: Simulation,
  options?: { readonly limit?: number; readonly type?: string },
): readonly CommandLogViewItem[] {
  const limit = options?.limit ?? 20;
  const entries = sim.commandLog.all();
  const items: CommandLogViewItem[] = [];
  for (let index = entries.length - 1; index >= 0 && items.length < limit; index -= 1) {
    const entry = entries[index];
    if (options?.type !== undefined && entry.type !== options.type) continue;
    items.push({
      id: entry.id,
      type: entry.type,
      origin: entry.origin,
      actor: entry.actor,
      status: entry.status,
      issuedAt: entry.issuedAt,
      issuedAtLabel: sim.calendar.formatDateTime(entry.issuedAt),
      reasons: entry.reasons,
      eventCount: entry.eventIds.length,
      params: entry.params,
    });
  }
  return items;
}


export const SEARCH_RESULT_KINDS = ["person", "place", "household", "event"] as const;
export type SearchResultKind = (typeof SEARCH_RESULT_KINDS)[number];

export interface SearchResultView {
  readonly id: string;
  readonly kind: SearchResultKind;
  readonly label: string;
  readonly detail: string;
  readonly knowledge: KnowledgeState;
  readonly relevance: number;
}

/**
 * Search over what the viewer is *entitled* to know (UI/UX 03 section 6,
 * UI/UX 18). This is the important part of search: it is not a global index.
 * You can find yourself, the people you live with or know, your own household,
 * the places you can locate yourself in, and events you are entitled to see.
 * Someone you have never met is not discoverable, because their existence is
 * not information you hold — searching must not become a second source of truth.
 */
export function searchKnownEntities(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
  query: string,
  options?: { readonly limit?: number },
): readonly SearchResultView[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [];
  const limit = options?.limit ?? 20;
  const results: SearchResultView[] = [];

  const identity = bag<IdentityState>(sim, "identity");
  const family = bag<FamilySystemState>(sim, "family");
  const relationships = bag<RelationshipsSystemState>(sim, "relationships");
  const geography = bag<GeographySystemState>(sim, "geography");
  const scale = bag<ScaleSystemState>(sim, "scale");

  const ownHousehold =
    viewer === null
      ? undefined
      : family?.households.find((household) =>
          household.members.some((member) => member.personId === viewer),
        );
  const householdIds = new Set<string>(
    ownHousehold?.members.map((member) => member.personId) ?? [],
  );
  const relatedIds = new Set<string>();
  for (const relationship of relationships?.relationships ?? []) {
    if (viewer === null) break;
    if (relationship.from === viewer) relatedIds.add(relationship.to);
    else if (relationship.to === viewer) relatedIds.add(relationship.from);
  }

  // People: self, household, known. Nothing else is nameable.
  for (const person of identity?.persons ?? []) {
    const isSelf = person.id === viewer;
    const isHousehold = householdIds.has(person.id);
    const isKnown = relatedIds.has(person.id);
    if (!isSelf && !isHousehold && !isKnown) continue;
    const name = displayNameOf(person);
    if (!name.toLowerCase().includes(needle)) continue;
    results.push({
      id: person.id,
      kind: "person",
      label: isSelf ? `${name} (you)` : name,
      detail: isSelf ? "yourself" : isHousehold ? "household member" : "someone you know",
      knowledge: isSelf ? "known" : isHousehold ? "known" : "estimate",
      relevance: name.toLowerCase().startsWith(needle) ? 3 : 2,
    });
  }

  // Households you belong to.
  if (ownHousehold !== undefined && ownHousehold.name.toLowerCase().includes(needle)) {
    results.push({
      id: ownHousehold.id,
      kind: "household",
      label: ownHousehold.name,
      detail: `${ownHousehold.members.length} member(s)`,
      knowledge: "known",
      relevance: 2,
    });
  }

  // Places: where you are, the chain above it, and the places inside it.
  // Anywhere else is not locatable by the viewer, so it is not searchable.
  const resident = viewer === null
    ? undefined
    : scale?.residents.find((entry) => entry.personId === viewer);
  const places = geography?.places ?? [];
  const byId = new Map(places.map((place) => [place.id, place]));
  const visiblePlaces = new Set<string>();
  if (resident !== undefined) {
    visiblePlaces.add(resident.settlementId);
    let current = byId.get(resident.settlementId);
    let depth = 0;
    while (current?.parentId !== undefined && depth < 16) {
      visiblePlaces.add(current.parentId);
      current = byId.get(current.parentId);
      depth += 1;
    }
    for (const place of places) {
      let parent = place.parentId === undefined ? undefined : byId.get(place.parentId);
      let walk = 0;
      while (parent !== undefined && walk < 16) {
        if (parent.id === resident.settlementId) {
          visiblePlaces.add(place.id);
          break;
        }
        parent = parent.parentId === undefined ? undefined : byId.get(parent.parentId);
        walk += 1;
      }
    }
  }
  for (const place of places) {
    if (!visiblePlaces.has(place.id)) continue;
    if (!place.name.toLowerCase().includes(needle)) continue;
    results.push({
      id: place.id,
      kind: "place",
      label: place.name,
      detail: `${place.level}${resident?.settlementId === place.id ? " — you are here" : ""}`,
      knowledge: "known",
      relevance: place.name.toLowerCase().startsWith(needle) ? 3 : 2,
    });
  }

  // Events: only those the viewer may see.
  for (const entry of sim.history.recent(200)) {
    if (!visibleTo(viewer, entry.visibility)) continue;
    if (!entry.summary.toLowerCase().includes(needle)) continue;
    results.push({
      id: entry.eventId ?? entry.id,
      kind: "event",
      label: entry.summary,
      detail: sim.calendar.formatDateTime(entry.at),
      knowledge: knowledgeFromVisibility(viewer, entry),
      relevance: 1,
    });
  }

  return results
    .sort((a, b) => b.relevance - a.relevance || a.label.localeCompare(b.label))
    .slice(0, limit);
}


export interface KnownPlaceView {
  readonly id: string;
  readonly name: string;
  readonly level: string;
  /** How the viewer relates to it: where they are, or how it contains them. */
  readonly relation: "here" | "containing" | "inside";
  readonly population?: number;
  readonly knowledge: KnowledgeState;
}

export interface WorldView {
  readonly worldName: string;
  readonly worldId: string;
  readonly startDateLabel: string;
  readonly currentDateLabel: string;
  readonly locationName: string;
  readonly places: readonly KnownPlaceView[];
  /** Residents of the viewer's settlement already revealed inside the aggregate. */
  readonly materializedResidents: number;
  readonly aggregatePopulation?: number;
  readonly notes: readonly string[];
}

/**
 * The world as the viewer can actually see it (UI/UX 09, UI/UX 19, UI_UX 04
 * section 2). Only the place chain the viewer occupies is returned, because a
 * life simulator should not hand the player a gazetteer they have never
 * learned; unknown markers stay unknown until knowledge reaches them (M4 adds
 * the knowledge-limited map).
 */
export function getWorldView(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
): WorldView {
  const world = getWorldSummaryView(sim);
  const geography = bag<GeographySystemState>(sim, "geography");
  const scale = bag<ScaleSystemState>(sim, "scale");
  const resident = viewer === null
    ? undefined
    : scale?.residents.find((entry) => entry.personId === viewer);
  const places = geography?.places ?? [];
  const byId = new Map(places.map((place) => [place.id, place]));
  const settlementId = resident?.settlementId;
  const settlement = settlementId === undefined ? undefined : byId.get(settlementId);

  const known: KnownPlaceView[] = [];
  const seen = new Set<string>();
  const residentAggregate =
    settlementId === undefined
      ? undefined
      : scale?.settlements.find((entry) => entry.settlementId === settlementId);
  if (settlementId !== undefined && settlement !== undefined) {
    // The place the viewer stands in.
    known.push({
      id: settlement.id,
      name: settlement.name,
      level: settlement.level,
      relation: "here",
      ...(residentAggregate === undefined
        ? {}
        : { population: residentAggregate.totalPopulation }),
      knowledge: "known",
    });
    seen.add(settlement.id);
    // The chain above it: continent, country, region and so on.
    let current = settlement;
    let depth = 0;
    while (current.parentId !== undefined && depth < 16) {
      const parent = byId.get(current.parentId);
      if (parent === undefined) break;
      known.push({
        id: parent.id,
        name: parent.name,
        level: parent.level,
        relation: "containing",
        knowledge: "known",
      });
      seen.add(parent.id);
      current = parent;
      depth += 1;
    }
    // Anything inside the settlement the viewer occupies.
    for (const place of places) {
      if (seen.has(place.id) || place.parentId !== settlement.id) continue;
      known.push({
        id: place.id,
        name: place.name,
        level: place.level,
        relation: "inside",
        knowledge: "known",
      });
    }
  }

  const aggregate = residentAggregate;
  return {
    worldName: world.worldName,
    worldId: world.worldId,
    startDateLabel: world.startDateLabel,
    currentDateLabel: sim.calendar.formatDateTime(sim.clock.time),
    locationName: settlement?.name ?? "Unplaced",
    places: known,
    materializedResidents: (scale?.residents ?? []).filter(
      (entry) => entry.settlementId === settlementId,
    ).length,
    ...(aggregate === undefined ? {} : { aggregatePopulation: aggregate.totalPopulation }),
    notes:
      settlementId === undefined
        ? ["You are not placed in the world yet, so there is nothing to show."]
        : [
            `Only ${settlement?.name ?? "your settlement"} and what contains it is known to you.`,
            "Places you have never learned about are not shown; discovering them is world knowledge, not a settings toggle.",
          ],
  };
}

