/**
 * System 40 — legal identity: administrative records, corrections, access.
 *
 * A record is an institutional representation of a person (law 5), so records
 * can be corrected and revoked without touching the person themselves.
 */

import { describe, expect, it } from "vitest";
import { createKernelSimulation } from "../../src/engine/kernel/bootstrap.ts";
import { LegalIdentityEngine } from "../../src/engine/legalIdentity/engine.ts";
import { asEntityId } from "../../src/engine/primitives/ids.ts";
import { atTime } from "../../src/engine/primitives/time.ts";
import type { Simulation } from "../../src/engine/core/simulation.ts";

const SEED = "reellife-legal-identity-seed";
const PERSON = asEntityId<"person">("PER-000001");
const STRANGER = asEntityId<"person">("PER-000002");

function newWorld(): Simulation {
  return createKernelSimulation({ masterSeed: SEED, checkInvariants: true });
}

function withLegal<T>(sim: Simulation, fn: (engine: LegalIdentityEngine) => T): T {
  let result: T = undefined as T;
  sim.guard.mutate("legalIdentity", () => {
    result = fn(new LegalIdentityEngine(sim.scope, sim.world));
  });
  return result;
}

describe("legal identity engine (System 40)", () => {
  it("issues records with authority, identifier and status", () => {
    const sim = newWorld();
    const record = withLegal(sim, (engine) =>
      engine.issue(
        sim.ids,
        {
          type: "birthRegistration",
          subject: PERSON,
          authority: "AURELIA_CIVIL_REGISTRY",
          identifier: "AUR-CITYARDEN-000001",
        },
        sim.clock.time,
      ),
    );
    expect(String(record.id)).toMatch(/^REC-/);
    expect(record.status).toBe("valid");
    expect(record.access).toBe("authority");

    withLegal(sim, (engine) => {
      expect(engine.recordsFor(PERSON)).toHaveLength(1);
      expect(engine.ofType(PERSON, "birthRegistration")).toHaveLength(1);
      expect(engine.ofType(PERSON, "nationalId")).toHaveLength(0);
      expect(engine.recordsFor(STRANGER)).toHaveLength(0);
      expect(engine.isValidAt(record, sim.clock.time)).toBe(true);
    });
  });

  it("appends corrections instead of overwriting the recorded past", () => {
    const sim = newWorld();
    const record = withLegal(sim, (engine) =>
      engine.issue(
        sim.ids,
        { type: "birthRegistration", subject: PERSON, authority: "AURELIA_CIVIL_REGISTRY", identifier: "WRONG" },
        sim.clock.time,
      ),
    );
    const corrected = withLegal(sim, (engine) =>
      engine.correct(record.id, "identifier", "RIGHT", sim.clock.time, "clerical error"),
    );
    // The record now carries the corrected value; the old one survives as history.
    expect(corrected.identifier).toBe("RIGHT");
    expect(corrected.corrections).toHaveLength(1);
    expect(corrected.corrections[0]).toMatchObject({
      field: "identifier",
      previous: "WRONG",
      current: "RIGHT",
      reason: "clerical error",
    });
    expect(() =>
      withLegal(sim, (engine) => engine.correct("REC-999999", "identifier", "X", sim.clock.time)),
    ).toThrow(/unknown record/);
  });

  it("revocation records status history and invalidates the record", () => {
    const sim = newWorld();
    const record = withLegal(sim, (engine) =>
      engine.issue(
        sim.ids,
        { type: "nationalId", subject: PERSON, authority: "AURELIA_CIVIL_REGISTRY" },
        sim.clock.time,
      ),
    );
    const revoked = withLegal(sim, (engine) => engine.setStatus(record.id, "revoked", sim.clock.time));
    expect(revoked.status).toBe("revoked");
    expect(revoked.corrections[0]).toMatchObject({ field: "status", previous: "valid", current: "revoked" });
    expect(withLegal(sim, (engine) => engine.isValidAt(revoked, sim.clock.time))).toBe(false);
  });

  it("expiry and access rules are enforced", () => {
    const sim = newWorld();
    const now = sim.clock.time;
    const [permit, publicRecord] = withLegal(sim, (engine) => [
      engine.issue(
        sim.ids,
        { type: "permit", subject: PERSON, authority: "CITY-ARDEN", validUntil: atTime((now as number) + 60) },
        now,
      ),
      engine.issue(
        sim.ids,
        { type: "birthRegistration", subject: PERSON, authority: "AURELIA_CIVIL_REGISTRY", access: "public" },
        now,
      ),
    ]);
    withLegal(sim, (engine) => {
      expect(engine.isValidAt(permit, now)).toBe(true);
      expect(engine.isValidAt(permit, atTime((now as number) + 61))).toBe(false);
      // authority-gated: subject yes, stranger only with authority.
      const subjectOnly = engine.get(permit.id);
      if (!subjectOnly) throw new Error("record missing");
      expect(engine.canAccess(subjectOnly, PERSON, false)).toBe(true);
      expect(engine.canAccess(subjectOnly, STRANGER, false)).toBe(false);
      expect(engine.canAccess(subjectOnly, STRANGER, true)).toBe(true);
      expect(engine.canAccess(publicRecord, STRANGER, false)).toBe(true);
    });
  });
});
