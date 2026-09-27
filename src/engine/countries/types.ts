/**
 * Countries & world rules state (System 39).
 *
 * A country is a *rule-and-institution environment*, not a polygon on a map
 * (System 39 core principle): it carries territory references, sovereignty,
 * jurisdictions, currency references, citizenship/immigration frameworks and
 * the data-driven world rules that configure legal, economic, civic, border and
 * institutional conditions.
 *
 * What this system deliberately does NOT own (System 39 "Does NOT own"):
 *   - specific legal rules            -> System 41 (Laws & Regulatory Rules)
 *   - an individual's legal identity  -> System 40 (Legal Identity)
 *   - foreign-relations detail        -> System 52 (International Relations)
 *   - city geography                  -> System 37 (Geography)
 *   - individual culture/beliefs      -> System 44 (Culture / Religion)
 *
 * So the state below holds *references* (framework ids, legal-system ids,
 * institution ids, location ids) and the configuration that gives them force in
 * a time window — never the other systems' records themselves. `systems.countries`
 * is written only through `CountriesEngine` inside the `countries` scope.
 *
 * Two temporal laws from the spec shape the model:
 *   - "Jurisdictions can overlap or nest"  -> `Jurisdiction.parentJurisdictionId`
 *     plus a location list, so two jurisdictions may govern the same place.
 *   - "Rules can vary across time"         -> every configuration, border
 *     regime, jurisdiction and rule carries `effectiveFrom` / `effectiveUntil`,
 *     and the engine resolves the version in force `at` a given `WorldTime`.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

/**
 * Sovereignty categories (World Design 03 — Political Geography):
 * "Territorial claim ≠ effective control ≠ recognized sovereignty."
 * The category describes the *recognized sovereignty* of the country record.
 */
export const SOVEREIGNTY_CATEGORIES = [
  "sovereign",
  "autonomous",
  "dependent",
  "administered",
  "occupied",
  "disputed",
  "protectorate",
  "special_administrative",
  "unrecognized",
  "neutral",
  "international",
] as const;

export type SovereigntyCategory = (typeof SOVEREIGNTY_CATEGORIES)[number];

/**
 * Jurisdiction tiers. National/regional/municipal follow the political-geography
 * hierarchy (World Design 03); `special` covers enclaves, free zones and other
 * overlapping authorities that do not nest cleanly into that ladder.
 */
export const JURISDICTION_LEVELS = ["national", "regional", "municipal", "special"] as const;

export type JurisdictionLevel = (typeof JURISDICTION_LEVELS)[number];

/**
 * A governing authority over space and/or people.
 *
 * `locationIds` is how a jurisdiction attaches to System 37 places: a national
 * jurisdiction lists the country, a municipal one its settlement, and two
 * jurisdictions may list the same id (overlap) or nest through
 * `parentJurisdictionId` (hierarchy). Neither list is a substitute for
 * geographic containment — it is the authority *claim*, which is why the spec
 * insists authority and geography stay separate.
 */
export interface Jurisdiction {
  readonly id: string;
  readonly countryId: EntityId<"country">;
  readonly name: string;
  readonly level: JurisdictionLevel;
  /** Nested authority, e.g. a city jurisdiction inside its national one. */
  readonly parentJurisdictionId?: string;
  readonly locationIds: readonly string[];
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  /** Provenance for provisional configuration (see docs/CONTENT_GAPS.md). */
  readonly note?: string;
}

/**
 * A currency *reference*. Money (System 25) is currency-agnostic: it stores
 * `{ currencyId, minorUnits }`, and this record answers what `AUR` means.
 * The World Bible deliberately authors no currencies, so anything here is
 * provisional content and is flagged as such.
 */
export interface CurrencyReference {
  readonly code: string;
  readonly name: string;
  /** 2 = 100 minor units per major unit, as in `primitives/money.ts`. */
  readonly minorUnitScale: number;
  /** Issuing country, when the currency is national rather than shared. */
  readonly issuingCountryId?: EntityId<"country">;
  readonly provisional?: boolean;
  readonly note?: string;
}

/**
 * How citizenship can be acquired (World Design 04: "Citizenship distinct from
 * residence, nationality, ethnicity, birthplace"). Status itself is an
 * individual fact owned by System 40; the framework only says which routes the
 * country recognizes.
 */
export const CITIZENSHIP_BASES = [
  "birth_in_territory",
  "descent",
  "naturalization",
  "marriage",
  "adoption",
  "investment",
] as const;

export type CitizenshipBasis = (typeof CITIZENSHIP_BASES)[number];

export interface CitizenshipFramework {
  readonly id: string;
  /** Omitted when one framework is shared across countries (provisional). */
  readonly countryId?: EntityId<"country">;
  readonly name: string;
  readonly bases: readonly CitizenshipBasis[];
  readonly naturalizationResidencyYears: number;
  readonly allowsDualCitizenship: boolean;
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly provisional?: boolean;
  readonly note?: string;
}

/**
 * Border access levels, ordered from most permissive to most closed.
 * `crossingIds` are System 37 place references (crossings, ports, stations)
 * where the border may legally be traversed.
 */
export const BORDER_ACCESS_LEVELS = [
  "open",
  "passport_required",
  "visa_required",
  "permit_required",
  "restricted",
  "closed",
] as const;

export type BorderAccess = (typeof BORDER_ACCESS_LEVELS)[number];

/** Outcome of a border inquiry; see `borderAccessOutcome` in `./engine.ts`. */
export const BORDER_OUTCOMES = ["allowed", "conditional", "denied"] as const;

export type BorderOutcome = (typeof BORDER_OUTCOMES)[number];

/**
 * A country's immigration configuration. The spec's emphasis is that borders
 * "affect movement, trade, legal status, security, migration and information" —
 * this record is where the country says *how* entry works; whether a particular
 * person may enter is decided by Travel/Immigration (System 45) and Legal
 * Identity (System 40) using it.
 */
export interface ImmigrationFramework {
  readonly id: string;
  readonly countryId?: EntityId<"country">;
  readonly name: string;
  readonly defaultAccess: BorderAccess;
  readonly workPermitRequired: boolean;
  /** Days a visitor may stay before a visa is required; omitted = not set. */
  readonly visaFreeStayDays?: number;
  readonly allowsPermanentResidency: boolean;
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly provisional?: boolean;
  readonly note?: string;
}

/**
 * A border *between two countries*.
 *
 * The pair is order-independent: the engine stores and looks up regimes with
 * `countryA < countryB` (lexicographic), so `borderBetween(a, b)` and
 * `borderBetween(b, a)` return the same record. Crossings are optional because
 * the World Bible authors no border geometry — it only says borders may follow
 * rivers, mountains, coastlines, historical boundaries or negotiated lines.
 */
export interface BorderRegime {
  readonly id: string;
  readonly countryA: EntityId<"country">;
  readonly countryB: EntityId<"country">;
  readonly access: BorderAccess;
  readonly crossingIds?: readonly string[];
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly note?: string;
}

/**
 * Country configuration in force during one time window.
 *
 * The spec's country model lists territory, government, legal system, currency,
 * jurisdictions, citizenship, immigration, economy, culture, institutions,
 * infrastructure and history. Territories/settlements live in System 37,
 * economy in System 36, culture in System 44 and institutions in System 42, so
 * this record keeps *references* to those owners and holds only what System 39
 * actually owns: the country-level settings themselves.
 */
export interface CountryConfiguration {
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly governmentType: string;
  readonly capitalSettlementId?: string;
  /** Legal system family; specific rules belong to System 41. */
  readonly legalSystemId?: string;
  readonly currencyCode?: string;
  readonly citizenshipFrameworkId?: string;
  readonly immigrationFrameworkId?: string;
  readonly jurisdictionIds?: readonly string[];
  /** System 42 institution references, e.g. the national court or bank. */
  readonly nationalInstitutionIds?: readonly string[];
  readonly note?: string;
}

/**
 * Recorded country history (World Design 04: a country keeps its "founding date,
 * constitutional history", plus creation, transformation and dissolution).
 */
export const COUNTRY_CHANGE_KINDS = [
  "founded",
  "renamed",
  "constitution",
  "government_change",
  "capital_change",
  "territory_change",
  "secession",
  "annexation",
  "dissolution",
] as const;

export type CountryChangeKind = (typeof COUNTRY_CHANGE_KINDS)[number];

export interface CountryChange {
  readonly kind: CountryChangeKind;
  readonly at: WorldTime;
  readonly summary: string;
  readonly from?: string;
  readonly to?: string;
}

/**
 * A country's persistent identity plus its time-ordered configurations.
 *
 * Identity (id, name, continent, sovereignty, founding, history) is stable;
 * everything a changing world can change lives in `configurations`. Names are
 * attributes, not identity (IDs survive renames), which is why a rename appends
 * to `historicalNames` and a change record rather than minting a new country id.
 */
export interface CountryRecord {
  readonly id: EntityId<"country">;
  readonly name: string;
  readonly historicalNames?: readonly string[];
  readonly continentId: string;
  readonly sovereignty: SovereigntyCategory;
  readonly foundedAt?: WorldTime;
  readonly configurations: readonly CountryConfiguration[];
  readonly history?: readonly CountryChange[];
  readonly note?: string;
}

/**
 * Scope kinds a world rule can be attached to, from most general to most
 * specific. Resolution walks the caller's chain from specific to general, so a
 * settlement rule beats its region, which beats its country, which beats the
 * world default — the mechanism that lets country-level settings stay data
 * instead of scattered constants.
 */
export const RULE_SCOPE_KINDS = ["world", "continent", "country", "region", "settlement"] as const;

export type RuleScopeKind = (typeof RULE_SCOPE_KINDS)[number];

export interface WorldRuleScope {
  readonly kind: RuleScopeKind;
  readonly id: string;
}

export type WorldRuleValue = number | string | boolean;

/**
 * One data-driven world rule in one time window. Keys are dotted, lowercase and
 * namespaced by the system that will read them (e.g. `border.default_access`),
 * so a rule can be found without a registry of magic constants.
 */
export interface WorldRule {
  readonly id: string;
  readonly key: string;
  readonly scope: WorldRuleScope;
  readonly value: WorldRuleValue;
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
  readonly provisional?: boolean;
  readonly note?: string;
}

/**
 * The answer to "what does rule `key` say at `at`, for this chain of scopes?".
 * `consultedScopes` is kept so the answer is explainable (System 59): it lists
 * the scopes actually consulted, in order, up to and including the one that
 * supplied the value — so a consumer can show which scope decided it, not just
 * what the value is.
 */
export interface WorldRuleResolution {
  readonly key: string;
  readonly value: WorldRuleValue;
  readonly ruleId: string;
  readonly scope: WorldRuleScope;
  readonly at: WorldTime;
  readonly consultedScopes: readonly WorldRuleScope[];
}

/** The result of asking whether a border may be crossed. */
export interface BorderAccessDecision {
  readonly fromCountryId: EntityId<"country">;
  readonly toCountryId: EntityId<"country">;
  readonly at: WorldTime;
  readonly access: BorderAccess;
  readonly outcome: BorderOutcome;
  /** `regime` = an explicit BorderRegime; `default` = a world rule decided it. */
  readonly source: "regime" | "framework" | "default";
  readonly regimeId?: string;
  /** Destination country's immigration framework, when that decided the access. */
  readonly frameworkId?: string;
  readonly ruleId?: string;
}

export interface CountriesSystemState {
  readonly countries: readonly CountryRecord[];
  readonly jurisdictions: readonly Jurisdiction[];
  readonly currencies: readonly CurrencyReference[];
  readonly citizenshipFrameworks: readonly CitizenshipFramework[];
  readonly immigrationFrameworks: readonly ImmigrationFramework[];
  readonly borders: readonly BorderRegime[];
  readonly rules: readonly WorldRule[];
}
