/**
 * System 39 — Countries & World Rules.
 *
 * Verifies:
 *   1. Identity & sovereignty (the 48 canonical countries register with canon metadata).
 *   2. Temporal country configuration (effective windows, forward-only amending, historical renames).
 *   3. Jurisdiction hierarchy (national/municipal nesting, chain walks, overlap, non-authorable cycles).
 *   4. Currency references (provisional flag, lookup through the country's configuration).
 *   5. Framework references (citizenship & immigration policy, distinct from a person's status).
 *   6. Symmetric bilateral borders & entry resolution (pair canonicalization, regime precedence, framework fallback, world-rule fallback).
 *   7. Hierarchical world rules as data (scope chain: settlement -> region -> country -> continent -> world).
 *   8. Persistence & architectural boundaries (save/load round-trip equivalence, ownership guard enforcement).
 *   9. Slice seeding integration (the playable slice owns its countries, jurisdictions and world rules).
 */

import { describe, expect, it } from "vitest";
import { CANON_COUNTRIES, CANON_SETTLEMENTS } from "../../src/content/aurelia/canon.ts";
import {
  AURELIA_CITIZENSHIP_FRAMEWORK_ID,
  AURELIA_CURRENCY,
  AURELIA_IMMIGRATION_FRAMEWORK_ID,
  AURELIA_LEGAL_SYSTEM_ID,
  AURELIA_WORLD_RULE_DRAFTS,
  aureliaMunicipalJurisdictionId,
  aureliaNationalJurisdictionId,
  aureliaScopeChain,
  registerAureliaCountries,
} from "../../src/content/aurelia/countries.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import {
  CountriesEngine,
  DEFAULT_BORDER_ACCESS_RULE_KEY,
} from "../../src/engine/countries/engine.ts";
import type {
  BorderRegime,
  CountryChange,
  CountryConfiguration,
  CountryRecord,
  CurrencyReference,
  Jurisdiction,
} from "../../src/engine/countries/types.ts";
import { createKernelSimulation, loadKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";

const SEED = "reellife-countries-test-seed";
const ARDIN_ID = "COUNTRY-ARDIN";
/** Canon names the country `COUNTRY-VEYRA`; `CITY-VEYR` is its capital settlement. */
const VEYR_ID = "COUNTRY-VEYRA";

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

/** Runs `fn` with the `countries` scope held, the only way writes are legal. */
function withCountries<T>(sim: Simulation, fn: (engine: CountriesEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("countries", () => {
    result = fn(new CountriesEngine(sim.scope, sim.world));
  });
  return result;
}

/** Content ids are stable slugs; the engine's nominal types need the cast. */
const countryId = (id: string) => asEntityId<"country">(id);

describe("countries identity and configuration (System 39 / World Bible 03 & 12)", () => {
  it("registers all 48 canonical sovereign countries with canonical metadata", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      expect(engine.countries()).toHaveLength(48);

      for (const canon of CANON_COUNTRIES) {
        const country = engine.country(canon.id);
        expect(country).toBeDefined();
        expect(country?.name).toBe(canon.name);
        expect(country?.continentId).toBe(canon.continentId);
        expect(country?.sovereignty).toBe("sovereign");

        const config = engine.configurationAt(canon.id, sim.clock.time);
        expect(config).toBeDefined();
        expect(config?.governmentType).toBe(canon.governmentType);
        expect(config?.currencyCode).toBe(AURELIA_CURRENCY.code);
        expect(config?.legalSystemId).toBe(AURELIA_LEGAL_SYSTEM_ID);
        expect(config?.citizenshipFrameworkId).toBe(AURELIA_CITIZENSHIP_FRAMEWORK_ID);
        expect(config?.immigrationFrameworkId).toBe(AURELIA_IMMIGRATION_FRAMEWORK_ID);
        if (canon.capitalSettlementId) {
          expect(config?.capitalSettlementId).toBe(canon.capitalSettlementId);
        }
      }

      // Continent membership is derived from canon rather than hard-coded here,
      // so this assertion cannot drift away from the content it describes.
      const perContinent = new Map<string, number>();
      for (const canon of CANON_COUNTRIES) {
        perContinent.set(canon.continentId, (perContinent.get(canon.continentId) ?? 0) + 1);
      }
      for (const [continentId, count] of perContinent) {
        expect(engine.countriesOfContinent(continentId)).toHaveLength(count);
      }
      expect(engine.countriesBySovereignty("sovereign")).toHaveLength(CANON_COUNTRIES.length);
      expect(engine.countryNamed("Republic of Ardin")?.id).toBe(ARDIN_ID);

      // Registration is idempotent, so world creation and re-seeding are safe.
      registerAureliaCountries(engine);
      expect(engine.countries()).toHaveLength(48);
    });
  });

  it("applies forward-only configuration amendments and maintains historical windows", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);

      const t0 = sim.clock.time;
      const t1 = (t0 + 10_000) as WorldTime;
      const t2 = (t0 + 20_000) as WorldTime;

      const initial = engine.configurationAt(ARDIN_ID, t0);
      expect(initial?.governmentType).toBe("Federal Republic");

      // A query before the first authored window falls back to that window —
      // "the country was not configured" is not a state this world can be in.
      expect(engine.configurationAt(ARDIN_ID, (t0 - 5_000) as WorldTime)?.governmentType).toBe(
        "Federal Republic",
      );

      const updatedConfig: CountryConfiguration = {
        ...initial!,
        effectiveFrom: t1,
        governmentType: "Parliamentary Republic",
      };
      engine.amend(ARDIN_ID, updatedConfig);

      expect(engine.configurationAt(ARDIN_ID, t0)?.governmentType).toBe("Federal Republic");
      expect(engine.configurationAt(ARDIN_ID, t1)?.governmentType).toBe("Parliamentary Republic");
      expect(engine.configurationAt(ARDIN_ID, t2)?.governmentType).toBe("Parliamentary Republic");

      const record = engine.country(ARDIN_ID);
      expect(record?.configurations).toHaveLength(2);
      // The superseded window is closed at the new one's start, so exactly one
      // configuration is ever in force.
      expect(record?.configurations[0]?.effectiveUntil).toBe(t1);

      // Histories move forward: an earlier effective date is rejected rather than
      // rewriting the past (law 9 — the past is not silently rewritten).
      expect(() => {
        engine.amend(ARDIN_ID, {
          ...initial!,
          effectiveFrom: (t1 - 100) as WorldTime,
        });
      }).toThrow(/histories move forward/);
    });
  });

  it("records historical renames and keeps historical names queryable", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t1 = (sim.clock.time + 5_000) as WorldTime;

      engine.rename(ARDIN_ID, "Grand Republic of Ardin", t1);

      const record = engine.country(ARDIN_ID);
      expect(record?.name).toBe("Grand Republic of Ardin");
      // Names are attributes, not identity: the id survives, the former name is
      // kept for historical lookup, and the change is recorded with its date.
      expect(record?.id).toBe(ARDIN_ID);
      expect(record?.historicalNames).toEqual(["Republic of Ardin"]);
      expect(record?.history).toHaveLength(1);
      expect(record?.history?.[0]?.kind).toBe("renamed");
      expect(record?.history?.[0]?.at).toBe(t1);
      expect(record?.history?.[0]?.from).toBe("Republic of Ardin");
      expect(record?.history?.[0]?.to).toBe("Grand Republic of Ardin");

      // Renaming a country to the name it already has changes nothing: a no-op
      // rather than a fabricated history entry.
      const unchanged = engine.rename(
        ARDIN_ID,
        "Grand Republic of Ardin",
        (t1 + 100) as WorldTime,
      );
      expect(unchanged.name).toBe("Grand Republic of Ardin");
      expect(unchanged.historicalNames).toHaveLength(1);
      expect(unchanged.history).toHaveLength(1);
    });
  });

  it("records constitutional and political changes on the country record", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t1 = (sim.clock.time + 1000) as WorldTime;

      engine.recordChange(ARDIN_ID, {
        at: t1,
        kind: "constitution",
        summary: "Ratification of constitutional amendment on civic councils",
      });

      const record = engine.country(ARDIN_ID);
      expect(record?.history).toHaveLength(1);
      expect(record?.history?.[0]?.kind).toBe("constitution");
      expect(record?.history?.[0]?.at).toBe(t1);
      expect(engine.historyOf(ARDIN_ID)).toHaveLength(1);

      // Only kinds the country model defines can be recorded, so history cannot
      // accumulate arbitrary labels.
      expect(() =>
        engine.recordChange(ARDIN_ID, {
          at: (t1 + 100) as WorldTime,
          kind: "coup" as CountryChange["kind"],
          summary: "not a recorded change kind",
        }),
      ).toThrow(/is not one of/);
      expect(engine.historyOf(ARDIN_ID)).toHaveLength(1);
    });
  });
});

describe("jurisdictions and hierarchy (System 39 / World Bible 03 & 05)", () => {
  it("registers national jurisdictions and municipal jurisdictions nested correctly", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);

      const nationalJurId = aureliaNationalJurisdictionId(ARDIN_ID);
      const nationalJur = engine.jurisdiction(nationalJurId);
      expect(nationalJur).toBeDefined();
      expect(nationalJur?.level).toBe("national");
      expect(nationalJur?.parentJurisdictionId).toBeUndefined();

      const municipalJurId = aureliaMunicipalJurisdictionId("CITY-ARDEN");
      const municipalJur = engine.jurisdiction(municipalJurId);
      expect(municipalJur).toBeDefined();
      expect(municipalJur?.level).toBe("municipal");
      expect(municipalJur?.parentJurisdictionId).toBe(nationalJurId);

      // The chain walks root-first and ends with the jurisdiction itself, so a
      // municipal authority can state which national authority it sits under.
      expect(engine.jurisdictionChain(municipalJurId).map((j) => j.id)).toEqual([
        nationalJurId,
        municipalJurId,
      ]);

      for (const settlement of CANON_SETTLEMENTS) {
        const jurId = aureliaMunicipalJurisdictionId(settlement.id);
        const jur = engine.jurisdiction(jurId);
        expect(jur).toBeDefined();
        expect(jur?.countryId).toBe(settlement.countryId);
      }

      // One national jurisdiction per country plus one municipal per settlement.
      expect(engine.jurisdictions()).toHaveLength(
        CANON_COUNTRIES.length + CANON_SETTLEMENTS.length,
      );
      expect(engine.jurisdictionsOfCountry(ARDIN_ID).map((j) => j.id)).toContain(nationalJurId);
    });
  });

  it("finds all jurisdictions covering a location", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;

      const ardenJurisdictions = engine.jurisdictionsAt("CITY-ARDEN", t);
      expect(ardenJurisdictions.map((j) => j.id)).toContain(
        aureliaMunicipalJurisdictionId("CITY-ARDEN"),
      );

      const ardinJurisdictions = engine.jurisdictionsAt(ARDIN_ID, t);
      expect(ardinJurisdictions.map((j) => j.id)).toContain(
        aureliaNationalJurisdictionId(ARDIN_ID),
      );
      // A national authority claims the country itself, not every city inside it:
      // an authority claim is not geographic containment (System 37 owns space).
      expect(ardinJurisdictions.map((j) => j.id)).not.toContain(
        aureliaMunicipalJurisdictionId("CITY-ARDEN"),
      );

      // Overlap is the norm, not an error — an enclave or free zone may govern a
      // place another jurisdiction also governs (WORLD_03: "Effective control
      // != formal jurisdiction"). The most specific authority is listed first.
      engine.defineJurisdiction({
        id: "JUR-SPECIAL-ARDEN-PORT",
        countryId: countryId(ARDIN_ID),
        name: "Arden free-port authority",
        level: "special",
        parentJurisdictionId: aureliaNationalJurisdictionId(ARDIN_ID),
        locationIds: ["CITY-ARDEN"],
        effectiveFrom: t,
      });
      expect(engine.jurisdictionsAt("CITY-ARDEN", t).map((j) => j.id)).toEqual([
        "JUR-SPECIAL-ARDEN-PORT",
        aureliaMunicipalJurisdictionId("CITY-ARDEN"),
      ]);
    });
  });

  it("rejects jurisdiction nesting that could form a cycle", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;

      const region: Jurisdiction = {
        id: "JUR-TEST-REGION",
        countryId: countryId(ARDIN_ID),
        name: "Test region",
        level: "regional",
        locationIds: [ARDIN_ID],
        effectiveFrom: t,
      };
      engine.defineJurisdiction(region);

      const city: Jurisdiction = {
        id: "JUR-TEST-CITY",
        countryId: countryId(ARDIN_ID),
        name: "Test city",
        level: "municipal",
        parentJurisdictionId: region.id,
        locationIds: ["CITY-ARDEN"],
        effectiveFrom: t,
      };
      engine.defineJurisdiction(city);
      expect(engine.jurisdictionChain(city.id).map((j) => j.id)).toEqual([region.id, city.id]);

      // A parent must already exist, which is exactly why A -> B -> A can never
      // be authored: whichever half is defined first would have to name a parent
      // that does not exist yet.
      expect(() =>
        engine.defineJurisdiction({
          ...region,
          id: "JUR-TEST-ORPHAN",
          parentJurisdictionId: "JUR-TEST-MISSING",
        }),
      ).toThrow(/parent JUR-TEST-MISSING of JUR-TEST-ORPHAN is not defined/);

      // Self-parenting is refused explicitly, so the error names the real fault
      // instead of reporting a jurisdiction as its own missing parent.
      expect(() =>
        engine.defineJurisdiction({
          ...region,
          id: "JUR-TEST-SELF",
          parentJurisdictionId: "JUR-TEST-SELF",
        }),
      ).toThrow(/cannot be its own parent/);
    });
  });
});

describe("currencies and frameworks (System 39)", () => {
  it("manages currency references and provides currency lookup for countries", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);

      const aur = engine.currency("AUR");
      expect(aur).toBeDefined();
      expect(aur?.code).toBe("AUR");
      // The Bible authors no currencies, so the single shared one is flagged.
      expect(aur?.provisional).toBe(true);
      expect(engine.currencies()).toHaveLength(1);

      const ardinCurrency = engine.currencyOfCountry(ARDIN_ID, sim.clock.time);
      expect(ardinCurrency?.code).toBe("AUR");

      const vcd: CurrencyReference = {
        code: "VCD",
        name: "Veyran Credit",
        minorUnitScale: 2,
        provisional: true,
      };
      engine.defineCurrency(vcd);
      expect(engine.currency("VCD")?.name).toBe("Veyran Credit");

      expect(() => engine.defineCurrency(AURELIA_CURRENCY)).toThrow(/already exists/);
    });
  });

  it("manages citizenship and immigration frameworks", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;

      const cit = engine.citizenshipFramework(AURELIA_CITIZENSHIP_FRAMEWORK_ID);
      expect(cit).toBeDefined();
      expect(cit?.bases).toContain("birth_in_territory");
      expect(cit?.allowsDualCitizenship).toBe(true);

      const imm = engine.immigrationFramework(AURELIA_IMMIGRATION_FRAMEWORK_ID);
      expect(imm).toBeDefined();
      expect(imm?.defaultAccess).toBe("passport_required");
      expect(imm?.allowsPermanentResidency).toBe(true);

      // A country references the frameworks; an individual's *status* is owned by
      // System 40 and is never stored here (WORLD_04: "Citizenship distinct from
      // residence, nationality, ethnicity, birthplace").
      expect(engine.citizenshipAt(ARDIN_ID, t)?.id).toBe(AURELIA_CITIZENSHIP_FRAMEWORK_ID);
      expect(engine.immigrationAt(ARDIN_ID, t)?.id).toBe(AURELIA_IMMIGRATION_FRAMEWORK_ID);
      expect(engine.citizenshipFramework("CIT-UNKNOWN")).toBeUndefined();
      expect(engine.immigrationFramework("IMM-UNKNOWN")).toBeUndefined();
    });
  });
});

describe("bilateral borders and borderAccess resolution (System 39)", () => {
  it("canonicalizes country pairs symmetrically", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;

      const regime: BorderRegime = {
        id: "BORDER-ARDIN-VEYR",
        countryA: countryId(VEYR_ID),
        countryB: countryId(ARDIN_ID),
        access: "open",
        effectiveFrom: t,
      };

      engine.defineBorder(regime);

      const lookup1 = engine.borderBetween(ARDIN_ID, VEYR_ID, t);
      const lookup2 = engine.borderBetween(VEYR_ID, ARDIN_ID, t);
      expect(lookup1).toBeDefined();
      expect(lookup2).toBeDefined();
      expect(lookup1?.id).toBe("BORDER-ARDIN-VEYR");
      expect(lookup2?.id).toBe("BORDER-ARDIN-VEYR");
      // "The border between A and B" is one fact, stored in canonical order, so
      // the pair can never disagree with itself.
      expect(lookup1?.countryA).toBe(ARDIN_ID);
      expect(lookup1?.countryB).toBe(VEYR_ID);
      expect(engine.bordersOf(VEYR_ID).map((r) => r.id)).toEqual(["BORDER-ARDIN-VEYR"]);
      expect(engine.borders()).toHaveLength(1);

      // A country does not border itself, and neither side may be unknown.
      expect(engine.borderBetween(ARDIN_ID, ARDIN_ID, t)).toBeUndefined();
      expect(() =>
        engine.defineBorder({
          id: "BORDER-SELF",
          countryA: countryId(ARDIN_ID),
          countryB: countryId(ARDIN_ID),
          access: "open",
          effectiveFrom: t,
        }),
      ).toThrow(/does not border itself/);
      expect(() =>
        engine.defineBorder({
          id: "BORDER-GHOST",
          countryA: countryId(ARDIN_ID),
          countryB: countryId("COUNTRY-GHOST"),
          access: "open",
          effectiveFrom: t,
        }),
      ).toThrow(/unknown country COUNTRY-GHOST/);
    });
  });

  it("resolves borderAccess through the precedence chain", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;

      const intra = engine.borderAccess({ from: ARDIN_ID, to: ARDIN_ID, at: t });
      expect(intra.outcome).toBe("allowed");
      expect(intra.access).toBe("open");
      expect(intra.source).toBe("default");

      // No bilateral regime is authored by the Bible, so entry follows the
      // *destination* country's own immigration framework. A passport check still
      // permits the crossing, so the outcome is conditional, not denied.
      const interDefault = engine.borderAccess({ from: ARDIN_ID, to: VEYR_ID, at: t });
      expect(interDefault.outcome).toBe("conditional");
      expect(interDefault.access).toBe("passport_required");
      expect(interDefault.source).toBe("framework");
      expect(interDefault.frameworkId).toBe(AURELIA_IMMIGRATION_FRAMEWORK_ID);

      engine.defineBorder({
        id: "BORDER-ARDIN-VEYR",
        countryA: countryId(ARDIN_ID),
        countryB: countryId(VEYR_ID),
        access: "closed",
        effectiveFrom: t,
      });

      // An explicit bilateral regime outranks the destination's general policy.
      const interRegime = engine.borderAccess({ from: ARDIN_ID, to: VEYR_ID, at: t });
      expect(interRegime.outcome).toBe("denied");
      expect(interRegime.access).toBe("closed");
      expect(interRegime.source).toBe("regime");
      expect(interRegime.regimeId).toBe("BORDER-ARDIN-VEYR");

      // With neither regime nor framework to consult, the world rule decides.
      const ruleFallback = engine.borderAccess({
        from: "COUNTRY-UNKNOWN-A",
        to: "COUNTRY-UNKNOWN-B",
        at: t,
      });
      expect(ruleFallback.outcome).toBe("conditional");
      expect(ruleFallback.access).toBe("passport_required");
      expect(ruleFallback.source).toBe("default");
      expect(ruleFallback.ruleId).toBe("RULE-BORDER-DEFAULT-ACCESS");

      // borderAccess is a read for Travel (45) and Legal Identity (40) to consult:
      // asking never adds state.
      expect(engine.borders()).toHaveLength(1);
    });
  });
});

describe("hierarchical world rules as data (System 39 / World Bible 12)", () => {
  it("resolves canonical world rules from WORLD_BUILD_12", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;
      // A canonical place's chain falls through to the world's own rules, which
      // is where every WORLD_BUILD_12 statement lives.
      const chain = aureliaScopeChain(ARDIN_ID, engine.worldScope().id);

      expect(engine.resolveRule("economy.is_mixed", chain, t)?.value).toBe(true);
      expect(engine.resolveRule("energy.transition_complete", chain, t)?.value).toBe(false);
      expect(engine.resolveRule("technology.uneven_access", chain, t)?.value).toBe(true);
      expect(engine.resolveRule("information.is_decentralized", chain, t)?.value).toBe(true);
      expect(engine.resolveRule("migration.is_major_demographic_force", chain, t)?.value).toBe(true);
      expect(engine.resolveRule("security.global_war", chain, t)?.value).toBe(false);
      expect(engine.resolveRule("education.literacy_is_high", chain, t)?.value).toBe(true);
      expect(engine.resolveRule(DEFAULT_BORDER_ACCESS_RULE_KEY, chain, t)?.value).toBe(
        "passport_required",
      );

      expect(engine.rules()).toHaveLength(AURELIA_WORLD_RULE_DRAFTS.length);
      // The border default is the one provisional rule: the Bible authors border
      // behaviour but no border geometry or treaties.
      const borderDefault = engine.ruleAt(DEFAULT_BORDER_ACCESS_RULE_KEY, engine.worldScope(), t);
      expect(borderDefault?.provisional).toBe(true);

      // An empty chain consults nothing, so there is no answer to give — a rule is
      // never invented from a scope that was not asked about.
      expect(engine.resolveRule("economy.is_mixed", [], t)).toBeUndefined();
    });
  });

  it("prefers narrower scopes over wider scopes (settlement > region > country > continent > world)", () => {
    const sim = newWorld();
    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      const t = sim.clock.time;
      const worldId = engine.worldScope().id;

      engine.defineRule({
        id: "RULE-TAX-WORLD",
        key: "tax.commercial_rate",
        value: 0.15,
        scope: { kind: "world", id: worldId },
        effectiveFrom: t,
      });

      engine.defineRule({
        id: "RULE-TAX-ARDIN",
        key: "tax.commercial_rate",
        value: 0.2,
        scope: { kind: "country", id: ARDIN_ID },
        effectiveFrom: t,
      });

      engine.defineRule({
        id: "RULE-TAX-ARDEN",
        key: "tax.commercial_rate",
        value: 0.25,
        scope: { kind: "settlement", id: "CITY-ARDEN" },
        effectiveFrom: t,
      });

      const ardenScopes = aureliaScopeChain("CITY-ARDEN", worldId);
      const resolvedArden = engine.resolveRule("tax.commercial_rate", ardenScopes, t);
      expect(resolvedArden?.value).toBe(0.25);
      expect(resolvedArden?.scope.kind).toBe("settlement");
      expect(resolvedArden?.ruleId).toBe("RULE-TAX-ARDEN");
      // Explainability (System 59): only the scopes actually consulted, up to and
      // including the winner, are reported — the chain is not echoed wholesale.
      expect(resolvedArden?.consultedScopes).toEqual([{ kind: "settlement", id: "CITY-ARDEN" }]);

      const otherPlaceInArdin = [
        { kind: "country", id: ARDIN_ID } as const,
        engine.worldScope(),
      ];
      const resolvedOther = engine.resolveRule("tax.commercial_rate", otherPlaceInArdin, t);
      expect(resolvedOther?.value).toBe(0.2);
      expect(resolvedOther?.scope.kind).toBe("country");
      // The chain is walked most-specific-first and stops at the winner, so a
      // scope that was never needed is not reported as if it had been consulted.
      expect(resolvedOther?.consultedScopes).toEqual([{ kind: "country", id: ARDIN_ID }]);

      // A place whose own scopes declare nothing falls through to the world rule,
      // and the resolution shows every scope that had to be opened to get there.
      const fallingThrough = [
        { kind: "settlement", id: "CITY-VALEDOR" } as const,
        { kind: "region", id: "REGION-WESTERN-MARCHES" } as const,
        { kind: "country", id: "COUNTRY-VALEDON" } as const,
        engine.worldScope(),
      ];
      const resolvedFallback = engine.resolveRule("tax.commercial_rate", fallingThrough, t);
      expect(resolvedFallback?.value).toBe(0.15);
      expect(resolvedFallback?.scope.kind).toBe("world");
      expect(resolvedFallback?.ruleId).toBe("RULE-TAX-WORLD");
      expect(resolvedFallback?.consultedScopes).toHaveLength(4);

      const resolvedWorld = engine.resolveRule("tax.commercial_rate", [engine.worldScope()], t);
      expect(resolvedWorld?.value).toBe(0.15);

      // A rule is never written into the past: the same key and scope only moves
      // forward, so history keeps the values that were actually in force.
      expect(() =>
        engine.defineRule({
          id: "RULE-TAX-WORLD-PAST",
          key: "tax.commercial_rate",
          value: 0.1,
          scope: { kind: "world", id: worldId },
          effectiveFrom: (t - 1) as WorldTime,
        }),
      ).toThrow(/histories move forward/);
    });
  });
});

describe("persistence, boundaries, and slice seeding (System 39 / Law 13)", () => {
  it("survives save/load without drifting", async () => {
    const sim = newWorld();
    const now = sim.clock.time;

    withCountries(sim, (engine) => {
      registerAureliaCountries(engine);
      engine.defineBorder({
        id: "BORDER-CUSTOM",
        countryA: countryId(ARDIN_ID),
        countryB: countryId(VEYR_ID),
        access: "visa_required",
        effectiveFrom: now,
      });
      engine.defineRule({
        id: "RULE-CUSTOM-TARIFF",
        key: "trade.tariff_rate",
        value: 0.05,
        scope: { kind: "world", id: engine.worldScope().id },
        effectiveFrom: now,
      });
    });

    const hash = sim.stateHash();
    await sim.saveTo("slot-countries", "countries test save");

    const reloaded = await loadKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      saveStore: sim.saveStore,
      slotName: "slot-countries",
    });

    expect(reloaded.stateHash()).toBe(hash);

    const check = withCountries(reloaded, (engine) => ({
      countryCount: engine.countries().length,
      border: engine.borderBetween(ARDIN_ID, VEYR_ID, now),
      rule: engine.resolveRule("trade.tariff_rate", [engine.worldScope()], now),
      ardenChain: engine.jurisdictionChain(aureliaMunicipalJurisdictionId("CITY-ARDEN")).map(
        (j) => j.id,
      ),
    }));

    expect(check.countryCount).toBe(48);
    expect(check.border?.access).toBe("visa_required");
    expect(check.rule?.value).toBe(0.05);
    // The jurisdiction hierarchy is restored as a hierarchy, not as loose rows.
    expect(check.ardenChain).toEqual([
      aureliaNationalJurisdictionId(ARDIN_ID),
      aureliaMunicipalJurisdictionId("CITY-ARDEN"),
    ]);
  });

  it("keeps countries state protected by the ownership guard", () => {
    const sim = newWorld();
    const dummyRecord: CountryRecord = {
      id: countryId("COUNTRY-TEST"),
      name: "Test Country",
      continentId: "CONT-ELANDRA",
      sovereignty: "sovereign",
      foundedAt: sim.clock.time,
      configurations: [
        {
          effectiveFrom: sim.clock.time,
          governmentType: "Republic",
        },
      ],
    };

    // Constructing the engine outside a write scope is refused outright.
    expect(() => new CountriesEngine(sim.scope, sim.world)).toThrow(MissingWriterContextError);

    sim.guard.mutate("countries", () => {
      new CountriesEngine(sim.scope, sim.world).define(dummyRecord);
    });

    // Holding a different system's scope cannot write countries state (law 1).
    expect(() => {
      sim.guard.mutate("needs", () => {
        new CountriesEngine(sim.scope, sim.world).rename("COUNTRY-TEST", "New Name", sim.clock.time);
      });
    }).toThrow(OwnershipViolationError);
  });

  it("seeds countries, frameworks, jurisdictions and rules when seeding playable slice", () => {
    const sim = createKernelSimulation({
      masterSeed: SEED,
      checkInvariants: true,
      seedSlice: true,
    });

    const state = withCountries(sim, (engine) => ({
      countries: engine.countries(),
      jurisdictions: engine.jurisdictions(),
      currencies: engine.currencies(),
      rules: engine.rules(),
    }));

    expect(state.countries).toHaveLength(48);
    expect(state.jurisdictions.length).toBeGreaterThan(48);
    expect(state.currencies).toHaveLength(1);
    expect(state.rules.length).toBe(AURELIA_WORLD_RULE_DRAFTS.length);
  });
});

