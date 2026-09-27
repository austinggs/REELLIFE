/**
 * Playable slice seed (M3 kernel composition).
 *
 * Builds the small lived-in world the UI shell runs on: the canonical Aurelia
 * geography spine, the slice's infrastructure network, a materialized
 * population inside Arden, and a player person with needs registered so the
 * Life screen has something authoritative to show. This is world *setup*, not
 * simulation rules — it runs once at creation (never after load, where state
 * is restored instead) and every write goes through the owning system's scope.
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import {
  M2_SETTLEMENT_ID,
  registerAureliaSliceGeography,
} from "../../content/aurelia/geography.ts";
import { aureliaWeatherPlace } from "../../content/aurelia/environment.ts";
import { registerAureliaCountries } from "../../content/aurelia/countries.ts";
import {
  registerAureliaBusinessOrganizations,
  registerAureliaBusinesses,
} from "../../content/aurelia/businesses.ts";
import { registerAureliaInfrastructure } from "../../content/aurelia/infrastructure.ts";
import { registerAureliaGoodsAndMarkets } from "../../content/aurelia/markets.ts";
import { registerAureliaSupplyChains } from "../../content/aurelia/supplyChains.ts";
import { registerAureliaMacroBaseline } from "../../content/aurelia/macro.ts";
import { registerAureliaTransport } from "../../content/aurelia/transport.ts";
import { registerAureliaInsurance } from "../../content/aurelia/insurance.ts";
import { registerAureliaEducation, registerAureliaPlayerApplication } from "../../content/aurelia/education.ts";
import { BusinessesEngine } from "../businesses/engine.ts";
import { EducationEngine } from "../education/engine.ts";
import { InsuranceEngine } from "../insurance/engine.ts";
import { LawsEngine } from "../laws/engine.ts";
import { registerAureliaLaws } from "../../content/aurelia/laws.ts";
import { CultureEngine } from "../culture/engine.ts";
import { registerAureliaCulture } from "../../content/aurelia/culture.ts";
import { TechnologyEngine } from "../technology/engine.ts";
import { registerAureliaTechnologies } from "../../content/aurelia/technologies.ts";
import { InformationEngine } from "../information/engine.ts";
import { registerAureliaInformation } from "../../content/aurelia/information.ts";
import { MarketsEngine } from "../markets/engine.ts";
import { MacroEngine } from "../macro/engine.ts";
import { SupplyChainsEngine } from "../supplyChains/engine.ts";
import { TravelEngine } from "../travel/engine.ts";
import { TransportEngine } from "../transport/engine.ts";
import { CountriesEngine } from "../countries/engine.ts";
import { OrganizationsEngine } from "../organizations/engine.ts";
import { EnvironmentEngine } from "../environment/engine.ts";
import { GeographyEngine } from "../geography/engine.ts";
import { InfrastructureEngine } from "../infrastructure/engine.ts";
import { materializeSettlement } from "../scale/materialize.ts";
import { NeedsEngine } from "../needs/engine.ts";
import type { ScaleSystemState } from "../scale/types.ts";

/** Provisional abstract population of the slice city (see docs/CONTENT_GAPS.md). */
export const SLICE_POPULATION = 50_000;
/** Default number of residents revealed — inside the M2 DoD's ~200–2 000 range. */
export const SLICE_RESIDENT_COUNT = 300;

export interface SliceSeedOptions {
  /** How many residents to materialize; defaults to SLICE_RESIDENT_COUNT. */
  readonly residentCount?: number;
}

export interface SliceSeedResult {
  readonly playerId: EntityId<"person">;
  readonly settlementId: string;
  readonly residentCount: number;
}

/**
 * Seeds (or re-affirms) the playable slice. Safe to call on a world that was
 * already seeded: geography registration is idempotent, materialization is a
 * no-op at its target, and the player is chosen from existing residents.
 */
export function seedPlayableSlice(
  sim: Simulation,
  options: SliceSeedOptions = {},
): SliceSeedResult {
  const residentCount = options.residentCount ?? SLICE_RESIDENT_COUNT;

  sim.guard.mutate("geography", () => {
    registerAureliaSliceGeography(new GeographyEngine(sim.scope, sim.world));
  });

  // System 39 gives the playable world its country environment: sovereignty,
  // the currency reference Money uses, citizenship/entry frameworks, the
  // national/municipal jurisdictions of the slice's country and city, and the
  // data-driven world rules. Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("countries", () => {
    registerAureliaCountries(new CountriesEngine(sim.scope, sim.world));
  });

  // System 33 gives the slice its commerce — but a business is the commercial
  // side of a System 32 organization, so the organizations come first and in
  // their own scope. Together they give employment, supply chains and markets
  // real firms to be about. Both are idempotent, so re-seeding is a no-op.
  sim.guard.mutate("organizations", () => {
    registerAureliaBusinessOrganizations(
      sim.ids,
      new OrganizationsEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      sim.clock.time,
    );
  });
  sim.guard.mutate("businesses", () => {
    registerAureliaBusinesses(
      new BusinessesEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      sim.clock.time,
    );
  });

  // System 34 turns those businesses' standing trade into a dependency
  // network: who can deliver what (capacity, lead times), who depends on
  // whom, and — derived from that graph — where a single failure would
  // cascade. Seeded after System 33 because a dependency may not name a
  // party that is not a registered business. Idempotent.
  sim.guard.mutate("supplyChains", () => {
    registerAureliaSupplyChains(new SupplyChainsEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 35 gives those businesses somewhere to trade: a goods catalogue and
  // three local markets whose opening prices are *formed* from cost, stock,
  // supply, demand, transport, tax and regulation — never typed in. Seeded after
  // System 33 because a market may not list a seller that does not exist.
  sim.guard.mutate("markets", () => {
    registerAureliaGoodsAndMarkets(
      new MarketsEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      sim.clock.time,
    );
  });

  // System 36 gives the slice a macro baseline: a price index anchored at
  // 100 and a provisional credit environment, so inflation and the interest
  // context have a first frame. Labour/output/aggregates are deliberately
  // not seeded — they start when a caller observes them. Idempotent.
  sim.guard.mutate("macro", () => {
    registerAureliaMacroBaseline(new MacroEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 28 gives the slice its mobility: the businesses' own delivery
  // vehicles, and a docks works coach on a **real** System 45 route out of
  // Arden. The route is read from System 45 (never restated here); that
  // read needs its own scope because the travel engine initializes its own
  // state on first construction, and scopes never nest. The service is only
  // authored if such a route exists. Idempotent.
  let coachRoute: string | undefined;
  sim.guard.mutate("travel", () => {
    coachRoute = new TravelEngine(sim.scope, sim.world).findRoute(
      M2_SETTLEMENT_ID,
      "CITY-CALDOR",
      "road",
    )?.id;
  });
  sim.guard.mutate("transport", () => {
    registerAureliaTransport(
      new TransportEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      coachRoute,
      sim.clock.time,
    );
  });

  // System 31 gives the slice its cover: two policies underwritten by the
  // grain cooperative's mutual society, over the vehicles System 28 just
  // registered. Seeded after 28 so the insured subjects are real, and
  // idempotent so re-seeding never re-issues a policy.
  sim.guard.mutate("insurance", () => {
    registerAureliaInsurance(new InsuranceEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 41 gives the slice a rule register: four rules derived from what
  // the slice's own content already implies (the mill, the quay, the market
  // stalls), one of them deliberately ambiguous. No enforcement authority is
  // named — System 43 has not been built yet, and pointing at a government
  // that does not exist would be a reference no one can resolve. Idempotent:
  // re-seeding never re-issues legislation.
  sim.guard.mutate("laws", () => {
    registerAureliaLaws(new LawsEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 44 gives the slice its communities: the quay working group, the
  // bakehouse, the Fenwick quarter, the mutual society and one congregation,
  // with the traditions each of them holds. Seeded after 41 because the two are
  // the same kind of content — the norms people are expected to follow — and
  // side by side the reader can see which of them the world considers rules and
  // which it merely holds. No participation is seeded: belonging is something
  // people are recorded as having, not something a world-start grants them.
  // Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("culture", () => {
    registerAureliaCulture(new CultureEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 51 gives the slice its technology catalogue — the water wheel, the
  // millstone, the controlled oven, the berth, the loading gauge and the crane —
  // registered in dependency order so no technology exists before what it
  // stands on. Seeded with no adoptions: a technology having been invented is
  // not the same as anybody having one, and granting the slice's organizations
  // its whole toolkit at world start would be an assumption dressed as content.
  // Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("technology", () => {
    registerAureliaTechnologies(new TechnologyEngine(sim.scope, sim.world), sim.clock.time);
  });

  // System 38 gives the slice city its operational network: utilities, transit
  // and hospital support with a real dependency order, so capacity, outages and
  // maintenance have something to work on. Idempotent, so re-seeding is a no-op.
  sim.guard.mutate("infrastructure", () => {
    registerAureliaInfrastructure(
      new InfrastructureEngine(sim.scope, sim.world),
      M2_SETTLEMENT_ID,
      sim.clock.time,
    );
  });

  // The slice city gets real weather from the first frame, so System 46 takes
  // part in the playable world's conditions. Idempotent: weather is upserted.
  const weatherPlace = aureliaWeatherPlace(M2_SETTLEMENT_ID);
  if (weatherPlace) {
    sim.guard.mutate("environment", () => {
      new EnvironmentEngine(sim.scope, sim.world).observeWeather({
        locationId: weatherPlace.locationId,
        climate: weatherPlace.climate,
        latitude: weatherPlace.latitude,
        monthIndex: sim.calendar.dateFromTime(sim.clock.time).monthIndex,
        at: sim.clock.time,
      });
    });
  }

  const personIds = materializeSettlement(sim, {
    settlementId: M2_SETTLEMENT_ID,
    totalPopulation: SLICE_POPULATION,
    targetCount: residentCount,
    now: sim.clock.time,
  });
  const playerId = personIds[0];
  if (playerId === undefined) {
    throw new Error("seedPlayableSlice: the slice has no residents");
  }

  // The player's needs must exist before the Life screen can show them.
  // registerPerson replaces, so guard against double-registration on re-seed.
  const needsState = sim.world.systems.needs as { persons?: readonly { personId: string }[] } | undefined;
  const alreadyRegistered = needsState?.persons?.some((entry) => entry.personId === playerId);
  if (!alreadyRegistered) {
    sim.guard.mutate("needs", () => {
      new NeedsEngine(sim.scope, sim.world).registerPerson(playerId, sim.clock.time);
    });
  }

  // System 23 gives the slice its programs — the docks' stevedore
  // certification and the bakery's milling course, both run by slice
  // organizations — and leaves the player an *application*, not a seat:
  // education creates the opportunity, and taking it is System 17's
  // decision. Seeded after materialization because the applicant is a real
  // person. Idempotent: re-seeding neither duplicates the application nor
  // enrolls the player by surprise.
  sim.guard.mutate("education", () => {
    const education = new EducationEngine(sim.scope, sim.world);
    registerAureliaEducation(education);
    // `sim.ids` is the live allocator — `world.shared.idAllocator` is only
    // its persisted snapshot, so a fresh allocator here would mint ids that
    // a later command could mint again.
    registerAureliaPlayerApplication(education, sim.ids, playerId, sim.clock.time);
  });

  // System 49 gives the slice its information substrate: the organizations
  // and residents as graph nodes, plus the two notice boards the docks and
  // the mill already keep. Seeded after materialization so the resident
  // nodes are real people, and deliberately **without** seeding any claim:
  // a claim needs an author and an audience, and putting words in
  // residents' mouths at seed time would be fiction, not a rumor. Idempotent.
  sim.guard.mutate("information", () => {
    const scale = sim.world.systems.scale as ScaleSystemState | undefined;
    const residentIds = (scale?.residents ?? [])
      .filter((resident) => resident.settlementId === M2_SETTLEMENT_ID)
      .map((resident) => resident.personId);
    registerAureliaInformation(
      new InformationEngine(sim.scope, sim.world),
      residentIds,
    );
  });

  const scale = sim.world.systems.scale as ScaleSystemState | undefined;
  return {
    playerId,
    settlementId: M2_SETTLEMENT_ID,
    residentCount: scale?.residents.filter((r) => r.settlementId === M2_SETTLEMENT_ID).length ?? personIds.length,
  };
}
/**
 * The person the shell currently controls: the slice's first resident.
 *
 * Deliberately derived from restored state rather than persisted as a flag, so
 * a load re-derives the same person instead of trusting a stored pointer.
 * Control *transfer* (descendants, M7) will replace this selection properly.
 */
export function sliceUnderControl(sim: Simulation): EntityId<"person"> | undefined {
  const scale = sim.world.systems.scale as ScaleSystemState | undefined;
  return scale?.residents.find((resident) => resident.settlementId === M2_SETTLEMENT_ID)?.personId;
}

