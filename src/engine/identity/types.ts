import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";

export interface PersonName {
  readonly first: string;
  readonly last: string;
  readonly middle?: string;
  readonly nickname?: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export type ParentageType =
  | "biological"
  | "legal"
  | "adoptive"
  | "guardian"
  | "unknown";

export interface ParentageLink {
  readonly parentId: EntityId<"person">;
  readonly type: ParentageType;
  readonly knownToChild: boolean;
}

export interface OriginContext {
  readonly nationalityId?: string;
  readonly cultureId?: string;
  readonly birthplaceId?: string;
}

export interface BirthMetadata {
  readonly dateOfBirth: WorldTime;
  readonly recordedTime?: WorldTime;
}

export interface IdentityHistoryEntry {
  readonly timestamp: WorldTime;
  readonly type: "nameChange" | "legalChange";
  readonly previous: unknown;
  readonly current: unknown;
  readonly reason?: string;
}

export interface PersonIdentity {
  readonly id: EntityId<"person">;
  readonly name: PersonName;
  readonly birth: BirthMetadata;
  readonly parentage: readonly ParentageLink[];
  readonly origin: OriginContext;
  readonly generation: number;
  readonly appearanceFoundationSeed: string;
  readonly history: readonly IdentityHistoryEntry[];
  readonly death?: {
    readonly date: WorldTime;
    readonly cause?: string;
  };
}

export interface IdentityState {
  readonly persons: readonly PersonIdentity[];
}

