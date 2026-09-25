import { describe, expect, it } from "vitest";
import { SkillsEngine, isMastered } from "../../src/engine/skills/engine.ts";
import type {
  PerformanceContext,
  PersonSkillState,
  SkillDefinition,
} from "../../src/engine/skills/types.ts";
import { Prng } from "../../src/engine/rng/prng.ts";
import { IdAllocator, type EntityId } from "../../src/engine/primitives/ids.ts";
import { atTime, MINUTES_PER_DAY } from "../../src/engine/primitives/time.ts";
import { permissiveScope } from "../../src/engine/core/access.ts";
import { createWorldState } from "../../src/engine/core/worldState.ts";

function makeWorld() {
  return createWorldState({
    worldId: "test",
    worldName: "test",
    createdAtLabel: "t",
    startTime: atTime(0),
    masterSeed: "test",
    mode: "standard",
    difficulty: "standard",
    schemaVersion: 1,
    simulationVersion: 1,
    contentVersion: "1",
    rngVersion: 1,
    config: {} as never,
    idAllocator: { counters: {} },
  });
}

const COOKING: SkillDefinition = {
  id: "cooking",
  name: "Cooking",
  domain: "domestic",
  subskillIds: ["baking"],
  prerequisites: [],
  relatedSkills: [
    { skillId: "baking", transferability: 0.8 },
    { skillId: "knife-work", transferability: 0.4 },
  ],
  learningMethods: ["practice", "employment", "hobby", "experimentation", "education"],
  decayRatePerDay: 0.01,
  masteryThreshold: 0.8,
  certificationLinks: ["cert-culinary-arts"],
};

const BAKING: SkillDefinition = {
  id: "baking",
  name: "Baking",
  domain: "domestic",
  parentId: "cooking",
  subskillIds: [],
  prerequisites: ["cooking"],
  relatedSkills: [{ skillId: "cooking", transferability: 0.7 }],
  learningMethods: ["practice", "apprenticeship", "hobby"],
  decayRatePerDay: 0.012,
  masteryThreshold: 0.8,
  certificationLinks: [],
};

const KNIFE_WORK: SkillDefinition = {
  id: "knife-work",
  name: "Knife Work",
  domain: "craft",
  subskillIds: [],
  prerequisites: [],
  relatedSkills: [],
  learningMethods: ["practice", "employment", "apprenticeship"],
  decayRatePerDay: 0.015,
  masteryThreshold: 0.85,
  certificationLinks: [],
};

function makeEngine(): SkillsEngine {
  const engine = new SkillsEngine(permissiveScope(), makeWorld());
  engine.registerDefinition(COOKING);
  engine.registerDefinition(BAKING);
  engine.registerDefinition(KNIFE_WORK);
  return engine;
}

function makePerson(engine: SkillsEngine, ids: IdAllocator): EntityId<"person"> {
  const personId = ids.next("person");
  engine.registerPerson(personId);
  return personId;
}

const IDEAL: PerformanceContext = {
  difficulty: 0.2,
  healthFactor: 1,
  mentalFactor: 1,
  fatigue: 0,
  equipmentQuality: 1,
  preparation: 1,
  environment: 1,
  specialtyFit: 0,
  uncertainty: 0.2,
};

describe("skills & competence (System 14)", () => {
  it("registers a person with an empty skill portfolio", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);

    const pss = engine.getPerson(personId)!;
    expect(pss.skills).toHaveLength(0);
    expect(engine.getSkill(personId, "cooking")).toBeUndefined();
    expect(engine.effectivePerformance(personId, "cooking", IDEAL)).toBe(0);
  });

  it("practice raises proficiency with diminishing returns", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);

    const first = engine.practice(personId, "cooking", 1, "practice", atTime(0));
    const second = engine.practice(personId, "cooking", 1, "practice", atTime(60));

    expect(first.practicalAfter).toBeGreaterThan(0);
    expect(second.practicalAfter - second.practicalBefore).toBeLessThan(
      first.practicalAfter - first.practicalBefore,
    );
  });

  it("experience accumulates as hours, distinct from proficiency", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);

    engine.practice(personId, "cooking", 10, "employment", atTime(0));

    const skill = engine.getSkill(personId, "cooking")!;
    expect(skill.experienceHours).toBe(10);
    expect(skill.practical).toBeGreaterThan(skill.theoretical);
    expect(skill.practical).toBeLessThan(1);
  });

  it("learning methods weight practical vs theoretical differently", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const doer = makePerson(engine, ids);
    const reader = makePerson(engine, ids);

    engine.practice(doer, "cooking", 5, "practice", atTime(0));
    engine.practice(reader, "cooking", 5, "reading", atTime(0));

    const doerSkill = engine.getSkill(doer, "cooking")!;
    const readerSkill = engine.getSkill(reader, "cooking")!;
    expect(doerSkill.practical).toBeGreaterThan(readerSkill.practical);
    expect(readerSkill.theoretical).toBeGreaterThan(doerSkill.theoretical);
  });

  it("aptitude accelerates learning without replacing practice", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const gifted = makePerson(engine, ids);
    const average = makePerson(engine, ids);

    engine.practice(gifted, "cooking", 5, "practice", atTime(0), { aptitude: 1 });
    engine.practice(average, "cooking", 5, "practice", atTime(0), { aptitude: 0.5 });

    const giftedSkill = engine.getSkill(gifted, "cooking")!;
    const averageSkill = engine.getSkill(average, "cooking")!;
    expect(giftedSkill.practical).toBeGreaterThan(averageSkill.practical);
  });

  it("practicing one skill transfers into related skills", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);

    const result = engine.practice(personId, "cooking", 10, "practice", atTime(0));

    const baking = engine.getSkill(personId, "baking")!;
    expect(baking.practical).toBeGreaterThan(0);
    expect(result.transferred.map((t) => t.skillId)).toContain("baking");
    // Baking gained ground without any direct practice hours.
    expect(baking.experienceHours).toBe(0);
  });

  it("skills decay gradually without practice — capability fastest, familiarity slowest", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);
    // Employment method keeps practical at 0.64 — below the 0.8 mastery threshold.
    engine.practice(personId, "cooking", 10, "employment", atTime(0));
    const before = engine.getSkill(personId, "cooking")!;

    engine.tick(personId, MINUTES_PER_DAY * 30);
    const after = engine.getSkill(personId, "cooking")!;

    expect(after.practical).toBeLessThan(before.practical);
    expect(before.practical - after.practical).toBeCloseTo(0.3, 5);
    // Theoretical and familiarity decay at fractions of the practical rate.
    expect(before.theoretical - after.theoretical).toBeLessThan(before.practical - after.practical);
    expect(after.familiarity).toBeGreaterThan(after.theoretical);
    // Experience never decays.
    expect(after.experienceHours).toBe(10);
    // Reliability erodes faster than capability.
    expect(after.reliability).toBeLessThan(before.reliability);
  });

  it("relearning below the peak is faster than first learning", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const rusted = makePerson(engine, ids);
    const novice = makePerson(engine, ids);

    // Rusted: reached a peak, then decayed below it.
    engine.practice(rusted, "cooking", 5, "practice", atTime(0));
    engine.tick(rusted, MINUTES_PER_DAY * 30);
    const rustedBefore = engine.getSkill(rusted, "cooking")!;

    const relearn = engine.practice(rusted, "cooking", 1, "practice", atTime(MINUTES_PER_DAY * 30 + 1));
    const learn = engine.practice(novice, "cooking", 1, "practice", atTime(0));

    expect(rustedBefore.practical).toBeLessThan(rustedBefore.peakPractical);
    expect(relearn.practicalAfter - relearn.practicalBefore).toBeGreaterThan(
      learn.practicalAfter - learn.practicalBefore,
    );
  });

  it("mastery is derived from the definition threshold and slows decay", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const master = makePerson(engine, ids);
    const competent = makePerson(engine, ids);

    // Drive practical above the 0.8 mastery threshold.
    engine.practice(master, "cooking", 20, "practice", atTime(0));
    const masterSkill = engine.getSkill(master, "cooking")!;
    expect(isMastered(masterSkill, engine.getDefinition("cooking"))).toBe(true);

    // 5h of practice reaches 0.4 — solid but below the 0.8 mastery threshold.
    engine.practice(competent, "cooking", 5, "practice", atTime(0));
    const competentSkill = engine.getSkill(competent, "cooking")!;
    expect(isMastered(competentSkill, engine.getDefinition("cooking"))).toBe(false);

    engine.tick(master, MINUTES_PER_DAY * 10);
    engine.tick(competent, MINUTES_PER_DAY * 10);

    const masterAfter = engine.getSkill(master, "cooking")!;
    const competentAfter = engine.getSkill(competent, "cooking")!;
    // 10 idle days: the non-master loses ~0.1, the master only ~0.05.
    expect(competentSkill.practical - competentAfter.practical).toBeGreaterThan(
      masterSkill.practical - masterAfter.practical,
    );
  });

  it("specialization deepens performance in the specialty context only", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);
    engine.practice(personId, "cooking", 10, "practice", atTime(0));

    const general = engine.effectivePerformance(personId, "cooking", IDEAL);
    const specialty: PerformanceContext = { ...IDEAL, specialtyFit: 1 };

    engine.specialize(personId, "cooking", 0.5, atTime(600));
    const afterGeneral = engine.effectivePerformance(personId, "cooking", IDEAL);
    const afterSpecialty = engine.effectivePerformance(personId, "cooking", specialty);

    // Outside the specialty context nothing changes.
    expect(afterGeneral).toBe(general);
    expect(afterSpecialty).toBeGreaterThan(general);
  });

  it("performance is contextual — fatigue, equipment and environment shape it", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);
    engine.practice(personId, "cooking", 10, "practice", atTime(0));

    const ideal = engine.effectivePerformance(personId, "cooking", IDEAL);
    const exhausted: PerformanceContext = {
      ...IDEAL,
      healthFactor: 0.2,
      mentalFactor: 0.2,
      fatigue: 0.9,
      equipmentQuality: 0.2,
      preparation: 0.1,
      environment: 0.3,
    };
    const harsh = engine.effectivePerformance(personId, "cooking", exhausted);

    expect(harsh).toBeLessThan(ideal * 0.2);

    // Same person, same skill: an easy task succeeds, a brutal one does not.
    const easy = engine.resolvePerformance(
      personId,
      "cooking",
      { ...IDEAL, difficulty: 0.1 },
      Prng.fromPath("master-seed-0001", "skills:performance"),
    );
    const brutal = engine.resolvePerformance(
      personId,
      "cooking",
      { ...IDEAL, difficulty: 0.95 },
      Prng.fromPath("master-seed-0001", "skills:performance"),
    );
    expect(easy.success).toBe(true);
    expect(brutal.success).toBe(false);
  });

  it("certification is recognition, not competence", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();
    const personId = makePerson(engine, ids);
    engine.practice(personId, "cooking", 2, "practice", atTime(0));

    const before = engine.effectivePerformance(personId, "cooking", IDEAL);

    engine.certify(personId, "cooking", {
      id: "cert-1",
      issuerOrgId: "org-culinary-institute",
      issuedAt: atTime(120),
      level: "master",
    });

    const after = engine.effectivePerformance(personId, "cooking", IDEAL);
    const skill = engine.getSkill(personId, "cooking")!;

    // The certificate is recorded, but capability and performance are untouched.
    expect(skill.certifications).toHaveLength(1);
    expect(after).toBe(before);
    expect(after).toBeLessThan(0.2);

    // A "master" certificate does not make hard tasks succeed.
    const outcome = engine.resolvePerformance(
      personId,
      "cooking",
      { ...IDEAL, difficulty: 0.9 },
      Prng.fromPath("master-seed-0001", "skills:cert"),
    );
    expect(outcome.success).toBe(false);
  });

  it("materialization continuity — seeded prior-life skills persist and decay normally", () => {
    const engine = makeEngine();
    const ids = new IdAllocator();

    const seeded: PersonSkillState = {
      skillId: "cooking",
      practical: 0.7,
      theoretical: 0.5,
      familiarity: 0.8,
      reliability: 0.6,
      experienceHours: 5000,
      specialization: 0.4,
      peakPractical: 0.8,
      lastPracticedAt: atTime(0),
      certifications: [
        { id: "cert-life", issuerOrgId: "org-navy", issuedAt: atTime(-1000), level: "journeyman" },
      ],
    };
    const personId = ids.next("person");
    engine.registerPerson(personId, [seeded]);

    const pss = engine.getPerson(personId)!;
    expect(pss.skills[0]).toEqual(seeded);

    engine.tick(personId, MINUTES_PER_DAY);
    const after = engine.getSkill(personId, "cooking")!;

    // One idle day at 0.01/day: capability erodes, history is never rewritten.
    expect(after.practical).toBeCloseTo(0.69, 5);
    expect(after.experienceHours).toBe(5000);
    expect(after.peakPractical).toBe(0.8);
    expect(after.specialization).toBe(0.4);
    expect(after.certifications).toHaveLength(1);
  });
});
