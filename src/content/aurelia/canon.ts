import type { GeoPoint } from "../../engine/primitives/location.ts";

export interface ContinentCanon {
  readonly id: string;
  readonly name: string;
  readonly coordinates: GeoPoint;
  readonly targetPopulation: number;
}

export interface OceanCanon {
  readonly id: string;
  readonly name: string;
  readonly coordinates: GeoPoint;
}

export interface RegionCanon {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly countryId?: string;
  readonly climate: string;
  readonly coordinates: GeoPoint;
}

export interface CountryCanon {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly capitalSettlementId?: string;
  readonly governmentType: string;
  readonly currencyCode: string;
  readonly coordinates: GeoPoint;
}

export interface SettlementCanon {
  readonly id: string;
  readonly name: string;
  readonly countryId: string;
  readonly regionId: string;
  readonly continentId: string;
  readonly role: string;
  readonly isFinancialCenter?: boolean;
  readonly coordinates: GeoPoint;
  readonly historicalNames?: readonly string[];
}

export interface MountainCanon {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly coordinates: GeoPoint;
}

export interface RiverCanon {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly coordinates: GeoPoint;
}

export interface CorridorCanon {
  readonly id: string;
  readonly name: string;
  readonly continentId: string;
  readonly settlementIds: readonly string[];
}

export interface EraCanon {
  readonly number: number;
  readonly name: string;
  readonly description: string;
}

export interface LanguageFamilyCanon {
  readonly id: string;
  readonly name: string;
  readonly script: string;
  readonly languages: readonly string[];
}

export interface ReligionCanon {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly coreThemes: readonly string[];
}

export interface ActiveDevelopmentCanon {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly summary: string;
}

export const CANON_CONTINENTS: readonly ContinentCanon[] = [
  { id: "CONT-ELANDRA", name: "Elandra", coordinates: { latitude: 35.0, longitude: 5.0 }, targetPopulation: 1_350_000_000 },
  { id: "CONT-VEYRA", name: "Veyra", coordinates: { latitude: 45.0, longitude: 85.0 }, targetPopulation: 1_550_000_000 },
  { id: "CONT-SAHRAEN", name: "Sahraen", coordinates: { latitude: -5.0, longitude: -45.0 }, targetPopulation: 1_250_000_000 },
  { id: "CONT-ORINTH", name: "Orinth", coordinates: { latitude: -35.0, longitude: 80.0 }, targetPopulation: 1_100_000_000 },
  { id: "CONT-KHAROS", name: "Kharos", coordinates: { latitude: 52.0, longitude: -125.0 }, targetPopulation: 850_000_000 },
  { id: "CONT-ILYRA", name: "Ilyra", coordinates: { latitude: -25.0, longitude: 160.0 }, targetPopulation: 700_000_000 },
];

export const CANON_OCEANS: readonly OceanCanon[] = [
  { id: "OCEAN-MERIDIAN", name: "Meridian Ocean", coordinates: { latitude: 0.0, longitude: 0.0 } },
  { id: "OCEAN-WESTERN", name: "Western Ocean", coordinates: { latitude: 15.0, longitude: -100.0 } },
  { id: "OCEAN-EASTERN", name: "Eastern Ocean", coordinates: { latitude: 10.0, longitude: 130.0 } },
  { id: "OCEAN-SOUTHERN", name: "Southern Ocean", coordinates: { latitude: -65.0, longitude: 0.0 } },
  { id: "OCEAN-POLAR", name: "Polar Ocean", coordinates: { latitude: 82.0, longitude: 0.0 } },
];

export const CANON_REGIONS: readonly RegionCanon[] = [
  // Elandra (6)
  { id: "REGION-CROWNLANDS", name: "Crownlands", continentId: "CONT-ELANDRA", countryId: "COUNTRY-HIGHLAND-FEDERATION", climate: "alpine", coordinates: { latitude: 45.0, longitude: 2.0 } },
  { id: "REGION-ARDAN-BASIN", name: "Ardan Basin", continentId: "CONT-ELANDRA", countryId: "COUNTRY-ARDIN", climate: "temperate_river_basin", coordinates: { latitude: 34.0, longitude: 7.0 } },
  { id: "REGION-WESTERN-MARCHES", name: "Western Marches", continentId: "CONT-ELANDRA", countryId: "COUNTRY-VALEDON", climate: "maritime_temperate", coordinates: { latitude: 38.0, longitude: -8.0 } },
  { id: "REGION-GREEN-COAST", name: "Green Coast", continentId: "CONT-ELANDRA", countryId: "COUNTRY-SELVARA", climate: "subtropical_coastal", coordinates: { latitude: 30.0, longitude: 16.0 } },
  { id: "REGION-INNER-STEPPE", name: "Inner Steppe", continentId: "CONT-ELANDRA", countryId: "COUNTRY-TORREN", climate: "semi_arid_steppe", coordinates: { latitude: 42.0, longitude: 12.0 } },
  { id: "REGION-EASTERN-HIGHLANDS", name: "Eastern Highlands", continentId: "CONT-ELANDRA", countryId: "COUNTRY-NARETH", climate: "continental_upland", coordinates: { latitude: 36.0, longitude: 24.0 } },

  // Veyra (6)
  { id: "REGION-VEYRAN-HEARTLAND", name: "Veyran Heartland", continentId: "CONT-VEYRA", countryId: "COUNTRY-VEYRA", climate: "temperate_continental", coordinates: { latitude: 48.0, longitude: 82.0 } },
  { id: "REGION-NORTHERN-FORESTS", name: "Northern Forests", continentId: "CONT-VEYRA", countryId: "COUNTRY-NORVALE", climate: "boreal", coordinates: { latitude: 58.0, longitude: 90.0 } },
  { id: "REGION-WESTERN-COAST", name: "Western Coast", continentId: "CONT-VEYRA", countryId: "COUNTRY-WESTHAVEN", climate: "maritime", coordinates: { latitude: 44.0, longitude: 56.0 } },
  { id: "REGION-CENTRAL-BASIN", name: "Central Basin", continentId: "CONT-VEYRA", countryId: "COUNTRY-EDRIA", climate: "fertile_valley", coordinates: { latitude: 42.0, longitude: 76.0 } },
  { id: "REGION-SOUTHERN-UPLANDS", name: "Southern Uplands", continentId: "CONT-VEYRA", countryId: "COUNTRY-SORELL", climate: "temperate_hills", coordinates: { latitude: 38.0, longitude: 86.0 } },
  { id: "REGION-EASTERN-LITTORAL", name: "Eastern Littoral", continentId: "CONT-VEYRA", countryId: "COUNTRY-LETHEN", climate: "coastal_oceanic", coordinates: { latitude: 46.0, longitude: 110.0 } },

  // Sahraen (6)
  { id: "REGION-SAHRAEN-NORTHERN-COAST", name: "Northern Coast", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-NAMAR", climate: "mediterranean_arid", coordinates: { latitude: 18.0, longitude: -42.0 } },
  { id: "REGION-GREAT-INTERIOR", name: "Great Interior", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-KESH", climate: "arid_desert", coordinates: { latitude: 10.0, longitude: -48.0 } },
  { id: "REGION-SAREN-BASIN", name: "Saren Basin", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-SARAD", climate: "tropical_river_basin", coordinates: { latitude: -2.0, longitude: -40.0 } },
  { id: "REGION-SAHRAEN-EASTERN-HIGHLANDS", name: "Eastern Highlands", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-TEREN", climate: "tropical_montane", coordinates: { latitude: -10.0, longitude: -26.0 } },
  { id: "REGION-SOUTHERN-SAVANNAH", name: "Southern Savannah", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-BELARA", climate: "tropical_savannah", coordinates: { latitude: -18.0, longitude: -38.0 } },
  { id: "REGION-RAINFOREST-BELT", name: "Rainforest Belt", continentId: "CONT-SAHRAEN", countryId: "COUNTRY-OMERA", climate: "equatorial_rainforest", coordinates: { latitude: -6.0, longitude: -55.0 } },

  // Orinth (6)
  { id: "REGION-NORTHERN-PLAINS", name: "Northern Plains", continentId: "CONT-ORINTH", countryId: "COUNTRY-BELMOND", climate: "temperate_grassland", coordinates: { latitude: -20.0, longitude: 72.0 } },
  { id: "REGION-ORINTHIAN-BASIN", name: "Orinthian Basin", continentId: "CONT-ORINTH", countryId: "COUNTRY-ORINTH", climate: "alluvial_basin", coordinates: { latitude: -32.0, longitude: 78.0 } },
  { id: "REGION-WESTERN-GRASSLANDS", name: "Western Grasslands", continentId: "CONT-ORINTH", countryId: "COUNTRY-WESTMARK", climate: "semi_arid_prairie", coordinates: { latitude: -28.0, longitude: 58.0 } },
  { id: "REGION-ORINTH-CENTRAL-HIGHLANDS", name: "Central Highlands", continentId: "CONT-ORINTH", countryId: "COUNTRY-TARSEN", climate: "montane_temperate", coordinates: { latitude: -36.0, longitude: 92.0 } },
  { id: "REGION-ORINTH-SOUTHERN-WALL", name: "Southern Wall", continentId: "CONT-ORINTH", countryId: "COUNTRY-SARETH", climate: "alpine_barrier", coordinates: { latitude: -42.0, longitude: 80.0 } },
  { id: "REGION-ORINTH-SOUTHERN-COAST", name: "Southern Coast", continentId: "CONT-ORINTH", countryId: "COUNTRY-AVELON", climate: "cool_maritime", coordinates: { latitude: -46.0, longitude: 86.0 } },

  // Kharos (6)
  { id: "REGION-NORTHERN-TUNDRA", name: "Northern Tundra", continentId: "CONT-KHAROS", countryId: "COUNTRY-NORTHERN-FEDERATION", climate: "polar_tundra", coordinates: { latitude: 68.0, longitude: -125.0 } },
  { id: "REGION-KHARIC-RANGE", name: "Kharic Range", continentId: "CONT-KHAROS", countryId: "COUNTRY-DOREN", climate: "high_alpine", coordinates: { latitude: 56.0, longitude: -136.0 } },
  { id: "REGION-GREAT-PLATEAU", name: "Great Plateau", continentId: "CONT-KHAROS", countryId: "COUNTRY-KHAR", climate: "continental_cold", coordinates: { latitude: 50.0, longitude: -120.0 } },
  { id: "REGION-EASTERN-FORESTS", name: "Eastern Forests", continentId: "CONT-KHAROS", countryId: "COUNTRY-ESTARA", climate: "taiga_forest", coordinates: { latitude: 45.0, longitude: -104.0 } },
  { id: "REGION-CENTRAL-STEPPE", name: "Central Steppe", continentId: "CONT-KHAROS", countryId: "COUNTRY-KALEN", climate: "cold_steppe", coordinates: { latitude: 53.0, longitude: -128.0 } },
  { id: "REGION-KHAROS-SOUTHERN-BASIN", name: "Southern Basin", continentId: "CONT-KHAROS", countryId: "COUNTRY-VARON", climate: "temperate_basin", coordinates: { latitude: 36.0, longitude: -116.0 } },

  // Ilyra (6)
  { id: "REGION-WESTERN-PENINSULA", name: "Western Peninsula", continentId: "CONT-ILYRA", countryId: "COUNTRY-ILYRA", climate: "maritime_subtropical", coordinates: { latitude: -22.0, longitude: 152.0 } },
  { id: "REGION-INNER-SEA-REGION", name: "Inner Sea Region", continentId: "CONT-ILYRA", countryId: "COUNTRY-SELIN", climate: "sheltered_marine", coordinates: { latitude: -28.0, longitude: 164.0 } },
  { id: "REGION-ILYRA-CENTRAL-HIGHLANDS", name: "Central Highlands", continentId: "CONT-ILYRA", countryId: "COUNTRY-ASTER", climate: "upland_oceanic", coordinates: { latitude: -32.0, longitude: 158.0 } },
  { id: "REGION-ILYRA-EASTERN-COAST", name: "Eastern Coast", continentId: "CONT-ILYRA", countryId: "COUNTRY-EASTERN-REPUBLIC", climate: "humid_maritime", coordinates: { latitude: -26.0, longitude: 174.0 } },
  { id: "REGION-ISLAND-ARC", name: "Island Arc", continentId: "CONT-ILYRA", countryId: "COUNTRY-ISLAND-FEDERATION", climate: "oceanic_islands", coordinates: { latitude: -18.0, longitude: 178.0 } },
  { id: "REGION-SOUTHERN-PENINSULA", name: "Southern Peninsula", continentId: "CONT-ILYRA", countryId: "COUNTRY-LYREN", climate: "cool_temperate_coast", coordinates: { latitude: -42.0, longitude: 160.0 } },
];

export const CANON_COUNTRIES: readonly CountryCanon[] = [
  // Elandra (10)
  { id: "COUNTRY-ARDIN", name: "Republic of Ardin", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-ARDEN", governmentType: "Federal Republic", currencyCode: "AUR", coordinates: { latitude: 34.2, longitude: 6.5 } },
  { id: "COUNTRY-VALEDON", name: "Kingdom of Valedon", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-VALEDOR", governmentType: "Constitutional Monarchy", currencyCode: "AUR", coordinates: { latitude: 38.0, longitude: -9.0 } },
  { id: "COUNTRY-SELVARA", name: "Republic of Selvara", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-VARENPORT", governmentType: "Parliamentary Republic", currencyCode: "AUR", coordinates: { latitude: 30.5, longitude: 17.5 } },
  { id: "COUNTRY-TORREN", name: "Republic of Torren", continentId: "CONT-ELANDRA", governmentType: "Unitary Republic", currencyCode: "AUR", coordinates: { latitude: 41.5, longitude: 11.0 } },
  { id: "COUNTRY-HIGHLAND-FEDERATION", name: "Highland Federation", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-CROWNREACH", governmentType: "Confederation", currencyCode: "AUR", coordinates: { latitude: 45.2, longitude: 1.8 } },
  { id: "COUNTRY-DARSEN", name: "Republic of Darsen", continentId: "CONT-ELANDRA", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 37.0, longitude: 15.0 } },
  { id: "COUNTRY-MERETH", name: "Kingdom of Mereth", continentId: "CONT-ELANDRA", governmentType: "Monarchy", currencyCode: "AUR", coordinates: { latitude: 40.0, longitude: 3.0 } },
  { id: "COUNTRY-CALDOR", name: "Republic of Caldor", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-CALDOR", governmentType: "Representative Republic", currencyCode: "AUR", coordinates: { latitude: 32.2, longitude: 9.8 } },
  { id: "COUNTRY-NARETH", name: "Republic of Nareth", continentId: "CONT-ELANDRA", capitalSettlementId: "CITY-NARETH", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 36.4, longitude: 24.8 } },
  { id: "COUNTRY-ORDEL", name: "Free State of Ordel", continentId: "CONT-ELANDRA", governmentType: "Free State", currencyCode: "AUR", coordinates: { latitude: 33.0, longitude: 2.0 } },

  // Veyra (9)
  { id: "COUNTRY-VEYRA", name: "Republic of Veyra", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-VEYR", governmentType: "Federal Republic", currencyCode: "AUR", coordinates: { latitude: 48.1, longitude: 82.2 } },
  { id: "COUNTRY-NORVALE", name: "Federation of Norvale", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-NORVALE", governmentType: "Federal Union", currencyCode: "AUR", coordinates: { latitude: 58.2, longitude: 89.8 } },
  { id: "COUNTRY-WESTHAVEN", name: "Republic of Westhaven", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-WESTHAVEN", governmentType: "Maritime Republic", currencyCode: "AUR", coordinates: { latitude: 44.1, longitude: 55.8 } },
  { id: "COUNTRY-EDRIA", name: "Kingdom of Edria", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-EDRIA", governmentType: "Constitutional Monarchy", currencyCode: "AUR", coordinates: { latitude: 42.1, longitude: 75.8 } },
  { id: "COUNTRY-SORELL", name: "Republic of Sorell", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-SORELL", governmentType: "Democratic Republic", currencyCode: "AUR", coordinates: { latitude: 39.9, longitude: 87.8 } },
  { id: "COUNTRY-VARIN", name: "Highland Republic of Varin", continentId: "CONT-VEYRA", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 51.0, longitude: 70.0 } },
  { id: "COUNTRY-LETHEN", name: "Republic of Lethen", continentId: "CONT-VEYRA", capitalSettlementId: "CITY-LETHEN", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 46.1, longitude: 109.8 } },
  { id: "COUNTRY-CORAVEL", name: "Republic of Coravel", continentId: "CONT-VEYRA", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 43.0, longitude: 98.0 } },
  { id: "COUNTRY-ANSEL", name: "Republic of Ansel", continentId: "CONT-VEYRA", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 36.5, longitude: 79.0 } },

  // Sahraen (8)
  { id: "COUNTRY-SARAD", name: "Republic of Sarad", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-SARAD", governmentType: "River Republic", currencyCode: "AUR", coordinates: { latitude: -2.1, longitude: -40.2 } },
  { id: "COUNTRY-NAMAR", name: "Kingdom of Namar", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-NAMAR", governmentType: "Monarchy", currencyCode: "AUR", coordinates: { latitude: 18.2, longitude: -42.1 } },
  { id: "COUNTRY-KESH", name: "Republic of Kesh", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-KESHARA", governmentType: "Federal Republic", currencyCode: "AUR", coordinates: { latitude: 8.2, longitude: -49.8 } },
  { id: "COUNTRY-ARASHA", name: "Republic of Arasha", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-ARASH", governmentType: "Trade Republic", currencyCode: "AUR", coordinates: { latitude: 12.1, longitude: -34.9 } },
  { id: "COUNTRY-TEREN", name: "Highland Union of Teren", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-TEREN", governmentType: "Highland Union", currencyCode: "AUR", coordinates: { latitude: -10.2, longitude: -25.8 } },
  { id: "COUNTRY-BELARA", name: "Republic of Belara", continentId: "CONT-SAHRAEN", capitalSettlementId: "CITY-BELARA", governmentType: "Savannah Republic", currencyCode: "AUR", coordinates: { latitude: -18.1, longitude: -38.2 } },
  { id: "COUNTRY-OMERA", name: "Republic of Omera", continentId: "CONT-SAHRAEN", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: -6.5, longitude: -54.0 } },
  { id: "COUNTRY-JANDOR", name: "Republic of Jandor", continentId: "CONT-SAHRAEN", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 2.0, longitude: -30.0 } },

  // Orinth (8)
  { id: "COUNTRY-ORINTH", name: "Republic of Orinth", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-ORIN", governmentType: "Federal Republic", currencyCode: "AUR", coordinates: { latitude: -32.1, longitude: 78.1 } },
  { id: "COUNTRY-WESTMARK", name: "Republic of Westmark", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-WESTMARK", governmentType: "Agrarian Republic", currencyCode: "AUR", coordinates: { latitude: -28.2, longitude: 57.8 } },
  { id: "COUNTRY-AVELON", name: "Kingdom of Avelon", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-AVELON", governmentType: "Maritime Kingdom", currencyCode: "AUR", coordinates: { latitude: -46.1, longitude: 85.2 } },
  { id: "COUNTRY-TARSEN", name: "Republic of Tarsen", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-TARSEN", governmentType: "Mining Republic", currencyCode: "AUR", coordinates: { latitude: -36.1, longitude: 91.8 } },
  { id: "COUNTRY-BELMOND", name: "Republic of Belmond", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-BELMOND", governmentType: "Industrial Republic", currencyCode: "AUR", coordinates: { latitude: -20.1, longitude: 71.9 } },
  { id: "COUNTRY-SARETH", name: "Republic of Sareth", continentId: "CONT-ORINTH", capitalSettlementId: "CITY-SARETH", governmentType: "Transit Republic", currencyCode: "AUR", coordinates: { latitude: -26.1, longitude: 87.9 } },
  { id: "COUNTRY-SOUTHERN-REPUBLIC", name: "Southern Republic", continentId: "CONT-ORINTH", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: -44.0, longitude: 72.0 } },
  { id: "COUNTRY-COASTAL-FEDERATION", name: "Coastal Federation", continentId: "CONT-ORINTH", governmentType: "Federation", currencyCode: "AUR", coordinates: { latitude: -38.0, longitude: 105.0 } },

  // Kharos (7)
  { id: "COUNTRY-KHAR", name: "Republic of Khar", continentId: "CONT-KHAROS", capitalSettlementId: "CITY-KHAR", governmentType: "Inland Republic", currencyCode: "AUR", coordinates: { latitude: 50.1, longitude: -120.2 } },
  { id: "COUNTRY-NORTHERN-FEDERATION", name: "Northern Federation", continentId: "CONT-KHAROS", governmentType: "Federation", currencyCode: "AUR", coordinates: { latitude: 67.5, longitude: -124.0 } },
  { id: "COUNTRY-ESTARA", name: "Republic of Estara", continentId: "CONT-KHAROS", capitalSettlementId: "CITY-ESTARA", governmentType: "Forest Republic", currencyCode: "AUR", coordinates: { latitude: 45.1, longitude: -103.8 } },
  { id: "COUNTRY-VARON", name: "Kingdom of Varon", continentId: "CONT-KHAROS", capitalSettlementId: "CITY-VARON", governmentType: "Southern Kingdom", currencyCode: "AUR", coordinates: { latitude: 36.1, longitude: -115.8 } },
  { id: "COUNTRY-STEPPE-REPUBLIC", name: "Steppe Republic", continentId: "CONT-KHAROS", governmentType: "Republic", currencyCode: "AUR", coordinates: { latitude: 48.0, longitude: -140.0 } },
  { id: "COUNTRY-DOREN", name: "Republic of Doren", continentId: "CONT-KHAROS", capitalSettlementId: "CITY-DOREN", governmentType: "Mountain Republic", currencyCode: "AUR", coordinates: { latitude: 56.1, longitude: -135.8 } },
  { id: "COUNTRY-KALEN", name: "Free Republic of Kalen", continentId: "CONT-KHAROS", capitalSettlementId: "CITY-KALEN", governmentType: "Free Republic", currencyCode: "AUR", coordinates: { latitude: 53.1, longitude: -127.8 } },

  // Ilyra (6)
  { id: "COUNTRY-ILYRA", name: "Republic of Ilyra", continentId: "CONT-ILYRA", capitalSettlementId: "CITY-ILYRA-CITY", governmentType: "Maritime Republic", currencyCode: "AUR", coordinates: { latitude: -22.1, longitude: 152.1 } },
  { id: "COUNTRY-SELIN", name: "Maritime Republic of Selin", continentId: "CONT-ILYRA", capitalSettlementId: "CITY-SELIN", governmentType: "Commercial Republic", currencyCode: "AUR", coordinates: { latitude: -28.1, longitude: 164.2 } },
  { id: "COUNTRY-ASTER", name: "Republic of Aster", continentId: "CONT-ILYRA", capitalSettlementId: "CITY-ASTER", governmentType: "Highland Republic", currencyCode: "AUR", coordinates: { latitude: -32.1, longitude: 157.9 } },
  { id: "COUNTRY-EASTERN-REPUBLIC", name: "Eastern Republic", continentId: "CONT-ILYRA", capitalSettlementId: "CITY-EASTPORT", governmentType: "Port Republic", currencyCode: "AUR", coordinates: { latitude: -26.1, longitude: 174.1 } },
  { id: "COUNTRY-LYREN", name: "Kingdom of Lyren", continentId: "CONT-ILYRA", capitalSettlementId: "CITY-LYREN", governmentType: "Coastal Kingdom", currencyCode: "AUR", coordinates: { latitude: -42.1, longitude: 159.9 } },
  { id: "COUNTRY-ISLAND-FEDERATION", name: "Island Federation", continentId: "CONT-ILYRA", governmentType: "Archipelagic Federation", currencyCode: "AUR", coordinates: { latitude: -18.2, longitude: 177.8 } },
];

export const CANON_SETTLEMENTS: readonly SettlementCanon[] = [
  // Elandra (6)
  {
    id: "CITY-ARDEN",
    name: "Arden",
    countryId: "COUNTRY-ARDIN",
    regionId: "REGION-ARDAN-BASIN",
    continentId: "CONT-ELANDRA",
    role: "Capital / major economic center",
    isFinancialCenter: true,
    coordinates: { latitude: 34.2, longitude: 6.5 },
    historicalNames: ["Old Arden", "Porte-Ardan"],
  },
  {
    id: "CITY-VARENPORT",
    name: "Varenport",
    countryId: "COUNTRY-SELVARA",
    regionId: "REGION-GREEN-COAST",
    continentId: "CONT-ELANDRA",
    role: "Maritime trade center",
    coordinates: { latitude: 30.5, longitude: 17.5 },
  },
  {
    id: "CITY-VALEDOR",
    name: "Valedor",
    countryId: "COUNTRY-VALEDON",
    regionId: "REGION-WESTERN-MARCHES",
    continentId: "CONT-ELANDRA",
    role: "Historic capital",
    coordinates: { latitude: 38.0, longitude: -9.0 },
  },
  {
    id: "CITY-CROWNREACH",
    name: "Crownreach",
    countryId: "COUNTRY-HIGHLAND-FEDERATION",
    regionId: "REGION-CROWNLANDS",
    continentId: "CONT-ELANDRA",
    role: "Mountain administrative center",
    coordinates: { latitude: 45.2, longitude: 1.8 },
  },
  {
    id: "CITY-CALDOR",
    name: "Caldor",
    countryId: "COUNTRY-CALDOR",
    regionId: "REGION-ARDAN-BASIN",
    continentId: "CONT-ELANDRA",
    role: "Industrial & commercial center",
    coordinates: { latitude: 32.2, longitude: 9.8 },
  },
  {
    id: "CITY-NARETH",
    name: "Nareth",
    countryId: "COUNTRY-NARETH",
    regionId: "REGION-EASTERN-HIGHLANDS",
    continentId: "CONT-ELANDRA",
    role: "Eastern crossroads & transport hub",
    coordinates: { latitude: 36.4, longitude: 24.8 },
  },

  // Veyra (6)
  {
    id: "CITY-VEYR",
    name: "Veyr",
    countryId: "COUNTRY-VEYRA",
    regionId: "REGION-VEYRAN-HEARTLAND",
    continentId: "CONT-VEYRA",
    role: "Global-scale metropolitan tech & finance center",
    isFinancialCenter: true,
    coordinates: { latitude: 48.1, longitude: 82.2 },
    historicalNames: ["Veyr-on-River"],
  },
  {
    id: "CITY-WESTHAVEN",
    name: "Westhaven",
    countryId: "COUNTRY-WESTHAVEN",
    regionId: "REGION-WESTERN-COAST",
    continentId: "CONT-VEYRA",
    role: "Global container port & financial center",
    isFinancialCenter: true,
    coordinates: { latitude: 44.1, longitude: 55.8 },
  },
  {
    id: "CITY-EDRIA",
    name: "Edria",
    countryId: "COUNTRY-EDRIA",
    regionId: "REGION-CENTRAL-BASIN",
    continentId: "CONT-VEYRA",
    role: "Historic capital",
    coordinates: { latitude: 42.1, longitude: 75.8 },
  },
  {
    id: "CITY-NORVALE",
    name: "Norvale",
    countryId: "COUNTRY-NORVALE",
    regionId: "REGION-NORTHERN-FORESTS",
    continentId: "CONT-VEYRA",
    role: "Northern resource & logistics center",
    coordinates: { latitude: 58.2, longitude: 89.8 },
  },
  {
    id: "CITY-SORELL",
    name: "Sorell",
    countryId: "COUNTRY-SORELL",
    regionId: "REGION-SOUTHERN-UPLANDS",
    continentId: "CONT-VEYRA",
    role: "Agricultural-industrial center",
    coordinates: { latitude: 39.9, longitude: 87.8 },
  },
  {
    id: "CITY-LETHEN",
    name: "Lethen",
    countryId: "COUNTRY-LETHEN",
    regionId: "REGION-EASTERN-LITTORAL",
    continentId: "CONT-VEYRA",
    role: "Eastern maritime center",
    coordinates: { latitude: 46.1, longitude: 109.8 },
  },

  // Sahraen (6)
  {
    id: "CITY-SARAD",
    name: "Sarad",
    countryId: "COUNTRY-SARAD",
    regionId: "REGION-SAREN-BASIN",
    continentId: "CONT-SAHRAEN",
    role: "River metropolis & trade hub",
    coordinates: { latitude: -2.1, longitude: -40.2 },
  },
  {
    id: "CITY-NAMAR",
    name: "Namar",
    countryId: "COUNTRY-NAMAR",
    regionId: "REGION-SAHRAEN-NORTHERN-COAST",
    continentId: "CONT-SAHRAEN",
    role: "Coastal capital",
    coordinates: { latitude: 18.2, longitude: -42.1 },
  },
  {
    id: "CITY-KESHARA",
    name: "Keshara",
    countryId: "COUNTRY-KESH",
    regionId: "REGION-GREAT-INTERIOR",
    continentId: "CONT-SAHRAEN",
    role: "Desert crossroads",
    coordinates: { latitude: 8.2, longitude: -49.8 },
  },
  {
    id: "CITY-ARASH",
    name: "Arash",
    countryId: "COUNTRY-ARASHA",
    regionId: "REGION-GREAT-INTERIOR",
    continentId: "CONT-SAHRAEN",
    role: "Trade and logistics center",
    coordinates: { latitude: 12.1, longitude: -34.9 },
  },
  {
    id: "CITY-TEREN",
    name: "Teren",
    countryId: "COUNTRY-TEREN",
    regionId: "REGION-SAHRAEN-EASTERN-HIGHLANDS",
    continentId: "CONT-SAHRAEN",
    role: "Highland capital",
    coordinates: { latitude: -10.2, longitude: -25.8 },
  },
  {
    id: "CITY-BELARA",
    name: "Belara",
    countryId: "COUNTRY-BELARA",
    regionId: "REGION-SOUTHERN-SAVANNAH",
    continentId: "CONT-SAHRAEN",
    role: "Agricultural metropolitan center",
    coordinates: { latitude: -18.1, longitude: -38.2 },
  },

  // Orinth (6)
  {
    id: "CITY-ORIN",
    name: "Orin",
    countryId: "COUNTRY-ORINTH",
    regionId: "REGION-ORINTHIAN-BASIN",
    continentId: "CONT-ORINTH",
    role: "River metropolitan center",
    coordinates: { latitude: -32.1, longitude: 78.1 },
  },
  {
    id: "CITY-WESTMARK",
    name: "Westmark",
    countryId: "COUNTRY-WESTMARK",
    regionId: "REGION-WESTERN-GRASSLANDS",
    continentId: "CONT-ORINTH",
    role: "Agriculture and livestock center",
    coordinates: { latitude: -28.2, longitude: 57.8 },
  },
  {
    id: "CITY-AVELON",
    name: "Avelon",
    countryId: "COUNTRY-AVELON",
    regionId: "REGION-ORINTH-SOUTHERN-COAST",
    continentId: "CONT-ORINTH",
    role: "Southern maritime capital",
    coordinates: { latitude: -46.1, longitude: 85.2 },
  },
  {
    id: "CITY-TARSEN",
    name: "Tarsen",
    countryId: "COUNTRY-TARSEN",
    regionId: "REGION-ORINTH-CENTRAL-HIGHLANDS",
    continentId: "CONT-ORINTH",
    role: "Mining and industrial center",
    coordinates: { latitude: -36.1, longitude: 91.8 },
  },
  {
    id: "CITY-BELMOND",
    name: "Belmond",
    countryId: "COUNTRY-BELMOND",
    regionId: "REGION-NORTHERN-PLAINS",
    continentId: "CONT-ORINTH",
    role: "Northern agricultural-industrial hub",
    coordinates: { latitude: -20.1, longitude: 71.9 },
  },
  {
    id: "CITY-SARETH",
    name: "Sareth",
    countryId: "COUNTRY-SARETH",
    regionId: "REGION-ORINTH-SOUTHERN-WALL",
    continentId: "CONT-ORINTH",
    role: "Transportation gateway & border city",
    coordinates: { latitude: -26.1, longitude: 87.9 },
  },

  // Kharos (5)
  {
    id: "CITY-KHAR",
    name: "Khar",
    countryId: "COUNTRY-KHAR",
    regionId: "REGION-GREAT-PLATEAU",
    continentId: "CONT-KHAROS",
    role: "Inland plateau capital & administration",
    coordinates: { latitude: 50.1, longitude: -120.2 },
  },
  {
    id: "CITY-ESTARA",
    name: "Estara",
    countryId: "COUNTRY-ESTARA",
    regionId: "REGION-EASTERN-FORESTS",
    continentId: "CONT-KHAROS",
    role: "Resource, forestry & metallurgy hub",
    coordinates: { latitude: 45.1, longitude: -103.8 },
  },
  {
    id: "CITY-VARON",
    name: "Varon",
    countryId: "COUNTRY-VARON",
    regionId: "REGION-KHAROS-SOUTHERN-BASIN",
    continentId: "CONT-KHAROS",
    role: "Southern commercial center",
    coordinates: { latitude: 36.1, longitude: -115.8 },
  },
  {
    id: "CITY-DOREN",
    name: "Doren",
    countryId: "COUNTRY-DOREN",
    regionId: "REGION-KHARIC-RANGE",
    continentId: "CONT-KHAROS",
    role: "Mountain mining & industrial center",
    coordinates: { latitude: 56.1, longitude: -135.8 },
  },
  {
    id: "CITY-KALEN",
    name: "Kalen",
    countryId: "COUNTRY-KALEN",
    regionId: "REGION-CENTRAL-STEPPE",
    continentId: "CONT-KHAROS",
    role: "Strategic transit & steppe nexus",
    coordinates: { latitude: 53.1, longitude: -127.8 },
  },

  // Ilyra (5)
  {
    id: "CITY-ILYRA-CITY",
    name: "Ilyra City",
    countryId: "COUNTRY-ILYRA",
    regionId: "REGION-WESTERN-PENINSULA",
    continentId: "CONT-ILYRA",
    role: "Capital & premier maritime port",
    isFinancialCenter: true,
    coordinates: { latitude: -22.1, longitude: 152.1 },
  },
  {
    id: "CITY-SELIN",
    name: "Selin",
    countryId: "COUNTRY-SELIN",
    regionId: "REGION-INNER-SEA-REGION",
    continentId: "CONT-ILYRA",
    role: "Maritime commercial & financial center",
    isFinancialCenter: true,
    coordinates: { latitude: -28.1, longitude: 164.2 },
  },
  {
    id: "CITY-ASTER",
    name: "Aster",
    countryId: "COUNTRY-ASTER",
    regionId: "REGION-ILYRA-CENTRAL-HIGHLANDS",
    continentId: "CONT-ILYRA",
    role: "Highland administrative center",
    coordinates: { latitude: -32.1, longitude: 157.9 },
  },
  {
    id: "CITY-EASTPORT",
    name: "Eastport",
    countryId: "COUNTRY-EASTERN-REPUBLIC",
    regionId: "REGION-ILYRA-EASTERN-COAST",
    continentId: "CONT-ILYRA",
    role: "Major international container terminal",
    coordinates: { latitude: -26.1, longitude: 174.1 },
  },
  {
    id: "CITY-LYREN",
    name: "Lyren",
    countryId: "COUNTRY-LYREN",
    regionId: "REGION-SOUTHERN-PENINSULA",
    continentId: "CONT-ILYRA",
    role: "Historic coastal capital & cultural center",
    coordinates: { latitude: -42.1, longitude: 159.9 },
  },
];

export const CANON_MOUNTAINS: readonly MountainCanon[] = [
  { id: "MTN-CROWN", name: "Crown Mountains", continentId: "CONT-ELANDRA", coordinates: { latitude: 45.0, longitude: 2.0 } },
  { id: "MTN-VEYRAN", name: "Veyran Spine", continentId: "CONT-VEYRA", coordinates: { latitude: 50.0, longitude: 72.0 } },
  { id: "MTN-KHARIC", name: "Kharic Range", continentId: "CONT-KHAROS", coordinates: { latitude: 55.0, longitude: -135.0 } },
  { id: "MTN-SOUTHERN", name: "Southern Wall", continentId: "CONT-ORINTH", coordinates: { latitude: -42.0, longitude: 80.0 } },
];

export const CANON_RIVERS: readonly RiverCanon[] = [
  { id: "RIVER-ARDAN", name: "Ardan River", continentId: "CONT-ELANDRA", coordinates: { latitude: 33.5, longitude: 8.0 } },
  { id: "RIVER-VEYR", name: "Veyr River", continentId: "CONT-VEYRA", coordinates: { latitude: 46.0, longitude: 78.0 } },
  { id: "RIVER-SAREN", name: "Saren River", continentId: "CONT-SAHRAEN", coordinates: { latitude: -2.0, longitude: -41.0 } },
  { id: "RIVER-ORIN", name: "Orin River", continentId: "CONT-ORINTH", coordinates: { latitude: -30.0, longitude: 75.0 } },
  { id: "RIVER-KHAR", name: "Khar River", continentId: "CONT-KHAROS", coordinates: { latitude: 48.0, longitude: -118.0 } },
];

export const CANON_CORRIDORS: readonly CorridorCanon[] = [
  { id: "CORRIDOR-ARDAN", name: "Ardan Corridor", continentId: "CONT-ELANDRA", settlementIds: ["CITY-ARDEN", "CITY-CALDOR", "CITY-VARENPORT", "CITY-VALEDOR", "CITY-CROWNREACH"] },
  { id: "CORRIDOR-VEYRAN", name: "Veyran Corridor", continentId: "CONT-VEYRA", settlementIds: ["CITY-VEYR", "CITY-WESTHAVEN", "CITY-EDRIA", "CITY-NORVALE", "CITY-SORELL", "CITY-LETHEN"] },
  { id: "CORRIDOR-SAREN", name: "Saren Corridor", continentId: "CONT-SAHRAEN", settlementIds: ["CITY-SARAD", "CITY-NAMAR", "CITY-KESHARA", "CITY-ARASH", "CITY-TEREN", "CITY-BELARA"] },
  { id: "CORRIDOR-ORIN", name: "Orin Corridor", continentId: "CONT-ORINTH", settlementIds: ["CITY-ORIN", "CITY-WESTMARK", "CITY-AVELON", "CITY-TARSEN", "CITY-BELMOND", "CITY-SARETH"] },
  { id: "CORRIDOR-KHARIC", name: "Kharic Corridor", continentId: "CONT-KHAROS", settlementIds: ["CITY-KHAR", "CITY-ESTARA", "CITY-VARON", "CITY-DOREN", "CITY-KALEN"] },
  { id: "CORRIDOR-ILYRAN", name: "Ilyran Maritime Corridor", continentId: "CONT-ILYRA", settlementIds: ["CITY-ILYRA-CITY", "CITY-SELIN", "CITY-ASTER", "CITY-EASTPORT", "CITY-LYREN"] },
];

export const CANON_ERAS: readonly EraCanon[] = [
  { number: 1, name: "Deep Settlement", description: "Early human dispersal through major migration corridors." },
  { number: 2, name: "First Civilizations", description: "River basin agriculture and early city alliances along the Ardan, Saren, Veyr and Orin." },
  { number: 3, name: "Age of Kingdoms", description: "Diverse kingdoms, overland trade expansion across deserts, steppes, and inland seas." },
  { number: 4, name: "Age of Networks", description: "Maritime exploration, navigational advances, and cross-continental cultural exchange." },
  { number: 5, name: "Age of States", description: "Bureaucratic state systems, legal codification, civil registries, and centralized administration." },
  { number: 6, name: "Industrial Transformation", description: "Steam power, rail networks, telegraphy, rapid urbanization, and industrial manufacturing." },
  { number: 7, name: "Modern Transformation", description: "Decolonization, international bodies, electronics, telecommunications, and early computing." },
  { number: 8, name: "Contemporary Age", description: "The active game era: high connectivity, AI, energy transition, cloud systems, and global supply chains." },
];

export const CANON_LANGUAGE_FAMILIES: readonly LanguageFamilyCanon[] = [
  { id: "LANG-ARDANIC", name: "Ardanic Family", script: "Ardan Script", languages: ["Ardan", "Valed", "Selvar", "Torren", "Caldic", "Narethic"] },
  { id: "LANG-VEYRIC", name: "Veyric Family", script: "Veyric Script", languages: ["Veyric", "Norvan", "Edrian", "Sorellan", "Lethenic", "Coravelan"] },
  { id: "LANG-SAHRIC", name: "Sahric Family", script: "Sahric Script", languages: ["Sahric", "Namari", "Keshic", "Arashi", "Tereni", "Belaran", "Omeran", "Jandori"] },
  { id: "LANG-ORINTHIAN", name: "Orinthian Family", script: "Orinthian Script", languages: ["Orinthian", "Westmarker", "Avelic", "Tarsenic", "Belmondian", "Sarethic", "Southern Coastal", "Mariner's Creole"] },
  { id: "LANG-KHARIC", name: "Kharic Family", script: "Kharic Scripts", languages: ["Kharic", "Estaran", "Varonic", "Dorenic", "Kalenic", "Northern Kharic", "Steppe Kharic"] },
  { id: "LANG-ILYRAN", name: "Ilyran Family", script: "Ilyran Maritime Script", languages: ["Ilyran", "Selini", "Asteran", "Eastern Ilyran", "Lyrenic", "Island Languages"] },
];

export const CANON_RELIGIONS: readonly ReligionCanon[] = [
  { id: "REL-COVENANT-FAITH", name: "The Covenant Faith", description: "Historical roots in western and central Elandra.", coreThemes: ["covenant", "moral law", "responsibility", "community", "justice", "scholarship"] },
  { id: "REL-LIVING-WORD", name: "The Way of the Living Word", description: "Strong presence in the Veyran sphere with monastic, medical, and educational heritage.", coreThemes: ["sacred teaching", "compassion", "personal transformation", "service"] },
  { id: "REL-RADIANT-PATH", name: "The Radiant Path", description: "Centuries of influence along Sahraen trade and caravan routes.", coreThemes: ["balance", "discipline", "enlightenment", "cycles of existence"] },
  { id: "REL-MANY-HEARTH", name: "The Many-Hearth Traditions", description: "Local and regional community traditions in Sahraen and Orinth.", coreThemes: ["ancestors", "hearth", "sacred places", "oral tradition", "seasons"] },
  { id: "REL-RIVER-TEACHINGS", name: "The River Teachings", description: "Philosophical and ethical traditions originating in the great river basins.", coreThemes: ["harmony", "wisdom", "proper conduct", "natural balance"] },
  { id: "REL-SKY-EARTH", name: "The Sky and Earth Tradition", description: "Deep historical lineage among northern and highland cultures.", coreThemes: ["stewardship", "sky", "land", "seasons", "respect for nature"] },
  { id: "REL-OPEN-HAND", name: "The Open Hand Philosophy", description: "Transregional ethical philosophy emphasizing human dignity and mutual aid.", coreThemes: ["human dignity", "compassion", "mutual aid", "reason", "social equality"] },
];

export const CANON_ACTIVE_DEVELOPMENTS: readonly ActiveDevelopmentCanon[] = [
  { id: "DEV-ENERGY-TRANSITION", name: "Global Energy Transition", category: "energy", summary: "Renewable expansion, grid investment, and nuclear development interacting with legacy systems." },
  { id: "DEV-ARDAN-CORRIDOR", name: "Ardan Energy & Infrastructure Corridor", category: "infrastructure", summary: "Major electricity, rail, and industrial growth along the Ardan river basin." },
  { id: "DEV-VEYRAN-TECH", name: "Veyran Technology Boom", category: "technology", summary: "Rapid expansion of computing, AI, robotics, and advanced manufacturing in Veyr." },
  { id: "DEV-AI-REGULATION", name: "AI Regulatory Debate", category: "governance", summary: "Cross-border legislative debate on privacy, liability, autonomous systems, and labor." },
  { id: "DEV-SAHRAEN-WATER", name: "Sahraen Water Pressure", category: "environment", summary: "Groundwater depletion and growing demand for regional water distribution infrastructure." },
  { id: "DEV-SAREN-RECOVERY", name: "Saren Basin Flood Recovery", category: "environment", summary: "Reconstruction and agricultural recovery following late-2041 floods." },
  { id: "DEV-KHARIC-MINING", name: "Kharic Mining Expansion", category: "industry", summary: "Surging mineral demand driving mountain infrastructure projects in Kharos." },
  { id: "DEV-WESTHAVEN-PORT", name: "Westhaven Port Expansion", category: "logistics", summary: "Automated logistics, deep-water terminals, and rail yard modernisation." },
  { id: "DEV-ILYRAN-COMPETITION", name: "Ilyran Maritime Competition", category: "trade", summary: "Tariff and efficiency competition between Selin, Ilyra City, Westhaven, and Eastport." },
  { id: "DEV-SUPPLY-PRESSURE", name: "Global Supply-Chain Pressure", category: "economy", summary: "Semiconductor and critical minerals friction propagating through industrial sectors." },
  { id: "DEV-MIGRATION-WAVE", name: "Migration & Urbanization Wave", category: "demographics", summary: "Rural-to-urban and cross-border migration toward industrial and educational hubs." },
  { id: "DEV-CORP-RESTRUCTURING", name: "Corporate Restructuring", category: "business", summary: "Automation and workflow redesign altering white-collar and logistics employment." },
  { id: "DEV-CORP-FIN-STRESS", name: "Corporate Financial Stress", category: "finance", summary: "Major industrial conglomerates negotiating debt and supply challenges." },
  { id: "DEV-HEALTH-SURVEILLANCE", name: "Global Health Monitoring", category: "health", summary: "Routine genomic and seasonal pathogen surveillance without active pandemics." },
  { id: "DEV-DIPLOMATIC-NEGOTIATION", name: "Diplomatic Negotiation", category: "diplomacy", summary: "Multilateral maritime safety and environmental treaties under active review." },
  { id: "DEV-INTL-DISPUTES", name: "International Maritime & Resource Claims", category: "security", summary: "Peaceful but tense territorial and fishing zone negotiations." },
  { id: "DEV-POLITICAL-TRANSITIONS", name: "Political Transitions", category: "politics", summary: "Impending elections, coalition formation, and constitutional reforms." },
];
