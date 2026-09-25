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
import type { NeedKind } from "../../needs/types.ts";
import type { TenancyType } from "../../housing/types.ts";
import { NeedsEngine } from "../../needs/engine.ts";
import { EmploymentEngine } from "../../employment/engine.ts";
import { HousingEngine } from "../../housing/engine.ts";
import { FinanceEngine } from "../../finance/engine.ts";
import { InventoryEngine } from "../../inventory/engine.ts";
import { NEEDS_CONSEQUENCE_TYPES } from "./needsCommands.ts";
import { EMPLOYMENT_CONSEQUENCE_TYPES } from "./employmentCommands.ts";
import { ASSET_CONSEQUENCE_TYPES } from "./assetCommands.ts";

/**
 * The slice of `Simulation` the domain wiring needs. Declared structurally so
 * this module does not import the Simulation class (which imports the
 * dispatcher, which the appliers are handed to).
 */
export interface DomainApplierHost {
  registerConsequenceApplier(type: string, applier: ConsequenceDescriptorApplier): void;
  readonly scope: SystemScope;
  readonly world: WorldState;
  /** The live allocator: `world.shared.idAllocator` is only its persisted snapshot. */
  readonly ids: IdAllocator;
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

  host.registerConsequenceApplier(EMPLOYMENT_CONSEQUENCE_TYPES.hire, (payload, event) => {
    new EmploymentEngine(host.scope, host.world).hire(
      host.ids,
      payload.personId as EntityId<"person">,
      payload.employerOrgId as string,
      payload.roleTitle as string,
      payload.occupationCode as string,
      payload.wage as Money,
      payload.weeklyHours as number,
      event.at,
    );
  });

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
}