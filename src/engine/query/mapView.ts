/**
 * System 56 — Map & Spatial Presentation (read path); UI/UX 09, UI/UX 19.
 *
 * The map is "a spatial lens over world truth, not a second geography database"
 * (System 56 core principle). This module is that lens, and the contract is the
 * same as `projections.ts` and `lifeViews.ts`:
 *
 *   - **read-only.** Nothing here mutates world state; the projection is derived
 *     and thrown away. Geographic truth stays System 37's, travel time stays
 *     System 45's, population stays System 47's, borders stay System 39's.
 *   - **knowledge-limited.** A marker exists only if *this viewer* knows the
 *     place. Places they have never learned about are absent — not blended out,
 *     not greyed — because "the map must not expose hidden events or entities
 *     merely because they exist in simulation state" (UI/UX 09 section 5). A
 *     camera move onto an unknown place reveals nothing: not its name, not its
 *     position, not its id.
 *   - **level of detail.** Each zoom is anchored on one place and shows only the
 *     levels that belong to that zoom's window (UI/UX 09 section 7, System 07
 *     relevance). Nothing is materialized "solely for visual decoration"
 *     (UI/UX 19 section 7).
 *   - **no invented numbers.** Route distances, durations and costs are copied
 *     from Transportation verbatim. Durations are *formatted*, never computed:
 *     the map does not know what traffic, weather or borders would do to them.
 *
 * Marker states are the vocabulary of UI/UX 19 section 4, each with an actual
 * source rather than a decorative one:
 *
 *   restricted        — System 39 refuses the viewer entry to that country
 *   selected          — the camera's own subject
 *   route-associated  — an endpoint of a shown route
 *   event-associated  — a visible history record happened there
 *   stale             — the viewer's knowledge rests on a dated observation
 *   uncertain         — knowledge came from an entitlement-limited report
 *   approximate       — the place is known, its position is not exact
 *   known             — visited, lived in, or plainly learned
 *
 * `knowledge` travels beside `state` on every marker, so knowing *how well* a
 * place is known is never lost to *what is notable about it* (law 4).
 */

import type { EntityId } from "../primitives/ids.ts";
import type { KnowledgeState } from "../primitives/information.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { GeoPoint, LocationLevel, LocationRef } from "../primitives/location.ts";
import { LOCATION_LEVELS } from "../primitives/location.ts";
import type { Visibility } from "../primitives/information.ts";
import type { Simulation } from "../core/simulation.ts";
import type { GeographySystemState } from "../geography/types.ts";
import type { ScaleSystemState } from "../scale/types.ts";
import type { TravelSystemState, TransportMode } from "../travel/types.ts";
import { TravelEngine } from "../travel/engine.ts";
import type { InfrastructureSystemState } from "../infrastructure/types.ts";
import { InfrastructureEngine } from "../infrastructure/engine.ts";
import type { FamilySystemState } from "../family/types.ts";
import type {
  DisasterIncident,
  EnvironmentSystemState,
  HazardCondition,
  HazardKind,
  WeatherCondition,
  WeatherSnapshot,
} from "../environment/types.ts";
import type { PopulationAggregate, PopulationSystemState } from "../population/types.ts";
import type { BorderAccess, BorderOutcome, CountriesSystemState } from "../countries/types.ts";
import { CountriesEngine } from "../countries/engine.ts";
import { getWorldSummaryView, visibleTo } from "./projections.ts";

/** Zooms the map offers, from widest to narrowest (UI/UX 09 section 7). */
export const MAP_LODS = ["world", "continent", "country", "region", "city"] as const;
export type MapLod = (typeof MAP_LODS)[number];

/** Marker states (UI/UX 19 section 4), each with a real source; see header. */
export const MAP_MARKER_STATES = [
  "known",
  "approximate",
  "uncertain",
  "stale",
  "route-associated",
  "event-associated",
  "selected",
  "restricted",
] as const;
export type MapMarkerState = (typeof MAP_MARKER_STATES)[number];

/** Layers the map knows how to render (UI/UX 09 section 4, UI/UX 19 section 3). */
export const MAP_LAYER_IDS = [
  "settlements",
  "political",
  "population",
  "transport",
  "weather",
  "events",
  "properties",
  "organizations",
  "infrastructure",
  "institutions",
] as const;
export type MapLayerId = (typeof MAP_LAYER_IDS)[number];

export const MAP_LOD_LABELS: Readonly<Record<MapLod, string>> = {
  world: "World",
  continent: "Continent",
  country: "Country",
  region: "Region",
  city: "City",
};

export const MAP_MARKER_STATE_LABELS: Readonly<Record<MapMarkerState, string>> = {
  known: "Known",
  approximate: "Approximate position",
  uncertain: "Uncertain",
  stale: "May be out of date",
  "route-associated": "On a travel route",
  "event-associated": "Something happened here",
  selected: "Selected",
  restricted: "Entry restricted",
};

export const MAP_LAYER_LABELS: Readonly<Record<MapLayerId, string>> = {
  settlements: "Settlements",
  political: "Political",
  population: "Population",
  transport: "Transport",
  weather: "Weather & hazards",
  events: "Events",
  properties: "Properties",
  organizations: "Organizations",
  infrastructure: "Infrastructure",
  institutions: "Institutions",
};

/**
 * The level a zoom is anchored on: the camera's subject. A `city` zoom of a
 * district is anchored on the settlement that contains it.
 */
const LOD_ANCHOR_LEVEL: Readonly<Record<MapLod, LocationLevel>> = {
  world: "world",
  continent: "continent",
  country: "country",
  region: "region",
  city: "settlement",
};

/**
 * Which place levels a zoom *shows* inside its anchor. This is the whole LOD
 * mechanism (System 07): a zoom never walks the entire world, and no place is
 * instantiated just to decorate the view.
 */
const LOD_WINDOW_LEVELS: Readonly<Record<MapLod, readonly LocationLevel[]>> = {
  world: ["continent", "region"], // the continents and the oceans between them
  continent: ["country", "region"],
  country: ["region", "settlement"],
  region: ["settlement"],
  city: ["district", "neighborhood"],
};

/** Safety cap per projection; the LOD window is the real bound. */
export const MAP_MARKER_BUDGET = 240;
/** Travel options shown per projection (the fastest route per destination). */
export const MAP_ROUTE_BUDGET = 24;
/**
 * How many visible history records are scanned for place association. History is
 * curated and already bounded (System 54), so this is a scan bound, not state.
 */
const MAP_EVENT_SCAN_LIMIT = 400;
/**
 * Knowledge older than this is shown as possibly stale rather than current: a
 * place last visited two years ago is *remembered*, not observed. Provisional
 * (docs/CONTENT_GAPS.md) — residence is never stale, only observations are.
 */
export const MAP_STALE_AFTER_DAYS = 730;
const MINUTES_PER_DAY = 24 * 60;
const MAX_ANCESTRY_DEPTH = 24;

/** Where the camera is: a zoom plus the place it is centred on. */
export interface MapCamera {
  readonly lod: MapLod;
  /**
   * The subject of the camera. Omitted means "where the viewer is" — the map
   * defaults to the viewer's own settlement rather than to an abstract world.
   */
  readonly focusId?: string;
}

export type MapPositionConfidence = "exact" | "approximate";

export interface MapPositionView {
  readonly latitude: number;
  readonly longitude: number;
  /** `exact` = the viewer has been there; `approximate` = they were told of it. */
  readonly confidence: MapPositionConfidence;
}

export interface MapMarkerPoliticalView {
  readonly countryId: string;
  readonly countryName: string;
  readonly governmentType: string;
  readonly currencyCode?: string;
  readonly currencyName?: string;
}

export interface MapMarkerPopulationView {
  /** Aggregate population (System 47). Always an estimate for the viewer. */
  readonly value: number;
  readonly knowledge: KnowledgeState;
}

export interface MapMarkerWeatherView {
  readonly condition: WeatherCondition;
  readonly conditionLabel: string;
  readonly temperatureCelsius: number;
  readonly observedAtLabel: string;
}

export interface MapMarkerHazardView {
  readonly kind: HazardKind;
  readonly kindLabel: string;
  readonly intensity: number;
  readonly sinceLabel: string;
}

export interface MapMarkerView {
  readonly id: string;
  readonly name: string;
  readonly level: LocationLevel;
  /** How well the viewer knows this place (law 4: information is not truth). */
  readonly knowledge: KnowledgeState;
  /** What is notable about it for the map (UI/UX 19 section 4). */
  readonly state: MapMarkerState;
  readonly position?: MapPositionView;
  /** Former names, so a renamed place stays traceable (UI/UX 19 section 6). */
  readonly formerNames: readonly string[];
  readonly population?: MapMarkerPopulationView;
  readonly weather?: MapMarkerWeatherView;
  readonly hazards: readonly MapMarkerHazardView[];
  readonly disasters: readonly { readonly kind: HazardKind; readonly stage: string }[];
  readonly political?: MapMarkerPoliticalView;
  /** Viewer-visible history records located here. */
  readonly visibleEventCount: number;
  /** Why the viewer knows it: residence, household, travel, presence or report. */
  readonly knowledgeSources: readonly string[];
}

export interface MapRouteBorderView {
  readonly access: BorderAccess;
  readonly outcome: BorderOutcome;
  readonly source: "regime" | "framework" | "default";
  readonly regimeId?: string;
  readonly frameworkId?: string;
}

export interface MapRouteView {
  readonly id: string;
  readonly mode: TransportMode;
  readonly modeLabel: string;
  readonly corridor?: string;
  readonly fromPlaceId: string;
  readonly fromName: string;
  readonly toPlaceId: string;
  readonly toName: string;
  readonly distanceKm: number;
  /** Copied from Transportation verbatim; this layer never computes a duration. */
  readonly durationMinutes: number;
  readonly durationLabel: string;
  readonly costMinorUnits: number;
  readonly costLabel: string;
  readonly isInternational: boolean;
  /** Other routes to the same destination that are not shown here. */
  readonly alternatives: number;
  readonly border?: MapRouteBorderView;
}

export interface MapLayerView {
  readonly id: MapLayerId;
  readonly label: string;
  readonly status: "shown" | "unavailable";
  readonly itemCount: number;
  /** Why a layer is unavailable; present only when `status` says so. */
  readonly reason?: string;
}

export interface MapFocusView {
  readonly known: boolean;
  readonly name: string;
  readonly level: LocationLevel | "unknown";
  readonly position?: MapPositionView;
  /** Anchor chain, root-first: world → … → anchor. */
  readonly containers: readonly {
    readonly id: string;
    readonly name: string;
    readonly level: LocationLevel;
  }[];
}

export interface MapLodOption {
  readonly id: MapLod;
  readonly label: string;
}

export interface MapView {
  readonly worldName: string;
  readonly lod: MapLod;
  readonly lods: readonly MapLodOption[];
  readonly focus: MapFocusView;
  readonly anchorName?: string;
  readonly markers: readonly MapMarkerView[];
  readonly routes: readonly MapRouteView[];
  readonly layers: readonly MapLayerView[];
  /** How many places in the whole world this viewer knows (not just the window). */
  readonly knownPlaceCount: number;
  readonly markerBudget: number;
  readonly nowLabel: string;
  readonly notes: readonly string[];
}

export interface MapViewOptions {
  readonly camera?: MapCamera;
}

/**
 * One derived knowledge record per place the viewer knows.
 *
 * This is *derived* state (law 9): it is recomputed from the systems that own
 * the underlying facts — residence (scale), household (family), journeys
 * (travel), records (history) — and is never persisted. System 49's claim graph
 * (M6) will become another source here rather than a replacement for this.
 */
export interface PlaceKnowledgeEntry {
  readonly placeId: string;
  readonly state: KnowledgeState;
  readonly position: MapPositionConfidence;
  /** When the viewer's knowledge of this place was acquired or last refreshed. */
  readonly since: WorldTime;
  readonly sources: readonly string[];
}

// ---------------------------------------------------------------- helpers ---

function bag<T>(sim: Simulation, key: string): T | undefined {
  return sim.world.systems[key] as T | undefined;
}

function levelRank(level: LocationLevel): number {
  const index = LOCATION_LEVELS.indexOf(level);
  return index < 0 ? LOCATION_LEVELS.length : index;
}

const WEATHER_LABELS: Readonly<Record<WeatherCondition, string>> = {
  clear: "Clear",
  partly_cloudy: "Partly cloudy",
  overcast: "Overcast",
  rain: "Rain",
  storm: "Storm",
  snow: "Snow",
  heatwave: "Heatwave",
  cold_snap: "Cold snap",
  fog: "Fog",
  windy: "Windy",
  drought: "Drought",
};

const HAZARD_LABELS: Readonly<Record<HazardKind, string>> = {
  flood: "Flood",
  drought: "Drought",
  storm: "Storm",
  wildfire: "Wildfire",
  earthquake: "Earthquake",
  volcanic: "Volcanic activity",
  landslide: "Landslide",
  extreme_heat: "Extreme heat",
  pollution: "Pollution",
  degradation: "Environmental degradation",
};

const MODE_LABELS: Readonly<Record<TransportMode, string>> = {
  road: "Road",
  rail: "Rail",
  maritime: "Sea",
  flight: "Air",
  foot: "On foot",
};

/** Strongest first. Used only to pick between two sources for one place. */
const KNOWLEDGE_RANK: Readonly<Record<KnowledgeState, number>> = {
  known: 4,
  estimate: 3,
  inference: 2,
  rumor: 1,
  unknown: 0,
  hidden: 0,
};

function positionOf(
  coordinates: GeoPoint | undefined,
  confidence: MapPositionConfidence,
): MapPositionView | undefined {
  if (coordinates === undefined) return undefined;
  return { latitude: coordinates.latitude, longitude: coordinates.longitude, confidence };
}

function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** Formats minor units with the currency reference System 39 owns. */
function costLabel(
  minorUnits: number,
  reference: { readonly code: string; readonly minorUnitScale: number } | undefined,
): string {
  if (reference === undefined) return `${minorUnits} minor units`;
  const scale = Math.max(0, Math.min(4, Math.trunc(reference.minorUnitScale)));
  return `${(minorUnits / 10 ** scale).toFixed(scale)} ${reference.code}`;
}

/** Renders a stored `Visibility` as the viewer's relationship to a record. */
function knowledgeFromEntry(
  viewer: EntityId<"person">,
  entry: { readonly visibility: Visibility; readonly personId?: EntityId<"person"> },
): KnowledgeState {
  switch (entry.visibility) {
    case "public":
      return "known";
    case "restricted":
      return "inference";
    case "private":
      return entry.personId === viewer ? "known" : "hidden";
    case "secret":
      return entry.personId === viewer ? "known" : "hidden";
    default:
      return "unknown";
  }
}

/** Parent chain root-first, inclusive of `start`; stops on corruption, not runs on. */
function ancestryChain(
  byId: ReadonlyMap<string, LocationRef>,
  start: LocationRef,
): readonly LocationRef[] {
  const chain: LocationRef[] = [start];
  let current = start;
  let depth = 0;
  while (current.parentId !== undefined && depth < MAX_ANCESTRY_DEPTH) {
    const parent = byId.get(current.parentId);
    if (parent === undefined) break;
    chain.push(parent);
    current = parent;
    depth += 1;
  }
  return chain.reverse();
}

function isWithinById(
  byId: ReadonlyMap<string, LocationRef>,
  place: LocationRef,
  ancestorId: string,
): boolean {
  let current: LocationRef | undefined = place;
  let depth = 0;
  while (current !== undefined && depth <= MAX_ANCESTRY_DEPTH) {
    if (String(current.id) === ancestorId) return true;
    current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    depth += 1;
  }
  return false;
}

/**
 * State-bag lookups, kept next to the marker builder instead of scattered.
 * They read flat arrays by id exactly the way the owning engines' own reads
 * do — `find` over `state.weather`, `state.aggregates` and friends — because a
 * projection must never invent a derived value the owner does not report.
 */
function findWeather(
  environment: EnvironmentSystemState | undefined,
  placeId: string,
): WeatherSnapshot | undefined {
  return environment?.weather.find((snapshot) => snapshot.locationId === placeId);
}

function findHazards(
  environment: EnvironmentSystemState | undefined,
  placeId: string,
): readonly HazardCondition[] {
  return environment?.hazards.filter((hazard) => hazard.locationId === placeId) ?? [];
}

function findActiveDisasters(
  environment: EnvironmentSystemState | undefined,
  placeId: string,
): readonly DisasterIncident[] {
  return (
    environment?.disasters.filter(
      (incident) => incident.locationId === placeId && incident.stage !== "recovery",
    ) ?? []
  );
}

function findAggregate(
  population: PopulationSystemState | undefined,
  placeId: string,
): PopulationAggregate | undefined {
  return population?.aggregates.find((aggregate) => aggregate.locationId === placeId);
}

// --------------------------------------------------------- place knowledge ---

interface KnowledgeSeed {
  readonly state: KnowledgeState;
  readonly position: MapPositionConfidence;
  readonly since: WorldTime;
  readonly sources: readonly string[];
}

interface KnowledgeCollection {
  readonly entries: readonly PlaceKnowledgeEntry[];
  /** Viewer-visible records located at each place. */
  readonly eventCounts: ReadonlyMap<string, number>;
}

/**
 * Derives which places a person knows, from records other systems already own.
 *
 * The rules are deliberately conservative: nothing is "generally known" yet.
 * Public/global knowledge (atlases, schooling, media — Systems 23/49, M6) will
 * raise knowledge through this same function, so today's map is a *strictly*
 * personal one rather than one seeded with facts the viewer never received.
 */
function collectKnowledge(sim: Simulation, viewer: EntityId<"person">): KnowledgeCollection {
  const geography = bag<GeographySystemState>(sim, "geography");
  const eventCounts = new Map<string, number>();
  if (geography === undefined) return { entries: [], eventCounts };

  const records = new Map<
    string,
    { state: KnowledgeState; position: MapPositionConfidence; since: WorldTime; sources: string[] }
  >();

  // Strongest source wins; among equally strong sources the fresher one wins.
  const remember = (placeId: string, seed: KnowledgeSeed): void => {
    const existing = records.get(placeId);
    if (existing === undefined) {
      records.set(placeId, {
        state: seed.state,
        position: seed.position,
        since: seed.since,
        sources: [...seed.sources],
      });
      return;
    }
    for (const source of seed.sources) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
    const betterPosition = seed.position === "exact" && existing.position === "approximate";
    const samePosition = seed.position === existing.position;
    const betterState = samePosition && KNOWLEDGE_RANK[seed.state] > KNOWLEDGE_RANK[existing.state];
    const fresher =
      samePosition &&
      KNOWLEDGE_RANK[seed.state] === KNOWLEDGE_RANK[existing.state] &&
      (seed.since as number) > (existing.since as number);
    if (betterPosition || betterState || fresher) {
      existing.state = seed.state;
      existing.position = seed.position;
      existing.since = seed.since;
    }
  };

  // 1. Where the viewer lives, and the parts of it (Systems 07/37): exact.
  const scale = bag<ScaleSystemState>(sim, "scale");
  const residence = scale?.residents.find((resident) => resident.personId === viewer);
  if (residence !== undefined) {
    remember(residence.settlementId, {
      state: "known",
      position: "exact",
      since: residence.materializedAt,
      sources: ["residence"],
    });
    for (const place of geography.places) {
      if (place.parentId !== residence.settlementId) continue;
      remember(String(place.id), {
        state: "known",
        position: "exact",
        since: residence.materializedAt,
        sources: ["residence"],
      });
    }
  }

  // 2. Household addresses (System 19): a member knows where their household is.
  const family = bag<FamilySystemState>(sim, "family");
  for (const household of family?.households ?? []) {
    if (household.residenceLocationId === undefined) continue;
    if (!household.members.some((member) => member.personId === viewer)) continue;
    remember(household.residenceLocationId, {
      state: "known",
      position: "exact",
      since: household.createdAt,
      sources: ["household"],
    });
  }

  // 3. Journeys (System 45): travel is how a personal map grows.
  const travel = bag<TravelSystemState>(sim, "travel");
  for (const journey of travel?.history ?? []) {
    if (journey.personId !== viewer) continue;
    const observed = { state: "known", position: "exact", since: journey.completedAt } as const;
    remember(journey.fromSettlementId, { ...observed, sources: ["travel"] });
    remember(journey.toSettlementId, { ...observed, sources: ["travel"] });
  }
  for (const journey of travel?.activeJourneys ?? []) {
    if (journey.personId !== viewer) continue;
    const observed = { state: "known", position: "exact", since: journey.departedAt } as const;
    remember(journey.originSettlementId, { ...observed, sources: ["travel"] });
    remember(journey.destinationSettlementId, { ...observed, sources: ["travel"] });
  }

  // 4. Records the viewer may see (System 54, standing in for System 49's claim
  // graph until M6). An entry at a place they were not at tells them the place
  // exists; it does not hand them its coordinates.
  for (const entry of sim.history.recent(MAP_EVENT_SCAN_LIMIT)) {
    const locationId = entry.locationId;
    if (locationId === undefined) continue;
    if (!visibleTo(viewer, entry.visibility)) continue;
    eventCounts.set(locationId, (eventCounts.get(locationId) ?? 0) + 1);
    if (entry.personId === viewer) {
      remember(locationId, {
        state: "known",
        position: "exact",
        since: entry.at,
        sources: ["presence"],
      });
      continue;
    }
    const reported = knowledgeFromEntry(viewer, entry);
    if (reported === "hidden" || reported === "unknown") continue;
    remember(locationId, {
      state: reported === "known" ? "estimate" : reported,
      position: "approximate",
      since: entry.at,
      sources: ["report"],
    });
  }

  // 5. Knowing a place means knowing what contains it. The chain from the world
  // down is not extra knowledge; it is the same knowledge.
  const byId = new Map<string, LocationRef>(
    geography.places.map((place) => [String(place.id), place]),
  );
  for (const [placeId, record] of [...records]) {
    let current = byId.get(placeId)?.parentId;
    let depth = 0;
    while (current !== undefined && depth < MAX_ANCESTRY_DEPTH) {
      const parent = byId.get(current);
      if (parent === undefined) break;
      const parentId = String(parent.id);
      if (!records.has(parentId)) {
        remember(parentId, {
          state: record.state,
          position: record.position,
          since: record.since,
          sources: [...record.sources, "context"],
        });
      }
      current = parent.parentId;
      depth += 1;
    }
  }

  const entries: PlaceKnowledgeEntry[] = [...records.entries()]
    .map(([placeId, record]) => ({
      placeId,
      state: record.state,
      position: record.position,
      since: record.since,
      sources: [...record.sources],
    }))
    .sort((a, b) => a.placeId.localeCompare(b.placeId));

  return { entries, eventCounts };
}

/** Every place the viewer knows, and why. See `PlaceKnowledgeEntry`. */
export function derivePlaceKnowledge(
  sim: Simulation,
  viewer: EntityId<"person"> | null,
): readonly PlaceKnowledgeEntry[] {
  if (viewer === null) return [];
  return collectKnowledge(sim, viewer).entries;
}

// -------------------------------------------------------------- the lens ---

/**
 * Everything the projection reads, resolved once. Engines are constructed only
 * when their state already exists: constructing one *creates* its slot, and a
 * read path must never write (law 1, law 3).
 */
interface MapContext {
  readonly sim: Simulation;
  readonly viewer: EntityId<"person">;
  readonly now: WorldTime;
  readonly places: readonly LocationRef[];
  readonly byId: ReadonlyMap<string, LocationRef>;
  readonly knowledge: ReadonlyMap<string, PlaceKnowledgeEntry>;
  readonly eventCounts: ReadonlyMap<string, number>;
  readonly residenceSettlementId: string | undefined;
  readonly travel: TravelEngine | undefined;
  readonly countries: CountriesEngine | undefined;
  readonly population: PopulationSystemState | undefined;
  readonly environment: EnvironmentSystemState | undefined;
  readonly infrastructure: InfrastructureEngine | undefined;
}

/** The country containing a place, by walking System 37's hierarchy. */
function countryOf(context: MapContext, placeId: string): LocationRef | undefined {
  let current = context.byId.get(placeId);
  let depth = 0;
  while (current !== undefined && depth <= MAX_ANCESTRY_DEPTH) {
    if (current.level === "country") return current;
    current = current.parentId === undefined ? undefined : context.byId.get(current.parentId);
    depth += 1;
  }
  return undefined;
}

/**
 * Travel options from where the viewer is to every place they know.
 *
 * Selection only: the fastest route per destination is the one shown, which is
 * System 45's own default (`TravelEngine.findRoute` with no preferred mode).
 * Distance, duration and cost are copied out verbatim — the map never computes
 * a travel time, because it does not own route validity or speed (System 56
 * "Does not own") and does not model traffic, weather or borders.
 */
function buildRoutes(
  context: MapContext,
  endpoints: Set<string>,
): readonly MapRouteView[] {
  const { travel, countries, now, byId, knowledge, residenceSettlementId } = context;
  if (travel === undefined || residenceSettlementId === undefined) return [];
  if (!knowledge.has(residenceSettlementId)) return [];

  const currencyOf = (countryId: string | undefined) =>
    countryId === undefined || countries === undefined
      ? undefined
      : countries.currencyOfCountry(countryId, now);

  const destinations = [...knowledge.keys()]
    .map((placeId) => byId.get(placeId))
    .filter(
      (place): place is LocationRef =>
        place !== undefined &&
        place.level === "settlement" &&
        String(place.id) !== residenceSettlementId,
    )
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const views: MapRouteView[] = [];
  for (const destination of destinations) {
    const destinationId = String(destination.id);
    const route = travel.findRoute(residenceSettlementId, destinationId);
    if (route === undefined) continue;
    const alternatives =
      travel.routesFrom(residenceSettlementId).filter(
        (candidate) => candidate.destinationSettlementId === destinationId,
      ).length - 1;

    const fromCountry = countryOf(context, residenceSettlementId);
    const toCountry = countryOf(context, destinationId);
    let border: MapRouteBorderView | undefined;
    if (countries !== undefined && route.isInternational && fromCountry !== undefined && toCountry !== undefined) {
      const decision = countries.borderAccess({ from: fromCountry.id, to: toCountry.id, at: now });
      border = {
        access: decision.access,
        outcome: decision.outcome,
        source: decision.source,
        ...(decision.regimeId === undefined ? {} : { regimeId: decision.regimeId }),
        ...(decision.frameworkId === undefined ? {} : { frameworkId: decision.frameworkId }),
      };
    }

    views.push({
      id: route.id,
      mode: route.mode,
      modeLabel: MODE_LABELS[route.mode],
      ...(route.corridor === undefined ? {} : { corridor: route.corridor }),
      fromPlaceId: residenceSettlementId,
      fromName: byId.get(residenceSettlementId)?.name ?? residenceSettlementId,
      toPlaceId: destinationId,
      toName: destination.name,
      distanceKm: route.distanceKm,
      durationMinutes: route.durationMinutes,
      durationLabel: durationLabel(route.durationMinutes),
      costMinorUnits: route.costMinorUnits,
      costLabel: costLabel(route.costMinorUnits, currencyOf(fromCountry?.id)),
      isInternational: route.isInternational,
      alternatives: Math.max(0, alternatives),
      ...(border === undefined ? {} : { border }),
    });
  }

  const shown = views
    .sort((a, b) => a.durationMinutes - b.durationMinutes || a.id.localeCompare(b.id))
    .slice(0, MAP_ROUTE_BUDGET);
  for (const route of shown) {
    endpoints.add(route.fromPlaceId);
    endpoints.add(route.toPlaceId);
  }
  return shown;
}

// ------------------------------------------------------------- markers ---

interface MarkerOptions {
  readonly entry: PlaceKnowledgeEntry;
  readonly selected: boolean;
  readonly onRoute: boolean;
  readonly restricted: boolean;
  /** Conditions are observable where the viewer is, not from hearsay (M6). */
  readonly conditions: boolean;
}

/**
 * One marker: what the place is, how well the viewer knows it, and what is
 * notable about it. `knowledge` and `state` are separate on purpose — the first
 * is entitlement, the second is salience, and collapsing them would lose one.
 */
// -------------------------------------------------------------- layers ---

function unavailableLayer(id: MapLayerId, reason: string): MapLayerView {
  return { id, label: MAP_LAYER_LABELS[id], status: "unavailable", itemCount: 0, reason };
}

interface LayerSource {
  readonly countries: CountriesEngine | undefined;
  readonly travel: TravelEngine | undefined;
  readonly infrastructure: InfrastructureEngine | undefined;
  readonly population: PopulationSystemState | undefined;
  readonly environment: EnvironmentSystemState | undefined;
  readonly infrastructureAssets: number;
}

/**
 * Which layers carry content and which sit out honestly. A layer is a lens
 * over another system's truth, never a private copy of it — so a world without
 * System 39 loaded says the political layer is *unavailable*, and M5/M6 systems
 * are named as its future owners rather than faked with placeholders.
 */
function buildLayers(
  source: LayerSource,
  markers: readonly MapMarkerView[],
  routes: readonly MapRouteView[],
): readonly MapLayerView[] {
  const counts: Partial<Record<MapLayerId, number>> = {
    settlements: markers.length,
    political: source.countries === undefined ? 0 : markers.filter((m) => m.political !== undefined).length,
    population: source.population === undefined ? 0 : markers.filter((m) => m.population !== undefined).length,
    transport: routes.length,
    weather: source.environment === undefined ? 0 : markers.filter((m) => m.weather !== undefined).length,
    events: markers.filter((m) => m.visibleEventCount > 0).length,
    infrastructure: source.infrastructureAssets,
  };
  const unavailable: Partial<Record<MapLayerId, string>> = {
    ...(source.countries === undefined
      ? { political: "Country configuration and world rules (System 39) are not loaded in this world." }
      : {}),
    ...(source.travel === undefined
      ? { transport: "Transportation (System 45) is not loaded in this world." }
      : {}),
    ...(source.population === undefined
      ? { population: "Population aggregates (System 47) are not loaded in this world." }
      : {}),
    ...(source.environment === undefined
      ? { weather: "Weather and environment state (System 46) are not loaded in this world." }
      : {}),
    ...(source.infrastructure === undefined
      ? { infrastructure: "Infrastructure operations (System 38) are not loaded in this world." }
      : {}),
    properties: "Housing & property (System 27) arrives in M5.",
    organizations: "Organizations & businesses (System 33) arrive in M5.",
    institutions: "Institutions & institutional memory (System 42) arrive in M6.",
  };
  return MAP_LAYER_IDS.map((id) => {
    const reason = unavailable[id];
    if (reason !== undefined) return unavailableLayer(id, reason);
    return { id, label: MAP_LAYER_LABELS[id], status: "shown" as const, itemCount: counts[id] ?? 0 };
  });
}

function unknownFocusView(): MapFocusView {
  // No id, no name, no position: an unknown focus must not echo back what the
  // caller asked for, because the caller's ask is not yet entitlement.
  return { known: false, name: "Unknown place", level: "unknown", containers: [] };
}

function emptyMapView(
  worldName: string,
  lod: MapLod,
  nowLabel: string,
  focus: MapFocusView,
  notes: readonly string[],
): MapView {
  return {
    worldName,
    lod,
    lods: MAP_LODS.map((id) => ({ id, label: MAP_LOD_LABELS[id] })),
    focus,
    markers: [],
    routes: [],
    layers: MAP_LAYER_IDS.map((id) =>
      id === "settlements" || id === "events"
        ? { id, label: MAP_LAYER_LABELS[id], status: "shown" as const, itemCount: 0 }
        : unavailableLayer(id, "No viewpoint, no focus: the map cannot attribute a layer to anyone."),
    ),
    knownPlaceCount: 0,
    markerBudget: MAP_MARKER_BUDGET,
    nowLabel,
    notes,
  };
}

/**
 * One marker: what the place is, how well the viewer knows it, and what is
 * notable about it. `knowledge` and `state` are separate on purpose — the first
 * is entitlement, the second is salience, and collapsing them would lose one.
 */
function buildMarker(context: MapContext, place: LocationRef, options: MarkerOptions): MapMarkerView {
  const placeId = String(place.id);
  const { now, calendar } = { now: context.now, calendar: context.sim.calendar };
  const visibleEventCount = context.eventCounts.get(placeId) ?? 0;
  const residenceBacked =
    options.entry.sources.includes("residence") || options.entry.sources.includes("household");
  const stale =
    !residenceBacked &&
    (now as number) - (options.entry.since as number) > MAP_STALE_AFTER_DAYS * MINUTES_PER_DAY;

  let state: MapMarkerState;
  if (options.restricted) state = "restricted";
  else if (options.selected) state = "selected";
  // Staleness outranks route/event association: how well the place is known
  // conditions everything else on the marker, while the association itself is
  // preserved in the routes list and the visible-event count. Without this a
  // connected settlement could never read as stale, because any known
  // settlement with a route would always report "route-associated" instead.
  else if (stale) state = "stale";
  else if (options.onRoute) state = "route-associated";
  else if (visibleEventCount > 0) state = "event-associated";
  else if (options.entry.state === "inference" || options.entry.state === "rumor") state = "uncertain";
  else if (options.entry.position === "approximate") state = "approximate";
  else state = "known";

  const position = positionOf(place.coordinates, options.entry.position);
  const weather = options.conditions ? findWeather(context.environment, placeId) : undefined;
  const hazards = options.conditions ? findHazards(context.environment, placeId) : [];
  const disasters = options.conditions ? findActiveDisasters(context.environment, placeId) : [];
  const aggregate = findAggregate(context.population, placeId);

  const country = countryOf(context, placeId);
  let political: MapMarkerPoliticalView | undefined;
  if (
    country !== undefined &&
    context.countries !== undefined &&
    context.knowledge.has(String(country.id))
  ) {
    const configuration = context.countries.configurationAt(String(country.id), now);
    if (configuration !== undefined) {
      const currency = context.countries.currencyOfCountry(String(country.id), now);
      political = {
        countryId: String(country.id),
        countryName: country.name,
        governmentType: configuration.governmentType,
        ...(currency === undefined ? {} : { currencyCode: currency.code, currencyName: currency.name }),
      };
    }
  }

  return {
    id: placeId,
    name: place.name,
    level: place.level,
    knowledge: options.entry.state,
    state,
    ...(position === undefined ? {} : { position }),
    formerNames: place.historicalNames ?? [],
    ...(aggregate === undefined
      ? {}
      : { population: { value: aggregate.totalPopulation, knowledge: "estimate" as const } }),
    ...(weather === undefined
      ? {}
      : {
          weather: {
            condition: weather.condition,
            conditionLabel: WEATHER_LABELS[weather.condition],
            temperatureCelsius: weather.temperatureCelsius,
            observedAtLabel: calendar.formatDateTime(weather.observedAt),
          },
        }),
    hazards: hazards.map((hazard) => ({
      kind: hazard.kind,
      kindLabel: HAZARD_LABELS[hazard.kind],
      intensity: hazard.intensity,
      sinceLabel: calendar.formatDateTime(hazard.since),
    })),
    disasters: disasters.map((incident) => ({ kind: incident.kind, stage: incident.stage })),
    ...(political === undefined ? {} : { political }),
    visibleEventCount,
    knowledgeSources: options.entry.sources,
  };
}

/**
 * The map as this viewer may see it (UI/UX 09, UI/UX 19): one zoom, centred on
 * one subject, with only the places they know.
 *
 * Two rules are what make this a lens rather than a leak:
 *   1. every marker is gated on `derivePlaceKnowledge` — no knowledge, no marker,
 *      including routes whose destination is unknown;
 *   2. an unknown camera focus answers with an empty window and carries no
 *      trace of what was asked for.
 */
export function getMapView(sim: Simulation, viewer: EntityId<"person"> | null, options: MapViewOptions = {}): MapView {
  const worldName = getWorldSummaryView(sim).worldName;
  const lod = options.camera?.lod ?? "city";
  const lods = MAP_LODS.map((id) => ({ id, label: MAP_LOD_LABELS[id] }));
  const now = sim.clock.time;
  const nowLabel = sim.calendar.formatDateTime(now);

  if (viewer === null) {
    return emptyMapView(worldName, lod, nowLabel, unknownFocusView(), [
      "This world has no controlled person, so there is no viewpoint to limit the map by.",
    ]);
  }

  const geography = bag<GeographySystemState>(sim, "geography");
  if (geography === undefined) {
    return emptyMapView(worldName, lod, nowLabel, unknownFocusView(), [
      "This world has no registered geography, so there is nothing to draw.",
    ]);
  }

  const byId = new Map<string, LocationRef>(geography.places.map((place) => [String(place.id), place],));
  const collected = collectKnowledge(sim, viewer);
  const knowledge = new Map(collected.entries.map((entry) => [entry.placeId, entry]));
  const scale = bag<ScaleSystemState>(sim, "scale");
  const residenceSettlementId = scale?.residents.find((resident) => resident.personId === viewer)?.settlementId;

  const requestedFocusId = options.camera?.focusId ?? residenceSettlementId;
  const focusPlace = requestedFocusId === undefined ? undefined : byId.get(requestedFocusId);
  if (focusPlace === undefined || !knowledge.has(String(focusPlace.id))) {
    return emptyMapView(worldName, lod, nowLabel, unknownFocusView(), [
      "That place is not one you know: moving the map never reveals a location you have not learned about.",
    ]);
  }

  // The anchor is what the zoom is *about*: the agreed level above the subject.
  const chain = ancestryChain(byId, focusPlace);
  const anchor =
    chain.find((place) => place.level === LOD_ANCHOR_LEVEL[lod]) ?? chain[chain.length - 1] ?? focusPlace;
  const anchorId = String(anchor.id);
  if (!knowledge.has(anchorId)) {
    return emptyMapView(worldName, lod, nowLabel, unknownFocusView(), [
      "That place is not one you know: moving the map never reveals a location you have not learned about.",
    ]);
  }

  const windowPlaces = geography.places.filter(
    (place) => LOD_WINDOW_LEVELS[lod].includes(place.level) && isWithinById(byId, place, anchorId),
  );

  const travelState = bag<TravelSystemState>(sim, "travel");
  const countriesState = bag<CountriesSystemState>(sim, "countries");
  const infrastructureState = bag<InfrastructureSystemState>(sim, "infrastructure");
  const context: MapContext = {
    sim,
    viewer,
    now,
    places: geography.places,
    byId,
    knowledge,
    eventCounts: collected.eventCounts,
    residenceSettlementId,
    travel: travelState === undefined ? undefined : new TravelEngine(sim.scope, sim.world),
    countries: countriesState === undefined ? undefined : new CountriesEngine(sim.scope, sim.world),
    population: bag<PopulationSystemState>(sim, "population"),
    environment: bag<EnvironmentSystemState>(sim, "environment"),
    infrastructure:
      infrastructureState === undefined ? undefined : new InfrastructureEngine(sim.scope, sim.world),
  };

  const endpoints = new Set<string>();
  const routes = buildRoutes(context, endpoints);

  // Border reachability is consulted once per destination country and shared
  // by markers and routes, because the same decision answers both.
  const reachability = new Map<string, BorderOutcome>();
  const accessTo = (placeId: string): BorderOutcome | undefined => {
    if (context.countries === undefined || residenceSettlementId === undefined) return undefined;
    if (!knowledge.has(residenceSettlementId)) return undefined;
    const from = countryOf(context, residenceSettlementId);
    const to = countryOf(context, placeId);
    if (from === undefined || to === undefined || String(from.id) === String(to.id)) return undefined;
    const key = String(to.id);
    const cached = reachability.get(key);
    if (cached !== undefined) return cached;
    const outcome = context.countries.borderAccess({ from: String(from.id), to: key, at: now }).outcome;
    reachability.set(key, outcome);
    return outcome;
  };

  const candidates: LocationRef[] = [];
  const seen = new Set<string>();
  // The anchor is always shown when known: it is the camera's subject.
  if (!seen.has(anchorId)) {
    seen.add(anchorId);
    candidates.push(anchor);
  }
  for (const place of windowPlaces) {
    const id = String(place.id);
    if (seen.has(id) || !knowledge.has(id)) continue;
    seen.add(id);
    candidates.push(place);
  }
  candidates.sort(
    (a, b) =>
      levelRank(a.level) - levelRank(b.level) ||
      a.name.localeCompare(b.name) ||
      String(a.id).localeCompare(String(b.id)),
  );
  const truncated = candidates.length > MAP_MARKER_BUDGET;

  const markers: MapMarkerView[] = [];
  for (const place of candidates.slice(0, MAP_MARKER_BUDGET)) {
    const id = String(place.id);
    const entry = knowledge.get(id);
    if (entry === undefined) continue;
    markers.push(
      buildMarker(context, place, {
        entry,
        selected: id === anchorId,
        onRoute: endpoints.has(id),
        restricted: accessTo(id) === "denied",
        conditions: id === residenceSettlementId,
      }),
    );
  }

  const focusEntry = knowledge.get(String(focusPlace.id));
  const anchorChain = ancestryChain(byId, anchor);
  const focusPosition =
    focusEntry === undefined ? undefined : positionOf(focusPlace.coordinates, focusEntry.position);
  const focus: MapFocusView = {
    known: true,
    name: focusPlace.name,
    level: focusPlace.level,
    ...(focusPosition === undefined ? {} : { position: focusPosition }),
    containers: anchorChain.map((place) => ({
      id: String(place.id),
      name: place.name,
      level: place.level,
    })),
  };

  const notes: string[] = [
    `You know ${knowledge.size === 1 ? "1 place" : `${knowledge.size} places`}; this view shows ${
      markers.length === 1 ? "1 of them" : `${markers.length} of them`
    } at ${MAP_LOD_LABELS[lod]} level.`,
    "Places you have never learned about are absent, not filtered: marker visibility follows what you know (UI/UX 09 section 5).",
    routes.length === 0
      ? "No travel options are shown because no known settlement is connected to yours yet."
      : `Travel options come from Transportation (System 45), not the map: ${
          routes.length === 1 ? "one route leaves" : `${routes.length} routes leave`
        } from where you are.`,
  ];
  if (truncated) {
    notes.push(
      `More places are known than this zoom draws; the list is capped at ${MAP_MARKER_BUDGET} (System 07).`,
    );
  }
  const staleCount = markers.filter((marker) => marker.state === "stale").length;
  if (staleCount > 0) {
    notes.push(
      `${staleCount === 1 ? "One marker rests" : `${staleCount} markers rest`} on information older than ${MAP_STALE_AFTER_DAYS} days.`,
    );
  }

  const infrastructureAssets =
    context.residenceSettlementId === undefined || context.infrastructure === undefined
      ? []
      : context.infrastructure.assetsAt(context.residenceSettlementId);
  return {
    worldName,
    lod,
    lods,
    focus,
    ...(anchor.name === focus.name ? {} : { anchorName: anchor.name }),
    markers,
    routes,
    layers: buildLayers(
      {
        countries: context.countries,
        travel: context.travel,
        infrastructure: context.infrastructure,
        population: context.population,
        environment: context.environment,
        infrastructureAssets: infrastructureAssets.length,
      },
      markers,
      routes,
    ),
    knownPlaceCount: knowledge.size,
    markerBudget: MAP_MARKER_BUDGET,
    nowLabel,
    notes,
  };
}
