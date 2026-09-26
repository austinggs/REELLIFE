/**
 * World load orchestration (System 06 persistence; UI/UX 20 section 4, UI/UX 24).
 *
 * Loading is the one action the presentation layer cannot complete through the
 * command pipeline alone. `world.load` is a real command: it validates the
 * request, records the intent as an event and can refuse it. What it deliberately
 * does *not* do is replace the running `Simulation`, because no instance can
 * replace itself mid-dispatch. The platform layer performs that swap — and this
 * module is that platform step, kept out of the React components so it is
 * testable headlessly and so the swap has exactly one implementation:
 *
 *   1. dispatch `world.load` (audit trail; refusals come from the engine)
 *   2. build the replacement session from the same store and master seed
 *   3. report failure explicitly instead of leaving a half-loaded world behind
 *
 * The caller owns the session reference, so this returns the replacement rather
 * than mutating anything (UI/UX 24 section 3: the UI never mutates; it swaps).
 */

import type { SaveStore } from "@/engine/index.ts";
import type { ConsoleAuthority } from "@/engine/primitives/index.ts";
import { SimulationSession } from "@/app/session/simulationSession.ts";

export interface WorldLoadRequest {
  readonly slotName: string;
  readonly masterSeed: string;
  readonly saveStore?: SaveStore;
  readonly checkInvariants?: boolean;
  /** Granted authority survives a load; it is a presentation grant, not world truth. */
  readonly authority?: ConsoleAuthority;
}

export type WorldLoadResult =
  | { readonly ok: true; readonly session: SimulationSession; readonly message: string }
  | { readonly ok: false; readonly message: string };

/**
 * Swaps `session` for the world stored in `slotName`.
 *
 * A refusal, a missing slot and a corrupt save are all reported the same way — as
 * an explicit failure with the engine's own explanation — because the caller must
 * never have to guess whether the old world is still the current one.
 */
export async function loadWorld(
  session: SimulationSession,
  request: WorldLoadRequest,
): Promise<WorldLoadResult> {
  const outcome = session.act("world.load", { slotName: request.slotName });
  if (!outcome.applied) {
    return {
      ok: false,
      message:
        outcome.reasons.join(" ") || `The world refused to load "${request.slotName}".`,
    };
  }

  try {
    const loaded = await SimulationSession.load({
      masterSeed: request.masterSeed,
      slotName: request.slotName,
      ...(request.saveStore === undefined ? {} : { saveStore: request.saveStore }),
      checkInvariants: request.checkInvariants ?? true,
      ...(request.authority === undefined ? {} : { authority: request.authority }),
    });
    return { ok: true, session: loaded, message: `Loaded "${request.slotName}".` };
  } catch (error) {
    // Validation and integrity failures are surfaced with their own words; a
    // failed load leaves the caller's existing session untouched and running.
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
