/**
 * System 41 — Laws & Regulatory Rules.
 *
 * "Law defines formal rules; it does not define what people will do or what
 * authorities will discover" (System 41 core principle).
 *
 * The system holds *rules as data*, and is strict about the four things it
 * is not, because every one of them is another system's:
 *
 *   1. **Enforcement is not law.** A rule says what is prohibited, required
 *      or licensed; whether anyone is caught is System 48's pipeline, and a
 *      violation here is a *fact* (this behaviour breached this rule), never
 *      a penalty applied.
 *   2. **Belief is not law.** What a person thinks the law says belongs to
 *      Systems 15/49 — someone may misunderstand, ignore, or exploit an
 *      ambiguity, and none of that changes the rule.
 *   3. **Jurisdiction is System 39's.** A rule *references* a jurisdiction
 *      id; it does not define territory, borders or sovereignty.
 *   4. **Authority is a shared primitive, not a second one.** `LawsEngine`
 *      projects its rules into the existing `AuthorityEvaluator`
 *      (`primitives/authority.ts`, architectural law 6) rather than
 *      inventing a permission check of its own.
 *
 * History is modelled as versioning rather than mutation: amending a rule
 * issues a **new rule id** that supersedes the old one and takes effect on
 * a date, so "the law before the reform" remains queryable and an act is
 * always judged against the law that was in force when it happened.
 */

import type { Money } from "../primitives/money.ts";
import type { WorldTime } from "../primitives/time.ts";

/** The kinds of rule the spec's law pipeline distinguishes. */
export const RULE_KINDS = [
  "permission",
  "prohibition",
  "obligation",
  "licensing",
  "inspection",
  "permit",
] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** What happens on breach. The *rule* names it; System 48 applies it. */
export const SANCTION_KINDS = [
  "fine",
  "license_revocation",
  "confiscation",
  "criminal_charge",
  "administrative_penalty",
  "injunction",
] as const;
export type SanctionKind = (typeof SANCTION_KINDS)[number];

export interface RuleCondition {
  /** The fact being tested, e.g. "hours_worked", "load_capacity". */
  readonly fact: string;
  /** One of eq/ne/lt/lte/gt/gte/in/not_in. */
  readonly operator: "eq" | "ne" | "lt" | "lte" | "gt" | "gte" | "in" | "not_in";
  /** The comparison value, interpreted per operator. */
  readonly value: string | number | boolean | readonly (string | number)[];
}

/** A sanction the rule *declares*; never one the system has applied. */
export interface RuleSanction {
  readonly kind: SanctionKind;
  readonly amount?: Money;
  readonly note: string;
}

/** An exemption is a named escape hatch, scoped to the rule itself. */
export interface RuleExemption {
  /** e.g. "emergency_service", "licensed_premises". */
  readonly reason: string;
  /** The fact that must hold for the exemption to apply. */
  readonly fact: string;
  readonly operator: RuleCondition["operator"];
  readonly value: RuleCondition["value"];
}

export interface LawRule {
  readonly id: string;
  readonly title: string;
  readonly kind: RuleKind;
  /** System 39's jurisdiction id this rule governs. */
  readonly jurisdictionId: string;
  /** The action this rule speaks to, e.g. "operate_mill", "sell_bread". */
  readonly action: string;
  /** Who the rule binds: "person", "organization", "vehicle", "good". */
  readonly subjectKinds: readonly string[];
  readonly conditions: readonly RuleCondition[];
  readonly sanctions: readonly RuleSanction[];
  readonly exemptions: readonly RuleExemption[];
  /** The authority that would enforce it (System 43's organizations). */
  readonly enforcementAuthorityId?: string;
  /** A licence, permit or credential the rule requires to act at all. */
  readonly requiredCredential?: string;
  readonly effectiveFrom: WorldTime;
  /** Omitted for a rule still in force. */
  readonly effectiveTo?: WorldTime;
  /** The rule this one replaces — an amendment is a new version, not an edit. */
  readonly supersedesRuleId?: string;
  /** Explicit when a rule's wording is genuinely unclear (the spec allows ambiguity). */
  readonly ambiguous?: boolean;
  readonly note?: string;
}

/** A licence/permit issued under a licensing rule. */
export interface Permit {
  readonly id: string;
  readonly ruleId: string;
  readonly holderId: string;
  readonly issuedAt: WorldTime;
  readonly expiresAt?: WorldTime;
  readonly status: "valid" | "expired" | "revoked";
  readonly revokedAt?: WorldTime;
  readonly revocationReason?: string;
}

export interface LawsSystemState {
  readonly rules: readonly LawRule[];
  readonly permits: readonly Permit[];
}

/** The verdict of asking the law about one act at one time. */
export interface LegalAssessment {
  /** `allowed` when nothing prohibits it and every condition is met. */
  readonly outcome: "allowed" | "conditional" | "prohibited";
  readonly jurisdictionId: string;
  readonly action: string;
  /** Rules that spoke, in force at the time asked. */
  readonly appliedRuleIds: readonly string[];
  /** Obligations the actor must still meet, named. */
  readonly obligations: readonly string[];
  /** Licences required and not held. */
  readonly missingCredentials: readonly string[];
  /** Sanctions a breach would carry, quoted from the rules — never applied. */
  readonly declaredSanctions: readonly RuleSanction[];
  /** Human-readable reasons, so a UI can state them without bypassing the model. */
  readonly reasons: readonly string[];
}

/** Facts a caller supplies about the act. Laws never infer them. */
export interface LegalFacts {
  readonly subjectKind: string;
  /** Licences/credentials the actor demonstrably holds. */
  readonly heldCredentials?: readonly string[];
  /** Free-form facts a rule's conditions test, e.g. { load_capacity: 900 }. */
  readonly facts?: Readonly<Record<string, string | number | boolean>>;
}

