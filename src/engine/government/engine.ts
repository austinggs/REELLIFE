/**
 * Government engine (System 43).
 *
 * Owns `systems.government`: governments, their agencies and their budgets,
 * and the policies they have committed to implementing. Every write asserts
 * ownership on that slot; reads are scope-free.
 *
 * Budgets here are *authorizations*, and service quality is *derived* from
 * what a caller reports about the world â€” because the honest statement is
 * that a service is only as good as its funding, its people, the
 * infrastructure under it and its integrity, and the engine should name the
 * binding constraint rather than produce one unexplained number.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  SERVICE_WEIGHTS,
  type Agency,
  type Government,
  type GovernmentSystemState,
  type GovernmentPolicy,
  type ServiceConditions,
  type ServiceReading,
} from "./types.ts";

export interface CreateAgencyRequest {
  readonly id: string;
  readonly countryId: string;
  readonly name: string;
  readonly mandate: string;
  readonly serviceKind: string;
  readonly budget: Money;
  readonly capacity: number;
  readonly budgetPeriod?: Agency["budgetPeriod"];
  readonly parentAgencyId?: string;
  readonly officialIds?: readonly string[];
}

export class GovernmentEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.government) {
      this.scope.assertOwner("government");
      this.world.systems.government = { governments: [] } satisfies GovernmentSystemState;
    }
  }

  private get state(): GovernmentSystemState {
    return this.world.systems.government as GovernmentSystemState;
  }

  private set state(value: GovernmentSystemState) {
    this.world.systems.government = value;
  }

  // ---------------------------------------------------------------- reads ---

  governments(): readonly Government[] {
    return this.state.governments;
  }

  government(countryId: string): Government | undefined {
    return this.state.governments.find((entry) => entry.countryId === countryId);
  }

  requireGovernment(countryId: string, caller: string): Government {
    const found = this.government(countryId);
    if (found === undefined) {
      throw new Error(`GovernmentEngine.${caller}: no government for ${countryId}`);
    }
    return found;
  }

  agenciesOf(countryId: string): readonly Agency[] {
    return this.requireGovernment(countryId, "agenciesOf").agencies;
  }

  agency(agencyId: string): Agency | undefined {
    return this.state.governments.flatMap((entry) => entry.agencies).find((e) => e.id === agencyId);
  }

  requireAgency(agencyId: string, caller: string): Agency {
    const found = this.agency(agencyId);
    if (found === undefined) {
      throw new Error(`GovernmentEngine.${caller}: unknown agency ${agencyId}`);
    }
    return found;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * How well a service is running, and *what is stopping it*.
   *
   * Quality is the weighted state of funding, capacity, staffing,
   * infrastructure and integrity â€” each supplied by whichever system owns
   * it. Overload is demand above what that quality can serve, and the
   * binding constraint is the weakest named input, so "the clinic is bad"
   * always arrives with "because there is no water".
   */
  serviceReading(agencyId: string, conditions: ServiceConditions): ServiceReading {
    const agency = this.requireAgency(agencyId, "serviceReading");
    requireRatio(conditions.infrastructure, "infrastructure", "serviceReading");
    requireRatio(conditions.integrity, "integrity", "serviceReading");
    const staffing = conditions.staffingRatio ?? 1;
    requireRatio(staffing, "staffingRatio", "serviceReading");
    const funding = agency.budget.minorUnits === 0 ? 0 : 1;

    const parts: readonly (readonly [string, number])[] = [
      ["funding", funding],
      ["capacity", agency.capacity],
      ["staffing", staffing],
      ["infrastructure", conditions.infrastructure],
      ["integrity", conditions.integrity],
    ];
    let quality = 0;
    let worst: { name: string; value: number } = { name: "funding", value: 1 };
    for (const [name, value] of parts) {
      quality += SERVICE_WEIGHTS[name as keyof typeof SERVICE_WEIGHTS] * value;
      if (value < worst.value) worst = { name, value };
    }
    // The reported quality is the one the served figure is derived from:
    // rounding first and serving second keeps them from disagreeing by a
    // unit because of floating-point dust.
    const reported = round4(clamp01(quality));
    const served = Math.floor(agency.demandUnits * reported);
    return {
      agencyId,
      quality: reported,
      served,
      demand: agency.demandUnits,
      overload: round4(clamp01(agency.demandUnits === 0 ? 0 : 1 - reported)),
      bindingConstraint: worst.value < 1 ? worst.name : undefined,
      unmetDemand: Math.max(0, agency.demandUnits - served),
    };
  }

  // --------------------------------------------------------------- writes ---

  establishGovernment(
    request: { readonly countryId: string; readonly name: string; readonly legitimacy: number },
    at: WorldTime,
  ): Government {
    this.scope.assertOwner("government");
    if (this.government(request.countryId) !== undefined) {
      throw new Error(
        `GovernmentEngine.establishGovernment: ${request.countryId} already has a government`,
      );
    }
    requireRatio(request.legitimacy, "legitimacy", "establishGovernment");
    if (!this.knownCountry(request.countryId)) {
      throw new Error(
        `GovernmentEngine.establishGovernment: ${request.countryId} is not a known country (System 39)`,
      );
    }
    const government: Government = {
      countryId: request.countryId,
      agencies: [],
      policies: [],
      legitimacy: request.legitimacy,
      establishedAt: at,
      history: [{ at, kind: "established", note: request.name }],
    };
    this.state = { ...this.state, governments: [...this.state.governments, government] };
    return government;
  }

  createAgency(request: CreateAgencyRequest, at: WorldTime): Agency {
    this.scope.assertOwner("government");
    if (this.agency(request.id) !== undefined) {
      throw new Error(`GovernmentEngine.createAgency: ${request.id} already exists`);
    }
    const government = this.requireGovernment(request.countryId, "createAgency");
    if (request.budget.minorUnits < 0) {
      throw new Error("GovernmentEngine.createAgency: a budget cannot be negative");
    }
    requireRatio(request.capacity, "capacity", "createAgency");
    if (request.parentAgencyId !== undefined) {
      this.requireAgency(request.parentAgencyId, "createAgency");
    }
    const agency: Agency = {
      id: request.id,
      name: request.name,
      countryId: request.countryId,
      mandate: request.mandate,
      serviceKind: request.serviceKind,
      budget: request.budget,
      budgetPeriod: request.budgetPeriod ?? "annual",
      capacity: request.capacity,
      officialIds: [...(request.officialIds ?? [])],
      demandUnits: 0,
      servedUnits: 0,
      ...(request.parentAgencyId === undefined ? {} : { parentAgencyId: request.parentAgencyId }),
      history: [{ at, kind: "created", note: request.mandate }],
    };
    // A new agency is appended; `writeAgency` only ever replaces by id, so
    // routing creation through it would silently drop the agency.
    this.state = {
      ...this.state,
      governments: this.state.governments.map((entry) =>
        entry === government ? { ...entry, agencies: [...entry.agencies, agency] } : entry,
      ),
    };
    return agency;
  }

  /**
   * Sets or changes a budget. An authorization, not a balance: the money
   * itself is System 25's, and nothing here posts a transaction.
   */
  setBudget(agencyId: string, budget: Money, at: WorldTime, note: string): Agency {
    this.scope.assertOwner("government");
    if (budget.minorUnits < 0) {
      throw new Error("GovernmentEngine.setBudget: a budget cannot be negative");
    }
    const agency = this.requireAgency(agencyId, "setBudget");
    const updated: Agency = {
      ...agency,
      budget,
      history: [...agency.history, { at, kind: "budget", note: `${budget.minorUnits} â€” ${note}` }],
    };
    this.writeAgency(this.requireGovernment(agency.countryId, "setBudget"), updated);
    return updated;
  }

  /** Officials are people; this records the role, not the person. */
  assignOfficial(agencyId: string, officialId: string, at: WorldTime): Agency {
    this.scope.assertOwner("government");
    const agency = this.requireAgency(agencyId, "assignOfficial");
    if (agency.officialIds.includes(officialId)) {
      throw new Error(`GovernmentEngine.assignOfficial: ${officialId} already holds a role at ${agencyId}`);
    }
    const updated: Agency = {
      ...agency,
      officialIds: [...agency.officialIds, officialId],
      history: [...agency.history, { at, kind: "official", note: officialId }],
    };
    this.writeAgency(this.requireGovernment(agency.countryId, "assignOfficial"), updated);
    return updated;
  }

  /**
   * Records demand and delivery. Overload is a fact about how much was asked
   * for against what was done â€” the spec's "service overload", recorded
   * rather than smoothed away.
   */
  recordServicePeriod(
    agencyId: string,
    period: { readonly demandUnits: number; readonly servedUnits: number },
    at: WorldTime,
  ): Agency {
    this.scope.assertOwner("government");
    for (const [name, value] of [
      ["demandUnits", period.demandUnits],
      ["servedUnits", period.servedUnits],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(
          `GovernmentEngine.recordServicePeriod: ${name} must be a non-negative integer, received ${String(value)}`,
        );
      }
    }
    if (period.servedUnits > period.demandUnits) {
      throw new Error("GovernmentEngine.recordServicePeriod: cannot serve more than was demanded");
    }
    const agency = this.requireAgency(agencyId, "recordServicePeriod");
    const updated: Agency = {
      ...agency,
      demandUnits: period.demandUnits,
      servedUnits: period.servedUnits,
      history: [
        ...agency.history,
        { at, kind: "service_period", note: `${period.servedUnits}/${period.demandUnits} served` },
      ],
    };
    this.writeAgency(this.requireGovernment(agency.countryId, "recordServicePeriod"), updated);
    return updated;
  }

  /**
   * A GovernmentPolicy, the System 41 rules it implements, and how far implementation
   * actually got. The gap between a GovernmentPolicy and its implementation is the
   * spec's "GovernmentPolicy implementation gap", stored rather than assumed zero.
   */
  implementPolicy(
    ids: IdAllocator,
    request: {
      readonly countryId: string;
      readonly title: string;
      readonly ruleIds: readonly string[];
      readonly implementation?: number;
      readonly note?: string;
    },
    at: WorldTime,
  ): GovernmentPolicy {
    this.scope.assertOwner("government");
    const government = this.requireGovernment(request.countryId, "implementPolicy");
    if (request.ruleIds.length === 0) {
      throw new Error("GovernmentEngine.implementPolicy: a GovernmentPolicy must cite the rules it implements");
    }
    requireRatio(request.implementation ?? 0, "implementation", "implementPolicy");
    const GovernmentPolicy: GovernmentPolicy = {
      id: `pol-${ids.next("activity")}`,
      countryId: request.countryId,
      title: request.title,
      ruleIds: [...request.ruleIds],
      implementedAt: at,
      implementation: request.implementation ?? 0,
      ...(request.note === undefined ? {} : { note: request.note }),
    };
    this.state = {
      ...this.state,
      governments: this.state.governments.map((entry) =>
        entry === government ? { ...entry, policies: [...entry.policies, GovernmentPolicy] } : entry,
      ),
    };
    return GovernmentPolicy;
  }

  /** An emergency, and the coordination it triggers across agencies. */
  declareEmergency(
    countryId: string,
    request: { readonly kind: string; readonly agencyIds: readonly string[]; readonly note: string },
    at: WorldTime,
  ): Government {
    this.scope.assertOwner("government");
    const government = this.requireGovernment(countryId, "declareEmergency");
    for (const agencyId of request.agencyIds) {
      this.requireAgency(agencyId, "declareEmergency");
    }
    this.state = {
      ...this.state,
      governments: this.state.governments.map((entry) =>
        entry === government
          ? {
              ...entry,
              history: [
                ...entry.history,
                {
                  at,
                  kind: "emergency",
                  note: `${request.kind} across ${request.agencyIds.join(", ")}: ${request.note}`,
                },
              ],
            }
          : entry,
      ),
    };
    return this.requireGovernment(countryId, "declareEmergency");
  }

  /**
   * Administrative capacity, which moves as posts are filled and lost.
   * Recorded with a reason, because "the clinic is slower now" should never
   * be a fact without an explanation attached.
   */
  setCapacity(agencyId: string, capacity: number, at: WorldTime, note: string): Agency {
    this.scope.assertOwner("government");
    requireRatio(capacity, "capacity", "setCapacity");
    const agency = this.requireAgency(agencyId, "setCapacity");
    const updated: Agency = {
      ...agency,
      capacity,
      history: [...agency.history, { at, kind: "capacity", note: `${round2(capacity)} — ${note}` }],
    };
    this.writeAgency(this.requireGovernment(agency.countryId, "setCapacity"), updated);
    return updated;
  }

  private writeAgency(government: Government, agency: Agency): void {
    this.state = {
      ...this.state,
      governments: this.state.governments.map((entry) =>
        entry === government
          ? {
              ...entry,
              agencies: entry.agencies.map((candidate) =>
                candidate.id === agency.id ? agency : candidate,
              ),
            }
          : entry,
      ),
    };
  }

  private knownCountry(countryId: string): boolean {
    const state = this.world.systems.countries as
      | { readonly countries: readonly { readonly id: string }[] }
      | undefined;
    if (state === undefined) return true;
    return state.countries.some((entry) => entry.id === countryId);
  }
}

// --------------------------------------------------------------- helpers ---

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function requireRatio(value: number, field: string, caller: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `GovernmentEngine.${caller}: ${field} must be in [0, 1], received ${String(value)}`,
    );
  }
}
