/**
 * Domain consequence appliers (M2/M3 vertical slice).
 *
 * The dispatcher applies every consequence inside `scope.mutate(descriptor.owner)`,
 * so each applier below runs as the system that owns the state it touches and
 * the engines' `assertOwner` calls pass without an extra mutation scope
 * (nested scopes are rejected by the ownership guard).
 *
 * Appliers close over the host's `scope`, `world` and live `IdAllocator`
 * instead of reading them from the ConsequenceContext, which only carries
 * time, deterministic RNG access, an event emitter and a logger.
 */

import type { EntityId, IdAllocator } from "../../primitives/ids.ts";
import type { Money } from "../../primitives/money.ts";
import type { SystemScope } from "../../core/access.ts";
import type { WorldState } from "../../core/worldState.ts";
import type { ConsequenceDescriptorApplier } from "../dispatcher.ts";
import type { EventHandler } from "../../events/engine.ts";
import type { NeedKind } from "../../needs/types.ts";
import type { TenancyType } from "../../housing/types.ts";
import type { EmploymentSystemState } from "../../employment/types.ts";
import type { Activity } from "../../primitives/activity.ts";
import type { ActivityKind } from "../../primitives/activity.ts";
import type { WorldTime } from "../../primitives/time.ts";
import type { RelationshipContext, RelationshipTurningPoint } from "../../primitives/relationship.ts";
import type { ActivitiesEngine } from "../../activities/engine.ts";
import type { Calendar } from "../../time/calendar.ts";
import { durationOf } from "../../primitives/time.ts";
import { activityIsTerminal } from "../../primitives/activity.ts";
import { NeedsEngine } from "../../needs/engine.ts";
import { EmploymentEngine } from "../../employment/engine.ts";
import { HousingEngine } from "../../housing/engine.ts";
import { FinanceEngine } from "../../finance/engine.ts";
import { InventoryEngine } from "../../inventory/engine.ts";
import { RelationshipsEngine } from "../../relationships/engine.ts";
import { NEEDS_CONSEQUENCE_TYPES } from "./needsCommands.ts";
import {
  EMPLOYMENT_CONSEQUENCE_TYPES,
  EMPLOYMENT_EVENT_TYPES,
} from "./employmentCommands.ts";
import { ASSET_CONSEQUENCE_TYPES } from "./assetCommands.ts";
import { ACTIVITY_CONSEQUENCE_TYPES } from "./activityCommands.ts";
import {
  SOCIAL_CONSEQUENCE_TYPES,
  type InteractionDeltas,
} from "./socialCommands.ts";
import type { OrganizationsSystemState } from "../../organizations/types.ts";

/**
 * The slice of `Simulation` the domain wiring needs. Declared structurally so
 * this module does not import the Simulation class (which imports the
 * dispatcher, which the appliers are handed to).
 */
export interface DomainApplierHost {
  registerConsequenceApplier(type: string, applier: ConsequenceDescriptorApplier): void;
  registerEventHandler(handler: EventHandler): void;
  readonly scope: SystemScope;
  readonly world: WorldState;
  /** The live allocator: `world.shared.idAllocator` is only its persisted snapshot. */
  readonly ids: IdAllocator;
  /**
   * The live activities engine. Its state lives inside the engine object rather
   * than in `world.systems`, so a newly constructed engine would write to a
   * throwaway map and the world would never see the activity.
   */
  readonly activities: ActivitiesEngine;
  readonly calendar: Calendar;
}

/** Adds a tie if one does not already exist, without disturbing an existing one. */
function ensureTie(
  engine: RelationshipsEngine,
  ids: IdAllocator,
  from: EntityId<"person">,
  to: EntityId<"person">,
  context: RelationshipContext,
  origin: string,
  at: WorldTime,
): void {
  if (engine.get(from, to)) return;
  engine.establish(ids, from, to, [context], origin, at);
}

/** Registers one consequence applier per domain consequence type. */
export function registerDomainConsequenceAppliers(host: DomainApplierHost): void {
  host.registerConsequenceApplier(NEEDS_CONSEQUENCE_TYPES.satisfyNeed, (payload, event) => {
    new NeedsEngine(host.scope, host.world).satisfy(
      payload.personId as EntityId<"person">,
      payload.needKind as NeedKind,
      payload.amount as number,
      event.at,
    );
  });

  host.registerConsequenceApplier(
    EMPLOYMENT_CONSEQUENCE_TYPES.hire,
    (payload, event, context) => {
      // Cross-system precondition: employment exists only at real
      // organizations (System 32). Unknown IDs are caller-facing input, so
      // report and change nothing rather than throwing out of the pipeline.
      const employerOrgId = payload.employerOrgId as string;
      const organizations = host.world.systems.organizations as
        | OrganizationsSystemState
        | undefined;
      if (
        !organizations?.organizations.some((organization) => organization.id === employerOrgId)
      ) {
        context.log(`employment.hire ignored: unknown organization ${employerOrgId}`, {
          employerOrgId,
        });
        return;
      }
      new EmploymentEngine(host.scope, host.world).hire(
        host.ids,
        payload.personId as EntityId<"person">,
        employerOrgId,
        payload.roleTitle as string,
        payload.occupationCode as string,
        payload.wage as Money,
        payload.weeklyHours as number,
        event.at,
      );
    },
  );

  host.registerConsequenceApplier(EMPLOYMENT_CONSEQUENCE_TYPES.terminate, (payload, event) => {
    new EmploymentEngine(host.scope, host.world).terminate(
      payload.employmentId as string,
      payload.reason as "resigned" | "terminated",
      event.at,
    );
  });

  host.registerConsequenceApplier(ASSET_CONSEQUENCE_TYPES.createLease, (payload, event) => {
    new HousingEngine(host.scope, host.world).signLease(
      host.ids,
      payload.propertyId as string,
      payload.landlordId as string,
      payload.tenantId as EntityId<"person">,
      payload.rentPerCycle as Money,
      event.at,
    );
  });

  host.registerConsequenceApplier(ASSET_CONSEQUENCE_TYPES.moveResident, (payload, event) => {
    new HousingEngine(host.scope, host.world).moveIn(
      host.ids,
      payload.personId as EntityId<"person">,
      payload.propertyId as string,
      payload.occupancyType as TenancyType,
      event.at,
    );
  });

  host.registerConsequenceApplier(ASSET_CONSEQUENCE_TYPES.postLedgerTransfer, (payload, event) => {
    new FinanceEngine(host.scope, host.world).transfer(
      host.ids,
      payload.fromAccountId as string,
      payload.toAccountId as string,
      payload.amount as Money,
      payload.category as string,
      payload.description as string,
      event.at,
    );
  });

  host.registerConsequenceApplier(ASSET_CONSEQUENCE_TYPES.transferItemPossession, (payload) => {
    new InventoryEngine(host.scope, host.world).transferPossession(
      payload.itemId as string,
      payload.toHolderId as EntityId<"person">,
    );
  });

  // ------------------------------------------------------------ activities

  host.registerConsequenceApplier(ACTIVITY_CONSEQUENCE_TYPES.started, (payload, event) => {
    const engine = host.activities;
    const created = engine.create(
      { ids: host.ids, calendar: host.calendar },
      {
        actor: payload.actor as EntityId<"person">,
        kind: payload.kind as ActivityKind,
        start: event.at,
        duration: durationOf(payload.durationMinutes as number),
        createdBy: payload.createdBy as Activity["createdBy"],
        ...(payload.locationId === undefined ? {} : { locationId: payload.locationId as string }),
        ...(Array.isArray(payload.participants)
          ? { participants: payload.participants as readonly EntityId<"person">[] }
          : {}),
        ...(payload.notes === undefined ? {} : { notes: payload.notes as string }),
        ...(event.cause.commandId === undefined ? {} : { commandId: event.cause.commandId }),
      },
    );
    // One event, one owner: the activity is created and started together so it
    // is never visible as an orphaned "planned" row with no author.
    engine.transition(created.id, "started", event.at);
  });

  host.registerConsequenceApplier(ACTIVITY_CONSEQUENCE_TYPES.stop, (payload, event, context) => {
    const engine = host.activities;
    const activityId = payload.activityId as EntityId<"activity">;
    const existing = engine.get(activityId);
    if (!existing) {
      // Unknown ids are caller-facing input, not a programming error: report and
      // change nothing rather than throwing out of the dispatch pipeline.
      context.log(`activity.stop ignored: unknown activity ${activityId}`, { activityId });
      return;
    }
    if (activityIsTerminal(existing)) {
      context.log(`activity.stop ignored: activity ${activityId} is already ${existing.state}`, {
        activityId,
        state: existing.state,
      });
      return;
    }
    const wasRunning = existing.state === "started" || existing.state === "inProgress";
    engine.transition(
      activityId,
      wasRunning ? "completed" : "cancelled",
      event.at,
      typeof payload.reason === "string" ? payload.reason : "stopped by command",
    );
  });

  // --------------------------------------------------------- relationships

  host.registerConsequenceApplier(SOCIAL_CONSEQUENCE_TYPES.interaction, (payload, event) => {
    const engine = new RelationshipsEngine(host.scope, host.world);
    const from = payload.from as EntityId<"person">;
    const to = payload.to as EntityId<"person">;
    const context = payload.context as RelationshipContext;
    const origin = typeof payload.origin === "string" ? payload.origin : "social interaction";
    const summary = typeof payload.summary === "string" ? payload.summary : "interacted";

    // An interaction is experienced by both parties, so both directional
    // records are created/updated; the engine still owns each evaluation.
    ensureTie(engine, host.ids, from, to, context, origin, event.at);
    ensureTie(engine, host.ids, to, from, context, origin, event.at);

    const turningPoint = payload.turningPoint as
      | { readonly kind: RelationshipTurningPoint["kind"]; readonly on: "initiator" | "counterparty" }
      | undefined;

    engine.recordInteraction(
      from,
      to,
      payload.initiator as InteractionDeltas,
      event.at,
      turningPoint?.on === "initiator" ? { kind: turningPoint.kind, summary } : undefined,
    );
    engine.recordInteraction(
      to,
      from,
      payload.counterparty as InteractionDeltas,
      event.at,
      turningPoint?.on === "counterparty" ? { kind: turningPoint.kind, summary } : undefined,
    );
  });

  // ------------------------------------------------------------- guards

  // A shift only exists if the employment it belongs to is still active when
  // the event resolves. Revalidating here (rather than at validation time, where
  // no world read path exists) is the System 04 "preconditions are revalidated
  // at execution" rule; a stale event is discarded, not partially applied.
  host.registerEventHandler({
    eventType: EMPLOYMENT_EVENT_TYPES.shiftWorked,
    systemId: "employment",
    precondition: (event, context) => {
      const employmentId = event.metadata?.employmentId;
      if (typeof employmentId !== "string") return true;
      const state = host.world.systems.employment as EmploymentSystemState | undefined;
      const record = state?.employments.find((entry) => entry.id === employmentId);
      if (record && record.status === "active") return true;
      context.log(`employment.work_shift discarded: employment ${employmentId} is not active`, {
        employmentId,
      });
      return false;
    },
    handle: () => [],
  });
}
