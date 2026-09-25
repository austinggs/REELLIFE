import { describe, expect, it } from "vitest";
import { RngRegistry } from "../../src/engine/rng/streams.ts";
import {
  ResolutionError,
  selectByWeight,
  totalEligibleWeight,
} from "../../src/engine/primitives/resolution.ts";
import { resolveScenario } from "../../src/engine/rng/resolve.ts";
import { atTime } from "../../src/engine/primitives/time.ts";

const seed = "master-seed-0001";
const stream = (path: string) => new RngRegistry(seed).stream(path);

describe("scenario resolution (System 03)", () => {
  it("separates eligibility from probability", () => {
    expect(
      totalEligibleWeight([
        { id: "a", weight: 3, eligible: true },
        { id: "b", weight: 100, eligible: false, ineligibleReason: "not qualified" },
      ]),
    ).toBe(3);
  });

  it("refuses an all-zero eligible set instead of silently picking one", () => {
    expect(() =>
      selectByWeight([{ id: "a", weight: 0, eligible: true }], stream("zero").nextFloat()),
    ).toThrow(ResolutionError);
  });

  it("validates the roll range", () => {
    expect(() => selectByWeight([{ id: "a", weight: 1, eligible: true }], 1)).toThrow(/Roll must be/);
    expect(() => selectByWeight([{ id: "a", weight: 1, eligible: true }], -0.1)).toThrow(/Roll must be/);
  });

  it("selects the last eligible candidate for the remainder of the range", () => {
    const candidates = [
      { id: "a", weight: 1, eligible: true },
      { id: "b", weight: 1, eligible: true },
    ];
    expect(selectByWeight(candidates, 0)?.id).toBe("a");
    expect(selectByWeight(candidates, 0.999_999)?.id).toBe("b");
  });

  it("consumes no randomness when a scenario is not applicable", () => {
    const control = stream("applicable");
    const subject = stream("applicable");

    const resolution = resolveScenario(subject, {
      purpose: "test",
      at: atTime(0),
      applicable: false,
      notApplicableReason: "guard clause",
      candidates: [{ id: "a", weight: 1, eligible: true }],
    });

    expect(resolution.outcomeKind).toBe("not-applicable");
    // An untouched stream and the guarded stream must still agree, proving that
    // adding a guard clause to content cannot shift unrelated outcomes.
    expect(subject.nextUint32()).toBe(control.nextUint32());
  });

  it("records the selected candidate and its RNG audit trail", () => {
    const resolution = resolveScenario(stream("selected"), {
      purpose: "job application",
      at: atTime(100),
      applicable: true,
      candidates: [
        { id: "hired", weight: 1, eligible: true },
        { id: "rejected", weight: 1, eligible: true },
      ],
    });
    expect(resolution.outcomeKind).toBe("selected");
    expect(["hired", "rejected"]).toContain(resolution.selectedCandidateId);
    expect(resolution.rng?.stream).toBe("selected");
    expect(resolution.rng?.roll).toBeGreaterThanOrEqual(0);
  });

  it("reports an empty candidate set explicitly", () => {
    const resolution = resolveScenario(stream("empty"), {
      purpose: "vacancy",
      at: atTime(0),
      applicable: true,
      candidates: [],
    });
    expect(resolution.outcomeKind).toBe("empty-candidate-set");
    expect(resolution.selectedCandidateId).toBeUndefined();
  });

  it("reports no eligible candidate distinctly from an empty set", () => {
    const resolution = resolveScenario(stream("ineligible"), {
      purpose: "promotion",
      at: atTime(0),
      applicable: true,
      candidates: [{ id: "promoted", weight: 1, eligible: false, ineligibleReason: "too junior" }],
    });
    expect(resolution.outcomeKind).toBe("no-eligible-candidate");
  });

  it("is reproducible for a given stream state", () => {
    const run = () =>
      resolveScenario(stream("replay"), {
        purpose: "outcome",
        at: atTime(7),
        applicable: true,
        candidates: [
          { id: "a", weight: 0.2, eligible: true },
          { id: "b", weight: 0.5, eligible: true },
          { id: "c", weight: 0.3, eligible: true },
        ],
      }).selectedCandidateId;
    expect(run()).toBe(run());
  });
});
