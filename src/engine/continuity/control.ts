/**
 * Player control handoff (System 53c).
 *
 * "Player can transfer control to a descendant or another eligible person
 * without resetting the world." This module is the whole of that, and the thing
 * it is careful about is what must *not* happen:
 *
 *  - The world is not re-seeded, re-keyed or rolled back. Every other system
 *    keeps the state it had; the transfer is one appended record.
 *  - Nothing is re-keyed to the new person. The departed PersonId still
 *    resolves in identity, lineage, ledger history and the timeline — a walk
 *    back to the ancestor's `causalChainId` has to keep working afterwards.
 *  - There is no hidden bonus. The heir's prospects come from what the estate
 *    actually handed over, in the owning systems' own fields, plus their own
 *    life state (architectural law 12).
 *
 * Eligibility is separate from the decision, as everywhere else: this module
 * *offers* candidates with the relationship that qualifies them, and the caller
 * chooses. A handoff to somebody with no relationship at all is still possible —
 * the spec allows "another eligible person" — but it is recorded under the
 * `other_eligible` basis rather than disguised as an inheritance.
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import { LifeContinuityEngine } from "./engine.ts";
import type { ControlTransfer, SuccessionBasis } from "./types.ts";

/** Who could take over, and on what grounds. */
export interface SuccessionCandidate {
  readonly personId: EntityId<"person">;
  /** The relationship that makes them eligible, in the spec's own words. */
  readonly relation: "descendant" | "parent" | "sibling" | "household" | "beneficiary";
  readonly basis: SuccessionBasis;
}

interface FamilyBag {
  readonly lineages?: readonly {
    readonly personId: EntityId<"person">;
    readonly parentIds: readonly EntityId<"person">[];
    readonly childIds: readonly EntityId<"person">[];
  }[];
  readonly households?: readonly {
    readonly members: readonly {
      readonly personId: EntityId<"person">;
      readonly role: string;
      readonly leftAt?: WorldTime;
    }[];
  }[];
}


/**
 * Lists who may take over, nearest relationship first.
 *
 * A candidate must be *alive* — a deceased heir inherits nothing and can hold
 * nothing — and must not be the person handing over. Order is stable, so a UI
 * can present the list and a test can assert it.
 */
export function successionCandidates(
  sim: Simulation,
  fromPersonId: EntityId<"person">,
): readonly SuccessionCandidate[] {
  const continuity = LifeContinuityEngine.peek(sim.scope, sim.world);
  const alive = (id: EntityId<"person">): boolean =>
    id !== fromPersonId && continuity.statusOf(id) === "active";

  const family = sim.world.systems.family as FamilyBag | undefined;
  const lineageOf = (id: EntityId<"person">) => family?.lineages?.find((link) => link.personId === id);
  const out: SuccessionCandidate[] = [];
  const seen = new Set<string>();
  const push = (personId: EntityId<"person">, relation: SuccessionCandidate["relation"]): void => {
    if (!alive(personId) || seen.has(String(personId))) return;
    seen.add(String(personId));
    out.push({
      personId,
      relation,
      basis:
        relation === "descendant"
          ? "descendant"
          : relation === "beneficiary"
            ? "beneficiary"
            : "household",
    });
  };

  for (const childId of lineageOf(fromPersonId)?.childIds ?? []) push(childId, "descendant");
  for (const household of family?.households ?? []) {
    if (!household.members.some((member) => member.personId === fromPersonId)) continue;
    for (const other of household.members) {
      if (other.role !== "spouse" && other.role !== "partner") continue;
      push(other.personId, "household");
    }
  }
  for (const parentId of lineageOf(fromPersonId)?.parentIds ?? []) {
    push(parentId, "parent");
    for (const siblingId of lineageOf(parentId)?.childIds ?? []) push(siblingId, "sibling");
  }
  for (const beneficiary of continuity.testamentFor(fromPersonId)?.beneficiaries ?? []) {
    push(beneficiary.personId, "beneficiary");
  }
  return out;
}

export interface HandOverControlRequest {
  readonly fromPersonId: EntityId<"person">;
  readonly toPersonId: EntityId<"person">;
  readonly at: WorldTime;
  /** Supplied by the caller; allocated deterministically when omitted. */
  readonly transferId?: string;
  readonly estateId?: string;
  readonly reason?: string;
  /** Stated by the caller; `other_eligible` when nobody can be named. */
  readonly basis?: SuccessionBasis;
}

export interface HandOverResult {
  readonly transfer: ControlTransfer;
  /** The chain of handoffs up to and including this one, oldest first. */
  readonly chain: readonly ControlTransfer[];
}

/**
 * Records the handoff and nothing else: one appended record, one history entry,
 * no other system touched. That restraint is what makes "the world was not reset"
 * checkable rather than merely claimed.
 */
export function handOverControl(sim: Simulation, request: HandOverControlRequest): HandOverResult {
  const peek = LifeContinuityEngine.peek(sim.scope, sim.world);
  if (peek.statusOf(request.toPersonId) !== "active") {
    throw new Error(
      `handOverControl: ${request.toPersonId} is ${peek.statusOf(request.toPersonId)}, not active`,
    );
  }
  const id = request.transferId ?? `ct-${String(sim.ids.next("record"))}`;
  const basis = request.basis ?? "other_eligible";

  const transfer = sim.guard.mutate("continuity", () =>
    new LifeContinuityEngine(sim.scope, sim.world).recordControlTransfer(id, {
      fromPersonId: request.fromPersonId,
      toPersonId: request.toPersonId,
      at: request.at,
      basis,
      ...(request.estateId === undefined ? {} : { estateId: request.estateId }),
      ...(request.reason === undefined ? {} : { reason: request.reason }),
    }),
  );

  sim.guard.mutate("history", () => {
    sim.history.record({
      at: request.at,
      kind: "milestone",
      summary: `control passed from ${String(request.fromPersonId)} to ${String(request.toPersonId)}`,
      detail: `basis: ${basis}${
        request.estateId === undefined ? "" : ` (estate ${request.estateId})`
      }; the world continues without a reset`,
      personId: request.toPersonId,
      eventType: "continuity.controlTransferred",
      causeKind: "system",
      importance: 5,
      visibility: "public",
      tags: ["continuity", "succession"],
    });
  });

  return { transfer, chain: [...peek.controlTransfers()] };
}

