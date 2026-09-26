/**
 * ReelLife stable identity primitives.
 *
 * Architectural law (System 01 / System 08): every persistent entity gets a
 * stable ID, and IDs survive name changes, migration, death, save/load and
 * control transfer. Names are attributes; they are never identity.
 *
 * Two ID families exist and must not be confused:
 *
 *  1. Authored content IDs (World Bible): semantic slugs such as
 *     "WORLD-AURELIA", "CONT-ELANDRA", "COUNTRY-ARDIN", "REGION-ARDAN-BASIN",
 *     "CITY-ARDEN", "RIVER-ARDAN", "EVENT-...". These are declared by content
 *     files and are immutable once published.
 *
 *  2. Allocated runtime IDs: deterministic counter-based IDs such as
 *     "PER-000001". They are produced by the IdAllocator, whose counters are
 *     part of persisted world state, so the same command sequence always
 *     produces the same IDs. No UUIDs and no random IDs are ever used.
 *
 * No `enum` is used anywhere in this codebase: the build targets Node's native
 * TypeScript type-stripping (erasableSyntaxOnly), which cannot emit runtime
 * enum objects. Union types plus const maps are used instead.
 */

declare const brand: unique symbol;

/** A nominal type wrapper so different ID kinds cannot be mixed up silently. */
export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** Persistent entity kinds known to the engine registry (System 01). */
export const ENTITY_KINDS = [
  "world",
  "continent",
  "country",
  "region",
  "settlement",
  "location",
  "person",
  "household",
  "relationship",
  "organization",
  "institution",
  "job",
  "property",
  "vehicle",
  "item",
  "account",
  "contract",
  "asset",
  "activity",
  "event",
  "claim",
  "record",
  "technology",
  "market",
  "resource",
  "command",
  "causalChain",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Prefix used when the allocator mints a new runtime ID for a kind.
 * Content IDs deliberately use longer authored slugs instead.
 */
export const ID_PREFIX: Record<EntityKind, string> = {
  world: "WLD",
  continent: "CNT",
  country: "CTY",
  region: "RGN",
  settlement: "SET",
  location: "LOC",
  person: "PER",
  household: "HH",
  relationship: "REL",
  organization: "ORG",
  institution: "INS",
  job: "JOB",
  property: "PRP",
  vehicle: "VEH",
  item: "ITM",
  account: "ACC",
  contract: "CTR",
  asset: "AST",
  activity: "ACT",
  event: "EVT",
  claim: "CLM",
  record: "REC",
  technology: "TEC",
  market: "MKT",
  resource: "RSR",
  command: "CMD",
  causalChain: "CHN",
};

const PREFIX_TO_KIND: Record<string, EntityKind> = (() => {
  const map: Record<string, EntityKind> = {};
  for (const kind of ENTITY_KINDS) map[ID_PREFIX[kind]] = kind;
  return map;
})();

/** A stable entity identifier, branded by the kind it refers to. */
export type EntityId<K extends EntityKind = EntityKind> = Branded<string, `entity:${K}`>;

/** An identifier of an authored content definition. */
export type ContentId = Branded<string, "content">;

export function asEntityId<K extends EntityKind>(value: string): EntityId<K> {
  return value as EntityId<K>;
}

export function asContentId(value: string): ContentId {
  return value as ContentId;
}

/** Reads the kind encoded in an allocated runtime ID, or null if unallocated. */
export function kindOfEntityId(id: string): EntityKind | null {
  const dash = id.indexOf("-");
  if (dash <= 0) return null;
  return PREFIX_TO_KIND[id.slice(0, dash)] ?? null;
}

export function isEntityIdForKind(id: string, kind: EntityKind): boolean {
  return id.startsWith(`${ID_PREFIX[kind]}-`);
}

const ID_PATTERN = /^[A-Z0-9]+(-[A-Z0-9]+)*$/;

export function isValidIdShape(id: string): boolean {
  return id.length > 0 && id.length <= 96 && ID_PATTERN.test(id);
}

/**
 * Deterministic ID allocator.
 *
 * Counters live in persisted world state, which is what makes IDs reproducible
 * from a seed + command sequence (System 03 / System 06).
 */
export interface IdAllocatorState {
  counters: Record<string, number>;
}

export class IdAllocator {
  private readonly counters: Map<EntityKind, number>;

  constructor(state?: IdAllocatorState) {
    this.counters = new Map<EntityKind, number>();
    if (state) {
      for (const [kind, value] of Object.entries(state.counters)) {
        this.counters.set(kind as EntityKind, value);
      }
    }
  }

  next<K extends EntityKind>(kind: K): EntityId<K> {
    const previous = this.counters.get(kind) ?? 0;
    const next = previous + 1;
    this.counters.set(kind, next);
    return asEntityId<K>(`${ID_PREFIX[kind]}-${String(next).padStart(6, "0")}`);
  }

  peek(kind: EntityKind): number {
    return this.counters.get(kind) ?? 0;
  }

  serialize(): IdAllocatorState {
    const counters: Record<string, number> = {};
    for (const kind of ENTITY_KINDS) {
      const value = this.counters.get(kind);
      if (value !== undefined && value !== 0) counters[kind] = value;
    }
    return { counters };
  }

  static deserialize(state: IdAllocatorState): IdAllocator {
    return new IdAllocator(state);
  }
}
