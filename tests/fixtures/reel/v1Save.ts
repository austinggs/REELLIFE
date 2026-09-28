/**
 * A real v1 `.reel` save, used as a migration fixture (M8, System 06).
 *
 * This file is hand-authored rather than generated, and that is the point: a
 * fixture produced by the current engine could only ever agree with the current
 * engine, so it could not detect a migration that silently changed the wrong
 * thing. This one is written from the v1 contract as it actually was:
 *
 *   - `simulationVersion: 1`
 *   - `systems.continuity` is exactly `{ statuses, deaths }` — the five
 *     collections M7 added do not exist here, and their absence is the point
 *   - one person who is `deceased` via `markHistorical`, with a death entry that
 *     has *no* determination id, because v1 determinations did not exist
 *
 * The checksum is computed at import time by `v1Fixture()`, so the fixture
 * cannot drift out of sync with its own integrity data.
 */

import { checksum32Hex, canonicalJson } from "../../../src/engine/rng/hash.ts";
import {
  FORMAT_VERSION,
  REEL_FORMAT,
  type ReelBody,
  type ReelFile,
} from "../../../src/engine/persistence/format.ts";

/** The v1 world body, exactly as v1 wrote it. */
export const V1_FIXTURE_BODY: ReelBody = {
  world: {
    meta: {
      worldId: "WLD-AURELIA",
      name: "Aurelia",
      masterSeed: "reellife-v1-fixture",
      createdAtLabel: "1 January 2042",
      generation: 1,
    },
    clock: { time: 5_259_600 },
    // v1's continuity: two collections, and only two.
    systems: {
      identity: {
        persons: [
          {
            id: "PER-000001",
            name: { first: "Ada", last: "Byron" },
            birth: { dateOfBirth: 0 },
          },
          {
            id: "PER-000002",
            name: { first: "Nell", last: "Byron" },
            birth: { dateOfBirth: 0 },
          },
        ],
      },
      continuity: {
        statuses: {
          "PER-000001": "historical",
          "PER-000002": "active",
        },
        // No determinationId: v1 never had determinations to cite.
        deaths: [
          {
            personId: "PER-000001",
            declaredAt: 5_259_600,
            cause: "old age",
          },
        ],
      },
    },
  },
};

/** The v1 fixture as a complete, integrity-correct save file. */
export function v1Fixture(): ReelFile {
  return {
    header: {
      format: REEL_FORMAT,
      formatVersion: FORMAT_VERSION,
      schemaVersion: 1,
      simulationVersion: 1,
      contentVersion: "0.1.0-kernel",
      rngVersion: 1,
      checksum: checksum32Hex(canonicalJson(V1_FIXTURE_BODY)),
      saveId: "SAVE-V1-FIXTURE",
      slotName: "legacy-v1",
      savedAtLabel: "world.save @ v1",
      worldId: "WLD-AURELIA",
      worldName: "Aurelia",
      worldDateLabel: "2 January 2042",
      stepIndex: 4_320,
      rootTimeMinutes: 5_259_600,
      generation: 1,
      commandCount: 17,
      pendingEventCount: 0,
    },
    body: V1_FIXTURE_BODY,
  };
}
