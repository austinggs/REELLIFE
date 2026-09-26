/**
 * Milestone 4 DoD verification:
 * "data-validation test asserting 6/5/36/48/34 counts and unique IDs"
 *
 * Source of truth: REEL LIFE FULL PLAN SOURCE / REELLIFE_WORLD_BIBLE_V1
 */

import { describe, expect, it } from "vitest";
import {
  CANON_ACTIVE_DEVELOPMENTS,
  CANON_CONTINENTS,
  CANON_CORRIDORS,
  CANON_COUNTRIES,
  CANON_ERAS,
  CANON_LANGUAGE_FAMILIES,
  CANON_MOUNTAINS,
  CANON_OCEANS,
  CANON_REGIONS,
  CANON_RELIGIONS,
  CANON_RIVERS,
  CANON_SETTLEMENTS,
} from "../../src/content/aurelia/canon.ts";

describe("Aurelia canonical world data validation (M4 DoD)", () => {
  it("asserts exact counts: 6 continents, 5 oceans, 36 regions, 48 countries, 34 settlements", () => {
    expect(CANON_CONTINENTS).toHaveLength(6);
    expect(CANON_OCEANS).toHaveLength(5);
    expect(CANON_REGIONS).toHaveLength(36);
    expect(CANON_COUNTRIES).toHaveLength(48);
    expect(CANON_SETTLEMENTS).toHaveLength(34);
  });

  it("asserts exact counts for geography features, eras, languages, religions and active events", () => {
    expect(CANON_MOUNTAINS).toHaveLength(4);
    expect(CANON_RIVERS).toHaveLength(5);
    expect(CANON_CORRIDORS).toHaveLength(6);
    expect(CANON_ERAS).toHaveLength(8);
    expect(CANON_LANGUAGE_FAMILIES).toHaveLength(6);
    expect(CANON_RELIGIONS).toHaveLength(7);
    expect(CANON_ACTIVE_DEVELOPMENTS).toHaveLength(17);
  });

  it("verifies country continental distribution matches World Build 03", () => {
    const elandra = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-ELANDRA");
    const veyra = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-VEYRA");
    const sahraen = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-SAHRAEN");
    const orinth = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-ORINTH");
    const kharos = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-KHAROS");
    const ilyra = CANON_COUNTRIES.filter((c) => c.continentId === "CONT-ILYRA");

    expect(elandra).toHaveLength(10);
    expect(veyra).toHaveLength(9);
    expect(sahraen).toHaveLength(8);
    expect(orinth).toHaveLength(8);
    expect(kharos).toHaveLength(7);
    expect(ilyra).toHaveLength(6);
  });

  it("verifies regional continental distribution matches World Build 02 (6 per continent)", () => {
    const continents = [
      "CONT-ELANDRA",
      "CONT-VEYRA",
      "CONT-SAHRAEN",
      "CONT-ORINTH",
      "CONT-KHAROS",
      "CONT-ILYRA",
    ];
    for (const contId of continents) {
      const regionsInCont = CANON_REGIONS.filter((r) => r.continentId === contId);
      expect(regionsInCont).toHaveLength(6);
    }
  });

  it("verifies major settlement continental distribution matches World Build 04", () => {
    const elandra = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-ELANDRA");
    const veyra = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-VEYRA");
    const sahraen = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-SAHRAEN");
    const orinth = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-ORINTH");
    const kharos = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-KHAROS");
    const ilyra = CANON_SETTLEMENTS.filter((s) => s.continentId === "CONT-ILYRA");

    expect(elandra).toHaveLength(6);
    expect(veyra).toHaveLength(6);
    expect(sahraen).toHaveLength(6);
    expect(orinth).toHaveLength(6);
    expect(kharos).toHaveLength(5);
    expect(ilyra).toHaveLength(5);
  });

  it("asserts unique IDs across all canonical entities without collisions", () => {
    const allIds = [
      ...CANON_CONTINENTS.map((c) => c.id),
      ...CANON_OCEANS.map((o) => o.id),
      ...CANON_REGIONS.map((r) => r.id),
      ...CANON_COUNTRIES.map((c) => c.id),
      ...CANON_SETTLEMENTS.map((s) => s.id),
      ...CANON_MOUNTAINS.map((m) => m.id),
      ...CANON_RIVERS.map((r) => r.id),
      ...CANON_CORRIDORS.map((c) => c.id),
      ...CANON_LANGUAGE_FAMILIES.map((l) => l.id),
      ...CANON_RELIGIONS.map((r) => r.id),
      ...CANON_ACTIVE_DEVELOPMENTS.map((d) => d.id),
    ];
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it("verifies coordinates are within valid geographic bounds", () => {
    const checkCoords = (place: { id: string; coordinates: { latitude: number; longitude: number } }) => {
      expect(place.coordinates.latitude).toBeGreaterThanOrEqual(-90);
      expect(place.coordinates.latitude).toBeLessThanOrEqual(90);
      expect(place.coordinates.longitude).toBeGreaterThanOrEqual(-180);
      expect(place.coordinates.longitude).toBeLessThanOrEqual(180);
    };

    CANON_CONTINENTS.forEach(checkCoords);
    CANON_OCEANS.forEach(checkCoords);
    CANON_REGIONS.forEach(checkCoords);
    CANON_COUNTRIES.forEach(checkCoords);
    CANON_SETTLEMENTS.forEach(checkCoords);
  });

  it("verifies referential integrity across hierarchy relationships", () => {
    const continentIds = new Set(CANON_CONTINENTS.map((c) => c.id));
    const countryIds = new Set(CANON_COUNTRIES.map((c) => c.id));
    const regionIds = new Set(CANON_REGIONS.map((r) => r.id));

    // Every country points to a real continent
    for (const country of CANON_COUNTRIES) {
      expect(continentIds.has(country.continentId)).toBe(true);
    }

    // Every region points to a real continent
    for (const region of CANON_REGIONS) {
      expect(continentIds.has(region.continentId)).toBe(true);
    }

    // Every settlement points to a real country, region, and continent
    for (const settlement of CANON_SETTLEMENTS) {
      expect(continentIds.has(settlement.continentId)).toBe(true);
      expect(countryIds.has(settlement.countryId)).toBe(true);
      expect(regionIds.has(settlement.regionId)).toBe(true);
    }
  });
});
