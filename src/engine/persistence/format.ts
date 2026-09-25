/**
 * ReelLife `.reel` save format (System 06).
 *
 * `.reel` is the native persistent world/save format. A save contains the
 * serializable authoritative world representation: entity IDs, system state, the
 * clock, RNG state, pending events, activities, required history, configuration,
 * versions and integrity data.
 *
 * What a `.reel` file deliberately never contains:
 *   - runtime-only objects (functions, engine instances, DOM, timers),
 *   - UI state of any kind,
 *   - derived caches that can be rebuilt from authoritative state.
 *
 * Versioning is explicit rather than implicit. `schemaVersion` covers the
 * serialization contract, `simulationVersion` covers save-visible simulation
 * semantics, `contentVersion` covers the definitions a world was created with,
 * and `rngVersion` covers the RNG algorithm and stream serialization.
 */

import type { ConfigState } from "../config/types.ts";

export const REEL_FORMAT = "reel" as const;

/** Serialization contract version. Incompatible changes bump this. */
export const FORMAT_VERSION = 1;

export interface ReelHeader {
  readonly format: typeof REEL_FORMAT;
  readonly formatVersion: number;
  readonly schemaVersion: number;
  readonly simulationVersion: number;
  readonly contentVersion: string;
  readonly rngVersion: number;
  /** Integrity data over the canonicalized body. */
  readonly checksum: string;
  readonly saveId: string;
  readonly slotName: string;
  /** Host-supplied label; metadata only, never authoritative time. */
  readonly savedAtLabel: string;
  readonly worldId: string;
  readonly worldName: string;
  /** Calendar label of the world date at save time, for slot display. */
  readonly worldDateLabel: string;
  readonly stepIndex: number;
  /** Canonical world time as a plain number, for quick inspection. */
  readonly rootTimeMinutes: number;
  readonly generation: number;
  readonly commandCount: number;
  readonly pendingEventCount: number;
}

/**
 * The body is the serialized world: an opaque, canonical, JSON-safe structure
 * whose shape is owned by the simulation core and the individual systems.
 */
export interface ReelBody {
  readonly world: unknown;
}

export interface ReelFile {
  readonly header: ReelHeader;
  readonly body: ReelBody;
}

export interface ReelSlotInfo {
  readonly slotName: string;
  readonly saveId: string;
  readonly savedAtLabel: string;
  readonly worldName: string;
  readonly worldDateLabel: string;
  readonly generation: number;
  readonly formatVersion: number;
  readonly contentVersion: string;
  readonly sizeBytes: number;
}

export function describeSaveFile(file: ReelFile): string {
  return `${file.header.worldName} — ${file.header.worldDateLabel} (${file.header.slotName})`;
}

/** Content/config facts every load must compare against the running engine. */
export interface SaveCompatibility {
  readonly schemaVersion: number;
  readonly simulationVersion: number;
  readonly contentVersion: string;
  readonly rngVersion: number;
}

export function compatibilityOf(config: ConfigState, versions: {
  readonly schemaVersion: number;
  readonly simulationVersion: number;
  readonly rngVersion: number;
}): SaveCompatibility {
  return {
    schemaVersion: versions.schemaVersion,
    simulationVersion: versions.simulationVersion,
    contentVersion: config.contentVersion,
    rngVersion: versions.rngVersion,
  };
}
