/**
 * Social interaction commands (System 18, M2 command list:
 * social.message|visit|apologize).
 *
 * Relationships are directional: A's opinion of B is a separate record from
 * B's opinion of A (System 18). An interaction is experienced by both parties,
 * so each command declares one consequence carrying *both* directional delta
 * sets; the relationship engine remains the single owner of the evaluation
 * truth and applies them.
 *
 * Deltas are deliberately data (SOCIAL_PROFILES) rather than logic in the
 * applier, so the magnitude of a chat versus a visit versus an apology is
 * inspectable and testable in one place.
 */

import type { EntityId } from "../../primitives/ids.ts";
import type {
  RelationshipContext,
  RelationshipTurningPoint,
} from "../../primitives/relationship.ts";
import type { CommandDefinition } from "../types.ts";
import { causeKindOf, createdByOf, errorIssue } from "../types.ts";

export const SOCIAL_COMMAND_TYPES = {
  message: "social.message",
  visit: "social.visit",
  apologize: "social.apologize",
} as const;

export const SOCIAL_CONSEQUENCE_TYPES = {
  /** One applier for every interaction shape; the payload carries the deltas. */
  interaction: "relationships.record_interaction",
} as const;

/** Subjective shift one party experiences from an interaction. */
export interface InteractionDeltas {
  readonly closeness?: number;
  readonly trust?: number;
  readonly affection?: number;
  readonly respect?: number;
  readonly loyalty?: number;
  readonly familiarity?: number;
  readonly conflict?: number;
}

export interface SocialProfile {
  readonly eventType: string;
  /** Context added to a tie that does not exist yet. */
  readonly context: RelationshipContext;
  readonly summary: string;
  readonly initiator: InteractionDeltas;
  readonly counterparty: InteractionDeltas;
  /** Where the turning point is recorded: the party whose view it changes. */
  readonly turningPoint?: {
    readonly kind: RelationshipTurningPoint["kind"];
    readonly on: "initiator" | "counterparty";
  };
  /** Minutes the interaction occupies the initiator, when it is an activity. */
  readonly occupyMinutes?: number;
}

export const SOCIAL_PROFILES = {
  message: {
    eventType: "social.message_sent",
    context: "acquaintance",
    summary: "exchanged messages",
    initiator: { closeness: 0.02, familiarity: 0.03, trust: 0.01 },
    counterparty: { closeness: 0.01, familiarity: 0.02 },
  },
  visit: {
    eventType: "social.visited",
    context: "acquaintance",
    summary: "spent time together",
    initiator: { closeness: 0.05, familiarity: 0.06, affection: 0.03 },
    counterparty: { closeness: 0.05, familiarity: 0.06, affection: 0.03 },
    occupyMinutes: 60,
  },
  apologize: {
    eventType: "social.apologized",
    context: "acquaintance",
    summary: "offered an apology",
    // Apologising costs a little standing but repairs the relationship.
    initiator: { conflict: -0.12, respect: 0.01 },
    counterparty: { conflict: -0.18, trust: 0.05, affection: 0.02 },
    turningPoint: { kind: "apology", on: "counterparty" },
  },
} as const satisfies Record<string, SocialProfile>;

export type SocialInteraction = keyof typeof SOCIAL_PROFILES;

export interface SocialTargetParams {
  readonly otherPersonId: EntityId<"person">;
  /** Overrides the profile's default occupancy for activity-shaped visits. */
  readonly durationMinutes?: number;
  readonly locationId?: string;
}

import type { ConsequenceDescriptor, EventDraft } from "../../events/types.ts";
import { ACTIVITY_CONSEQUENCE_TYPES } from "./activityCommands.ts";

function socialCommand(
  type: string,
  interaction: SocialInteraction,
  description: string,
): CommandDefinition<never> {
  const profile: SocialProfile = SOCIAL_PROFILES[interaction];
  return {
    type,
    owner: "relationships",
    description,
    validate: (cmd) => {
      const p = cmd.params as Partial<SocialTargetParams>;
      if (typeof p.otherPersonId !== "string" || p.otherPersonId.length === 0) {
        return [errorIssue("invalid_params", "otherPersonId is required", "params.otherPersonId")];
      }
      if (p.otherPersonId === cmd.actor) {
        return [
          errorIssue(
            "invalid_target",
            "A person cannot interact socially with themselves",
            "params.otherPersonId",
          ),
        ];
      }
      if (
        p.durationMinutes !== undefined &&
        (typeof p.durationMinutes !== "number" ||
          !Number.isFinite(p.durationMinutes) ||
          p.durationMinutes <= 0)
      ) {
        return [
          errorIssue(
            "invalid_duration",
            "durationMinutes must be a positive number when provided",
            "params.durationMinutes",
          ),
        ];
      }
      return [];
    },
    resolve: (cmd) => {
      const p = cmd.params as SocialTargetParams;
      const consequences: ConsequenceDescriptor[] = [];

      // A visit occupies real time, so it also creates an activity. That keeps
      // "what a person was doing" owned by System 05 rather than by the social
      // layer (single owner per field).
      if (profile.occupyMinutes !== undefined) {
        consequences.push({
          type: ACTIVITY_CONSEQUENCE_TYPES.started,
          owner: "activities",
          payload: {
            actor: cmd.actor,
            kind: "socialVisit",
            durationMinutes: Math.round(p.durationMinutes ?? profile.occupyMinutes),
            createdBy: createdByOf(cmd.origin),
            participants: [cmd.actor, p.otherPersonId],
            ...(p.locationId === undefined ? {} : { locationId: p.locationId }),
            notes: `social:${interaction}`,
          },
        });
      }

      consequences.push({
        type: SOCIAL_CONSEQUENCE_TYPES.interaction,
        owner: "relationships",
        payload: {
          interaction,
          from: cmd.actor,
          to: p.otherPersonId,
          context: profile.context,
          origin: `social.${interaction}`,
          summary: profile.summary,
          initiator: profile.initiator,
          counterparty: profile.counterparty,
          ...(profile.turningPoint === undefined ? {} : { turningPoint: profile.turningPoint }),
        },
      });

      const event: EventDraft = {
        type: profile.eventType,
        cause: { kind: causeKindOf(cmd.origin), description: `${String(cmd.actor)} ${profile.summary}` },
        actors: [{ kind: "person", id: cmd.actor }],
        targets: [{ kind: "person", id: p.otherPersonId }],
        visibleFacts: [`${String(cmd.actor)} ${profile.summary} with ${String(p.otherPersonId)}`],
        tags: ["social", "relationship"],
        consequences,
      };
      return { event };
    },
  } as CommandDefinition<never>;
}

export const SOCIAL_COMMANDS: readonly CommandDefinition<never>[] = [
  socialCommand(
    SOCIAL_COMMAND_TYPES.message,
    "message",
    "Sends a message to another person, nudging closeness and familiarity.",
  ),
  socialCommand(
    SOCIAL_COMMAND_TYPES.visit,
    "visit",
    "Visits another person: records the interaction and the time it occupied.",
  ),
  socialCommand(
    SOCIAL_COMMAND_TYPES.apologize,
    "apologize",
    "Apologises to another person, reducing conflict and recording a turning point.",
  ),
];
