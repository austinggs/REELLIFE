/**
 * System 48 — security & legal pipeline: detection that is allowed to fail, a
 * case that cannot exist without a report, charges that must name a real rule in
 * the right jurisdiction, evidence that cuts both ways, penalties that exist
 * only on a conviction, and appeals that vacate rather than erase.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { MissingWriterContextError, OwnershipViolationError } from "../../src/engine/core/access.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";
import { LawsEngine } from "../../src/engine/laws/engine.ts";
import { SecurityEngine } from "../../src/engine/security/engine.ts";
import type { DetectionConditions } from "../../src/engine/security/types.ts";
import { IdAllocator } from "../../src/engine/primitives/ids.ts";
import type { WorldTime } from "../../src/engine/primitives/time.ts";
import type { RandomSource } from "../../src/engine/rng/distributions.ts";
import { RngRegistry } from "../../src/engine/rng/streams.ts";
import { registerAureliaLaws } from "../../src/content/aurelia/laws.ts";
import { M2_SETTLEMENT_ID } from "../../src/content/aurelia/geography.ts";

const SEED = "reellife-security-seed";
const ARDIN = "COUNTRY-ARDIN";
const MILL_LICENCE = "RULE-ARDIN-MILL-LICENCE";
const STEVEDORE = "RULE-ARDIN-STEVEDORE-CERT";
const SUSPECT = "PERSON-SUSPECT";
let T0: WorldTime;

/** Everything and someone in the right place to notice. */
const EASY: DetectionConditions = {
  witnesses: 1,
  physicalEvidence: 1,
  institutionalCapacity: 1,
  jurisdictionReach: 1,
  concealment: 0,
  misinformation: 0,
};

/** Nobody saw, nothing was left behind, and someone had already said otherwise. */
const UNNOTICEABLE: DetectionConditions = {
  witnesses: 0,
  physicalEvidence: 0,
  institutionalCapacity: 0.1,
  jurisdictionReach: 0,
  concealment: 1,
  misinformation: 1,
};

function newWorld(): Simulation {
  const sim = createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
  T0 = sim.clock.time;
  sim.guard.mutate("laws", () => {
    registerAureliaLaws(new LawsEngine(sim.scope, sim.world), sim.clock.time);
  });
  return sim;
}

function withSecurity<T>(
  sim: Simulation,
  fn: (engine: SecurityEngine, ids: IdAllocator) => T,
  random?: RandomSource,
): T {
  let result: T = undefined as T;
  sim.guard.mutate("security", () => {
    const laws = new LawsEngine(sim.scope, sim.world);
    const engine =
      random === undefined
        ? new SecurityEngine(sim.scope, sim.world, laws)
        : new SecurityEngine(sim.scope, sim.world, laws, random);
    result = fn(engine, new IdAllocator());
  });
  return result;
}

/** An incident that was noticed, and a case open on it. */
function openedCase(engine: SecurityEngine, ids: IdAllocator, at: WorldTime) {
  engine.recordIncident(
    {
      id: "INC-THEFT-1",
      locationId: M2_SETTLEMENT_ID,
      kind: "theft",
      summary: "grain sacks taken from the mill floor",
      severity: 0.6,
    },
    at,
    ids,
  );
  engine.recordDetection("INC-THEFT-1", EASY, at, ids, "PERSON-WITNESS");
  return engine.openCase(
    { incidentId: "INC-THEFT-1", jurisdictionId: ARDIN, suspectIds: [SUSPECT] },
    at,
    ids,
  );
}

describe("security and legal pipeline (System 48)", () => {
  it("makes an incident something that has not yet been noticed", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        engine.recordIncident(
          {
            id: "INC-1",
            locationId: M2_SETTLEMENT_ID,
            kind: "theft",
            summary: "a sack is gone",
            severity: 0.3,
          },
          T0,
          ids,
        );
        // No detection, so no case: a report has to come from somewhere, and
        // here there is nowhere it came from.
        expect(engine.detectionOf("INC-1")).toBeUndefined();
        expect(engine.isDetected("INC-1")).toBe(false);
        expect(() =>
          engine.openCase({ incidentId: "INC-1", jurisdictionId: ARDIN, suspectIds: [] }, T0, ids),
        ).toThrow(/has not been detected/);
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("lets detection fail, and keeps the record that nothing was noticed", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        engine.recordIncident(
          {
            id: "INC-1",
            locationId: M2_SETTLEMENT_ID,
            kind: "theft",
            summary: "a sack is gone and nobody saw it",
            severity: 0.3,
          },
          T0,
          ids,
        );
        const detection = engine.recordDetection("INC-1", UNNOTICEABLE, T0, ids);
        expect(detection.probability).toBe(0);
        expect(detection.detected).toBe(false);
        expect(detection.note).toMatch(/no case follows/);
        // The incident stays on the record. It happened; it was simply never
        // found out, and the world should not look as though it did not.
        expect(engine.incident("INC-1")).toBeDefined();
        expect(engine.history().some((entry) => entry.kind === "undetected")).toBe(true);
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("weights the detection factors and names every one of them", () => {
    const sim = newWorld();
    withSecurity(sim, (engine) => {
      expect(engine.assessDetection(EASY)).toMatchObject({ probability: 0.8 });
      expect(engine.assessDetection(UNNOTICEABLE)).toMatchObject({ probability: 0 });
      const factors = engine.assessDetection(EASY).factors;
      expect(factors).toHaveLength(6);
      expect(factors.join(" ")).toContain("witnesses=1.00");

      // Losing a witness costs exactly what one witness is worth.
      expect(engine.assessDetection({ ...EASY, witnesses: 0 }).probability).toBe(0.55);
      // Concealment subtracts rather than multiplying, so it can take detection to
      // nothing without erasing the other factors.
      expect(engine.assessDetection({ ...EASY, concealment: 1 }).probability).toBe(0.65);
      expect(() => engine.assessDetection({ ...EASY, witnesses: 4 })).toThrow(/must be 0\.\.1/);
    });
  });

  it("refuses to roll a detection without an injected source", () => {
    const sim = newWorld();
    withSecurity(sim, (engine, ids) => {
      engine.recordIncident(
        {
          id: "INC-1",
          locationId: M2_SETTLEMENT_ID,
          kind: "theft",
          summary: "a sack is gone",
          severity: 0.3,
        },
        T0,
        ids,
      );
      expect(() => engine.recordDetection("INC-1", EASY, T0, ids)).toThrow(
        /no RandomSource was injected/,
      );
    });
  });

  it("will not charge someone who is not a suspect, or under a rule from elsewhere", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        expect(() =>
          engine.fileCharge(
            { caseId: record.id, suspectId: "PERSON-NOBODY", ruleId: STEVEDORE },
            T0,
            ids,
          ),
        ).toThrow(/is not a suspect on case/);

        // A case heard elsewhere cannot borrow Arin's rule: the rule governs the
        // jurisdiction it names, and that check happens before anything is filed.
        const foreign = engine.openCase(
          { incidentId: "INC-THEFT-1", jurisdictionId: "COUNTRY-OTHERLAND", suspectIds: [SUSPECT] },
          T0,
          ids,
        );
        expect(() =>
          engine.fileCharge({ caseId: foreign.id, suspectId: SUSPECT, ruleId: STEVEDORE }, T0, ids),
        ).toThrow(/governs COUNTRY-ARDIN but case .* is being heard in COUNTRY-OTHERLAND/);
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("quotes the rule's declared sanctions without applying a single one", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        expect(charge.ruleId).toBe(MILL_LICENCE);
        expect(charge.action).toBe("operate_mill");
        expect(charge.jurisdictionId).toBe(ARDIN);
        expect(charge.declaredSanctions.length).toBeGreaterThan(0);
        // The rule says what a breach would carry. Nothing has been levied.
        expect(engine.penalties()).toEqual([]);
        expect(engine.case(record.id)?.stage).toBe("charged");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("keeps evidence that was gathered without authority out of the balance", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "document",
            stance: "supports_accusation",
            weight: 0.9,
            collectedBy: "PERSON-INVESTIGATOR",
            admissible: false,
            integrity: 1,
            description: "a ledger page taken without a warrant",
          },
          T0,
          ids,
        );
        const reading = engine.caseReading(record.id);
        expect(reading.evidenceCount).toBe(1);
        expect(reading.forAccusation).toBe(0);
        expect(reading.factors.join(" ")).toContain("inadmissible=1");

        // A charge with nothing admissible is dismissed, and dismissed is not
        // the same as acquitted: nobody was tried, nobody was cleared.
        const preview = engine.adjudicationPreview(record.id, [charge.id]);
        expect(preview.outcome).toBe("dismissed");
        expect(preview.rationale).toMatch(/below the 0.4 needed/);
        const { penalties } = engine.adjudicate(record.id, [charge.id], "PERSON-JUDGE", T0, ids);
        expect(penalties).toEqual([]);
        expect(engine.hearingFor(record.id)?.outcome).toBe("dismissed");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("lets the defence acquit, so a false accusation is reachable rather than unlikely", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "circumstantial",
            stance: "supports_accusation",
            weight: 0.3,
            collectedBy: "PERSON-INVESTIGATOR",
            admissible: true,
            integrity: 1,
            description: "the suspect was seen nearby",
          },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "expert",
            stance: "supports_defense",
            weight: 0.8,
            collectedBy: "PERSON-EXPERT",
            admissible: true,
            integrity: 1,
            description: "the tally shows the loss was entered before the break-in",
          },
          T0,
          ids,
        );
        const reading = engine.caseReading(record.id);
        expect(reading.net).toBe(-0.5);

        const { hearing, penalties } = engine.adjudicate(
          record.id,
          [charge.id],
          "PERSON-JUDGE",
          T0,
          ids,
        );
        expect(hearing.outcome).toBe("acquitted");
        expect(hearing.rationale).toMatch(/favours the defence/);
        expect(penalties).toEqual([]);
        expect(engine.penalties()).toEqual([]);
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("applies exactly the declared sanctions on a conviction, and no more", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "physical",
            stance: "supports_accusation",
            weight: 0.7,
            collectedBy: "PERSON-INVESTIGATOR",
            admissible: true,
            integrity: 1,
            description: "the mill's own tally, short by exactly one sack",
          },
          T0,
          ids,
        );
        const { hearing, penalties } = engine.adjudicate(
          record.id,
          [charge.id],
          "PERSON-JUDGE",
          T0,
          ids,
        );
        expect(hearing.outcome).toBe("convicted");
        // One penalty per declared sanction, carrying the sanction as the rule
        // wrote it — no invention, no uplift, nothing the rule did not say.
        expect(penalties).toHaveLength(charge.declaredSanctions.length);
        expect(penalties.map((p) => p.sanction)).toEqual(charge.declaredSanctions);
        expect(penalties.every((p) => p.status === "applied")).toBe(true);
        expect(engine.case(record.id)?.stage).toBe("adjudicated");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("halves degraded evidence, and says that it did", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "physical",
            stance: "supports_accusation",
            weight: 0.8,
            collectedBy: "PERSON-INVESTIGATOR",
            admissible: true,
            integrity: 0.2,
            description: "a sack found after the yard had been swept",
          },
          T0,
          ids,
        );
        const reading = engine.caseReading(record.id);
        // 0.8 of evidence held at a third of its worth still counts for 0.4.
        expect(reading.forAccusation).toBe(0.4);
        expect(reading.degradedCount).toBe(1);
        expect(reading.factors.join(" ")).toContain("degraded=1");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("vacates a penalty on a successful appeal without erasing that it was levied", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "testimony",
            stance: "supports_accusation",
            weight: 0.9,
            collectedBy: "PERSON-WITNESS",
            admissible: true,
            integrity: 1,
            description: "a dockhand says he saw the sack carried out",
          },
          T0,
          ids,
        );
        engine.adjudicate(record.id, [charge.id], "PERSON-JUDGE", T0, ids);
        expect(engine.penaltiesOf(record.id)[0]?.status).toBe("applied");

        const appeal = engine.fileAppeal(record.id, "the witness was not present", T0, ids);
        expect(engine.case(record.id)?.stage).toBe("appealed");
        const resolved = engine.resolveAppeal(appeal.id, "overturned", T0, ids);
        expect(resolved.result).toBe("overturned");

        const vacated = engine.penaltiesOf(record.id)[0]!;
        expect(vacated.status).toBe("vacated");
        expect(vacated.vacatedReason).toMatch(/witness was not present/);
        // Still on the record: it was levied, and then undone. Both are history.
        // (The mill licence declares two sanctions, so a conviction levied two.)
        expect(engine.penalties()).toHaveLength(charge.declaredSanctions.length);
        expect(
          engine.penaltiesOf(record.id).every((penalty) => penalty.status === "vacated"),
        ).toBe(true);
        expect(engine.case(record.id)?.stage).toBe("closed");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("leaves a penalty standing when the appeal is upheld", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        engine.assignInvestigator(record.id, "PERSON-INVESTIGATOR");
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: STEVEDORE },
          T0,
          ids,
        );
        engine.collectEvidence(
          {
            caseId: record.id,
            kind: "document",
            stance: "supports_accusation",
            weight: 0.6,
            collectedBy: "PERSON-INVESTIGATOR",
            admissible: true,
            integrity: 1,
            description: "the certification register shows no entry for the suspect",
          },
          T0,
          ids,
        );
        engine.adjudicate(record.id, [charge.id], "PERSON-JUDGE", T0, ids);
        const appeal = engine.fileAppeal(record.id, "the register is incomplete", T0, ids);
        engine.resolveAppeal(appeal.id, "upheld", T0, ids);
        expect(engine.penaltiesOf(record.id)[0]?.status).toBe("applied");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("treats organized crime as a reference to an organization, not a second one", () => {
    const sim = newWorld();
    withSecurity(
      sim,
      (engine, ids) => {
        engine.recordIncident(
          {
            id: "INC-SMUGGLE",
            locationId: M2_SETTLEMENT_ID,
            kind: "smuggling",
            summary: "unmanifested sacks moved off the quay after dark",
            severity: 0.7,
            organizationId: "ORG-ARDIN-DOCKS",
            marketId: "MARKET-ARDEN-QUAY",
          },
          T0,
          ids,
        );
        // The operation names incidents that exist; it will not invent them.
        expect(() =>
          engine.startOperation(
            { organizationId: "ORG-SUSPECT-GANG", kind: "smuggling", incidentIds: ["INC-NOPE"] },
            T0,
            ids,
          ),
        ).toThrow(/unknown incident/);

        const operation = engine.startOperation(
          { organizationId: "ORG-SUSPECT-GANG", kind: "smuggling", incidentIds: ["INC-SMUGGLE"] },
          T0,
          ids,
        );
        expect(operation.status).toBe("active");
        expect(engine.operationsOf("ORG-SUSPECT-GANG")).toHaveLength(1);
        expect(
          engine.setOperationStatus(operation.id, "disrupted", "a run was turned back").status,
        ).toBe("disrupted");
        // The organization itself is System 32's; nothing here duplicates it.
        expect(operation.organizationId).toBe("ORG-SUSPECT-GANG");
      },
      new RngRegistry(SEED).stream("security"),
    );
  });

  it("records the whole pipeline in its history, and refuses a foreign writer", () => {
    const sim = newWorld();
    const caseId = withSecurity(
      sim,
      (engine, ids) => {
        const record = openedCase(engine, ids, T0);
        const charge = engine.fileCharge(
          { caseId: record.id, suspectId: SUSPECT, ruleId: MILL_LICENCE },
          T0,
          ids,
        );
        engine.adjudicate(record.id, [charge.id], "PERSON-JUDGE", T0, ids);
        const kinds = engine.history().map((entry) => entry.kind);
        expect(kinds).toContain("incident");
        expect(kinds).toContain("detected");
        expect(kinds).toContain("case_opened");
        expect(kinds).toContain("charge_filed");
        expect(kinds).toContain("adjudicated");
        return record.id;
      },
      new RngRegistry(SEED).stream("security"),
    );

    // A reader outside a writer context may read the record but not add to it.
    const laws = new LawsEngine(sim.scope, sim.world);
    const reader = new SecurityEngine(sim.scope, sim.world, laws);
    expect(reader.cases()).toHaveLength(1);
    expect(() =>
      reader.openCase(
        { incidentId: "INC-THEFT-1", jurisdictionId: ARDIN, suspectIds: [] },
        T0,
        new IdAllocator(),
      ),
    ).toThrow(MissingWriterContextError);

    // And another system's context cannot reach in and write it either.
    expect(() =>
      sim.guard.mutate("laws", () => {
        new SecurityEngine(sim.scope, sim.world, laws).recordIncident(
          {
            id: "INC-FROM-LAWS",
            locationId: M2_SETTLEMENT_ID,
            kind: "vandalism",
            summary: "a gate prised off its hinges",
            severity: 0.4,
          },
          T0,
          new IdAllocator(),
        );
      }),
    ).toThrow(OwnershipViolationError);
    expect(sim.guard.recordedViolations.length).toBeGreaterThan(0);
    expect(caseId).toMatch(/^case-/);
  });
});
