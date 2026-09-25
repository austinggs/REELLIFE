/**
 * ReelLife System 12 — Mental & Emotional State.
 *
 * Models the three distinct layers (emotion, mood, stress), grief as a staged
 * process, coping, and the separation between internal experience and outward
 * expression. This engine holds the internal experience only; appraisal inputs
 * (personality, beliefs, relationships, events) belong to other systems and
 * arrive here already interpreted, as an Emotion to add or stress to apply.
 *
 * The same event can produce different internal experiences because callers
 * supply different intensities/associations — the engine never decides meaning.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  MINUTES_PER_DAY,
  MINUTES_PER_HOUR,
  durationToMinutes,
  timeBetween,
} from "../primitives/time.ts";
import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type {
  CopingMechanism,
  Emotion,
  EmotionKind,
  GriefProcess,
  GriefStage,
  MentalState,
  MentationSystemState,
  MoodLabel,
  MoodState,
  StressState,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Data-driven tables (spec: state tracks intensity, duration, residue, recovery)
// ---------------------------------------------------------------------------

/** Hedonic valence per emotion, used only to push the mood baseline. */
export const EMOTION_VALENCE: Readonly<Record<EmotionKind, number>> = {
  joy: 0.9,
  love: 0.8,
  pride: 0.6,
  hope: 0.5,
  gratitude: 0.6,
  relief: 0.4,
  surprise: 0.0,
  sadness: -0.6,
  anger: -0.6,
  fear: -0.7,
  disgust: -0.5,
  grief: -0.9,
  guilt: -0.5,
  shame: -0.6,
  anxiety: -0.6,
  loneliness: -0.5,
} as const;

/** Grief advances by elapsed days since it began (a process, not a switch). */
export const GRIEF_STAGE_FROM_DAY: readonly { readonly stage: GriefStage; readonly fromDay: number }[] = [
  { stage: "shock", fromDay: 0 },
  { stage: "yearning", fromDay: 3 },
  { stage: "disorganization", fromDay: 21 },
  { stage: "reorganization", fromDay: 90 },
  { stage: "integration", fromDay: 365 },
] as const;

const DEFAULT_RESILIENCE = 0.5;
const DEFAULT_RECOVERY_PER_HOUR = 0.15;
const STRESS_HIGH_THRESHOLD = 0.7;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function moodLabelFromValence(valence: number): MoodLabel {
  if (valence <= -0.6) return "despondent";
  if (valence <= -0.2) return "down";
  if (valence < 0.2) return "neutral";
  if (valence < 0.6) return "content";
  return "uplifted";
}

export function resolveGriefStage(daysSinceStart: number): GriefStage {
  let stage: GriefStage = GRIEF_STAGE_FROM_DAY[0]!.stage;
  for (const entry of GRIEF_STAGE_FROM_DAY) {
    if (daysSinceStart >= entry.fromDay) stage = entry.stage;
    else break;
  }
  return stage;
}

function initialMood(now: WorldTime): MoodState {
  return { valence: 0, label: "neutral", since: now };
}

function initialStress(resilience: number): StressState {
  return {
    level: 0,
    accumulated: 0,
    pressure: 0,
    resilience: clamp01(resilience),
    recoveryPerHour: DEFAULT_RECOVERY_PER_HOUR,
  };
}

export function initialMentalState(
  personId: EntityId<"person">,
  now: WorldTime,
  resilience: number = DEFAULT_RESILIENCE,
): MentalState {
  return {
    personId,
    mood: initialMood(now),
    stress: initialStress(resilience),
    emotions: [],
    grief: [],
    coping: [],
    history: [],
  };
}

// ---------------------------------------------------------------------------
// Pure layer updates — kept side-effect free so tick() stays deterministic.
// ---------------------------------------------------------------------------

/** Ease an emotion toward its residue across its lifetime, then fade it out. */
function decayEmotion(emotion: Emotion, elapsedMinutes: number): Emotion | null {
  const lifetime = Math.max(1, emotion.durationMinutes);
  let intensity = emotion.intensity;
  if (intensity > emotion.residue) {
    const fraction = Math.min(1, elapsedMinutes / lifetime);
    intensity += (emotion.residue - intensity) * fraction;
  }
  // The residue itself fades with a half-life equal to the emotion's lifetime,
  // so a spent emotion eventually clears instead of lingering forever.
  intensity *= Math.pow(0.5, elapsedMinutes / lifetime);
  if (intensity < 0.01) return null;
  return { ...emotion, intensity };
}

/** Mood valence is the valence-weighted sum of active emotions, damped by stress. */
function computeMoodValence(
  emotions: readonly Emotion[],
  stressLevel: number,
): number {
  let sum = 0;
  for (const emotion of emotions) {
    sum += EMOTION_VALENCE[emotion.kind] * emotion.intensity;
  }
  return clamp01Signed(sum - stressLevel * 0.5);
}

function clamp01Signed(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function recoverStress(stress: StressState, elapsedMinutes: number): StressState {
  const hours = elapsedMinutes / MINUTES_PER_HOUR;
  const pressure = Math.max(0, stress.pressure - 0.1 * hours);
  const recovery = stress.recoveryPerHour * (0.5 + stress.resilience) * hours;
  const level = clamp01(stress.level - recovery * (1 - pressure));
  const accumulated = Math.max(0, stress.accumulated - 0.02 * hours);
  return { ...stress, level, accumulated, pressure };
}

// ---------------------------------------------------------------------------
// Engine — state lives in WorldState.systems.mentation
// ---------------------------------------------------------------------------
export class MentalEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.mentation) {
      this.scope.assertOwner("mentation");
      this.world.systems.mentation = { persons: [] } satisfies MentationSystemState;
    }
  }

  private get state(): MentationSystemState {
    return this.world.systems.mentation as MentationSystemState;
  }

  private set state(value: MentationSystemState) {
    this.world.systems.mentation = value;
  }

  registerPerson(
    personId: EntityId<"person">,
    now: WorldTime,
    resilience: number = DEFAULT_RESILIENCE,
  ): MentalState {
    this.scope.assertOwner("mentation");
    const ms = initialMentalState(personId, now, resilience);
    this.state = { ...this.state, persons: [...this.state.persons, ms] };
    return ms;
  }

  /** Add an emotion. Multiple simultaneous emotions are allowed (mixed states). */
  addEmotion(personId: EntityId<"person">, emotion: Emotion, now: WorldTime): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => {
      const emotions = [...ms.emotions.filter((e) => e.id !== emotion.id), emotion];
      return this._recompute({ ...ms, emotions }, now, `emotion:${emotion.kind}`);
    });
  }

  /** Internal state and outward expression differ: toggle concealment. */
  setConcealment(
    personId: EntityId<"person">,
    emotionId: string,
    concealed: boolean,
    expressedIntensity?: number,
  ): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => ({
      ...ms,
      emotions: ms.emotions.map((e) =>
        e.id === emotionId
          ? {
              ...e,
              concealed,
              expressedIntensity:
                expressedIntensity !== undefined
                  ? Math.max(0, expressedIntensity)
                  : concealed
                    ? 0
                    : e.intensity,
            }
          : e,
      ),
    }));
  }

  /** Apply an acute stressor. Resilience blunts the immediate impact. */
  applyStress(
    personId: EntityId<"person">,
    amount: number,
    now: WorldTime,
    pressure: number = 0,
  ): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => {
      const blunted = amount * (1 - ms.stress.resilience * 0.5);
      const stress: StressState = {
        ...ms.stress,
        level: clamp01(ms.stress.level + blunted),
        accumulated: Math.max(0, ms.stress.accumulated + amount * 0.5),
        pressure: clamp01(ms.stress.pressure + pressure),
      };
      const wasHigh = ms.stress.level >= STRESS_HIGH_THRESHOLD;
      const isHigh = stress.level >= STRESS_HIGH_THRESHOLD;
      const next = { ...ms, stress };
      if (!wasHigh && isHigh) {
        return this._note(this._recompute(next, now, "stress"), now, "stress crossed into high");
      }
      return this._recompute(next, now, "stress");
    });
  }

  addCoping(personId: EntityId<"person">, coping: CopingMechanism): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => ({
      ...ms,
      coping: [...ms.coping.filter((c) => c.id !== coping.id), coping],
    }));
  }

  /**
   * Apply a coping mechanism. Coping is *chosen* by NPC Decision (System 17);
   * this engine only resolves its effect. Avoidant/ineffective coping erodes
   * resilience, so repeated use can make a person less able to recover.
   */
  useCoping(personId: EntityId<"person">, copingId: string, now: WorldTime): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => {
      const coping = ms.coping.find((c) => c.id === copingId);
      if (!coping) throw new Error(`Unknown coping mechanism: ${copingId}`);
      const used: CopingMechanism = { ...coping, useCount: coping.useCount + 1 };
      const stress: StressState = {
        ...ms.stress,
        level: clamp01(ms.stress.level - coping.stressRelief),
        resilience: clamp01(ms.stress.resilience - coping.resilienceCost),
      };
      const next = this._recompute({ ...ms, stress }, now, `coping:${coping.kind}`);
      return {
        ...next,
        coping: next.coping.map((c) => (c.id === copingId ? used : c)),
      };
    });
  }

  /** Begin a grief process for a loss. Also seeds a grief emotion. */
  startGrief(
    personId: EntityId<"person">,
    griefId: string,
    relatedPersonId: EntityId<"person"> | undefined,
    now: WorldTime,
  ): void {
    this.scope.assertOwner("mentation");
    this._mutatePerson(personId, (ms) => {
      if (ms.grief.some((g) => g.id === griefId)) return ms; // idempotent
      const grief: GriefProcess = {
        id: griefId,
        startedAt: now,
        stage: "shock",
        intensity: 1,
        relatedPersonId,
      };
      const emotion: Emotion = {
        id: `${griefId}:grief`,
        kind: "grief",
        intensity: 1,
        startedAt: now,
        durationMinutes: 30 * MINUTES_PER_DAY,
        residue: 0.25,
        associations: relatedPersonId ? [relatedPersonId] : [],
        concealed: false,
        expressedIntensity: 1,
      };
      const next = {
        ...ms,
        grief: [...ms.grief, grief],
        emotions: [...ms.emotions, emotion],
      };
      return this._note(this._recompute(next, now, "grief"), now, `grief began (${grief.stage})`);
    });
  }

  /**
   * Advance all mental layers for one person over `elapsedMinutes`. Called from
   * the tick loop for active persons. History is only written on meaningful
   * transitions (mood label or grief stage change), never per fluctuation.
   */
  tick(personId: EntityId<"person">, elapsedMinutes: number, now: WorldTime): MentalState | undefined {
    this.scope.assertOwner("mentation");
    const ms = this.getPerson(personId);
    if (!ms) return undefined;

    const emotions = ms.emotions
      .map((e) => decayEmotion(e, elapsedMinutes))
      .filter((e): e is Emotion => e !== null);

    const grief = ms.grief.map((g) => this._advanceGrief(g, now));
    const stress = recoverStress(ms.stress, elapsedMinutes);

    let next = this._recompute({ ...ms, emotions, grief, stress }, now, "tick");
    for (const g of grief) {
      const before = ms.grief.find((p) => p.id === g.id);
      if (before && before.stage !== g.stage) {
        next = this._note(next, now, `grief ${g.id} -> ${g.stage}`);
      }
    }

    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.personId === personId ? next : p)),
    };
    return next;
  }

  getPerson(personId: EntityId<"person">): MentalState | undefined {
    return this.state.persons.find((p) => p.personId === personId);
  }

  all(): readonly MentalState[] {
    return this.state.persons;
  }

  // -------------------------------------------------------------------------
  // internals
  // -------------------------------------------------------------------------

  private _advanceGrief(grief: GriefProcess, now: WorldTime): GriefProcess {
    const elapsedDays = durationToMinutes(timeBetween(now, grief.startedAt)) / MINUTES_PER_DAY;
    const stage = resolveGriefStage(elapsedDays);
    // Intensity eases as grief integrates; it never fully vanishes on its own.
    const stageIndex = GRIEF_STAGE_FROM_DAY.findIndex((s) => s.stage === stage);
    const intensity = Math.max(0.1, 1 - stageIndex * 0.2);
    return { ...grief, stage, intensity };
  }

  /** Recompute the mood layer from the current emotions and stress. */
  private _recompute(ms: MentalState, now: WorldTime, _cause: string): MentalState {
    const valence = computeMoodValence(ms.emotions, ms.stress.level);
    const label = moodLabelFromValence(valence);
    const mood: MoodState =
      label === ms.mood.label
        ? { ...ms.mood, valence }
        : { valence, label, since: now };
    return label === ms.mood.label ? { ...ms, mood } : this._note({ ...ms, mood }, now, `mood -> ${label}`);
  }

  private _note(ms: MentalState, now: WorldTime, note: string): MentalState {
    return { ...ms, history: [...ms.history, { timestamp: now, note }] };
  }

  private _mutatePerson(
    personId: EntityId<"person">,
    fn: (ms: MentalState) => MentalState,
  ): void {
    const ms = this.getPerson(personId);
    if (!ms) throw new Error(`Unknown person in mentation: ${personId}`);
    const updated = fn(ms);
    this.state = {
      ...this.state,
      persons: this.state.persons.map((p) => (p.personId === personId ? updated : p)),
    };
  }
}
