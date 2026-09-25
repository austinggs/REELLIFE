import type { CommandDefinition } from "../types.ts";
import { errorIssue } from "../types.ts";

export const NEEDS_COMMAND_TYPES = {
  personEat: "person.eat",
  personSleep: "person.sleep",
  personRest: "person.rest",
  personHygiene: "person.hygiene",
  personSocialize: "person.socialize",
} as const;

export const NEEDS_CONSEQUENCE_TYPES = {
  satisfyNeed: "needs.satisfy",
} as const;

export const NEEDS_COMMANDS: readonly CommandDefinition<never>[] = [
  {
    type: NEEDS_COMMAND_TYPES.personEat,
    owner: "needs",
    description: "Satisfies person hunger need.",
    validate: (cmd) => (cmd.actor ? [] : [errorIssue("missing_actor", "Actor required for eating")]),
    resolve: (cmd) => ({
      event: {
        type: "person.ate",
        cause: { kind: "player", description: "Person ate meal" },
        visibleFacts: ["Person ate a meal"],
        tags: ["needs", "food"],
        consequences: [
          {
            type: NEEDS_CONSEQUENCE_TYPES.satisfyNeed,
            owner: "needs",
            payload: { personId: cmd.actor, needKind: "hunger", amount: 0.4 },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
  {
    type: NEEDS_COMMAND_TYPES.personSleep,
    owner: "needs",
    description: "Satisfies person sleep need.",
    validate: (cmd) => (cmd.actor ? [] : [errorIssue("missing_actor", "Actor required for sleeping")]),
    resolve: (cmd) => ({
      event: {
        type: "person.slept",
        cause: { kind: "player", description: "Person slept" },
        visibleFacts: ["Person slept"],
        tags: ["needs", "sleep"],
        consequences: [
          {
            type: NEEDS_CONSEQUENCE_TYPES.satisfyNeed,
            owner: "needs",
            payload: { personId: cmd.actor, needKind: "sleep", amount: 0.7 },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
  {
    type: NEEDS_COMMAND_TYPES.personRest,
    owner: "needs",
    description: "Satisfies person rest need.",
    validate: (cmd) => (cmd.actor ? [] : [errorIssue("missing_actor", "Actor required for resting")]),
    resolve: (cmd) => ({
      event: {
        type: "person.rested",
        cause: { kind: "player", description: "Person rested" },
        visibleFacts: ["Person rested"],
        tags: ["needs", "rest"],
        consequences: [
          {
            type: NEEDS_CONSEQUENCE_TYPES.satisfyNeed,
            owner: "needs",
            payload: { personId: cmd.actor, needKind: "rest", amount: 0.35 },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
  {
    type: NEEDS_COMMAND_TYPES.personHygiene,
    owner: "needs",
    description: "Satisfies person hygiene need.",
    validate: (cmd) => (cmd.actor ? [] : [errorIssue("missing_actor", "Actor required for hygiene")]),
    resolve: (cmd) => ({
      event: {
        type: "person.cleaned",
        cause: { kind: "player", description: "Person attended to hygiene" },
        visibleFacts: ["Person showered/cleaned"],
        tags: ["needs", "hygiene"],
        consequences: [
          {
            type: NEEDS_CONSEQUENCE_TYPES.satisfyNeed,
            owner: "needs",
            payload: { personId: cmd.actor, needKind: "hygiene", amount: 0.6 },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
  {
    type: NEEDS_COMMAND_TYPES.personSocialize,
    owner: "needs",
    description: "Satisfies person social need.",
    validate: (cmd) => (cmd.actor ? [] : [errorIssue("missing_actor", "Actor required for socializing")]),
    resolve: (cmd) => ({
      event: {
        type: "person.socialized",
        cause: { kind: "player", description: "Person socialized" },
        visibleFacts: ["Person socialized with others"],
        tags: ["needs", "social"],
        consequences: [
          {
            type: NEEDS_CONSEQUENCE_TYPES.satisfyNeed,
            owner: "needs",
            payload: { personId: cmd.actor, needKind: "social_contact", amount: 0.35 },
          },
        ],
      },
    }),
  } as CommandDefinition<never>,
];
