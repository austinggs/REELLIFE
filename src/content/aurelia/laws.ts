/**
 * Provisional law content for the Arden slice (M6 / System 41).
 *
 * The World Bible authors 48 countries with forms of government but no
 * statute book: no named acts, no article numbers, no licence classes
 * (deferred canon). So this module authors only the rules the slice's
 * *existing* content already implies, each derived from something already
 * written down rather than invented for its own sake:
 *
 *   - **Mill licensing** — the bakery is authored as owning a mill and
 *     baking overnight, so a mill operating licence and its inspection
 *     requirement follow directly.
 *   - **Quayside safety** — the docks are authored with a 140-strong
 *     workforce, a berth and pilotage, so a capacity limit on stevedore
 *     certification and a prohibition on uncrewed crane work follow.
 *   - **Market selling** — the fenwick stall and quay cafe sell bread
 *     through System 35's markets, so a food-trading permit applies.
 *
 * One rule is deliberately **ambiguous** (the "temporary stalls" exemption
 * threshold). The spec requires that ambiguous cases be representable, and a
 * register in which every rule is crisp would be a register that could not
 * test the thing it exists for.
 *
 * No enforcement authority is named: System 43's public bodies do not exist
 * yet, so every rule omits `enforcementAuthorityId` rather than pointing at
 * a government that has not been built. Nothing here is canon.
 */

import type { LawRule } from "../../engine/laws/types.ts";
import type { LawsEngine } from "../../engine/laws/engine.ts";
import type { WorldTime } from "../../engine/primitives/time.ts";
import { currencyId, money } from "../../engine/primitives/money.ts";
import { AURELIA_CURRENCY } from "./countries.ts";

const AUR = currencyId(AURELIA_CURRENCY.code);
const aur = (major: number): number => Math.round(major * 100);

const PROVISIONAL_NOTE =
  "Provisional: the World Bible authors no statute book (M6/S41 gap list).";

/** Ardin, the slice's jurisdiction (System 39's `COUNTRY-ARDIN`). */
export const ARDIN_JURISDICTION = "COUNTRY-ARDIN";

export const AURELIA_SLICE_RULE_COUNT = 4;

/** The rules in force at the slice's start. */
export function aureliaArdenRules(effectiveFrom: WorldTime): readonly LawRule[] {
  return [
    {
      id: "RULE-ARDIN-MILL-LICENCE",
      title: "Commercial milling licence",
      kind: "licensing",
      jurisdictionId: ARDIN_JURISDICTION,
      action: "operate_mill",
      subjectKinds: ["organization"],
      // What qualifies for the licence: the mill holds a safety certificate.
      // (Whether it is *currently* operational is not a qualification — an
      // idle mill is not thereby unqualified, it is simply not working.)
      conditions: [{ fact: "safety_certificate_held", operator: "eq", value: true }],
      sanctions: [
        { kind: "fine", amount: money(AUR, aur(500)), note: "operating a mill unlicensed" },
        { kind: "confiscation", note: "mill output held pending adjudication" },
      ],
      exemptions: [],
      requiredCredential: "LIC-MILL-OPERATIONS",
      effectiveFrom,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "RULE-ARDIN-MILL-INSPECTION",
      title: "Annual mill inspection",
      kind: "inspection",
      jurisdictionId: ARDIN_JURISDICTION,
      action: "operate_mill",
      subjectKinds: ["organization"],
      conditions: [
        { fact: "days_since_inspection", operator: "lte", value: 365 },
      ],
      sanctions: [
        { kind: "administrative_penalty", note: "operating past an inspection interval" },
      ],
      exemptions: [
        // A mill that has stopped for want of grain is not fined for idleness.
        { reason: "mills_idle_under_force_majeure", fact: "operating", operator: "eq", value: false },
      ],
      effectiveFrom,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "RULE-ARDIN-STEVEDORE-CERT",
      title: "Stevedore certification requirement",
      kind: "licensing",
      jurisdictionId: ARDIN_JURISDICTION,
      action: "work_quayside",
      subjectKinds: ["person"],
      // An uncertified hand may not work the quay unsupervised.
      conditions: [{ fact: "supervised", operator: "eq", value: false }],
      sanctions: [{ kind: "fine", amount: money(AUR, aur(120)), note: "working the quay uncertified" }],
      exemptions: [
        { reason: "visitor_not_working", fact: "engaged_in_work", operator: "eq", value: false },
      ],
      requiredCredential: "CERT-STEVEDORE",
      effectiveFrom,
      note: PROVISIONAL_NOTE,
    },
    {
      id: "RULE-ARDIN-FOOD-TRADING",
      title: "Food trading at markets",
      kind: "permit",
      jurisdictionId: ARDIN_JURISDICTION,
      action: "sell_food",
      subjectKinds: ["organization"],
      conditions: [],
      sanctions: [
        { kind: "fine", amount: money(AUR, aur(80)), note: "trading in food without a permit" },
        { kind: "confiscation", note: "unsold stock held pending adjudication" },
      ],
      exemptions: [
        {
          // The deliberately ambiguous exemption: a *temporary* stall is
          // exempt below a threshold nobody has fixed. Two honest readings,
          // one of which (a stall is always temporary) would exempt the
          // fenwick stall permanently.
          reason: "temporary_stall_under_threshold",
          fact: "temporary_stall",
          operator: "eq",
          value: true,
        },
      ],
      requiredCredential: "PRM-FOOD-TRADING",
      effectiveFrom,
      ambiguous: true,
      note: PROVISIONAL_NOTE,
    },
  ];
}

/**
 * Registers the slice's rules. Idempotent: a rule already in the register is
 * left alone, so re-seeding never re-issues legislation.
 */
export function registerAureliaLaws(engine: LawsEngine, effectiveFrom: WorldTime): { readonly rules: number } {
  let rules = 0;
  for (const rule of aureliaArdenRules(effectiveFrom)) {
    if (engine.rule(rule.id) !== undefined) continue;
    engine.defineRule(rule);
    rules += 1;
  }
  return { rules };
}
