/**
 * ReelLife configuration model (System 58).
 *
 * Separation the engine must keep:
 *   Engine        = how simulation works
 *   Content       = what exists
 *   Rules         = how the world behaves
 *   Configuration = scenario setup
 *
 * Configuration never stores runtime world state, and versioning is explicit so
 * a `.reel` save can refuse to load against incompatible content instead of
 * silently changing meaning.
 */

import type { CalendarConfig } from "../time/calendar.ts";
import type { CurrencyDefinition } from "../primitives/money.ts";
import type { SimulationSpeed } from "../time/clock.ts";

export const GAME_MODES = [
  "standard",
  "historical",
  "alternate",
  "sandbox",
  "scenario",
  "challenge",
  "custom",
] as const;
export type GameMode = (typeof GAME_MODES)[number];

export const DIFFICULTY_IDS = ["relaxed", "standard", "harsh", "brutal"] as const;
export type DifficultyId = (typeof DIFFICULTY_IDS)[number];

/**
 * Difficulty may alter uncertainty, resources, consequences, constraints and
 * information access. It must never break fundamental causal logic.
 */
export interface DifficultyProfile {
  readonly id: DifficultyId;
  readonly label: string;
  readonly description: string;
  /** Multiplies hazard/probability inputs, not eligibility. */
  readonly uncertaintyMultiplier: number;
  /** Scales starting resources and income availability. */
  readonly resourceMultiplier: number;
  /** Scales the severity of adverse consequences. */
  readonly consequenceMultiplier: number;
  /** 0 = only what the character can perceive; 1 = generous summaries. */
  readonly informationAccess: number;
}

export interface GameConfig {
  readonly id: string;
  readonly mode: GameMode;
  readonly difficulty: DifficultyId;
  readonly calendarId: string;
  /** ISO-like label of the canonical start date, e.g. "2042-01-01". */
  readonly startDateLabel: string;
  readonly quantumMinutes: number;
  readonly defaultSpeed: SimulationSpeed;
  /** Cap on offline catch-up quanta (System 02). */
  readonly maxCatchupQuanta: number;
  /** When true, the simulation reports invariant failures as trace diagnostics. */
  readonly strictInvariants: boolean;
  /** When true, unhandled consequence types are reported as trace warnings. */
  readonly strictConsequences: boolean;
}

export interface ContentModuleRef {
  readonly id: string;
  readonly version: string;
  /** True when the content is a justified placeholder pending owner review. */
  readonly provisional: boolean;
  readonly notes?: string;
}

export interface ConfigState {
  readonly game: GameConfig;
  readonly contentVersion: string;
  readonly contentModules: readonly ContentModuleRef[];
  /** The calendar definition actually used by this world. */
  readonly calendar: CalendarConfig;
  /** Currency definitions in use; authoritative money references these by ID. */
  readonly currencies: readonly CurrencyDefinition[];
}

export interface ContentManifest {
  readonly contentVersion: string;
  readonly simulationVersion: number;
  readonly schemaVersion: number;
  readonly modules: readonly ContentModuleRef[];
}

/**
 * A brand-new world must record which content produced it. Loading a save whose
 * content version differs is a migration decision, never a silent continue.
 */
export function describeContent(config: ConfigState): string {
  const provisional = config.contentModules.filter((module) => module.provisional);
  return [
    `content ${config.contentVersion}`,
    `${config.contentModules.length} modules`,
    provisional.length > 0 ? `${provisional.length} provisional` : "no provisional modules",
  ].join(", ");
}
