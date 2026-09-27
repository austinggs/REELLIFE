/**
 * Laws engine (System 41).
 *
 * Owns `systems.laws`: the rule register (with jurisdiction, effective
 * dates, conditions, sanctions, exemptions and superseding versions) and the
 * permits issued under licensing rules. Every write asserts ownership on
 * that slot; reads are scope-free.
 *
 * Two design commitments run through the whole module:
 *
 *   - **Rules are immutable versions.** `defineRule` and `amendRule` only
 *     ever append. An act is judged by `rulesInForceAt`, so the law that
 *     applied when something happened can still be read afterwards — which is
 *     what makes a later prosecution of an older act possible at all.
 *   - **The engine decides legality, never enforcement.** `assess` returns
 *     what the law says, including the sanctions a breach *would* carry. It
 *     never records a penalty, a conviction or a seizure: that is System 48's
 *     pipeline, driven by evidence this system has no opinion about.
 */

import type { SystemScope } from "../core/access.ts";
import type { WorldState } from "../core/worldState.ts";
import type { AuthorityEvaluator, AuthorityRequest } from "../primitives/authority.ts";
import { AUTH_WILDCARD } from "../primitives/authority.ts";
import type { IdAllocator } from "../primitives/ids.ts";
import type { WorldTime } from "../primitives/time.ts";
import {
  RULE_KINDS,
  type LawRule,
  type LawsSystemState,
  type LegalAssessment,
  type LegalFacts,
  type Permit,
  type RuleCondition,
  type RuleExemption,
} from "./types.ts";

export class LawsEngine {
  private readonly scope: SystemScope;
  private readonly world: WorldState;

  constructor(scope: SystemScope, world: WorldState) {
    this.scope = scope;
    this.world = world;
    if (!this.world.systems.laws) {
      this.scope.assertOwner("laws");
      this.world.systems.laws = { rules: [], permits: [] } satisfies LawsSystemState;
    }
  }

  private get state(): LawsSystemState {
    return this.world.systems.laws as LawsSystemState;
  }

  private set state(value: LawsSystemState) {
    this.world.systems.laws = value;
  }

  // ---------------------------------------------------------------- reads ---

  rules(): readonly LawRule[] {
    return this.state.rules;
  }

  rule(id: string): LawRule | undefined {
    return this.state.rules.find((candidate) => candidate.id === id);
  }

  requireRule(id: string, caller: string): LawRule {
    const found = this.rule(id);
    if (found === undefined) {
      throw new Error(`LawsEngine.${caller}: unknown rule ${id}`);
    }
    return found;
  }

  /**
   * Whether a rule was in force at a moment. Derived from its dates, so an
   * amendment cannot retroactively make an old act legal or illegal.
   */
  isInForce(id: string, at: WorldTime): boolean {
    const rule = this.requireRule(id, "isInForce");
    if ((at as number) < (rule.effectiveFrom as number)) return false;
    return rule.effectiveTo === undefined || (at as number) < (rule.effectiveTo as number);
  }

  /**
   * Every rule governing a jurisdiction at a moment — including a superseded
   * rule that is still in force, because both can be true at once when an
   * amendment has a transition period.
   */
  rulesInForceAt(jurisdictionId: string, at: WorldTime): readonly LawRule[] {
    return this.state.rules.filter(
      (rule) => rule.jurisdictionId === jurisdictionId && this.isInForce(rule.id, at),
    );
  }

  /** The rule currently governing an action (the latest in force one). */
  ruleForAction(
    jurisdictionId: string,
    action: string,
    at: WorldTime,
  ): LawRule | undefined {
    const candidates = this.rulesInForceAt(jurisdictionId, at).filter(
      (rule) => rule.action === action || rule.action === AUTH_WILDCARD,
    );
    return candidates[candidates.length - 1];
  }

  /** The version history of one rule line: the original and every amendment. */
  ruleLine(ruleId: string): readonly LawRule[] {
    const start = this.requireRule(ruleId, "ruleLine");
    const line = [start];
    for (const candidate of this.state.rules) {
      if (candidate.supersedesRuleId !== undefined && line.some((entry) => entry.id === candidate.supersedesRuleId)) {
        line.push(candidate);
      }
    }
    return line;
  }

  permits(): readonly Permit[] {
    return this.state.permits;
  }

  permit(id: string): Permit | undefined {
    return this.state.permits.find((candidate) => candidate.id === id);
  }

  permitsOf(holderId: string): readonly Permit[] {
    return this.state.permits.filter((candidate) => candidate.holderId === holderId);
  }

  /**
   * A permit counts only if it is live *now*. Expiry is exclusive: a permit
   * whose term ends at an instant is already spent at that instant, which is
   * what `expirePermit` records — so the two can never disagree about the
   * boundary.
   */
  validPermitsOf(holderId: string, at: WorldTime): readonly Permit[] {
    return this.state.permits.filter(
      (candidate) =>
        candidate.holderId === holderId &&
        candidate.status === "valid" &&
        (candidate.expiresAt === undefined || (at as number) < (candidate.expiresAt as number)),
    );
  }

  /** Credentials a holder can prove: live permits, by the rule's slug. */
  credentialsHeldBy(holderId: string, at: WorldTime): readonly string[] {
    const held: string[] = [];
    for (const permit of this.validPermitsOf(holderId, at)) {
      const rule = this.rule(permit.ruleId);
      if (rule?.requiredCredential !== undefined && !held.includes(rule.requiredCredential)) {
        held.push(rule.requiredCredential);
      }
    }
    return held;
  }

  // -------------------------------------------------------------- derived ---

  /**
   * Asks the law about one act by one subject at one moment.
   *
   * The verdict is assembled from every rule in force that governs the
   * action: a prohibition or an unmet licence makes it `prohibited`, an
   * obligation or an unmet condition makes it `conditional`, otherwise
   * `allowed`. Sanctions are *quoted* from the rules — this system never
   * applies one, and saying so is deliberate: the distance between "the law
   * says a fine" and "a fine was imposed" is the whole gap between System 41
   * and System 48.
   */
  assess(
    jurisdictionId: string,
    action: string,
    facts: LegalFacts,
    at: WorldTime,
  ): LegalAssessment {
    // A rule speaks to an action *and* to a kind of subject. Matching on the
    // subject alone would make a mill licence govern bread selling, which is
    // how a registry quietly turns into a permission soup.
    const applicable = this.rulesInForceAt(jurisdictionId, at).filter(
      (rule) =>
        (rule.action === action || rule.action === AUTH_WILDCARD) &&
        (rule.subjectKinds.includes(facts.subjectKind) || rule.subjectKinds.includes(AUTH_WILDCARD)),
    );
    const held = facts.heldCredentials ?? [];
    const appliedRuleIds: string[] = [];
    const obligations: string[] = [];
    const missingCredentials: string[] = [];
    const declaredSanctions: LawRule["sanctions"][number][] = [];
    const reasons: string[] = [];
    let prohibited = false;
    let conditional = false;

    for (const rule of applicable) {
      // An exemption that genuinely applies takes the rule out of play.
      const appliedExemption = rule.exemptions.find((exemption) =>
        exemptionHolds(exemption, facts.facts ?? {}),
      );
      if (appliedExemption !== undefined) {
        reasons.push(`${rule.id} exempted (${appliedExemption.reason})`);
        continue;
      }
      appliedRuleIds.push(rule.id);
      const unmet = rule.conditions.filter((condition) => !conditionHolds(condition, facts.facts ?? {}));

      switch (rule.kind) {
        case "prohibition":
          if (unmet.length === 0) {
            prohibited = true;
            reasons.push(`${rule.id} prohibits ${action}`);
            declaredSanctions.push(...rule.sanctions);
          } else {
            conditional = true;
            reasons.push(`${rule.id} prohibits ${action} unless ${unmet.map(describeCondition).join(", ")}`);
          }
          break;
        case "licensing":
        case "permit": {
          if (rule.requiredCredential !== undefined && !held.includes(rule.requiredCredential)) {
            conditional = true;
            missingCredentials.push(rule.requiredCredential);
            reasons.push(`${rule.id} requires the ${rule.requiredCredential} licence`);
          } else if (rule.requiredCredential !== undefined) {
            obligations.push(`${rule.id}: hold a valid ${rule.requiredCredential}`);
          }
          if (unmet.length > 0) {
            conditional = true;
            reasons.push(`${rule.id} requires ${unmet.map(describeCondition).join(", ")}`);
          }
          break;
        }
        case "obligation":
        case "inspection":
          // Both are "you must comply" rules: the duty is listed whether or
          // not it is currently met, and a duty that is not met makes the
          // act conditional rather than quietly fine.
          obligations.push(`${rule.id}: ${rule.title}`);
          if (unmet.length > 0) {
            conditional = true;
            reasons.push(`${rule.id} requires ${unmet.map(describeCondition).join(", ")}`);
          }
          break;
        case "permission":
        default:
          // A permission with unmet conditions is a conditional allowance.
          if (unmet.length > 0) {
            conditional = true;
            reasons.push(`${rule.id} permits ${action} only if ${unmet.map(describeCondition).join(", ")}`);
          }
          break;
      }
    }

    return {
      outcome: prohibited ? "prohibited" : conditional ? "conditional" : "allowed",
      jurisdictionId,
      action,
      appliedRuleIds,
      obligations,
      missingCredentials,
      declaredSanctions,
      reasons,
    };
  }

  /** Every rule in force at a moment, across all jurisdictions. */
  private rulesInForceAtAll(at: WorldTime): readonly LawRule[] {
    return this.state.rules.filter((rule) => this.isInForce(rule.id, at));
  }

  /**
   * Projects the rule register into the shared authority evaluator, so one
   * permission check serves every domain (architectural law 6). Licensing
   * rules become credential requirements; prohibitions become denials that
   * name the rule they came from.
   */
  registerInto(evaluator: AuthorityEvaluator, at: WorldTime): number {
    let registered = 0;
    for (const rule of this.rulesInForceAtAll(at)) {
      evaluator.register({
        id: rule.id,
        priority: 0,
        applies: (request: AuthorityRequest) =>
          request.jurisdiction === rule.jurisdictionId &&
          (request.action === rule.action || rule.action === AUTH_WILDCARD),
        evaluate: (_request, context) => {
          if (rule.kind === "prohibition") {
            return { outcome: "denied", reasons: ["legal_status_blocks_action"], ruleId: rule.id };
          }
          const required = rule.requiredCredential;
          if ((rule.kind === "licensing" || rule.kind === "permit") && required !== undefined) {
            return context.credentials.includes(required)
              ? { outcome: "allowed", reasons: [], ruleId: rule.id }
              : { outcome: "denied", reasons: ["insufficient_credentials"], ruleId: rule.id };
          }
          return { outcome: "allowed", reasons: ["no_rule_matched"], ruleId: rule.id };
        },
      });
      registered += 1;
    }
    return registered;
  }

  // --------------------------------------------------------------- writes ---

  /**
   * Registers a rule. Rules are never edited afterwards: `amendRule` issues a
   * successor instead, so the law in force at any past moment stays readable.
   */
  defineRule(rule: LawRule): LawRule {
    this.scope.assertOwner("laws");
    if (this.rule(rule.id) !== undefined) {
      throw new Error(`LawsEngine.defineRule: rule ${rule.id} already exists`);
    }
    validateRule(rule, "defineRule");
    this.state = { ...this.state, rules: [...this.state.rules, rule] };
    return rule;
  }

  /**
   * Amends a rule: the old version is closed on the amendment's date and a
   * new rule id takes over from then. The original text is never touched, so
   * an act from last year is still judged by last year's law.
   */
  amendRule(
    successor: LawRule,
    at: WorldTime,
  ): LawRule {
    this.scope.assertOwner("laws");
    const previous = this.requireRule(successor.supersedesRuleId ?? "", "amendRule");
    if (this.rule(successor.id) !== undefined) {
      throw new Error(`LawsEngine.amendRule: rule ${successor.id} already exists`);
    }
    if (previous.jurisdictionId !== successor.jurisdictionId) {
      throw new Error(
        `LawsEngine.amendRule: ${successor.id} is in ${successor.jurisdictionId}, but ${previous.id} is in ${previous.jurisdictionId}`,
      );
    }
    if ((at as number) <= (previous.effectiveFrom as number)) {
      throw new Error(
        "LawsEngine.amendRule: an amendment cannot take effect before the rule it replaces",
      );
    }
    validateRule(successor, "amendRule");
    // Close the predecessor on the amendment date, then append the successor.
    this.state = {
      ...this.state,
      rules: [
        ...this.state.rules.map((rule) =>
          rule.id === previous.id ? { ...rule, effectiveTo: at } : rule,
        ),
        successor,
      ],
    };
    return successor;
  }

  /**
   * Issues a permit under a licensing rule. The rule must actually require
   * a credential, and the holder must satisfy the rule's conditions — a
   * permit is a record that the law's requirements were met, so issuing one
   * the rule forbids would make the register lie.
   */
  issuePermit(
    ids: IdAllocator,
    request: {
      readonly ruleId: string;
      readonly holderId: string;
      readonly facts?: Readonly<Record<string, string | number | boolean>>;
      readonly expiresAt?: WorldTime;
    },
    at: WorldTime,
  ): Permit {
    this.scope.assertOwner("laws");
    const rule = this.requireRule(request.ruleId, "issuePermit");
    if (rule.kind !== "licensing" && rule.kind !== "permit") {
      throw new Error(
        `LawsEngine.issuePermit: ${rule.id} is a ${rule.kind}, not a licensing rule`,
      );
    }
    if (!this.isInForce(rule.id, at)) {
      throw new Error(`LawsEngine.issuePermit: ${rule.id} is not in force at ${String(at)}`);
    }
    if (rule.requiredCredential === undefined) {
      throw new Error(`LawsEngine.issuePermit: ${rule.id} names no credential to issue`);
    }
    const unmet = rule.conditions.filter(
      (condition) => !conditionHolds(condition, request.facts ?? {}),
    );
    if (unmet.length > 0) {
      throw new Error(
        `LawsEngine.issuePermit: ${request.holderId} does not meet ${rule.id}: ${unmet.map(describeCondition).join(", ")}`,
      );
    }
    if (request.expiresAt !== undefined && (request.expiresAt as number) <= (at as number)) {
      throw new Error("LawsEngine.issuePermit: a permit cannot expire on the day it is issued");
    }
    const permit: Permit = {
      id: `prm-${ids.next("activity")}`,
      ruleId: rule.id,
      holderId: request.holderId,
      issuedAt: at,
      ...(request.expiresAt === undefined ? {} : { expiresAt: request.expiresAt }),
      status: "valid",
    };
    this.state = { ...this.state, permits: [...this.state.permits, permit] };
    return permit;
  }

  /**
   * Withdraws a permit. Revocation is a record with a reason, and the
   * credential stops counting immediately — but the permit itself stays, so
   * "was ever licensed" remains answerable.
   */
  revokePermit(id: string, at: WorldTime, reason: string): Permit {
    this.scope.assertOwner("laws");
    const permit = this.permit(id);
    if (permit === undefined) {
      throw new Error(`LawsEngine.revokePermit: unknown permit ${id}`);
    }
    if (permit.status === "revoked") {
      throw new Error(`LawsEngine.revokePermit: ${id} was already revoked`);
    }
    const revoked: Permit = { ...permit, status: "revoked", revokedAt: at, revocationReason: reason };
    this.state = {
      ...this.state,
      permits: this.state.permits.map((candidate) => (candidate.id === id ? revoked : candidate)),
    };
    return revoked;
  }

  /**
   * Marks a permit expired once its term has passed. Expiry is derived in
   * `validPermitsOf` as well; this records the fact so a register can show
   * it, without letting the two disagree (a permit read as expired must not
   * still be `valid` in the stored status).
   */
  expirePermit(id: string, at: WorldTime): Permit {
    this.scope.assertOwner("laws");
    const permit = this.permit(id);
    if (permit === undefined) {
      throw new Error(`LawsEngine.expirePermit: unknown permit ${id}`);
    }
    if (permit.status !== "valid") {
      throw new Error(`LawsEngine.expirePermit: ${id} is ${permit.status}`);
    }
    if (permit.expiresAt === undefined || (at as number) < (permit.expiresAt as number)) {
      throw new Error(`LawsEngine.expirePermit: ${id} has not reached its expiry date`);
    }
    const expired: Permit = { ...permit, status: "expired" };
    this.state = {
      ...this.state,
      permits: this.state.permits.map((candidate) => (candidate.id === id ? expired : candidate)),
    };
    return expired;
  }
}

// ---------------------------------------------------------- fact testing ---

/**
 * Tests one rule condition against caller-supplied facts.
 *
 * A fact that was not supplied does **not** pass: an unstated fact is
 * missing evidence, and treating it as satisfied would let a rule be
 * "complied with" by saying nothing about it. The spec's whole point is that
 * legal conditions are contextual and jurisdiction-specific.
 */
export function conditionHolds(
  condition: RuleCondition,
  facts: Readonly<Record<string, string | number | boolean>>,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(facts, condition.fact)) return false;
  const actual = facts[condition.fact];
  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "ne":
      return actual !== condition.value;
    case "lt":
      return typeof actual === "number" && typeof condition.value === "number" && actual < condition.value;
    case "lte":
      return typeof actual === "number" && typeof condition.value === "number" && actual <= condition.value;
    case "gt":
      return typeof actual === "number" && typeof condition.value === "number" && actual > condition.value;
    case "gte":
      return typeof actual === "number" && typeof condition.value === "number" && actual >= condition.value;
    case "in":
      return Array.isArray(condition.value) && condition.value.includes(actual as string | number);
    case "not_in":
      return Array.isArray(condition.value) && !condition.value.includes(actual as string | number);
    default:
      return false;
  }
}

function exemptionHolds(
  exemption: RuleExemption,
  facts: Readonly<Record<string, string | number | boolean>>,
): boolean {
  return conditionHolds(
    { fact: exemption.fact, operator: exemption.operator, value: exemption.value },
    facts,
  );
}

function describeCondition(condition: RuleCondition): string {
  return `${condition.fact} ${condition.operator} ${String(condition.value)}`;
}

// --------------------------------------------------------------- guards ---

function validateRule(rule: LawRule, caller: string): void {
  if (!RULE_KINDS.includes(rule.kind)) {
    throw new Error(`LawsEngine.${caller}: unknown rule kind ${String(rule.kind)}`);
  }
  if (rule.jurisdictionId.trim().length === 0) {
    throw new Error(`LawsEngine.${caller}: ${rule.id} names no jurisdiction`);
  }
  if (rule.action.trim().length === 0) {
    throw new Error(`LawsEngine.${caller}: ${rule.id} names no action`);
  }
  if (rule.subjectKinds.length === 0) {
    throw new Error(`LawsEngine.${caller}: ${rule.id} binds no subjects`);
  }
  if (rule.effectiveTo !== undefined && (rule.effectiveTo as number) <= (rule.effectiveFrom as number)) {
    throw new Error(`LawsEngine.${caller}: ${rule.id} ends before it begins`);
  }
  if ((rule.kind === "licensing" || rule.kind === "permit") && rule.requiredCredential === undefined) {
    throw new Error(
      `LawsEngine.${caller}: ${rule.id} is a ${rule.kind} rule but names no credential`,
    );
  }
}

