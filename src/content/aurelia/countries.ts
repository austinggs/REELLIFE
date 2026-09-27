/**
 * Canonical country & world-rule content for Aurelia (M4 / System 39).
 *
 * What the World Bible actually fixes, and what it defers:
 *
 *   authored (canon)   — the 48 sovereign countries, their continent, capital
 *                        (where named), government type, the single currency code
 *                        `AUR` used across the canon, "48 sovereign countries at
 *                        the game-start baseline" (WORLD_BUILD_03), and the
 *                        qualitative world rules stated in WORLD_BUILD_12
 *                        (mixed economy, incomplete energy transition, uneven
 *                        technology access, decentralized information, migration
 *                        as a major force, no predetermined global war).
 *   deferred           — exact currencies/central banks, per-country legal-system
 *                        assignment, ministries, budgets, named institutions and
 *                        detailed foreign relations.
 *
 * Deferred items are *not* invented here. Where a reference is required for the
 * mechanisms System 39 owns (money needs a currency record, citizenship needs a
 * framework, entry needs an access policy, a country needs a legal system), one
 * explicitly provisional record is defined and flagged, and the decision is
 * logged in `docs/CONTENT_GAPS.md`. Everything else is left undefined rather
 * than guessed:
 *
 *   - no bilateral border regimes are authored (the Bible authors no border
 *     geometry or treaties), so `borderAccess` answers from the destination's
 *     entry policy and, failing that, from the world rule `border.default_access`;
 *   - no national institution ids, no language/religion assignment per country
 *     (Systems 42/44 own those) — the fields exist and stay empty.
 *
 * Registration is idempotent: an id that already exists is left untouched, so
 * world setup can call this on every creation path without double-defining.
 */

import { CountriesEngine, DEFAULT_BORDER_ACCESS_RULE_KEY } from "../../engine/countries/engine.ts";
import type {
  CitizenshipFramework,
  CountryConfiguration,
  CountryRecord,
  CurrencyReference,
  ImmigrationFramework,
  Jurisdiction,
  WorldRule,
  WorldRuleScope,
  WorldRuleValue,
} from "../../engine/countries/types.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { CANON_COUNTRIES, CANON_SETTLEMENTS } from "./canon.ts";
import { AURELIA_WORLD_PLACES } from "./geography.ts";

/** Provisional shared currency (docs/CONTENT_GAPS.md; Money stays currency-agnostic). */
export const AURELIA_CURRENCY: CurrencyReference = {
  code: "AUR",
  name: "Aurelian mark",
  minorUnitScale: 2,
  provisional: true,
  note: "The World Bible authors no currencies; one flag-shared currency keeps Money usable until a currency content pack exists (M5).",
};

/**
 * Reserved legal-system slug.
 *
 * WORLD_BUILD_12 states countries maintain *different* legal systems; no
 * per-country assignment is authored, and legal rules themselves belong to
 * System 41 (M6). Rather than invent 48 world facts, every country references
 * this one provisional codified system until System 41 authors the families.
 */
export const AURELIA_LEGAL_SYSTEM_ID = "LEGAL-AURELIAN-CODIFIED";

export const AURELIA_CITIZENSHIP_FRAMEWORK_ID = "CIT-AURELIAN-STANDARD";
export const AURELIA_IMMIGRATION_FRAMEWORK_ID = "IMM-AURELIAN-STANDARD";

/** Stable jurisdiction ids derived from canon ids (national + municipal tiers). */
export const NATIONAL_JURISDICTION_PREFIX = "JUR-NATIONAL-";
export const MUNICIPAL_JURISDICTION_PREFIX = "JUR-MUNICIPAL-";

export function aureliaNationalJurisdictionId(countryId: string): string {
  return `${NATIONAL_JURISDICTION_PREFIX}${countryId.replace(/^COUNTRY-/, "")}`;
}

export function aureliaMunicipalJurisdictionId(settlementId: string): string {
  return `${MUNICIPAL_JURISDICTION_PREFIX}${settlementId.replace(/^CITY-/, "")}`;
}

/** The sovereign country a canonical settlement belongs to. */
export function aureliaCountryOfSettlement(settlementId: string): string | undefined {
  return CANON_SETTLEMENTS.find((settlement) => settlement.id === settlementId)?.countryId;
}

/** Geographic level → rule scope kind; levels that are not scopes are skipped. */
const SCOPE_KIND_BY_LEVEL: Record<string, WorldRuleScope["kind"] | undefined> = {
  world: "world",
  continent: "continent",
  country: "country",
  region: "region",
  settlement: "settlement",
};

/**
 * The rule-scope chain for a place, most specific first, e.g.
 * `CITY-ARDEN` → settlement, region, country, continent, world.
 *
 * Built from the canonical geography list (so districts inherit their
 * settlement's chain) with `worldId` overriding the world entry, because a
 * custom world's id is runtime state (`world.meta.worldId`) rather than content.
 * A place outside the canonical hierarchy resolves to the world scope alone,
 * which is the correct fallback: no more specific scope can be named for it.
 */
export function aureliaScopeChain(
  locationId: string,
  worldId = "WORLD-AURELIA",
): readonly WorldRuleScope[] {
  const byId = new Map(AURELIA_WORLD_PLACES.map((place) => [place.id, place]));
  const chain: WorldRuleScope[] = [];
  let current = byId.get(locationId);
  let depth = 0;
  while (current && depth <= AURELIA_WORLD_PLACES.length) {
    const kind = SCOPE_KIND_BY_LEVEL[current.level];
    if (kind) chain.push({ kind, id: kind === "world" ? worldId : current.id });
    current = current.parentId ? byId.get(current.parentId) : undefined;
    depth += 1;
  }
  if (chain.length === 0) return [{ kind: "world", id: worldId }];
  return chain;
}

/**
 * The game-start configuration of every canonical country.
 *
 * Effective from the world's start rather than the Aurelia epoch: this *is* the
 * game-start state, and the engine's `effectiveAt` fallback serves earlier
 * queries from the earliest authored window.
 */
export function aureliaCountryRecords(at: WorldTime): readonly CountryRecord[] {
  return CANON_COUNTRIES.map((country) => {
    const configuration: CountryConfiguration = {
      effectiveFrom: at,
      governmentType: country.governmentType,
      ...(country.capitalSettlementId ? { capitalSettlementId: country.capitalSettlementId } : {}),
      legalSystemId: AURELIA_LEGAL_SYSTEM_ID,
      currencyCode: AURELIA_CURRENCY.code,
      citizenshipFrameworkId: AURELIA_CITIZENSHIP_FRAMEWORK_ID,
      immigrationFrameworkId: AURELIA_IMMIGRATION_FRAMEWORK_ID,
      jurisdictionIds: [aureliaNationalJurisdictionId(country.id)],
      note: "Game-start configuration. Government type is canon (WORLD_BUILD_03); the legal-system reference is the provisional shared slug until System 41 authors the families.",
    };
    return {
      id: country.id as CountryRecord["id"],
      name: country.name,
      continentId: country.continentId,
      sovereignty: "sovereign" as const,
      foundedAt: at,
      configurations: [configuration],
    };
  });
}

/**
 * One national jurisdiction per country and one municipal jurisdiction per
 * canonical settlement, nested municipal-inside-national.
 *
 * This is the country claiming *its own* territory and a city claiming itself —
 * a formalization of the sovereignty the canon already states, not a new world
 * fact. Overlapping authorities (enclaves, free zones, disputed control) are
 * what the model exists for; none are authored because the Bible authors none.
 */
export function aureliaJurisdictions(at: WorldTime): readonly Jurisdiction[] {
  const national: Jurisdiction[] = CANON_COUNTRIES.map((country) => ({
    id: aureliaNationalJurisdictionId(country.id),
    countryId: country.id as Jurisdiction["countryId"],
    name: country.name,
    level: "national" as const,
    locationIds: [country.id],
    effectiveFrom: at,
    note: "National authority over the country's own territory (WORLD_BUILD_03).",
  }));
  const municipal: Jurisdiction[] = CANON_SETTLEMENTS.map((settlement) => ({
    id: aureliaMunicipalJurisdictionId(settlement.id),
    countryId: settlement.countryId as Jurisdiction["countryId"],
    name: `${settlement.name} municipal authority`,
    level: "municipal" as const,
    parentJurisdictionId: aureliaNationalJurisdictionId(settlement.countryId),
    locationIds: [settlement.id],
    effectiveFrom: at,
    note: "WORLD_05: settlements carry a jurisdiction; nested inside their country's national jurisdiction.",
  }));
  return [...national, ...municipal];
}

/**
 * One provisional citizenship framework shared by every country.
 *
 * The processes are generic and canon-supported (citizenship is distinct from
 * residence, nationality, ethnicity and birthplace per WORLD_04); the numbers
 * are provisional and flagged, because the Bible authors no naturalization terms.
 */
export function aureliaCitizenshipFramework(at: WorldTime): CitizenshipFramework {
  return {
    id: AURELIA_CITIZENSHIP_FRAMEWORK_ID,
    name: "Aurelian standard citizenship framework",
    bases: ["birth_in_territory", "descent", "naturalization"],
    naturalizationResidencyYears: 5,
    allowsDualCitizenship: true,
    effectiveFrom: at,
    provisional: true,
    note: "Shared provisional framework: the Bible names the concept and defers per-country rules (WORLD_04).",
  };
}

/** One provisional entry policy shared by every country (see `borderAccess`). */
export function aureliaImmigrationFramework(at: WorldTime): ImmigrationFramework {
  return {
    id: AURELIA_IMMIGRATION_FRAMEWORK_ID,
    name: "Aurelian standard entry framework",
    defaultAccess: "passport_required",
    workPermitRequired: true,
    visaFreeStayDays: 90,
    allowsPermanentResidency: true,
    effectiveFrom: at,
    provisional: true,
    note: "Shared provisional entry policy. WORLD_BUILD_12 says migration is a major force and borders affect movement; no per-country access is authored.",
  };
}

export interface AureliaWorldRuleDraft {
  readonly id: string;
  readonly key: string;
  readonly value: WorldRuleValue;
  readonly provisional?: boolean;
  /** Provenance: which World Bible statement this rule encodes. */
  readonly note: string;
}

/**
 * Canonical world rules as data.
 *
 * Each entry encodes a statement the World Bible actually makes about the world,
 * so consumers read `resolveRule(...)` instead of hard-coding a constant. Only
 * the border default is provisional; the rest are quotes from WORLD_BUILD_12.
 */
export const AURELIA_WORLD_RULE_DRAFTS: readonly AureliaWorldRuleDraft[] = [
  {
    id: "RULE-BORDER-DEFAULT-ACCESS",
    key: DEFAULT_BORDER_ACCESS_RULE_KEY,
    value: "passport_required",
    provisional: true,
    note: "No border geometry or treaties are authored (WORLD_BUILD_03 'Border rules'), so this world default is provisional; a country overrides it with its own rule or immigration framework.",
  },
  {
    id: "RULE-ECONOMY-MIXED",
    key: "economy.is_mixed",
    value: true,
    note: "WORLD_BUILD_12 Economic state: a globally interconnected mixed economy of private firms, state-linked enterprises, cooperatives, family businesses, nonprofits, public institutions, informal businesses and independent workers.",
  },
  {
    id: "RULE-ENERGY-TRANSITION-COMPLETE",
    key: "energy.transition_complete",
    value: false,
    note: "WORLD_BUILD_12 Energy state: the global energy transition is underway but incomplete.",
  },
  {
    id: "RULE-TECHNOLOGY-UNEVEN-ACCESS",
    key: "technology.uneven_access",
    value: true,
    note: "WORLD_BUILD_12 Technology state: advanced computing, AI, robotics, medicine and transport exist with uneven access.",
  },
  {
    id: "RULE-INFORMATION-DECENTRALIZED",
    key: "information.is_decentralized",
    value: true,
    note: "WORLD_BUILD_12 Information environment: information is abundant and decentralized.",
  },
  {
    id: "RULE-MIGRATION-MAJOR-FORCE",
    key: "migration.is_major_demographic_force",
    value: true,
    note: "WORLD_BUILD_12 Migration: migration remains a major demographic force.",
  },
  {
    id: "RULE-SECURITY-GLOBAL-WAR",
    key: "security.global_war",
    value: false,
    note: "WORLD_BUILD_12 Security state: the world is not in predetermined global war.",
  },
  {
    id: "RULE-EDUCATION-LITERACY-HIGH",
    key: "education.literacy_is_high",
    value: true,
    note: "WORLD_BUILD_12 Education: global literacy is high by historical standards.",
  },
];

export function aureliaWorldRules(at: WorldTime, worldId: string): readonly WorldRule[] {
  return AURELIA_WORLD_RULE_DRAFTS.map((draft) => ({
    id: draft.id,
    key: draft.key,
    value: draft.value,
    ...(draft.provisional === undefined ? {} : { provisional: draft.provisional }),
    note: draft.note,
    scope: { kind: "world" as const, id: worldId },
    effectiveFrom: at,
  }));
}

/**
 * Registers canonical Aurelia currency, country, jurisdiction, framework and
 * world-rule content. Idempotent: existing ids are left alone, so this is safe
 * on world creation, on re-seeding and in tests.
 */
export function registerAureliaCountries(engine: CountriesEngine): void {
  const at = engine.worldStart();

  if (!engine.currency(AURELIA_CURRENCY.code)) engine.defineCurrency(AURELIA_CURRENCY);
  if (!engine.citizenshipFramework(AURELIA_CITIZENSHIP_FRAMEWORK_ID)) {
    engine.defineCitizenshipFramework(aureliaCitizenshipFramework(at));
  }
  if (!engine.immigrationFramework(AURELIA_IMMIGRATION_FRAMEWORK_ID)) {
    engine.defineImmigrationFramework(aureliaImmigrationFramework(at));
  }

  for (const record of aureliaCountryRecords(at)) {
    if (!engine.country(record.id)) engine.define(record);
  }
  for (const jurisdiction of aureliaJurisdictions(at)) {
    if (!engine.jurisdiction(jurisdiction.id)) engine.defineJurisdiction(jurisdiction);
  }
  for (const rule of aureliaWorldRules(at, engine.worldScope().id)) {
    if (!engine.rules().some((existing) => existing.id === rule.id)) engine.defineRule(rule);
  }
}
