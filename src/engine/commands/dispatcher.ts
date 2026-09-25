/**
 * ReelLife command dispatcher (System 01 / System 04 / System 59).
 *
 * The one place where intent becomes occurrence:
 *
 *   Command -> Validation -> AuthorityCheck -> Resolution -> Event
 *           -> Consequences -> New State
 *
 * Guarantees this module is responsible for:
 *  - a rejected or blocked command produces no event and changes nothing,
 *  - consequences are applied by the system that owns the state they touch,
 *    inside that system's ownership scope,
 *  - every step of the pipeline is traceable (System 59),
 *  - unhandled consequence types are reported instead of silently ignored.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { EntityRef } from "../primitives/entity.ts";
import type { WorldTime } from "../primitives/time.ts";
import type { SystemId } from "../core/ownership.ts";
import type { AuthorityContext, AuthorityEvaluator } from "../primitives/authority.ts";
import type { EventEngine, EventHandler, ConsequenceContext } from "../events/engine.ts";
import type { ConsequenceDescriptor, EventDraft, WorldEvent } from "../events/types.ts";
import type { RngRegistry } from "../rng/streams.ts";
import type { TraceLog } from "../observability/trace.ts";
import type { MetricsCollector } from "../observability/metrics.ts";
import type { HistoryStore } from "../history/store.ts";
import type { SystemScope } from "../core/access.ts";
import type { CommandRegistry } from "./registry.ts";
import type { CommandLog } from "./log.ts";
import {
  errorIssue,
  type Command,
  type CommandContext,
  type CommandOrigin,
  type CommandResult,
  type ValidationIssue,
} from "./types.ts";
import { UnknownCommandError } from "./registry.ts";

export interface DispatcherScope extends SystemScope {
  mutate<T>(owner: SystemId, fn: () => T): T;
}

export type ConsequenceDescriptorApplier = (
  payload: Readonly<Record<string, unknown>>,
  event: WorldEvent,
  context: ConsequenceContext,
) => void;

export interface DispatcherDeps {
  readonly scope: DispatcherScope;
  readonly registry: CommandRegistry;
  readonly log: CommandLog;
  readonly events: EventEngine;
  readonly rng: RngRegistry;
  readonly authority: AuthorityEvaluator;
  readonly trace: TraceLog;
  readonly metrics: MetricsCollector;
  readonly history: HistoryStore;
  /** Reads the current authoritative time. */
  readonly currentTime: () => WorldTime;
  readonly stepIndex: () => number;
  /** Builds the actor's authority context from the systems that own each fact. */
  readonly authorityContext: (command: Command) => AuthorityContext;
  readonly handlers: ReadonlyMap<string, EventHandler>;
  readonly appliers: ReadonlyMap<string, ConsequenceDescriptorApplier>;
  /** When true, unhandled consequence types are recorded as trace warnings. */
  readonly strictConsequences: boolean;
}

export interface DispatchOptions {
  /** Overrides "now" for tests and replay (must not move time backwards). */
  readonly issuedAt?: WorldTime;
}

export class CommandDispatcher {
  private readonly deps: DispatcherDeps;
  readonly unhandledConsequenceTypes = new Set<string>();

  constructor(deps: DispatcherDeps) {
    this.deps = deps;
  }

  /** Mints a command whose identity is owned by the core, not by the caller. */
  createCommand<TParams extends object>(
    type: string,
    actor: EntityId<"person">,
    params: TParams,
    origin: CommandOrigin,
    targets?: readonly EntityRef[],
  ): Command<TParams> {
    const id = this.deps.scope.mutate("core", () => this.deps.log.mintId());
    return {
      id,
      type,
      actor,
      origin,
      issuedAt: this.deps.currentTime(),
      params,
      ...(targets === undefined ? {} : { targets }),
    };
  }

  dispatch(command: Command, options?: DispatchOptions): CommandResult {
    const now = options?.issuedAt ?? command.issuedAt;
    this.deps.metrics.increment("commands.dispatched");
    this.trace(now, "command", `dispatch ${command.type}`, {
      commandId: command.id,
      systemId: undefined,
      data: { origin: command.origin, actor: command.actor },
    });

    // 1. Definition lookup. An unknown command changes nothing.
    if (!this.deps.registry.has(command.type)) {
      return this.finish(command, now, {
        status: "rejected",
        issues: [errorIssue("unknown_command", `No handler for command "${command.type}"`)],
        events: [],
        reasons: [`Unknown command: ${command.type}`],
        error: new UnknownCommandError(command.type).message,
      });
    }
    const definition = this.deps.registry.get(command.type);

    const context: CommandContext = {
      time: now,
      origin: command.origin,
      correlationId: command.id,
      rng: { stream: (path: string) => this.deps.rng.stream(path) },
      log: (message, data) => {
        this.trace(now, "system", message, {
          systemId: definition.owner,
          commandId: command.id,
          ...(data === undefined ? {} : { data }),
        });
      },
    };

    // 2. Validation: structure and preconditions.
    const issues = this.collectIssues(
      definition.validate(command as never, context),
      now,
      command,
      definition.owner,
    );
    if (issues.some((issue) => issue.severity === "error")) {
      this.deps.metrics.increment("commands.rejected");
      return this.finish(command, now, {
        status: "rejected",
        issues,
        events: [],
        reasons: issues.filter((issue) => issue.severity === "error").map((issue) => issue.message),
      });
    }

    // 3. Authority: allowed / denied / conditional.
    if (definition.authorityRequirement) {
      const target = command.targets?.[0];
      const decision = this.deps.authority.check(
        {
          actor: command.actor,
          action: command.type,
          ...(target === undefined ? {} : { target }),
          time: now,
        },
        this.deps.authorityContext(command),
      );
      this.trace(now, "authority", `authority ${decision.outcome}`, {
        systemId: definition.owner,
        commandId: command.id,
        data: { reasons: [...decision.reasons], ruleId: decision.ruleId ?? "none" },
      });
      if (decision.outcome === "denied") {
        this.deps.metrics.increment("commands.blocked");
        return this.finish(command, now, {
          status: "blocked",
          issues,
          authority: decision,
          events: [],
          reasons: decision.reasons.map((reason) => `Blocked: ${reason}`),
        });
      }
    }

    // 4. Resolution, 5. Events, 6. Consequences.
    return this.resolveAndApply(command, now, definition.owner, context, issues);
  }

  /** Records a trace entry with the dispatcher's current step index. */
  private trace(
    at: WorldTime,
    kind: "command" | "validation" | "authority" | "resolution" | "event" | "consequence" | "system" | "warning" | "error",
    message: string,
    extra: {
      readonly systemId?: SystemId | undefined;
      readonly commandId?: EntityId<"command"> | undefined;
      readonly eventId?: EntityId<"event"> | undefined;
      readonly causalChainId?: string | undefined;
      readonly data?: Readonly<Record<string, unknown>> | undefined;
    },
  ): void {
    this.deps.trace.record({
      at,
      step: this.deps.stepIndex(),
      kind,
      message,
      ...(extra.systemId === undefined ? {} : { systemId: extra.systemId }),
      ...(extra.commandId === undefined ? {} : { commandId: extra.commandId }),
      ...(extra.eventId === undefined ? {} : { eventId: extra.eventId }),
      ...(extra.causalChainId === undefined ? {} : { causalChainId: extra.causalChainId }),
      ...(extra.data === undefined ? {} : { data: extra.data }),
    });
  }

  private resolveAndApply(
    command: Command,
    now: WorldTime,
    owner: SystemId,
    context: CommandContext,
    issues: readonly ValidationIssue[],
  ): CommandResult {
    const definition = this.deps.registry.get(command.type);

    let resolved: ReturnType<typeof definition.resolve>;
    try {
      resolved = definition.resolve(command as never, context);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.trace(now, "error", `resolution failed: ${message}`, {
        systemId: owner,
        commandId: command.id,
      });
      this.deps.metrics.increment("commands.failed");
      return this.finish(command, now, {
        status: "rejected",
        issues: [...issues, errorIssue("resolution_failed", message)],
        events: [],
        reasons: [`Could not resolve ${command.type}: ${message}`],
        error: message,
      });
    }

    const emitted: WorldEvent[] = [];
    emitted.push(this.emitEvent(resolved.event, now, command));
    for (const followUp of resolved.followUpEvents ?? []) {
      emitted.push(this.emitEvent(followUp, now, command));
    }

    const applied = this.resolveDue(now);
    this.deps.metrics.increment("commands.applied");

    return this.finish(command, now, {
      status: "applied",
      issues,
      events: [...emitted, ...applied],
      ...(resolved.resolution === undefined ? {} : { resolution: resolved.resolution }),
      reasons: resolved.event.visibleFacts ?? [],
    });
  }

  /** Emits an event, attributing it to the command that caused it. */
  emitEvent(draft: EventDraft, now: WorldTime, command?: Command): WorldEvent {
    const withCause: EventDraft =
      command === undefined
        ? draft
        : { ...draft, cause: { ...draft.cause, commandId: draft.cause.commandId ?? command.id } };

    const event = this.deps.events.emit(withCause, now);
    this.trace(now, "event", `event ${event.type}`, {
      commandId: command?.id,
      eventId: event.id,
      causalChainId: event.causalChainId,
    });
    return event;
  }

  /**
   * Resolves due events, applies their consequences through the owning systems,
   * and records curated history. Called after every command and every step.
   */
  resolveDue(now: WorldTime): WorldEvent[] {
    const consequenceContext: ConsequenceContext = {
      time: now,
      rng: { stream: (path: string) => this.deps.rng.stream(path) },
      emit: (draft) => this.emitEvent(draft, now),
      log: (message, data) => {
        this.trace(now, "warning", message, data === undefined ? {} : { data });
      },
    };

    const report = this.deps.events.resolveDue(
      now,
      this.deps.handlers,
      consequenceContext,
      (event) => {
        this.recordHistory(event);
      },
    );

    for (const descriptor of report.consequences) {
      this.applyConsequence(descriptor, report.resolved, consequenceContext, now);
    }

    this.deps.metrics.setGauge("events.pending", this.deps.events.pendingCount);
    return [...report.resolved];
  }

  private applyConsequence(
    descriptor: ConsequenceDescriptor,
    resolvedEvents: readonly WorldEvent[],
    context: ConsequenceContext,
    now: WorldTime,
  ): void {
    const applier = this.deps.appliers.get(descriptor.type);
    if (!applier) {
      // An unhandled consequence is a defect: an event declared an effect that no
      // system performs. It is reported, never silently swallowed.
      this.unhandledConsequenceTypes.add(descriptor.type);
      this.trace(now, "warning", `unhandled consequence type "${descriptor.type}"`, {
        systemId: descriptor.owner,
      });
      return;
    }

    const sourceEvent = resolvedEvents[resolvedEvents.length - 1];
    if (!sourceEvent) {
      this.trace(now, "warning", `consequence "${descriptor.type}" has no source event`, {
        systemId: descriptor.owner,
      });
      return;
    }

    this.deps.metrics.measure("consequences.apply", () => {
      this.deps.scope.mutate(descriptor.owner, () => {
        applier(descriptor.payload, sourceEvent, context);
      });
    });
    this.trace(now, "consequence", `applied ${descriptor.type}`, {
      systemId: descriptor.owner,
      eventId: sourceEvent.id,
      causalChainId: sourceEvent.causalChainId,
    });
  }

  /** History is curated: meaningful occurrences become timeline entries. */
  private recordHistory(event: WorldEvent): void {
    const importance =
      typeof event.metadata?.importance === "number" ? event.metadata.importance : 2;
    const summary = event.visibleFacts.length > 0 ? event.visibleFacts.join("; ") : event.type;
    this.deps.scope.mutate("history", () => {
      this.deps.history.record({
        at: event.at,
        kind: historyKindOf(event),
        summary,
        ...(event.locationId === undefined ? {} : { locationId: event.locationId }),
        eventId: event.id,
        eventType: event.type,
        causeKind: event.cause.kind,
        causalChainId: event.causalChainId,
        importance,
        visibility: event.visibility,
        knownBy: event.knownBy,
        tags: event.tags,
      });
    });
  }

  private collectIssues(
    issues: readonly ValidationIssue[],
    now: WorldTime,
    command: Command,
    owner: SystemId,
  ): readonly ValidationIssue[] {
    for (const issue of issues) {
      this.trace(now, "validation", `${issue.severity}: ${issue.code} ${issue.message}`, {
        systemId: owner,
        commandId: command.id,
      });
    }
    return issues;
  }

  private finish(
    command: Command,
    now: WorldTime,
    result: Omit<CommandResult, "commandId" | "type">,
  ): CommandResult {
    const full: CommandResult = { commandId: command.id, type: command.type, ...result };
    this.deps.scope.mutate("core", () => {
      this.deps.log.append(command, full);
    });
    this.deps.metrics.setGauge("commands.logSize", this.deps.log.size);
    this.trace(now, "command", `result ${full.status}`, { commandId: command.id });
    return full;
  }
}

function historyKindOf(event: WorldEvent): "lifeEvent" | "worldEvent" | "system" {
  if (event.tags.includes("world")) return "worldEvent";
  if (event.tags.includes("system")) return "system";
  return "lifeEvent";
}



