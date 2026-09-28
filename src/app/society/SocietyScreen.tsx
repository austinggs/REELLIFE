import { useState } from "react";
import { EmptyState } from "@/app/ui/EmptyState.tsx";
import { CoverageBadge } from "@/app/ui/CoverageBadge.tsx";
import { densityClasses, type UiDensity } from "@/app/ui/prefs.ts";
import type {
  CommunityView,
  EconomyView,
  InformationView,
  LawView,
  LegacyView,
} from "@/engine/query/index.ts";
import { Badge } from "@/ui/components/badge.tsx";
import { Button } from "@/ui/components/button.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/components/card.tsx";

const TABS = [
  { id: "law", label: "Law & records" },
  { id: "information", label: "Information" },
  { id: "community", label: "Community" },
  { id: "economy", label: "Economy" },
  { id: "continuity", label: "Continuity" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export interface SocietyScreenProps {
  readonly density: UiDensity;
  readonly law: LawView | null;
  readonly information: InformationView | null;
  readonly community: CommunityView | null;
  readonly economy: EconomyView | null;
  readonly legacy: LegacyView | null;
}

/** The standing notes a tab carries, rendered once in the same place. */
function Notes({ notes }: { readonly notes: readonly string[] }) {
  if (notes.length === 0) return null;
  return (
    <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
      {notes.map((note) => (
        <li key={note}>{note}</li>
      ))}
    </ul>
  );
}

/**
 * Society screen (U5; UI/UX 11, 15, 16).
 *
 * Four readings of the world around the viewer, and one rule running through all
 * of them: **a catalogue is not an experience.** The slice authors a law book, a
 * set of communities, a noticeboard network and three markets — and issues no
 * permits, records no memberships, circulates no claims and completes no sale.
 * So each tab shows the catalogue and the lived record as two separate things,
 * and never lets the first quietly imply the second.
 */
export function SocietyScreen({
  density,
  law,
  information,
  community,
  economy,
  legacy,
}: SocietyScreenProps) {
  const [tab, setTab] = useState<TabId>("law");
  const gap = densityClasses(density);

  return (
    <div className={`${gap} mx-auto max-w-4xl p-4`}>
      <div role="tablist" aria-label="Society sections" className="flex flex-wrap gap-2">
        {TABS.map((entry) => (
          <Button
            key={entry.id}
            role="tab"
            aria-selected={tab === entry.id}
            size="sm"
            variant={tab === entry.id ? "default" : "outline"}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </Button>
        ))}
      </div>

      <div
        role="tabpanel"
        aria-label={TABS.find((entry) => entry.id === tab)?.label}
        className={gap}
      >
        {tab === "law" ? <LawTab law={law} /> : null}
        {tab === "information" ? <InformationTab information={information} /> : null}
        {tab === "community" ? <CommunityTab community={community} /> : null}
        {tab === "economy" ? <EconomyTab economy={economy} /> : null}
        {tab === "continuity" ? <ContinuityTab legacy={legacy} /> : null}
      </div>
    </div>
  );
}

function LawTab({ law }: { readonly law: LawView | null }) {
  if (law === null) {
    return (
      <EmptyState
        title="No law to read"
        body="There is no one to live as yet, so there is no jurisdiction whose law applies to you."
      />
    );
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What you hold</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {law.permits.length === 0 ? (
            <EmptyState
              title="No licences or permits"
              body="A permit exists when something is actually issued to you. None has been. That is different from being free of obligation: the rules below bind whether or not you hold anything."
            />
          ) : (
            <ul className="space-y-2">
              {law.permits.map((permit) => (
                <li key={permit.id} className="rounded-md border p-3 text-sm">
                  <span className="font-medium">{permit.ruleTitle}</span>
                  <Badge variant="outline" className="ml-2 text-[10px] uppercase">
                    {permit.statusLabel}
                  </Badge>
                  <p className="text-xs text-muted-foreground">
                    issued {permit.issuedAtLabel}
                    {permit.expiresAtLabel === undefined
                      ? ""
                      : `, expires ${permit.expiresAtLabel}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">The rules in force</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {law.rules.length === 0 ? (
            <EmptyState
              title="No rules on record"
              body="System 41 holds no rules in this world, so there is no law book to read rather than a missing one."
            />
          ) : (
            <ul className="space-y-2">
              {law.rules.map((rule) => (
                <li key={rule.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{rule.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {rule.kindLabel}
                    </Badge>
                    <Badge
                      variant={rule.inForce ? "secondary" : "outline"}
                      className="text-[10px] uppercase"
                    >
                      {rule.inForceLabel}
                    </Badge>
                    {rule.provisional ? <CoverageBadge level="partial" /> : null}
                    {rule.bindsViewer ? (
                      <Badge variant="destructive" className="text-[10px] uppercase">
                        Binds you
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Governs "{rule.action}" in {rule.jurisdictionName}.
                    {rule.requiredCredential === undefined
                      ? ""
                      : rule.credentialHeld
                        ? ` Requires ${rule.requiredCredential}, which you hold.`
                        : ` Requires ${rule.requiredCredential}, which you do not hold.`}
                  </p>
                  {rule.ambiguous ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      The engine records this rule as ambiguous rather than resolving it.
                    </p>
                  ) : null}
                  {rule.sanctions.length === 0 ? null : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Breaking it means: {rule.sanctions.join("; ")}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Notes notes={law.notes} />
        </CardContent>
      </Card>
    </>
  );
}

function InformationTab({ information }: { readonly information: InformationView | null }) {
  if (information === null) {
    return (
      <EmptyState
        title="Nothing to report"
        body="There is no one to live as yet, so there is no viewpoint to hear anything from."
      />
    );
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">What is being said</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {information.claims.length === 0 ? (
            <EmptyState
              title="Nothing is circulating"
              body={`The graph holds ${information.nodeCount} people, places and organizations, and nothing has been said on any of it yet. System 49 stores a claim only once somebody has actually said something, so an empty list means the world has not started talking — not that the reporting has failed.`}
              coverage="partial"
            />
          ) : (
            <ul className="space-y-2">
              {information.claims.map((claim) => (
                <li key={claim.id} className="rounded-md border p-3 text-sm">
                  <p className="font-medium">{claim.text}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {claim.originLabel}
                    </Badge>
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {claim.statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {claim.subjectLabel} · said {claim.createdAtLabel} · source credibility{" "}
                    {claim.sourceCredibilityLabel} · {claim.exposureLabel}.
                  </p>
                  {claim.derivedFromClaimId === undefined ? null : (
                    <p className="text-xs text-muted-foreground">
                      Copied from another claim rather than seen first-hand.
                    </p>
                  )}
                  {claim.moderations.length === 0 ? null : (
                    <p className="text-xs text-muted-foreground">
                      Moderated: {claim.moderations.join("; ")}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
          <Notes notes={information.notes} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">How things get said</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {information.channels.length === 0 ? (
            <EmptyState
              title="No channels"
              body="Nothing in this world carries news between people yet."
            />
          ) : (
            <ul className="space-y-2">
              {information.channels.map((channel) => (
                <li key={channel.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{channel.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {channel.kindLabel}
                    </Badge>
                    {channel.moderated ? (
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        Moderated
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {channel.reachLabel}. Audience: {channel.audienceSize}.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function CommunityTab({ community }: { readonly community: CommunityView | null }) {
  if (community === null) {
    return (
      <EmptyState
        title="No community to read"
        body="There is no one to live as yet, so there is no person whose community this could be."
      />
    );
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Where you take part</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {community.viewerParticipation.length === 0 ? (
            <EmptyState
              title="You take part in none of them"
              body="There are communities here, and you are in none. Arriving somewhere changes what is available to you, never who you are — so this is an ordinary life, not a gap in the record."
            />
          ) : (
            <ul className="space-y-1 text-sm">
              {community.viewerParticipation.map((entry) => (
                <li key={entry} className="rounded-md border p-2">
                  {entry}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Communities available here</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {community.groups.length === 0 ? (
            <EmptyState
              title="No communities on record"
              body="System 44 holds no communities in this world. The World Bible authors none, so this is unpopulated rather than absent."
              coverage="partial"
            />
          ) : (
            <ul className="space-y-2">
              {community.groups.map((group) => (
                <li key={group.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{group.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {group.kindLabel}
                    </Badge>
                    {group.locationName === undefined ? null : (
                      <Badge variant="secondary" className="text-[10px] uppercase">
                        {group.locationName}
                      </Badge>
                    )}
                    {group.provisional ? <CoverageBadge level="partial" /> : null}
                  </div>
                  {group.traditions.length === 0 ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No tradition is recorded against this group.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {group.traditions.map((tradition) => (
                        <li key={tradition.id}>
                          {tradition.name} — {tradition.kindLabel} about {tradition.domainLabel}:{" "}
                          {tradition.stateLabel}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
          {community.normConflicts.length === 0 ? null : (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">Rules that cannot both be followed</h3>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {community.normConflicts.map((conflict) => (
                  <li key={conflict}>{conflict}</li>
                ))}
              </ul>
            </div>
          )}
          <Notes notes={community.notes} />
        </CardContent>
      </Card>
    </>
  );
}

function EconomyTab({ economy }: { readonly economy: EconomyView | null }) {
  if (economy === null) {
    return (
      <EmptyState
        title="No market to read"
        body="There are no markets in this world yet, so there is nothing to price."
      />
    );
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Markets and what they ask</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {economy.markets.length === 0 ? (
          <EmptyState
            title="No markets on record"
            body="System 35 holds no markets in this world, so there are no prices to show."
            coverage="partial"
          />
        ) : (
          <ul className="space-y-2">
            {economy.markets.map((market) => (
              <li key={market.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{market.name}</span>
                  <Badge variant="outline" className="text-[10px] uppercase">
                    {market.structureLabel}
                  </Badge>
                  {market.locationName === undefined ? null : (
                    <Badge variant="secondary" className="text-[10px] uppercase">
                      {market.locationName}
                    </Badge>
                  )}
                  {market.provisional ? <CoverageBadge level="partial" /> : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {market.sellerCount} sellers, and {market.concentrationLabel}.
                </p>
                <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                  {market.goods.map((good) => (
                    <li key={good.goodId}>
                      <span className="text-foreground">{good.goodName}</span> —{" "}
                      {good.priceLabel ?? "no price on record"} per {good.unit} ·{" "}
                      {good.tightnessLabel} · {good.taxLabel}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
        {economy.unlistedGoods.length === 0 ? null : (
          <p className="text-xs text-muted-foreground">
            In the catalogue but listed by no market: {economy.unlistedGoods.join(", ")}.
          </p>
        )}
        {economy.currencyNote === undefined ? null : (
          <p className="text-xs text-muted-foreground">{economy.currencyNote}</p>
        )}
        <Notes notes={economy.notes} />
      </CardContent>
    </Card>
  );
}

function ContinuityTab({ legacy }: { readonly legacy: LegacyView | null }) {
  if (legacy === null) {
    return (
      <EmptyState
        title="No life to follow yet"
        body="There is no one to live as yet, so there is no record of a life to read."
      />
    );
  }
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your life so far</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Your status</span>
            <Badge variant={legacy.viewerIsAlive ? "default" : "secondary"}>
              {legacy.viewerStatusLabel}
            </Badge>
          </p>
          <p className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Controlling your life</span>
            <span className="font-medium">
              {legacy.viewerIsInControl ? "You are" : (legacy.currentControllerName ?? "someone else")}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Lives in this household that have ended</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {legacy.archivedLives.length === 0 ? (
            <EmptyState
              title="None yet"
              body="Nobody you live with has died. This world began on 1 January 2042 with everyone alive, and a record here is written only when a determination actually happens — so an empty list is the truth, not a gap. A person's name and identity stay on the record either way: a death changes the world's state, it does not erase the person."
              coverage="partial"
            />
          ) : (
            <ul className="space-y-2">
              {legacy.archivedLives.map((life) => (
                <li key={life.personId} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{life.displayName}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {life.statusLabel}
                    </Badge>
                    <span className="text-xs text-muted-foreground">{life.relationLabel}</span>
                  </div>
                  {life.determination === undefined ? (
                    <p className="mt-1 text-xs text-muted-foreground">
                      No determination is on record for this life.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Determined {life.determination.determinedAtLabel}:{" "}
                      {life.determination.causeLabel}
                      {life.determination.mechanism === undefined
                        ? ""
                        : ` (${life.determination.mechanism})`} —{" "}
                      {life.determination.certaintyLabel}, by {life.determination.determinedByLabel}.
                      Rests on {life.determination.evidenceCount}{" "}
                      {life.determination.evidenceCount === 1 ? "fact" : "facts"} held by{" "}
                      {life.determination.evidenceSystems.join(", ") || "no system on record"}.
                    </p>
                  )}
                  {life.record === undefined ? null : (
                    <p className="text-xs text-muted-foreground">
                      Filed {life.record.recordedAtLabel}
                      {life.record.civilRecordId === undefined
                        ? ""
                        : ` under civil record ${life.record.civilRecordId}`}
                      .
                    </p>
                  )}
                  {life.estate === undefined ? null : (
                    <p className="text-xs text-muted-foreground">
                      Estate {life.estate.id} — {life.estate.statusLabel}.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your household</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {legacy.household.length === 0 ? (
            <EmptyState
              title="No household on record"
              body="You are not recorded as living with anyone, so there is no roster here."
            />
          ) : (
            <ul className="space-y-2">
              {legacy.household.map((member) => (
                <li key={member.personId} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{member.displayName}</span>
                    {member.isViewer ? <Badge className="text-[10px] uppercase">You</Badge> : null}
                    {member.role === undefined ? null : (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {member.role}
                      </Badge>
                    )}
                    <Badge
                      variant={member.status === "active" ? "secondary" : "outline"}
                      className="text-[10px] uppercase"
                    >
                      {member.statusLabel}
                    </Badge>
                  </div>
                  {member.ageLabel === undefined ? null : (
                    <p className="text-xs text-muted-foreground">
                      {member.ageLabel}
                      {member.lifeStageLabel === undefined ? "" : ` — ${member.lifeStageLabel}`}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Estates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {legacy.estates.length === 0 ? (
            <EmptyState
              title="No estate is open"
              body="An estate is opened when someone dies with property on record. Nobody you are related to is in that position yet."
            />
          ) : (
            <ul className="space-y-2">
              {legacy.estates.map((estate) => (
                <li key={estate.id} className="rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">Estate of {estate.deceasedName}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">
                      {estate.statusLabel}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Opened {estate.openedAtLabel}
                    {estate.settledAtLabel === undefined ? "" : `, settled ${estate.settledAtLabel}`}.
                  </p>
                  {estate.items.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No property is recorded against this estate.
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {estate.items.map((item) => (
                        <li key={item.id}>
                          {item.kindLabel} — held by {item.systemLabel}, record {item.recordId}
                          {item.valuationLabel === undefined ? "" : `, worth ${item.valuationLabel}`}
                          {item.retainedReason === undefined
                            ? ""
                            : `. Not handed on: ${item.retainedReason}`}
                          .
                        </li>
                      ))}
                    </ul>
                  )}
                  {estate.beneficiaries.length === 0 ? null : (
                    <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                      {estate.beneficiaries.map((beneficiary) => (
                        <li key={beneficiary.personId}>
                          {beneficiary.displayName} takes {beneficiary.shareLabel} —{" "}
                          {beneficiary.basisLabel}.
                        </li>
                      ))}
                    </ul>
                  )}
                  {estate.note === undefined ? null : (
                    <p className="text-xs text-muted-foreground">{estate.note}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Who has taken over</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {legacy.controlTransfers.length === 0 ? (
            <EmptyState
              title="No handoff has happened"
              body="You are controlling your own life. When control passes, the record names who passed it, to whom, and on what basis — and it never rewrites the person it came from."
            />
          ) : (
            <ul className="space-y-2">
              {legacy.controlTransfers.map((transfer) => (
                <li
                  key={`${transfer.fromName}->${transfer.toName}-${transfer.atLabel}`}
                  className="rounded-md border p-3 text-sm"
                >
                  <span className="font-medium">
                    {transfer.fromName} → {transfer.toName}
                  </span>
                  <p className="text-xs text-muted-foreground">
                    {transfer.atLabel} — {transfer.basisLabel}
                    {transfer.reason === undefined ? "" : ` (${transfer.reason})`}.
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Notes notes={legacy.notes} />
        </CardContent>
      </Card>
    </>
  );
}
