/**
 * Countries & world rules engine (System 39).
 *
 * Owns `systems.countries`: country identity and sovereignty, time-ordered
 * country configurations, the jurisdiction hierarchy, currency references,
 * citizenship/immigration frameworks, pairwise border regimes and the
 * data-driven world-rule registry.
 *
 * Design notes that keep this consistent with the rest of the kernel:
 *
 *  - Reads are scope-free; every write asserts `scope.assertOwner("countries")`
 *    exactly like the geography/population/environment engines.
 *  - Time is supplied by the caller (`at: WorldTime`), never read from a clock,
 *    so the engine stays deterministic and has no hidden "now" (law 7).
 *  - Histories are written *forward*: `amend`, `rename`, `defineBorder` and
 *    `defineRule` supersede an earlier open window by closing it at the new
 *    effective time, and reject a non-monotonic (earlier) effective date rather
 *    than rewriting history in place (law 9: derived and historical state stays
 *    derived; the past is not silently rewritten).
 *  - Lookups are order-independent where the domain says so: a border is stored
 *    and found as an unordered pair, because "the border between A and B" is one
 *    fact, not two.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  BORDER_ACCESS_LEVELS,
  CITIZENSHIP_BASES,
  COUNTRY_CHANGE_KINDS,
  JURISDICTION_LEVELS,
  RULE_SCOPE_KINDS,
  SOVEREIGNTY_CATEGORIES,
  type BorderAccess,
  type BorderAccessDecision,
  type BorderOutcome,
  type BorderRegime,
  type CitizenshipFramework,
  type CountriesSystemState,
  type CountryChange,
  type CountryConfiguration,
  type CountryRecord,
  type CurrencyReference,
  type ImmigrationFramework,
  type Jurisdiction,
  type SovereigntyCategory,
  type WorldRule,
  type WorldRuleResolution,
  type WorldRuleScope,
} from "./types.ts";

/** Rule key that answers "what is the default border access?" (world scope). */
export const DEFAULT_BORDER_ACCESS_RULE_KEY = "border.default_access";

/**
 * Maps a border access level onto what it means for a would-be crosser.
 * `passport_required` still allows the crossing (with a document check), so it
 * is `conditional`, not `denied`.
 */
export function borderAccessOutcome(access: BorderAccess): BorderOutcome {
  if (access === "open") return "allowed";
  if (access === "restricted" || access === "closed") return "denied";
  return "conditional";
}

/** Anything with a validity window. */
interface Windowed {
  readonly effectiveFrom: WorldTime;
  readonly effectiveUntil?: WorldTime;
}

/** True when `at` falls inside the record's validity window (end exclusive). */
export function inForceAt(record: Windowed, at: WorldTime): boolean {
  if (record.effectiveFrom > at) return false;
  return record.effectiveUntil === undefined || at < record.effectiveUntil;
}

/** The most recently started record in force at `at`, or undefined. */
export function latestInForceAt<T extends Windowed>(
  records: readonly T[],
  at: WorldTime,
): T | undefined {
  let best: T | undefined;
  for (const record of records) {
    if (!inForceAt(record, at)) continue;
    if (best === undefined || record.effectiveFrom > best.effectiveFrom) best = record;
  }
  return best;
}

/**
 * The authored record that applies at `at`: the latest window in force, or —
 * when `at` precedes every authored window — the earliest window.
 *
 * The fallback exists because authored histories are forward-only and cannot be
 * written before the world's start, so a query for an earlier instant would
 * otherwise report "nothing was configured", which is not a state this world can
 * be in. It never invents a value: it returns an authored record, just the
 * earliest one.
 */
export function effectiveAt<T extends Windowed>(
  records: readonly T[],
  at: WorldTime,
): T | undefined {
  const inForce = latestInForceAt(records, at);
  if (inForce) return inForce;
  let earliest: T | undefined;
  for (const record of records) {
    if (earliest === undefined || record.effectiveFrom < earliest.effectiveFrom) earliest = record;
  }
  return earliest;
}

/** Closes every open window that started strictly before `at`, at `at`. */
function closeOpenWindows<T extends Windowed>(records: readonly T[], at: WorldTime): T[] {
  return records.map((record) => {
    if (record.effectiveUntil !== undefined || record.effectiveFrom >= at) return record;
    return { ...record, effectiveUntil: at };
  });
}

function requireText(value: string | undefined, context: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${context}: value must be a non-empty string`);
  }
  return value;
}

function requireMember<T extends string>(
  value: string,
  allowed: readonly T[],
  context: string,
): T {
  if (!(allowed as readonly string[]).includes(value)) {
    throw new Error(`${context}: "${value}" is not one of ${allowed.join(", ")}`);
  }
  return value as T;
}

export class CountriesEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.countries) {
      this.scope.assertOwner("countries");
      this.world.systems.countries = {
        countries: [],
        jurisdictions: [],
        currencies: [],
        citizenshipFrameworks: [],
        immigrationFrameworks: [],
        borders: [],
        rules: [],
      } satisfies CountriesSystemState;
    }
  }

  private get state(): CountriesSystemState {
    return this.world.systems.countries as CountriesSystemState;
  }

  private set state(value: CountriesSystemState) {
    this.world.systems.countries = value;
  }

  // ---------------------------------------------------------------- identity

  countries(): readonly CountryRecord[] {
    return this.state.countries;
  }

  country(id: string): CountryRecord | undefined {
    return this.state.countries.find((record) => record.id === id);
  }

  /** Looks a country up by current or former name (names are not identity). */
  countryNamed(name: string): CountryRecord | undefined {
    const target = name.trim().toLowerCase();
    return this.state.countries.find(
      (record) =>
        record.name.toLowerCase() === target ||
        record.historicalNames?.some((former) => former.toLowerCase() === target) === true,
    );
  }

  countriesOfContinent(continentId: string): readonly CountryRecord[] {
    return this.state.countries.filter((record) => record.continentId === continentId);
  }

  /** Countries whose recognized sovereignty is exactly `sovereignty`. */
  countriesBySovereignty(sovereignty: SovereigntyCategory): readonly CountryRecord[] {
    return this.state.countries.filter((record) => record.sovereignty === sovereignty);
  }

  /**
   * The configuration of `id` in force at `at` (see `effectiveAt` for the
   * pre-history fallback).
   */
  configurationAt(id: string, at: WorldTime): CountryConfiguration | undefined {
    const record = this.country(id);
    if (!record) return undefined;
    return effectiveAt(record.configurations, at);
  }

  /** The canonical start of this world (core-owned `meta.startTime`). */
  worldStart(): WorldTime {
    return this.world.meta.startTime;
  }

  historyOf(id: string): readonly CountryChange[] {
    return this.country(id)?.history ?? [];
  }

  /** Registers a country. Duplicate ids are a content error, not a no-op. */
  define(record: CountryRecord): CountryRecord {
    this.scope.assertOwner("countries");
    requireText(record.id, "CountriesEngine.define(id)");
    requireText(record.name, "CountriesEngine.define(name)");
    requireText(record.continentId, "CountriesEngine.define(continentId)");
    requireMember(record.sovereignty, SOVEREIGNTY_CATEGORIES, "CountriesEngine.define(sovereignty)");
    if (record.configurations.length === 0) {
      throw new Error(`CountriesEngine.define: ${record.id} needs at least one configuration`);
    }
    const starts = new Set<number>();
    for (const configuration of record.configurations) {
      if (starts.has(configuration.effectiveFrom)) {
        throw new Error(
          `CountriesEngine.define: ${record.id} has two configurations starting at ${configuration.effectiveFrom}`,
        );
      }
      starts.add(configuration.effectiveFrom);
    }
    if (this.country(record.id)) {
      throw new Error(`CountriesEngine.define: country ${record.id} is already defined`);
    }
    const ordered: CountryRecord = {
      ...record,
      configurations: [...record.configurations].sort((a, b) => a.effectiveFrom - b.effectiveFrom),
    };
    this.state = { ...this.state, countries: [...this.state.countries, ordered] };
    return ordered;
  }

  /**
   * Supersedes the country's latest configuration with a new one effective at
   * `configuration.effectiveFrom`. The previous window is closed at that same
   * instant, so exactly one configuration is ever in force. Histories move
   * forward only: an earlier effective date is rejected rather than inserted.
   */
  amend(id: string, configuration: CountryConfiguration): CountryConfiguration {
    this.scope.assertOwner("countries");
    const record = this.country(id);
    if (!record) throw new Error(`CountriesEngine.amend: unknown country ${id}`);
    requireText(configuration.governmentType, "CountriesEngine.amend(governmentType)");
    const latest = record.configurations[record.configurations.length - 1];
    if (latest && configuration.effectiveFrom <= latest.effectiveFrom) {
      throw new Error(
        `CountriesEngine.amend: ${id} histories move forward (latest starts at ${latest.effectiveFrom}, got ${configuration.effectiveFrom})`,
      );
    }
    const closed = closeOpenWindows(record.configurations, configuration.effectiveFrom);
    this.replaceCountry(id, { ...record, configurations: [...closed, configuration] });
    return configuration;
  }

  /** Renames a country at `at`, keeping the old name as a historical name. */
  rename(id: string, newName: string, at: WorldTime): CountryRecord {
    this.scope.assertOwner("countries");
    const record = this.country(id);
    if (!record) throw new Error(`CountriesEngine.rename: unknown country ${id}`);
    requireText(newName, "CountriesEngine.rename(newName)");
    const previous = record.name;
    if (previous === newName) return record;
    const renamed: CountryRecord = {
      ...record,
      name: newName,
      historicalNames: [...(record.historicalNames ?? []), previous],
      history: [
        ...(record.history ?? []),
        { kind: "renamed", at, summary: `${previous} became ${newName}`, from: previous, to: newName },
      ],
    };
    this.replaceCountry(id, renamed);
    return renamed;
  }

  /** Appends a recorded change (constitution, capital, territory, dissolution…). */
  recordChange(id: string, change: CountryChange): CountryRecord {
    this.scope.assertOwner("countries");
    const record = this.country(id);
    if (!record) throw new Error(`CountriesEngine.recordChange: unknown country ${id}`);
    requireMember(change.kind, COUNTRY_CHANGE_KINDS, "CountriesEngine.recordChange(kind)");
    requireText(change.summary, "CountriesEngine.recordChange(summary)");
    const updated: CountryRecord = { ...record, history: [...(record.history ?? []), change] };
    this.replaceCountry(id, updated);
    return updated;
  }

  private replaceCountry(id: string, next: CountryRecord): void {
    this.state = {
      ...this.state,
      countries: this.state.countries.map((record) => (record.id === id ? next : record)),
    };
  }

  // ----------------------------------------------------------- jurisdictions

  jurisdictions(): readonly Jurisdiction[] {
    return this.state.jurisdictions;
  }

  jurisdiction(id: string): Jurisdiction | undefined {
    return this.state.jurisdictions.find((record) => record.id === id);
  }

  /** Every jurisdiction a country claims, including its historical ones. */
  jurisdictionsOfCountry(countryId: string): readonly Jurisdiction[] {
    return this.state.jurisdictions.filter((record) => record.countryId === countryId);
  }

  /**
   * Every jurisdiction governing `locationId` at `at`, most specific first.
   * Overlap is the norm rather than an error (World Design 03: "Effective
   * control ≠ formal jurisdiction"), so this returns a list, never a winner.
   */
  jurisdictionsAt(locationId: string, at: WorldTime): readonly Jurisdiction[] {
    const levelRank: Record<string, number> = { special: 0, municipal: 1, regional: 2, national: 3 };
    return this.state.jurisdictions
      .filter((record) => record.locationIds.includes(locationId) && inForceAt(record, at))
      .sort((a, b) => (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9));
  }

  /**
   * Nested authority chain, root-first, ending with `id` itself.
   *
   * Nesting is acyclic by construction (`defineJurisdiction` only accepts an
   * already-defined parent), so a repeat here means persisted state was
   * corrupted. That is reported instead of silently returning a truncated,
   * wrong ancestry.
   */
  jurisdictionChain(id: string): readonly Jurisdiction[] {
    const chain: Jurisdiction[] = [];
    const visited = new Set<string>();
    let current = this.jurisdiction(id);
    while (current) {
      if (visited.has(current.id)) {
        throw new Error(`CountriesEngine.jurisdictionChain: cycle detected at ${current.id}`);
      }
      visited.add(current.id);
      chain.push(current);
      if (!current.parentJurisdictionId) break;
      current = this.jurisdiction(current.parentJurisdictionId);
    }
    return chain.reverse();
  }

  /**
   * Registers a governing authority.
   *
   * A parent must already be defined and a jurisdiction may not be its own
   * parent, so nesting can never form a cycle: ancestry is a DAG by
   * construction (System 39: "jurisdictions can overlap or nest").
   */
  defineJurisdiction(record: Jurisdiction): Jurisdiction {
    this.scope.assertOwner("countries");
    requireText(record.id, "CountriesEngine.defineJurisdiction(id)");
    requireText(record.name, "CountriesEngine.defineJurisdiction(name)");
    requireMember(record.level, JURISDICTION_LEVELS, "CountriesEngine.defineJurisdiction(level)");
    if (record.parentJurisdictionId === record.id) {
      throw new Error(
        `CountriesEngine.defineJurisdiction: ${record.id} cannot be its own parent`,
      );
    }
    if (!this.country(record.countryId)) {
      throw new Error(`CountriesEngine.defineJurisdiction: unknown country ${record.countryId}`);
    }
    if (this.jurisdiction(record.id)) {
      throw new Error(`CountriesEngine.defineJurisdiction: jurisdiction ${record.id} already exists`);
    }
    if (record.parentJurisdictionId && !this.jurisdiction(record.parentJurisdictionId)) {
      throw new Error(
        `CountriesEngine.defineJurisdiction: parent ${record.parentJurisdictionId} of ${record.id} is not defined`,
      );
    }
    if (record.locationIds.length === 0) {
      throw new Error(`CountriesEngine.defineJurisdiction: ${record.id} governs no location`);
    }
    this.state = { ...this.state, jurisdictions: [...this.state.jurisdictions, record] };
    return record;
  }

  // --------------------------------------------------------------- currencies

  currencies(): readonly CurrencyReference[] {
    return this.state.currencies;
  }

  currency(code: string): CurrencyReference | undefined {
    return this.state.currencies.find((record) => record.code === code);
  }

  defineCurrency(reference: CurrencyReference): CurrencyReference {
    this.scope.assertOwner("countries");
    requireText(reference.code, "CountriesEngine.defineCurrency(code)");
    requireText(reference.name, "CountriesEngine.defineCurrency(name)");
    if (!Number.isInteger(reference.minorUnitScale) || reference.minorUnitScale < 0) {
      throw new Error(
        `CountriesEngine.defineCurrency: ${reference.code} needs a non-negative integer minorUnitScale`,
      );
    }
    if (this.currency(reference.code)) {
      throw new Error(`CountriesEngine.defineCurrency: currency ${reference.code} already exists`);
    }
    if (reference.issuingCountryId && !this.country(reference.issuingCountryId)) {
      throw new Error(
        `CountriesEngine.defineCurrency: unknown issuing country ${reference.issuingCountryId}`,
      );
    }
    this.state = { ...this.state, currencies: [...this.state.currencies, reference] };
    return reference;
  }

  /** The currency a country uses at `at`, following its configuration. */
  currencyOfCountry(countryId: string, at: WorldTime): CurrencyReference | undefined {
    const code = this.configurationAt(countryId, at)?.currencyCode;
    return code === undefined ? undefined : this.currency(code);
  }

  // ------------------------------------------------- citizenship / immigration

  citizenshipFrameworks(): readonly CitizenshipFramework[] {
    return this.state.citizenshipFrameworks;
  }

  citizenshipFramework(id: string): CitizenshipFramework | undefined {
    return this.state.citizenshipFrameworks.find((record) => record.id === id);
  }

  immigrationFrameworks(): readonly ImmigrationFramework[] {
    return this.state.immigrationFrameworks;
  }

  immigrationFramework(id: string): ImmigrationFramework | undefined {
    return this.state.immigrationFrameworks.find((record) => record.id === id);
  }

  defineCitizenshipFramework(framework: CitizenshipFramework): CitizenshipFramework {
    this.scope.assertOwner("countries");
    requireText(framework.id, "CountriesEngine.defineCitizenshipFramework(id)");
    requireText(framework.name, "CountriesEngine.defineCitizenshipFramework(name)");
    if (framework.bases.length === 0) {
      throw new Error(
        `CountriesEngine.defineCitizenshipFramework: ${framework.id} needs at least one basis`,
      );
    }
    for (const basis of framework.bases) {
      requireMember(basis, CITIZENSHIP_BASES, "CountriesEngine.defineCitizenshipFramework(bases)");
    }
    if (this.citizenshipFramework(framework.id)) {
      throw new Error(
        `CountriesEngine.defineCitizenshipFramework: framework ${framework.id} already exists`,
      );
    }
    this.state = {
      ...this.state,
      citizenshipFrameworks: [...this.state.citizenshipFrameworks, framework],
    };
    return framework;
  }

  defineImmigrationFramework(framework: ImmigrationFramework): ImmigrationFramework {
    this.scope.assertOwner("countries");
    requireText(framework.id, "CountriesEngine.defineImmigrationFramework(id)");
    requireText(framework.name, "CountriesEngine.defineImmigrationFramework(name)");
    requireMember(
      framework.defaultAccess,
      BORDER_ACCESS_LEVELS,
      "CountriesEngine.defineImmigrationFramework(defaultAccess)",
    );
    if (this.immigrationFramework(framework.id)) {
      throw new Error(
        `CountriesEngine.defineImmigrationFramework: framework ${framework.id} already exists`,
      );
    }
    this.state = {
      ...this.state,
      immigrationFrameworks: [...this.state.immigrationFrameworks, framework],
    };
    return framework;
  }

  /** The citizenship framework the country operates at `at`. */
  citizenshipAt(countryId: string, at: WorldTime): CitizenshipFramework | undefined {
    const id = this.configurationAt(countryId, at)?.citizenshipFrameworkId;
    return id === undefined ? undefined : this.citizenshipFramework(id);
  }

  /** The immigration framework the country operates at `at`. */
  immigrationAt(countryId: string, at: WorldTime): ImmigrationFramework | undefined {
    const id = this.configurationAt(countryId, at)?.immigrationFrameworkId;
    return id === undefined ? undefined : this.immigrationFramework(id);
  }

  // ------------------------------------------------------------------ borders

  borders(): readonly BorderRegime[] {
    return this.state.borders;
  }

  /** Every border this country is a party to, historical ones included. */
  bordersOf(countryId: string): readonly BorderRegime[] {
    return this.state.borders.filter(
      (regime) => regime.countryA === countryId || regime.countryB === countryId,
    );
  }

  /** The regime in force between two countries at `at`; undefined if none is authored. */
  borderBetween(countryA: string, countryB: string, at: WorldTime): BorderRegime | undefined {
    if (countryA === countryB) return undefined;
    const pair = orderedPair(countryA, countryB);
    const candidates = this.state.borders.filter(
      (regime) => regime.countryA === pair[0] && regime.countryB === pair[1],
    );
    return latestInForceAt(candidates, at);
  }

  /**
   * Declares a border regime. The pair is stored in a canonical order so the
   * same border is one record, and a newer declaration supersedes the previous
   * open window for that pair (a renegotiated border is a new window, not a
   * mutated old one). Histories move forward: an earlier effective date than the
   * pair's latest declaration is rejected.
   */
  defineBorder(regime: BorderRegime): BorderRegime {
    this.scope.assertOwner("countries");
    requireText(regime.id, "CountriesEngine.defineBorder(id)");
    requireMember(regime.access, BORDER_ACCESS_LEVELS, "CountriesEngine.defineBorder(access)");
    if (regime.countryA === regime.countryB) {
      throw new Error("CountriesEngine.defineBorder: a country does not border itself");
    }
    for (const side of [regime.countryA, regime.countryB]) {
      if (!this.country(side)) {
        throw new Error(`CountriesEngine.defineBorder: unknown country ${side}`);
      }
    }
    if (this.state.borders.some((existing) => existing.id === regime.id)) {
      throw new Error(`CountriesEngine.defineBorder: regime ${regime.id} already exists`);
    }
    const pair = orderedPair(regime.countryA, regime.countryB);
    const samePair = (candidate: BorderRegime): boolean =>
      candidate.countryA === pair[0] && candidate.countryB === pair[1];
    const latest = this.state.borders.filter(samePair).reduce<BorderRegime | undefined>(
      (best, candidate) => (best === undefined || candidate.effectiveFrom > best.effectiveFrom ? candidate : best),
      undefined,
    );
    if (latest && regime.effectiveFrom <= latest.effectiveFrom) {
      throw new Error(
        `CountriesEngine.defineBorder: ${pair[0]} / ${pair[1]} histories move forward (latest starts at ${latest.effectiveFrom})`,
      );
    }
    const ordered: BorderRegime = {
      ...regime,
      countryA: pair[0] as EntityId<"country">,
      countryB: pair[1] as EntityId<"country">,
    };
    const superseded = this.state.borders.map((existing) =>
      samePair(existing) && existing.effectiveUntil === undefined && existing.effectiveFrom < ordered.effectiveFrom
        ? { ...existing, effectiveUntil: ordered.effectiveFrom }
        : existing,
    );
    this.state = { ...this.state, borders: [...superseded, ordered] };
    return ordered;
  }

  /**
   * Answers whether movement from one country into another is possible at `at`.
   *
   * Precedence, most specific first:
   *   1. an explicit `BorderRegime` in force between the pair (a bilateral fact);
   *   2. the *destination* country's immigration framework (its own entry policy);
   *   3. the data-driven rule `border.default_access`, resolved through the scope
   *      chain destination-country → world.
   *
   * Entry is decided by the destination: exit restrictions and document checks
   * are security/legal matters owned by Systems 40 and 48, not modelled here.
   * Nothing in this method mutates state — it is a read that Travel (45) and
   * Legal Identity (40) consult (System 39 "feeds" those systems).
   */
  borderAccess(input: {
    readonly from: string;
    readonly to: string;
    readonly at: WorldTime;
  }): BorderAccessDecision {
    const base = {
      fromCountryId: input.from as EntityId<"country">,
      toCountryId: input.to as EntityId<"country">,
      at: input.at,
    } as const;
    if (input.from === input.to) {
      return { ...base, access: "open", outcome: "allowed", source: "default" };
    }
    const regime = this.borderBetween(input.from, input.to, input.at);
    if (regime) {
      return {
        ...base,
        access: regime.access,
        outcome: borderAccessOutcome(regime.access),
        source: "regime",
        regimeId: regime.id,
      };
    }
    const immigration = this.immigrationAt(input.to, input.at);
    if (immigration) {
      return {
        ...base,
        access: immigration.defaultAccess,
        outcome: borderAccessOutcome(immigration.defaultAccess),
        source: "framework",
        frameworkId: immigration.id,
      };
    }
    const resolution = this.resolveRule(
      DEFAULT_BORDER_ACCESS_RULE_KEY,
      [{ kind: "country", id: input.to }, this.worldScope()],
      input.at,
    );
    if (!resolution) {
      throw new Error(
        `CountriesEngine.borderAccess: no border regime between ${input.from} and ${input.to} at ${input.at}, no immigration framework for ${input.to}, and no "${DEFAULT_BORDER_ACCESS_RULE_KEY}" rule is in force`,
      );
    }
    const access = requireMember(
      String(resolution.value),
      BORDER_ACCESS_LEVELS,
      `CountriesEngine.borderAccess(${DEFAULT_BORDER_ACCESS_RULE_KEY})`,
    );
    return {
      ...base,
      access,
      outcome: borderAccessOutcome(access),
      source: "default",
      ruleId: resolution.ruleId,
    };
  }

  // ------------------------------------------------------------- world rules

  rules(): readonly WorldRule[] {
    return this.state.rules;
  }

  /** Rules attached to one scope, optionally only those in force at `at`. */
  rulesFor(scope: WorldRuleScope, at?: WorldTime): readonly WorldRule[] {
    return this.state.rules.filter(
      (rule) =>
        rule.scope.kind === scope.kind &&
        rule.scope.id === scope.id &&
        (at === undefined || inForceAt(rule, at)),
    );
  }

  /**
   * The rule in force for one key at one scope, if the scope declares one.
   * `effectiveAt` supplies the pre-history fallback, so a scope either declares
   * a key or does not — never "declared it, but not yet".
   */
  ruleAt(key: string, scope: WorldRuleScope, at: WorldTime): WorldRule | undefined {
    return effectiveAt(
      this.state.rules.filter(
        (rule) => rule.key === key && rule.scope.kind === scope.kind && rule.scope.id === scope.id,
      ),
      at,
    );
  }

  /** The world-definition scope (`WORLD-AURELIA`), the root of every chain. */
  worldScope(): WorldRuleScope {
    return { kind: "world", id: this.world.meta.worldId };
  }

  /**
   * Resolves a rule through a scope chain supplied most-specific-first, e.g.
   * settlement → region → country → world. The first scope that declares the
   * key wins; the resolution records every scope consulted, so a caller can
   * explain *why* the value is what it is (System 59).
   */
  resolveRule(
    key: string,
    scopes: readonly WorldRuleScope[],
    at: WorldTime,
  ): WorldRuleResolution | undefined {
    const consulted: WorldRuleScope[] = [];
    for (const scope of scopes) {
      consulted.push(scope);
      const rule = this.ruleAt(key, scope, at);
      if (rule) {
        return {
          key,
          value: rule.value,
          ruleId: rule.id,
          scope,
          at,
          consultedScopes: consulted,
        };
      }
    }
    return undefined;
  }

  /**
   * Defines a rule. A newer rule for the same key *and scope* supersedes the
   * previous open window (that is how a rule changes over time without the past
   * being rewritten); an earlier effective date than the pair's latest is
   * rejected as non-monotonic.
   */
  defineRule(rule: WorldRule): WorldRule {
    this.scope.assertOwner("countries");
    requireText(rule.id, "CountriesEngine.defineRule(id)");
    requireText(rule.key, "CountriesEngine.defineRule(key)");
    requireMember(rule.scope.kind, RULE_SCOPE_KINDS, "CountriesEngine.defineRule(scope.kind)");
    requireText(rule.scope.id, "CountriesEngine.defineRule(scope.id)");
    if (typeof rule.value === "number" && !Number.isFinite(rule.value)) {
      throw new Error(`CountriesEngine.defineRule: ${rule.id} has a non-finite numeric value`);
    }
    if (typeof rule.value === "string") requireText(rule.value, `CountriesEngine.defineRule(${rule.id}).value`);
    if (this.state.rules.some((existing) => existing.id === rule.id)) {
      throw new Error(`CountriesEngine.defineRule: rule ${rule.id} already exists`);
    }
    const latest = this.state.rules
      .filter(
        (existing) =>
          existing.key === rule.key &&
          existing.scope.kind === rule.scope.kind &&
          existing.scope.id === rule.scope.id,
      )
      .reduce<WorldRule | undefined>(
        (best, candidate) =>
          best === undefined || candidate.effectiveFrom > best.effectiveFrom ? candidate : best,
        undefined,
      );
    if (latest && rule.effectiveFrom <= latest.effectiveFrom) {
      throw new Error(
        `CountriesEngine.defineRule: "${rule.key}" at ${rule.scope.kind}:${rule.scope.id} histories move forward (latest starts at ${latest.effectiveFrom})`,
      );
    }
    const superseded = this.state.rules.map((existing) =>
      existing.key === rule.key &&
      existing.scope.kind === rule.scope.kind &&
      existing.scope.id === rule.scope.id &&
      existing.effectiveUntil === undefined &&
      existing.effectiveFrom < rule.effectiveFrom
        ? { ...existing, effectiveUntil: rule.effectiveFrom }
        : existing,
    );
    this.state = { ...this.state, rules: [...superseded, rule] };
    return rule;
  }
}

/** Canonical (lexicographic) ordering of a country pair, so A↔B is one border. */
export function orderedPair(a: string, b: string): readonly [string, string] {
  return a <= b ? [a, b] : [b, a];
}
