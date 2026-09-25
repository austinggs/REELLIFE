/**
 * ReelLife authority / access primitive (System 01 shared primitives, Systems 32/40/48).
 *
 * Authority is evaluated as:
 *
 *   actor + action + target + jurisdiction + time + role + credentials
 *   + ownership + permissions + legal status + organizational status
 *   + secrecy/access state -> allowed / denied / conditional
 *
 * Authority checks are reusable and must not be re-implemented per domain.
 * A denial always carries a human-understandable reason so the UI can state the
 * blocking reason without bypassing the authority model (UI/UX 07 section 3).
 */

import type { EntityId, EntityKind } from "./ids.ts";
import type { EntityRef } from "./entity.ts";
import type { WorldTime } from "./time.ts";

export const AUTHORITY_OUTCOMES = ["allowed", "denied", "conditional"] as const;
export type AuthorityOutcome = (typeof AUTHORITY_OUTCOMES)[number];

export const AUTHORITY_REASONS = [
  "no_rule_matched",
  "not_owner",
  "insufficient_credentials",
  "insufficient_clearance",
  "role_required",
  "legal_status_blocks_action",
  "jurisdiction_mismatch",
  "target_unavailable",
  "time_window_closed",
  "organization_status_blocks_action",
  "conditional_requirement",
] as const;
export type AuthorityReason = (typeof AUTHORITY_REASONS)[number];

export interface AuthorityRequest {
  readonly actor: EntityId<"person">;
  readonly action: string;
  readonly target?: EntityRef<EntityKind>;
  readonly jurisdiction?: EntityId<"country">;
  readonly time: WorldTime;
}

/**
 * Everything about an actor that authority decisions may legitimately consider.
 * Populated by the requesting domain from the systems that own each fact
 * (employment, legal identity, ownership, organizations, cognition).
 */
export interface AuthorityContext {
  readonly roles: readonly string[];
  readonly credentials: readonly string[];
  readonly permissions: readonly string[];
  readonly ownedRefs: readonly EntityRef[];
  readonly memberOf: readonly EntityRef[];
  readonly legalStatus: string;
  readonly secrecyClearance: number;
  /** Free-form domain facts a rule may consult, e.g. an organization's state. */
  readonly attributes?: Readonly<Record<string, string | number | boolean>>;
}

export interface AuthorityDecision {
  readonly outcome: AuthorityOutcome;
  readonly reasons: readonly AuthorityReason[];
  /** Conditions that must be met for a "conditional" outcome. */
  readonly conditions?: readonly string[];
  /** Rule that produced this decision, for observability (System 59). */
  readonly ruleId?: string;
}

export interface AuthorityRule {
  readonly id: string;
  /** Higher priority rules are evaluated first; ties break by registration order. */
  readonly priority: number;
  /** Returns false when the rule does not govern this request at all. */
  applies(request: AuthorityRequest): boolean;
  evaluate(request: AuthorityRequest, context: AuthorityContext): AuthorityDecision;
}

export const AUTH_WILDCARD = "*";

/** Declarative shape for the common "requirements" rule. */
export interface PermissionRequirement {
  readonly action: string;
  readonly requiresPermissions?: readonly string[];
  readonly requiresCredentials?: readonly string[];
  readonly requiresRoles?: readonly string[];
  readonly minimumClearance?: number;
  readonly requiresOwnershipOfTarget?: boolean;
  readonly requiresMembershipOfTarget?: boolean;
  readonly allowedLegalStatuses?: readonly string[];
}


export function fulfilRequirements(
  request: AuthorityRequest,
  context: AuthorityContext,
  requirement: PermissionRequirement,
): AuthorityDecision {
  const reasons: AuthorityReason[] = [];

  for (const permission of requirement.requiresPermissions ?? []) {
    if (!context.permissions.includes(permission)) reasons.push("insufficient_credentials");
  }

  for (const credential of requirement.requiresCredentials ?? []) {
    if (!context.credentials.includes(credential)) reasons.push("insufficient_credentials");
  }

  for (const role of requirement.requiresRoles ?? []) {
    if (!context.roles.includes(role)) reasons.push("role_required");
  }

  if (
    requirement.minimumClearance !== undefined &&
    context.secrecyClearance < requirement.minimumClearance
  ) {
    reasons.push("insufficient_clearance");
  }

  if (requirement.requiresOwnershipOfTarget) {
    const target = request.target;
    const owns = target
      ? context.ownedRefs.some((ref) => ref.id === target.id && ref.kind === target.kind)
      : false;
    if (!owns) reasons.push("not_owner");
  }

  if (requirement.requiresMembershipOfTarget) {
    const target = request.target;
    const member = target
      ? context.memberOf.some((ref) => ref.id === target.id && ref.kind === target.kind)
      : false;
    if (!member) reasons.push("role_required");
  }

  if (
    requirement.allowedLegalStatuses &&
    !requirement.allowedLegalStatuses.includes(context.legalStatus)
  ) {
    reasons.push("legal_status_blocks_action");
  }

  const unique = [...new Set(reasons)];
  return unique.length === 0
    ? { outcome: "allowed", reasons: [] }
    : { outcome: "denied", reasons: unique };
}

/**
 * Deterministic authority evaluator.
 *
 * Unmatched requests return "allowed" with reason `no_rule_matched`: an
 * explicit rule must exist to deny an action. This keeps the authority layer
 * from becoming a hidden second simulation that blocks behaviour nobody
 * specified, while still making every denial explainable.
 */
export class AuthorityEvaluator {
  private readonly rules: AuthorityRule[] = [];

  register(rule: AuthorityRule): void {
    this.rules.push(rule);
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  rulesOf(): readonly AuthorityRule[] {
    return this.rules;
  }

  check(request: AuthorityRequest, context: AuthorityContext): AuthorityDecision {
    for (const rule of this.rules) {
      if (!rule.applies(request)) continue;
      return rule.evaluate(request, context);
    }
    return { outcome: "allowed", reasons: ["no_rule_matched"] };
  }
}

