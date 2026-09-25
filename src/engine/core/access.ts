/**
 * ReelLife runtime ownership guard (System 01, architectural law 1).
 *
 * Every authoritative write happens inside `guard.mutate(owner, fn)`. While a
 * mutation is in progress the guard knows which system is writing, and a Proxy
 * placed over the world state rejects writes to any section that system does
 * not own.
 *
 * This buys three concrete protections:
 *  - a domain system cannot quietly reach into another system's state,
 *  - presentation code has no owner context at all, so a UI component that tries
 *    to write simulation state fails loudly instead of corrupting continuity
 *    (UI/UX 24 section 9),
 *  - tests and debug tooling get an explicit, explainable violation list.
 */

import { SECTION_OWNERS, type StateSection, type SystemId } from "./ownership.ts";

export interface OwnershipViolation {
  readonly systemId: SystemId;
  readonly path: string;
  readonly expectedOwner: SystemId | null;
  readonly message: string;
}

export class OwnershipViolationError extends Error {
  readonly violation: OwnershipViolation;

  constructor(violation: OwnershipViolation) {
    super(violation.message);
    this.name = "OwnershipViolationError";
    this.violation = violation;
  }
}

export class MissingWriterContextError extends Error {
  constructor(path: string) {
    super(
      `Authoritative state was written without an active system context at "${path}". ` +
        "All writes must occur inside WorldStateAccess.mutate(owner, fn): the UI and " +
        "unowned code paths must dispatch commands instead of mutating state.",
    );
    this.name = "MissingWriterContextError";
  }
}

export class OwnershipGuard {
  private activeOwner: SystemId | null = null;
  private readonly violations: OwnershipViolation[] = [];
  private readonly additionalWrites = new Map<SystemId, Set<string>>();

  /** Set to false in hot loops or after validation; violations are still recorded. */
  enforce = true;

  get writer(): SystemId | null {
    return this.activeOwner;
  }

  get recordedViolations(): readonly OwnershipViolation[] {
    return this.violations;
  }

  /** Grants a system an extra section beyond `systems.<id>` (e.g. shared indexes). */
  allowAdditionalWrite(systemId: SystemId, path: string): void {
    const existing = this.additionalWrites.get(systemId) ?? new Set<string>();
    existing.add(path);
    this.additionalWrites.set(systemId, existing);
  }

  /**
   * Asserts that `systemId` is the active writer.
   *
   * Systems that keep their authoritative state inside a live engine object
   * (activity scheduler, event engine, RNG registry) cannot be policed by a
   * Proxy over the world-state object graph, so those engines call this at every
   * mutating entry point instead. Together the two layers cover both storage
   * styles: proxied plain-object sections and engine-held state.
   */
  assertOwner(systemId: SystemId): void {
    if (this.activeOwner === systemId) return;
    const violation: OwnershipViolation = {
      systemId: this.activeOwner ?? systemId,
      path: `engine:${systemId}`,
      expectedOwner: systemId,
      message:
        this.activeOwner === null
          ? `"${systemId}" state was mutated without an active system context`
          : `"${this.activeOwner}" attempted to mutate "${systemId}"-owned state`,
    };
    this.violations.push(violation);
    if (this.enforce) {
      throw this.activeOwner === null
        ? new MissingWriterContextError(`engine:${systemId}`)
        : new OwnershipViolationError(violation);
    }
  }

  /**
   * Runs `fn` with `owner` as the active writer. Nested mutation scopes are
   * rejected: nesting would hide which system actually performed a write.
   */
  mutate<T>(owner: SystemId, fn: () => T): T {
    if (this.activeOwner !== null) {
      throw new Error(
        `Nested mutation scope from ${owner} while ${this.activeOwner} was still writing`,
      );
    }
    this.activeOwner = owner;
    try {
      return fn();
    } finally {
      this.activeOwner = null;
    }
  }

  /** Reads do not require a writer context, and are not policed. */
  read<T>(fn: () => T): T {
    return fn();
  }

  checkWrite(path: string): void {
    const expected = this.expectedOwnerOf(path);
    const writer = this.activeOwner;

    if (writer === null) {
      const violation: OwnershipViolation = {
        systemId: "core",
        path,
        expectedOwner: expected,
        message: `No active system context while writing "${path}"`,
      };
      this.violations.push(violation);
      if (this.enforce) throw new MissingWriterContextError(path);
      return;
    }

    if (expected !== null && expected !== writer) {
      const violation: OwnershipViolation = {
        systemId: writer,
        path,
        expectedOwner: expected,
        message: `System "${writer}" attempted to write "${path}", which is owned by "${expected}"`,
      };
      this.violations.push(violation);
      if (this.enforce) throw new OwnershipViolationError(violation);
    }
  }

  private expectedOwnerOf(path: string): SystemId | null {
    const writer = this.activeOwner;
    if (writer && this.additionalWrites.get(writer)?.has(path)) return writer;

    if (path.startsWith("systems.")) {
      const systemId = path.slice("systems.".length) as SystemId;
      return systemId;
    }
    const section = path as StateSection;
    return SECTION_OWNERS[section] ?? null;
  }
}

/**
 * Narrow dependency for state-owning engines. An engine asks "am I the system
 * that is allowed to be writing right now?" without needing the whole guard,
 * which keeps engine modules testable with a tiny stub.
 */
export interface SystemScope {
  assertOwner(systemId: SystemId): void;
}

/** Stub scope for tests and headless tools that intentionally bypass the guard. */
export function permissiveScope(): SystemScope {
  return { assertOwner: () => undefined };
}

