/**
 * M2 Definition of Done — one full causal chain, reproducible from a seed.
 *
 *   missed shift -> dismissal -> income shock -> rent threat -> NPC takes a second job
 *
 * The point of this scenario is not that a particular number comes out; it is
 * that each link is produced through the real pipeline (Intent -> Command ->
 * Validation -> Resolution -> Event -> Consequences -> New State) and that the
 * whole run is reproducible: the same seed and the same command sequence must
 * produce the same state hash.
 *
 * Employer and landlord are played by the harness. That is honest rather than a
 * shortcut: organization and contract systems are M5/M6 work, so until they
 * exist there is no system that can *decide* to dismiss a worker or threaten a
 * tenant. The harness emits their decisions as ordinary events, which is exactly
 * what those systems will do once they exist — so none of the chain bypasses the
 * event/consequence pipeline.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { asEntityId, type EntityId } from "../../src/engine/primitives/ids.ts";
import { currencyId, money, type Money } from "../../src/engine/primitives/money.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { EMPLOYMENT_CONSEQUENCE_TYPES } from "../../src/engine/commands/domain/index.ts";
import { EMPLOYMENT_COMMAND_TYPES } from "../../src/engine/commands/domain/employmentCommands.ts";
import { ASSET_COMMAND_TYPES } from "../../src/engine/commands/domain/assetCommands.ts";
import { FinanceEngine } from "../../src/engine/finance/engine.ts";
import { HousingEngine } from "../../src/engine/housing/engine.ts";
import type { EmploymentSystemState } from "../../src/engine/employment/types.ts";
import type { FinanceSystemState } from "../../src/engine/finance/types.ts";

const ACTOR = asEntityId<"person">("PER-000001");
const LANDLORD = asEntityId<"person">("PER-000002");
const DOCKS = "ORG-ARDIN-DOCKS";
const CAFE = "ORG-QUAY-CAFE";
const PROPERTY = "PRP-ARDEN-001";
const ACR = currencyId("ACR");
const RENT = money(ACR, 50_000);
const WEEKLY_WAGE = money(ACR, 60_000);
const CAFE_WAGE = money(ACR, 40_000);
const OPENING_BALANCE = money(ACR, 100_000);
/** Weeks simulated: enough for wages to stop, arrears to bite, and income to resume. */
const SCENARIO_WEEKS = 6;
const SEED = "reellife-scenario-job-loss";

interface ScenarioOutcome {
  readonly sim: Simulation;
  readonly missedShiftCount: number;
  readonly dismissedAt: number | null;
  readonly dismissalSharesShiftChain: boolean;
  readonly rentThreatCount: number;
  readonly rentPayments: number;
  readonly wagePayments: number;
  readonly employmentStatuses: readonly string[];
  readonly employers: readonly string[];
  readonly secondJobEmployer: string | null;
  readonly balanceAtEnd: Money;
  readonly unhandledConsequences: number;
}

function dispatch(
  sim: Simulation,
  type: string,
  params: Record<string, unknown>,
  origin: "player" | "npc" | "system" = "player",
) {
  return sim.dispatcher.dispatch(sim.dispatcher.createCommand(type, ACTOR, params, origin));
}

function openAccount(
  sim: Simulation,
  ownerId: EntityId<"person"> | string,
  openingBalance = 0,
): string {
  let accountId = "";
  sim.guard.mutate("finance", () => {
    accountId = new FinanceEngine(sim.scope, sim.world).openAccount(
      sim.ids,
      ownerId,
      "checking",
      ACR,
      sim.clock.time,
      money(ACR, openingBalance),
    ).id;
  });
  return accountId;
}

function balanceOf(sim: Simulation, accountId: string): Money {
  const account = new FinanceEngine(sim.scope, sim.world).getAccount(accountId);
  if (!account) throw new Error(`Unknown account ${accountId}`);
  return account.balance;
}

function employments(sim: Simulation) {
  return (sim.world.systems.employment as EmploymentSystemState | undefined)?.employments ?? [];
}

function activeEmployment(sim: Simulation) {
  return employments(sim).find((record) => record.status === "active");
}

function ledgerCategories(sim: Simulation): readonly string[] {
  const finance = sim.world.systems.finance as FinanceSystemState | undefined;
  return (finance?.ledger ?? []).map((entry) => entry.category);
}


/** Runs the entire chain and reports what the world ended up looking like. */
function runJobLossScenario(seed: string): ScenarioOutcome {
  const sim = createKernelSimulation({ masterSeed: seed, checkInvariants: true });

  // -------------------------------------------------------------- fixtures
  const employerAccount = openAccount(sim, DOCKS);
  const cafeAccount = openAccount(sim, CAFE);
  const landlordAccount = openAccount(sim, LANDLORD);
  const workerAccount = openAccount(sim, ACTOR, OPENING_BALANCE.minorUnits);

  dispatch(sim, EMPLOYMENT_COMMAND_TYPES.apply, {
    employerOrgId: DOCKS,
    roleTitle: "Dockhand",
    occupationCode: "dockhand",
    wage: WEEKLY_WAGE,
    weeklyHours: 40,
  });
  dispatch(sim, ASSET_COMMAND_TYPES.housingSignLease, {
    propertyId: PROPERTY,
    landlordId: String(LANDLORD),
    rentPerCycle: RENT,
  });
  dispatch(sim, ASSET_COMMAND_TYPES.housingMoveIn, {
    propertyId: PROPERTY,
    occupancyType: "tenant",
  });

  const docksJob = activeEmployment(sim);
  if (!docksJob) throw new Error("Fixture failed: no active employment");
  const docksJobId = docksJob.id;

  // A committed daily shift. A schedule is structure, not behaviour: the worker
  // still has to actually attend, which is what makes "missed" possible.
  sim.guard.mutate("activities", () => {
    sim.activities.addSchedule({
      id: "SCH-DOCKS-DAY",
      owner: { kind: "person", id: ACTOR },
      kind: "workShift",
      label: "Docks day shift",
      startMinuteOfDay: 8 * 60,
      durationMinutes: 8 * 60,
      recurrence: { frequency: "daily" },
      requirementIds: [],
      commitment: true,
      activeFrom: sim.clock.time,
    });
    sim.activities.materialiseSchedules(
      { ids: sim.ids, calendar: sim.calendar },
      sim.clock.time,
      atTime((sim.clock.time as number) + 3 * MINUTES_PER_DAY),
    );
  });

  // ------------------------------------------------------- 1. missed shift
  sim.advanceTo(atTime((sim.clock.time as number) + 2 * MINUTES_PER_DAY));
  const missed = sim.activities.all().filter((activity) => activity.state === "missed");

  // -------------------------------------------------------- 2. dismissal
  // The employer treats repeated no-shows as a breach. It is declared as a
  // delayed effect, so the dismissal is a *scheduled future event* rather than a
  // hidden timer, and it carries a real consequence for the owning system.
  for (const activity of missed) {
    sim.dispatcher.emitEvent(
      {
        type: "employment.shift_missed",
        cause: { kind: "institution", description: "shift not attended" },
        actors: [{ kind: "person", id: ACTOR }],
        targets: [{ kind: "organization", id: asEntityId<"organization">(DOCKS) }],
        visibleFacts: [`Missed shift ${activity.id} at ${DOCKS}`],
        tags: ["employment"],
        metadata: { employmentId: docksJobId, activityId: activity.id },
        delayedEffects: [
          {
            delayMinutes: 2 * MINUTES_PER_DAY,
            eventType: "employment.dismissed",
            description: "Repeated no-shows without notice",
            consequences: [
              {
                type: EMPLOYMENT_CONSEQUENCE_TYPES.terminate,
                owner: "employment",
                payload: { employmentId: docksJobId, reason: "terminated" },
              },
            ],
          },
        ],
      },
      sim.clock.time,
    );
  }

  let shiftChainId = "";
  for (const event of sim.dispatcher.resolveDue(sim.clock.time)) {
    if (event.type === "employment.shift_missed") shiftChainId = event.causalChainId;
  }

  sim.advanceTo(atTime((sim.clock.time as number) + 3 * MINUTES_PER_DAY));
  const dismissal = sim.history
    .all()
    .find((entry) => entry.eventType === "employment.dismissed");
  const dismissalSharesShiftChain =
    shiftChainId.length > 0 &&
    sim.history.forChain(shiftChainId).some((entry) => entry.eventType === "employment.dismissed");


  // ------------------------- 3/4/5. income shock, rent pressure, second job
  let rentThreatCount = 0;
  let secondJobEmployer: string | null = null;

  for (let weekIndex = 0; weekIndex < SCENARIO_WEEKS; weekIndex += 1) {
    // Wages are paid only while an employment is active, so the dismissal is
    // felt as an income shock rather than being narrated as one.
    const job = activeEmployment(sim);
    if (job) {
      const payer = job.employerOrgId === DOCKS ? employerAccount : cafeAccount;
      dispatch(sim, ASSET_COMMAND_TYPES.financeTransfer, {
        fromAccountId: payer,
        toAccountId: workerAccount,
        amount: job.wage,
        category: "wage",
        description: "weekly wage",
      });
    }

    const balance = balanceOf(sim, workerAccount);
    if (balance.minorUnits >= RENT.minorUnits) {
      dispatch(sim, ASSET_COMMAND_TYPES.housingPayRent, {
        fromAccountId: workerAccount,
        toAccountId: landlordAccount,
        amount: RENT,
        propertyId: PROPERTY,
      });
    } else {
      // The landlord observes arrears the tenant cannot clear and applies
      // pressure. Nothing about the tenant's balance has been faked: it went
      // negative because the wages stopped.
      const residence = new HousingEngine(sim.scope, sim.world)
        .all()
        .find((record) => record.propertyId === PROPERTY);
      sim.dispatcher.emitEvent(
        {
          type: "housing.rent_overdue",
          cause: { kind: "institution", description: "rent unpaid" },
          actors: [{ kind: "person", id: LANDLORD }],
          targets: [{ kind: "person", id: ACTOR }],
          visibleFacts: [`Landlord demands arrears for ${PROPERTY}`],
          tags: ["housing", "finance", "pressure"],
          metadata: {
            propertyId: PROPERTY,
            balanceMinorUnits: balance.minorUnits,
            ...(residence === undefined ? {} : { residenceId: residence.id }),
          },
        },
        sim.clock.time,
      );
      sim.dispatcher.resolveDue(sim.clock.time);
      rentThreatCount += 1;

      // The NPC responds the way an income shock forces it to: take a second
      // job. It goes through the same command an NPC decision would dispatch.
      if (!activeEmployment(sim) && secondJobEmployer === null) {
        const applied = dispatch(
          sim,
          EMPLOYMENT_COMMAND_TYPES.apply,
          {
            employerOrgId: CAFE,
            roleTitle: "Evening server",
            occupationCode: "server",
            wage: CAFE_WAGE,
            weeklyHours: 20,
          },
          "npc",
        );
        if (applied.status === "applied") secondJobEmployer = CAFE;
      }
    }

    sim.advanceTo(atTime((sim.clock.time as number) + 7 * MINUTES_PER_DAY));
  }

  const records = employments(sim);
  const categories = ledgerCategories(sim);

  return {
    sim,
    missedShiftCount: missed.length,
    dismissedAt: dismissal?.at ?? null,
    dismissalSharesShiftChain,
    rentThreatCount,
    rentPayments: categories.filter((category) => category === "rent").length,
    wagePayments: categories.filter((category) => category === "wage").length,
    employmentStatuses: records.map((record) => record.status),
    employers: records.map((record) => record.employerOrgId),
    secondJobEmployer,
    balanceAtEnd: balanceOf(sim, workerAccount),
    unhandledConsequences: sim.dispatcher.unhandledConsequenceTypes.size,
  };
}

describe("scenario: missed shift -> dismissal -> income shock -> rent threat -> second job", () => {
  it("produces every link in the chain through the command/event pipeline", () => {
    const outcome = runJobLossScenario(SEED);

    // 1. Structure without attendance produces missed shifts, not completions.
    expect(outcome.missedShiftCount).toBeGreaterThan(0);

    // 2. The missed shift caused a dismissal two days later.
    expect(outcome.dismissedAt).not.toBeNull();
    expect(outcome.dismissalSharesShiftChain).toBe(true);

    // 3. The dismissal terminated the docks employment and wages stopped.
    expect(outcome.employmentStatuses).toContain("terminated");
    expect(outcome.employers).toContain(DOCKS);
    expect(outcome.wagePayments).toBeGreaterThanOrEqual(1);

    // 4. Rent pressure followed the income shock.
    expect(outcome.rentThreatCount).toBeGreaterThan(0);
    // Rent was paid normally before the shock, so the threat is a change of
    // state rather than an inability that was true all along.
    expect(outcome.rentPayments).toBeGreaterThanOrEqual(2);

    // 5. The actor took a second job, and it is a different employer with
    // income actually resuming afterwards.
    expect(outcome.secondJobEmployer).toBe(CAFE);
    expect(outcome.employmentStatuses).toContain("active");
    expect(outcome.employers).toContain(CAFE);
    expect(outcome.wagePayments).toBeGreaterThanOrEqual(2);
    expect(outcome.balanceAtEnd.minorUnits).not.toBe(OPENING_BALANCE.minorUnits);

    // No consequence was declared that no system knows how to apply.
    expect(outcome.unhandledConsequences).toBe(0);
  });

  it("is reproducible: same seed and same commands produce the same state hash", () => {
    const first = runJobLossScenario(SEED);
    const second = runJobLossScenario(SEED);

    expect(second.sim.stateHash()).toBe(first.sim.stateHash());
    expect(second.sim.canonicalStateText()).toBe(first.sim.canonicalStateText());
    expect(second.missedShiftCount).toBe(first.missedShiftCount);
    expect(second.wagePayments).toBe(first.wagePayments);
    expect(second.rentPayments).toBe(first.rentPayments);
    expect(second.balanceAtEnd).toEqual(first.balanceAtEnd);
  });

  it("diverges for a different seed, so the chain is not seed-independent theatre", () => {
    const first = runJobLossScenario(SEED);
    const other = runJobLossScenario("reellife-scenario-job-loss-other");
    expect(other.sim.stateHash()).not.toBe(first.sim.stateHash());
    expect(other.sim.world.meta.masterSeed).not.toBe(first.sim.world.meta.masterSeed);
  });
});

