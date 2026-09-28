/**
 * ReelLife content registry and defaults (System 58).
 *
 * Content definitions live here rather than inside domain systems, so adding an
 * occupation, item or technology never requires editing engine code.
 *
 * Two content items are shipped in the kernel because the architecture cannot
 * function without them, and both are explicitly marked provisional:
 *
 *  1. The calendar definition (the World Bible names the start date but not the
 *     months).
 *  2. One currency definition (the World Bible defers exact country currencies
 *     to later content), needed because Money is a currency plus integer minor
 *     units and cannot be currency-less.
 *
 * Recorded in docs/CONTENT_GAPS.md for owner review.
 */

import type { CalendarConfig } from "../time/calendar.ts";
import type { CurrencyDefinition } from "../primitives/money.ts";
import { currencyId } from "../primitives/money.ts";
import { DEFAULT_CALENDAR_CONFIG } from "../time/calendar.ts";
import type { ContentModuleRef, ConfigState, DifficultyProfile, GameConfig } from "./types.ts";
import { DIFFICULTY_IDS, type DifficultyId } from "./types.ts";

/** Bumped whenever authoritative serialization changes incompatibly. */
export const SCHEMA_VERSION = 1;
/**
 * Bumped whenever simulation semantics change in a save-visible way.
 *
 * 2 (M8) — M7 extended `systems.continuity` from `{ statuses, deaths }` to also
 * carry determinations, records, controlTransfers, testaments and estates. That
 * is save-visible, so the version moved; the shape itself is unchanged for
 * existing fields, which is why the v1 -> v2 migration backfills rather than
 * rewrites. See `V1_TO_V2_CONTINUITY_LIFECYCLE`.
 */
export const SIMULATION_VERSION = 2;
/** Bumped whenever engine-owned content definitions change. */
export const CONTENT_VERSION = "0.1.0-kernel";

/** Canonical game start per World Build 13/14: 1 January 2042. */
export const CANONICAL_START_DATE_LABEL = "2042-01-01";

export const PROVISIONAL_CURRENCY: CurrencyDefinition = {
  id: currencyId("ACR"),
  code: "ACR",
  name: "Aurelian Credit",
  symbol: "₳",
  minorUnitsPerMajor: 100,
  decimalPlaces: 2,
  provisional: true,
};

export const DIFFICULTY_PROFILES: Readonly<Record<DifficultyId, DifficultyProfile>> = {
  relaxed: {
    id: "relaxed",
    label: "Relaxed",
    description: "Fewer adverse events and more forgiving consequences; causality unchanged.",
    uncertaintyMultiplier: 0.7,
    resourceMultiplier: 1.3,
    consequenceMultiplier: 0.7,
    informationAccess: 0.9,
  },
  standard: {
    id: "standard",
    label: "Standard",
    description: "The balanced baseline used by the World Bible's game-start conditions.",
    uncertaintyMultiplier: 1,
    resourceMultiplier: 1,
    consequenceMultiplier: 1,
    informationAccess: 0.6,
  },
  harsh: {
    id: "harsh",
    label: "Harsh",
    description: "Higher uncertainty and heavier consequences; eligibility rules untouched.",
    uncertaintyMultiplier: 1.3,
    resourceMultiplier: 0.8,
    consequenceMultiplier: 1.35,
    informationAccess: 0.45,
  },
  brutal: {
    id: "brutal",
    label: "Brutal",
    description: "Maximum uncertainty and severity. Still no arbitrary hidden modifiers.",
    uncertaintyMultiplier: 1.6,
    resourceMultiplier: 0.6,
    consequenceMultiplier: 1.8,
    informationAccess: 0.35,
  },
};

export const DEFAULT_GAME_CONFIG: GameConfig = {
  id: "CFG-DEFAULT",
  mode: "standard",
  difficulty: "standard",
  calendarId: DEFAULT_CALENDAR_CONFIG.id,
  startDateLabel: CANONICAL_START_DATE_LABEL,
  quantumMinutes: 1,
  defaultSpeed: 1,
  maxCatchupQuanta: 5_000_000,
  strictInvariants: true,
  strictConsequences: true,
};

export const KERNEL_CONTENT_MODULES: readonly ContentModuleRef[] = [
  {
    id: "core:calendar",
    version: "1",
    provisional: DEFAULT_CALENDAR_CONFIG.provisional,
    notes:
      "Month names and season boundaries are placeholders; the World Bible fixes 1 Jan 2042 but not the calendar's names.",
  },
  {
    id: "core:currency",
    version: "1",
    provisional: true,
    notes:
      "Single provisional currency (ACR). World Build 08 defers country currencies to a later content pass.",
  },
];

export function difficultyProfile(id: DifficultyId): DifficultyProfile {
  return DIFFICULTY_PROFILES[id];
}

export function isDifficultyId(value: string): value is DifficultyId {
  return (DIFFICULTY_IDS as readonly string[]).includes(value);
}

export function createDefaultConfigState(overrides?: Partial<GameConfig>): ConfigState {
  return {
    game: { ...DEFAULT_GAME_CONFIG, ...overrides },
    contentVersion: CONTENT_VERSION,
    contentModules: KERNEL_CONTENT_MODULES,
    calendar: DEFAULT_CALENDAR_CONFIG,
    currencies: [PROVISIONAL_CURRENCY],
  };
}

/**
 * Content registry: holds data-driven definitions. Kernel ships only the
 * architectural essentials; domain content is added in later milestones
 * (occupations, items, vehicles, buildings, foods, laws, holidays, diseases...).
 */
export class ContentRegistry {
  private readonly currencies = new Map<string, CurrencyDefinition>();
  private readonly calendar: CalendarConfig;

  constructor(calendar: CalendarConfig, currencies: readonly CurrencyDefinition[]) {
    this.calendar = calendar;
    for (const currency of currencies) this.currencies.set(currency.id, currency);
  }

  get calendarConfig(): CalendarConfig {
    return this.calendar;
  }

  currency(id: string): CurrencyDefinition | undefined {
    return this.currencies.get(id);
  }

  requireCurrency(id: string): CurrencyDefinition {
    const definition = this.currencies.get(id);
    if (!definition) throw new Error(`Unknown currency: ${id}`);
    return definition;
  }

  allCurrencies(): readonly CurrencyDefinition[] {
    return [...this.currencies.values()];
  }

  /** Currencies still flagged provisional, reported by content-gap tooling. */
  provisionalCurrencies(): readonly CurrencyDefinition[] {
    return this.allCurrencies().filter((currency) => currency.provisional === true);
  }
}
