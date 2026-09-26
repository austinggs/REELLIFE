/**
 * Debug console execution (System 57).
 *
 * Reads run directly against the query layer. Mutations are *not* executed
 * here: they are handed to the command dispatcher with origin `console`, so
 * validation, authority checks, resolution, events and the audit trail all
 * behave exactly as they do for any other actor. The console has no private
 * path into state.
 *
 * Authority is explicit and separate from the player's: a `player` context may
 * read but may not mutate; `debug` and `system` may mutate. This is what makes
 * the console a tool rather than a cheat channel (System 57, UI/UX 22).
 */

import type { Simulation } from "../core/simulation.ts";
import type { EntityId } from "../primitives/ids.ts";
import type {
  ConsoleAuthority,
  ConsoleLine,
} from "../primitives/authorityTerms.ts";
import type { CommandResult } from "../commands/types.ts";
import {
  getClockView,
  getEntityInspectorView,
  getLifeSituation,
  getNotificationFeedView,
  getSimulationHealthView,
  getWorldSummaryView,
} from "../query/index.ts";
import { CONSOLE_READ_COMMANDS, type ConsoleInstruction } from "./parser.ts";

export { CONSOLE_AUTHORITIES } from "../primitives/authorityTerms.ts";
export type {
  ConsoleAuthority,
  ConsoleLine,
} from "../primitives/authorityTerms.ts";

export interface ConsoleContext {
  /** The person commands are issued as; null means no acting persona. */
  readonly actorId: EntityId<"person"> | null;
  readonly authority: ConsoleAuthority;
}

export interface ConsoleResult {
  readonly status: "ok" | "denied" | "error";
  readonly lines: readonly ConsoleLine[];
  readonly commandResult?: CommandResult;
}

function readLines(texts: readonly string[]): ConsoleLine[] {
  return texts.map((text) => ({ kind: "read" as const, text }));
}

/** The console's own help text: reads are listed with their arity. */
function helpText(sim: Simulation): readonly string[] {
  const byOwner = sim.registry.byOwner();
  const owners = Object.keys(byOwner).sort();
  const sample = owners
    .slice(0, 6)
    .map((owner) => `${owner}: ${(byOwner[owner] ?? []).slice(0, 3).join(", ")}`);
  return [
    `Reads: ${CONSOLE_READ_COMMANDS.join(", ")}`,
    "  help              this text",
    "  time              authoritative clock and speed",
    "  state             world summary and your situation",
    "  health            simulation health (pending events, invariants)",
    "  events [n]        your notification feed (default 10)",
    "  entity <id>       authoritative record for an id",
    "  commands          registered command types by owning system",
    "  whoami            acting person and console authority",
    "Mutations: <command.type> key=value ... (dispatched through the command pipeline)",
    "  e.g. time.set_speed speed=10     world.save slotName=manual",
    `Registered types by owner (${owners.length} systems): ${sample.join(" | ")}`,
  ];
}

function readState(sim: Simulation, context: ConsoleContext): readonly string[] {
  const world = getWorldSummaryView(sim);
  const lines: string[] = [
    `${world.worldName} (${world.worldId}) — ${world.mode}/${world.difficulty}, seed ${world.masterSeed}`,
    `Registered systems: ${world.registeredSystems}; generation ${world.generation}; uptime ${world.uptimeDays} days`,
  ];
  if (context.actorId === null) {
    lines.push("No acting person: situation unavailable.");
    return lines;
  }
  const life = getLifeSituation(sim, context.actorId);
  lines.push(
    `${life.displayName} — ${life.lifeStage}, age ${life.ageYears}, in ${life.locationName} (${life.timeLabel})`,
    `Mood: ${life.moodLabel}${life.householdName === undefined ? "" : `; household ${life.householdName}`}`,
  );
  if (life.currentActivity !== undefined) {
    lines.push(`Doing: ${life.currentActivity.label} until ${life.currentActivity.endsAtLabel}`);
  }
  for (const need of life.needs) {
    lines.push(`  ${need.label}: ${(need.level * 100).toFixed(0)}% (${need.urgency})`);
  }
  return lines;
}

/**
 * Executes a parsed instruction. Reads always work; mutations need debug or
 * system authority and an acting person, because every command is attributed.
 */
export function executeConsoleInstruction(
  sim: Simulation,
  instruction: ConsoleInstruction,
  context: ConsoleContext,
): ConsoleResult {
  switch (instruction.kind) {
    case "empty":
      return {
        status: "ok",
        lines: [{ kind: "info", text: "Type `help` to list reads and commands." }],
      };

    case "error":
      return {
        status: "error",
        lines: [
          { kind: "error", text: instruction.message },
          ...(instruction.suggestions.length === 0
            ? []
            : [
                {
                  kind: "info" as const,
                  text: `Did you mean: ${instruction.suggestions.join(", ")}`,
                },
              ]),
        ],
      };

    case "read":
      return executeRead(sim, instruction, context);

    case "command":
      return executeMutation(sim, instruction, context);
  }
}

function executeRead(
  sim: Simulation,
  instruction: Extract<ConsoleInstruction, { kind: "read" }>,
  context: ConsoleContext,
): ConsoleResult {
  switch (instruction.read) {
    case "help":
      return { status: "ok", lines: readLines(helpText(sim)) };

    case "time": {
      const clock = getClockView(sim);
      return {
        status: "ok",
        lines: readLines([
          `${clock.dateTimeLabel} (${clock.weekdayName}, ${clock.season}, ${clock.dayPhase})`,
          `Speed ${clock.speed}x${clock.paused ? ", paused" : ""}; step ${clock.stepIndex}; minutes ${clock.timeMinutes}`,
        ]),
      };
    }

    case "state":
      return { status: "ok", lines: readLines(readState(sim, context)) };

    case "health": {
      const health = getSimulationHealthView(sim);
      return {
        status: "ok",
        lines: readLines([
          `steps ${health.steps}; pending events ${health.pendingEvents}; commands ${health.commandCount}`,
          `timeline ${health.timelineEntries} (compressed ${health.compressedTimelineEntries}); invariant failures ${health.invariantFailures}`,
          `ownership violations ${health.ownershipViolations.length}; unhandled consequence types ${health.unhandledConsequenceTypes.length}`,
        ]),
      };
    }

    case "events": {
      const limit = instruction.argument === undefined ? 10 : Number(instruction.argument);
      if (Number.isNaN(limit) || limit <= 0) {
        return {
          status: "error",
          lines: [
            { kind: "error", text: "events takes an optional positive count, e.g. `events 20`." },
          ],
        };
      }
      const feed = getNotificationFeedView(sim, context.actorId, { limit });
      if (feed.notifications.length === 0) {
        return {
          status: "ok",
          lines: [{ kind: "info", text: "Nothing you are entitled to know about yet." }],
        };
      }
      return {
        status: "ok",
        lines: readLines(
          feed.notifications.map(
            (notification) =>
              `[${notification.timeLabel}] (${notification.category}/${notification.delivery}) ${notification.title}`,
          ),
        ),
      };
    }

    case "entity": {
      const id = instruction.argument?.trim();
      if (id === undefined || id.length === 0) {
        return {
          status: "error",
          lines: [{ kind: "error", text: "entity requires an id, e.g. `entity PERSON-000001`." }],
        };
      }
      const inspector = getEntityInspectorView(sim, id);
      if (!inspector.found) {
        return { status: "error", lines: [{ kind: "error", text: inspector.title }] };
      }
      return {
        status: "ok",
        lines: readLines([
          `${inspector.kind} ${inspector.id}: ${inspector.title}`,
          ...inspector.fields.map((field) => `  ${field.label} = ${field.value}`),
        ]),
      };
    }

    case "commands": {
      const byOwner = sim.registry.byOwner();
      return {
        status: "ok",
        lines: readLines(
          Object.keys(byOwner)
            .sort()
            .map((owner) => `${owner}: ${(byOwner[owner] ?? []).join(", ")}`),
        ),
      };
    }

    case "whoami":
      return {
        status: "ok",
        lines: readLines([
          `Acting as: ${context.actorId ?? "(nobody)"}`,
          `Console authority: ${context.authority}`,
          context.authority === "player"
            ? "Reads only: mutations require debug authority."
            : "Reads and mutations are available; every mutation is audited.",
        ]),
      };
  }
}


/**
 * Mutations are dispatched, never applied directly: the console is a client of
 * the command pipeline like any other origin, and every attempt is logged.
 */
function executeMutation(
  sim: Simulation,
  instruction: Extract<ConsoleInstruction, { kind: "command" }>,
  context: ConsoleContext,
): ConsoleResult {
  if (context.authority === "player") {
    return {
      status: "denied",
      lines: [
        {
          kind: "error",
          text: `Mutations require debug authority (you are ${context.authority}). Available command types are listed under \`commands\`.`,
        },
      ],
    };
  }
  if (context.actorId === null) {
    return {
      status: "denied",
      lines: [
        { kind: "error", text: "No acting person: commands must be attributed to someone." },
      ],
    };
  }

  const command = sim.dispatcher.createCommand(
    instruction.commandType,
    context.actorId,
    { ...instruction.params },
    "console",
  );
  const result = sim.dispatcher.dispatch(command);

  const lines: ConsoleLine[] = [
    {
      kind: result.status === "applied" ? "mutation" : "error",
      text: `${instruction.commandType} → ${result.status} (${result.commandId}, origin console, authority ${context.authority})`,
    },
    ...result.reasons.map((reason): ConsoleLine => ({ kind: "info", text: reason })),
  ];
  if (result.error !== undefined) lines.push({ kind: "error", text: result.error });
  if (result.events.length > 0) {
    lines.push({
      kind: "info",
      text: `${result.events.length} event(s) resolved: ${result.events.map((event) => event.type).join(", ")}`,
    });
  }

  return {
    status: result.status === "applied" ? "ok" : "error",
    lines,
    commandResult: result,
  };
}

