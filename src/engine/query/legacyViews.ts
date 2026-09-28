/**
 * Continuity and legacy projections (U6; System 53, UI/UX 05/17).
 *
 * A life simulator that cannot show you how a life ended is not finished, and
 * one that *invents* an ending to fill the screen is worse. So this read is a
 * window onto whatever System 53 has actually recorded — and on a world that
 * began on 1 January 2042 with nobody dead, that window is legitimately empty.
 *
 * The empty case is not a stub. `docs/CONTENT_GAPS.md` records the project's own
 * stance on it: *"a v1 world genuinely had no determinations, no estates and no
 * heirs; manufacturing them would be invisible and would become canon."* So this
 * module reports the emptiness, says what will fill it, and — crucially — the
 * household roster is real data, so the surface says something true today even
 * when nothing has ended yet.
 *
 * Three distinctions the read keeps:
 *
 *   1. **`presumed` is not `witnessed`.** A determination carries its certainty
 *      and who made it, and the surface shows both rather than flattening every
 *      death into "died".
 *   2. **Evidence is referenced, never copied.** A determination names the facts
 *      it rests on; those facts stay in the systems that own them. The surface
 *      reports the count and the systems, and does not restate the facts.
 *   3. **A legacy is concrete.** There is no `legacyBonus` and no score for a
 *      life well lived. What passes on is named: an estate's items, the systems
 *      that own them, the beneficiaries, and a control transfer with its basis.
 */

import type { EntityId } from "../primitives/ids.ts";
import type { IdentityState } from "../identity/types.ts";
import type { CountriesSystemState } from "../countries/types.ts";
import type { FamilySystemState } from "../family/types.ts";
import type {
  BeneficiaryBasis,
  ContinuityDeathRecord,
  DeathCertainty,
  DeathDetermination,
  DeathDeterminer,
  EstateCase,
  EstateItem,
  LifeStatus,
  SuccessionBasis,
  SuccessionKind,
} from "../continuity/types.ts";
import { LifeContinuityEngine } from "../continuity/engine.ts";
import type { Simulation } from "../core/simulation.ts";
import { bag, displayNameOf, lifeStageOf, moneyLabel } from "./projections.ts";

const CERTAINTY_LABELS: Readonly<Record<DeathCertainty, string>> = {
  certain: "Certain",
  probable: "Probable — no one witnessed it",
  presumed: "Presumed — the record says so, not an eyewitness",
};

const DETERMINER_LABELS: Readonly<Record<DeathDeterminer, string>> = {
  medical: "a medical finding",
  witness: "an eyewitness",
  registration: "a civil registration",
  inference: "an inference from the facts",
};

const BASIS_LABELS: Readonly<Record<SuccessionBasis, string>> = {
  descendant: "a descendant of the person who held it",
  household: "someone in the household",
  beneficiary: "a named beneficiary",
  other_eligible: "another eligible person",
  declared: "a declared handoff",
};

const BENEFICIARY_BASIS_LABELS: Readonly<Record<BeneficiaryBasis, string>> = {
  will: "named in a will",
  designated: "designated directly",
  intestacy_descendant: "next of kin, as a descendant",
  intestacy_household: "next of kin, from the household",
  intestacy_parent: "next of kin, as a parent",
  intestacy_sibling: "next of kin, as a sibling",
};

const STATUS_LABELS: Readonly<Record<LifeStatus, string>> = {
  active: "Living",
  deceased: "Deceased",
  historical: "Historical — outside living memory",
};

/**
 * How a life ended, and what it left behind (System 53).
 *
 * Reads through `LifeContinuityEngine.peek` — the read-only handle M8 added so
 * that *reading* continuity cannot claim a state slot. Nothing here mutates, and
 * the household roster comes from Systems 19/16 as usual, so this surface says
 * something true even on a world where nothing has ended yet.
 */
export function getLegacyView(sim: Simulation, viewer: EntityId<"person">): LegacyView {
  const engine = LifeContinuityEngine.peek(sim.scope, sim.world);
  const identity = bag<IdentityState>(sim, "identity");
  const family = bag<FamilySystemState>(sim, "family");
  const countries = bag<CountriesSystemState>(sim, "countries");

  const nameOf = (personId: string): string =>
    displayNameOf(identity?.persons.find((candidate) => candidate.id === personId));
  const scaleOf = (code: string | undefined): number | undefined =>
    code === undefined
      ? undefined
      : countries?.currencies.find((entry) => entry.code === code)?.minorUnitScale;
  const ageOf = (personId: string): { ageLabel?: string; stage?: string } => {
    const person = identity?.persons.find((candidate) => candidate.id === personId);
    if (person === undefined) return {};
    const years = Math.max(
      0,
      Math.floor(
        ((sim.clock.time as number) - (person.birth.dateOfBirth as number)) / (365.2425 * 1440),
      ),
    );
    return { ageLabel: `${years} years`, stage: lifeStageOf(years) };
  };

  const determinationView = (determination: DeathDetermination): DeterminationView => ({
    personId: String(determination.personId),
    displayName: nameOf(String(determination.personId)),
    occurredAtLabel: sim.calendar.formatDateTime(determination.occurredAt),
    determinedAtLabel: sim.calendar.formatDateTime(determination.determinedAt),
    causeLabel: determination.cause,
    ...(determination.mechanism === undefined ? {} : { mechanism: determination.mechanism }),
    certainty: determination.certainty,
    certaintyLabel: CERTAINTY_LABELS[determination.certainty],
    determinedByLabel: DETERMINER_LABELS[determination.determinedBy],
    // The facts stay with the systems that own them; only the reference is shown.
    evidenceCount: determination.evidence.length,
    evidenceSystems: [...new Set(determination.evidence.map((fact) => fact.system))].sort(),
  });

  const recordView = (record: ContinuityDeathRecord): DeathRecordView => ({
    recordId: record.id,
    recordedAtLabel: sim.calendar.formatDateTime(record.recordedAt),
    causeLabel: record.cause,
    ...(record.civilRecordId === undefined ? {} : { civilRecordId: record.civilRecordId }),
  });

  const itemView = (item: EstateItem): EstateItemView => {
    const valuation = moneyLabel(item.valuation, scaleOf(item.valuation?.currency));
    return {
      id: item.id,
      kindLabel: (item.ref.kind as SuccessionKind).replace(/_/g, " "),
      // The owning system is shown so "who actually holds this" is never vague.
      systemLabel: item.ref.system,
      recordId: item.ref.recordId,
      ...(valuation === undefined ? {} : { valuationLabel: valuation }),
      ...(item.retainedReason === undefined ? {} : { retainedReason: item.retainedReason }),
    };
  };

  const estateView = (estate: EstateCase): EstateView => ({
    id: estate.id,
    deceasedName: nameOf(String(estate.deceasedId)),
    openedAtLabel: sim.calendar.formatDateTime(estate.openedAt),
    statusLabel:
      estate.status === "unclaimed" ? "Unclaimed — no eligible heir" : estate.status,
    ...(estate.settledAt === undefined
      ? {}
      : { settledAtLabel: sim.calendar.formatDateTime(estate.settledAt) }),
    items: estate.items.map(itemView),
    obligations: estate.obligations.map(itemView),
    beneficiaries: estate.beneficiaries.map((beneficiary) => ({
      personId: String(beneficiary.personId),
      displayName: nameOf(String(beneficiary.personId)),
      basisLabel: BENEFICIARY_BASIS_LABELS[beneficiary.basis],
      // The estate's own share, rounded for reading — not a recalculation.
      shareLabel: `${Math.round(beneficiary.share * 100)}%`,
    })),
    applications: estate.applications.map((application) => ({
      itemId: application.itemId,
      kindLabel: application.kind === "bequest" ? "handed on" : "debt settled",
      ...(application.beneficiaryId === undefined
        ? {}
        : { beneficiaryName: nameOf(String(application.beneficiaryId)) }),
      appliedAtLabel: sim.calendar.formatDateTime(application.appliedAt),
      appliedByLabel: application.appliedBy,
      ...(application.ledgerEntryId === undefined ? {} : { ledgerEntryId: application.ledgerEntryId }),
      ...(application.note === undefined ? {} : { note: application.note }),
    })),
    ...(estate.note === undefined ? {} : { note: estate.note }),
  });

  const household = (family?.households ?? []).find(
    (candidate) =>
      !candidate.dissolvedAt &&
      candidate.members.some((member) => member.personId === viewer && member.leftAt === undefined),
  );
  const currentMembers = (household?.members ?? []).filter((member) => member.leftAt === undefined);

  const householdViews: HouseholdMemberView[] = currentMembers
    .map((member) => {
      const status = engine.statusOf(member.personId);
      const age = ageOf(String(member.personId));
      return {
        personId: String(member.personId),
        displayName: nameOf(String(member.personId)),
        role: member.role,
        ...(age.ageLabel === undefined ? {} : { ageLabel: age.ageLabel }),
        ...(age.stage === undefined ? {} : { lifeStageLabel: age.stage }),
        status,
        statusLabel: STATUS_LABELS[status],
        isViewer: member.personId === viewer,
      } satisfies HouseholdMemberView;
    })
    .sort((a, b) => {
      const self = Number(b.isViewer) - Number(a.isViewer);
      return self !== 0 ? self : a.displayName.localeCompare(b.displayName);
    });

  // A "life that has ended" is a household member the engine no longer calls
  // active — deceased, or historical. Either way the person keeps their name and
  // their id; nothing here is an obituary written for them.
  const archivedLives: ArchivedLifeView[] = currentMembers
    .filter((member) => engine.statusOf(member.personId) !== "active")
    .map((member) => {
      const personId = String(member.personId);
      const determination = engine.determinationOf(member.personId);
      const record = engine.recordOf(member.personId);
      const estate = engine.estatesOf(member.personId)[0];
      return {
        personId,
        displayName: nameOf(personId),
        relationLabel:
          member.role === "head" ? "head of the household" : `recorded here as ${member.role}`,
        status: engine.statusOf(member.personId),
        statusLabel: STATUS_LABELS[engine.statusOf(member.personId)],
        ...(determination === undefined ? {} : { determination: determinationView(determination) }),
        ...(record === undefined ? {} : { record: recordView(record) }),
        ...(estate === undefined ? {} : { estate: estateView(estate) }),
      } satisfies ArchivedLifeView;
    });

  const householdIds = new Set(currentMembers.map((member) => String(member.personId)));
  const estates = engine
    .estates()
    .filter(
      (estate) =>
        householdIds.has(String(estate.deceasedId)) || String(estate.deceasedId) === String(viewer),
    )
    .map(estateView);

  const controlTransfers: ControlTransferView[] = engine.controlTransfers().map((transfer) => ({
    fromName: nameOf(String(transfer.fromPersonId)),
    toName: nameOf(String(transfer.toPersonId)),
    atLabel: sim.calendar.formatDateTime(transfer.at),
    basisLabel: BASIS_LABELS[transfer.basis],
    ...(transfer.estateId === undefined ? {} : { estateId: transfer.estateId }),
    ...(transfer.reason === undefined ? {} : { reason: transfer.reason }),
  }));

  const controllerId = engine.currentControllerId();
  const viewerStatus = engine.statusOf(viewer);

  const notes: string[] = [
    "There is no score for a life and nothing here adds one. What passes on is named: an estate's items and the systems that own them, the beneficiaries, and a control transfer with the basis it rests on.",
  ];
  if (archivedLives.length === 0 && estates.length === 0) {
    notes.push(
      "Nobody in your household has died and there is no estate open. System 53 writes a record only when a determination actually happens — this world began on 1 January 2042 with everyone alive, and manufacturing a death to fill this page would turn it into canon.",
    );
  }
  if (controlTransfers.length === 0) {
    notes.push(
      "No control handoff is on record, so you are controlling your own life. When one happens it names who passed what to whom and on what basis, and it never rewrites the person it came from.",
    );
  }

  return {
    viewerId: String(viewer),
    viewerStatus,
    viewerStatusLabel: STATUS_LABELS[viewerStatus],
    viewerIsAlive: viewerStatus === "active",
    household: householdViews,
    archivedLives,
    estates,
    controlTransfers,
    ...(controllerId === undefined ? {} : { currentControllerName: nameOf(String(controllerId)) }),
    viewerIsInControl: controllerId === undefined ? true : controllerId === viewer,
    notes,
  };
}

export interface DeterminationView {
  readonly personId: string;
  readonly displayName: string;
  readonly occurredAtLabel: string;
  readonly determinedAtLabel: string;
  readonly causeLabel: string;
  readonly mechanism?: string;
  readonly certainty: DeathCertainty;
  readonly certaintyLabel: string;
  readonly determinedByLabel: string;
  /** How many facts it rests on. The facts themselves stay with their owners. */
  readonly evidenceCount: number;
  /** Which systems hold those facts, so the reference is traceable. */
  readonly evidenceSystems: readonly string[];
}

export interface DeathRecordView {
  readonly recordId: string;
  readonly recordedAtLabel: string;
  readonly causeLabel: string;
  readonly civilRecordId?: string;
}

export interface EstateItemView {
  readonly id: string;
  readonly kindLabel: string;
  /** The owning system, so "who actually holds this" is never ambiguous. */
  readonly systemLabel: string;
  readonly recordId: string;
  readonly valuationLabel?: string;
  /** Why this did *not* pass on, when it did not. */
  readonly retainedReason?: string;
}

export interface BeneficiaryView {
  readonly personId: string;
  readonly displayName: string;
  readonly basisLabel: string;
  /** As a percentage in words; the estate's own share, not a recalculation. */
  readonly shareLabel: string;
}

export interface BequestView {
  readonly itemId: string;
  readonly kindLabel: string;
  readonly beneficiaryName?: string;
  readonly appliedAtLabel: string;
  readonly appliedByLabel: string;
  readonly ledgerEntryId?: string;
  readonly note?: string;
}

export interface EstateView {
  readonly id: string;
  readonly deceasedName: string;
  readonly openedAtLabel: string;
  readonly statusLabel: string;
  readonly settledAtLabel?: string;
  readonly items: readonly EstateItemView[];
  readonly obligations: readonly EstateItemView[];
  readonly beneficiaries: readonly BeneficiaryView[];
  readonly applications: readonly BequestView[];
  readonly note?: string;
}

export interface HouseholdMemberView {
  readonly personId: string;
  readonly displayName: string;
  readonly role?: string;
  readonly ageLabel?: string;
  readonly lifeStageLabel?: string;
  readonly status: LifeStatus;
  readonly statusLabel: string;
  readonly isViewer: boolean;
}

export interface ArchivedLifeView {
  readonly personId: string;
  readonly displayName: string;
  readonly relationLabel: string;
  readonly status: LifeStatus;
  readonly statusLabel: string;
  readonly determination?: DeterminationView;
  readonly record?: DeathRecordView;
  readonly estate?: EstateView;
}

export interface ControlTransferView {
  readonly fromName: string;
  readonly toName: string;
  readonly atLabel: string;
  readonly basisLabel: string;
  readonly estateId?: string;
  readonly reason?: string;
}

export interface LegacyView {
  readonly viewerId: string;
  readonly viewerStatus: LifeStatus;
  readonly viewerStatusLabel: string;
  readonly viewerIsAlive: boolean;
  readonly household: readonly HouseholdMemberView[];
  readonly archivedLives: readonly ArchivedLifeView[];
  readonly estates: readonly EstateView[];
  readonly controlTransfers: readonly ControlTransferView[];
  readonly currentControllerName?: string;
  readonly viewerIsInControl: boolean;
  readonly notes: readonly string[];
}

