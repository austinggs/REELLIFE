# REELLIFE — PROGRESS

> **MANDATORY FOR EVERY AGENT/SESSION THAT WORKS HERE:**
> Read this file first. When you finish (or stop), **update it** — correct the
> status lines, add/remove rows below, and refresh the "Current position"
> section so the next session can resume from your exact stopping point.
> A stale `PROGRESS.md` is a bug; treat it like failing tests.
> Keep `docs/OWNERSHIP_MATRIX.md`, `docs/CONTENT_GAPS.md`,
> `docs/SOURCE_CONFLICTS.md` in sync when your change affects them.

Last updated: 2026-09-28 (UI build: U0 audit + U1-a/b design-system foundations done — text-scale wired, shared primitives landed.)
Gate: typecheck 0, lint 0, 83 files / 691 tests, `npm run build` OK, `npm run sim -- --check-determinism` PASS.

---

## Current position

**Phase: M8 COMPLETE (engine). All 59 approved systems are implemented** — 31
complete with canon-seeded content, 28 partial (engine built and tested, but the
playable slice does not populate them). `SIMULATION_VERSION = 2`; headless
determinism, save/load migrations with fixtures, performance budgets, the
accessibility policy and the content ledger all landed in M8.

**Current work: the UI build.** The M3 shell (8 screens, decision surface,
knowledge-filtered projections, accessibility policy) is the foundation, but the
engine is far ahead of it. U0 (audit) and U1-a/b (design-system foundations) are
complete. Visual direction is **atmospheric / game-like** (owner-approved). Still
missing: the new surfaces (Law & Records, Economy, Information, Community,
Continuity/Legacy), a spatial SVG map (markers are currently a flat list), list
virtualisation, genealogy and supply-chain graphs, and the chart/moment layers.

Gate now: typecheck 0, lint 0, 83 files / 691 tests, build OK, determinism PASS.

_Historical milestone detail (M6 and earlier) follows, kept for the record._

### The two DoD scenarios

- **`tests/scenarios/legalPipelineScenario.test.ts`** (41 + 48) — a theft at the
  mill that nobody noticed and that therefore never becomes a case, and one that
  runs the whole way to a conviction, its declared sanctions applied and then
  vacated on appeal. Asserts a cross-jurisdiction charge is refused, that
  *declaring* a sanction is not *applying* one, and that it reproduces.
- **`tests/scenarios/rumourPropagationScenario.test.ts`** (49 + 22) — a false
  claim reaches the neighbourhood, those who heard it form a view about the mill's
  reliability, and only afterwards is it verified false by a named method and
  record. Asserts truth and belief diverge and that verifying convinces nobody.

### The last three systems

- **System 21 (conflict)** — `src/engine/conflict/`: conflicts with their stage,
  parties (position, underlying interest, contextual power, informedness,
  beliefs), claims with the world's answer, offers, concessions, agreements,
  apologies and reconciliations. A dispute creates **nothing** but a dispute — the
  test asserts no `systems.security` slot even exists afterwards. `unresolved` is a
  terminal state, not a failure: an agreement that meets every stated term but no
  underlying interest ends `unresolved`, which is the spec's "persistent
  unresolved tension". `tests/kernel/conflict.test.ts` (10).
- **System 20 (parenting)** — `src/engine/parenting/`: caregiving relationships
  across six caregiver kinds, care observations, discipline, mistakes,
  independence on five dimensions, care events. `careReading` names its binding
  constraint, so "this child is not doing well" always arrives with "because". There
  is **no parenting-style enum** — the spec rules one out and any such field would
  smuggle in a moral judgment; a mistake with no `discoveredAt` stays unnoticed.
  `tests/kernel/parenting.test.ts` (9).
- **System 52 (international relations)** — `src/engine/international/`:
  bilateral standing **per domain per pair** (allies and rivals are the same pair,
  and the pair key is sorted so A|B and B|A cannot become two records), treaties
  that stay on the record when suspended, sanctions by scope, declared global
  shocks with a per-country route, migration pressure, and international
  organizations as membership lists over System 32. A sanction is a *condition*
  that names itself; no price is ever touched. `tests/kernel/international.test.ts`
  (9).

### Content and seeding

Systems **20, 21 and 52** have complete engines and tests but **no Aurelia
content and no seed**, joining 22, 50, 42 and 43. The World Bible authors no named
disputes, feuds, wars or local parenting situations, and inventing some to make
the seed look fuller would be the wrong trade. Systems **41, 44, 48, 49 and 51**
do have seeded content, each derived from slice content that already exists; every
provisional decision is recorded in `docs/CONTENT_GAPS.md`.

**M7 is now landed** (see the block at the end of this file).

- **`tests/scenarios/legalPipelineScenario.test.ts`** (41 + 48) — a theft at
  the mill: one that nobody noticed and that therefore never becomes a case,
  and one that was noticed and runs the whole way to a conviction, its
  declared sanctions applied and then vacated on appeal. Asserts that a charge
  is refused under another jurisdiction's rule, that *declaring* a sanction is
  not *applying* one, and that the whole run reproduces from its seed.
- **`tests/scenarios/rumourPropagationScenario.test.ts`** (49 + 22) — a false
  claim about the mill reaches the neighbourhood, those who heard it form a
  view about its reliability, and only afterwards is the claim verified false
  by a named method and evidence. Asserts truth and belief diverge, that
  verifying changes nobody's mind, and that the views stay per observer.

- **System 48 (security & legal pipeline)** — `src/engine/security/{types,engine,index}.ts`:
  incidents, detection, cases, evidence, charges, hearings, penalties, appeals,
  criminal operations and security history. The load-bearing decisions are that
  **an incident is not a case** (detection may fail, and a case cannot be opened
  on something nobody noticed), that a **charge is not a conviction** (a charge
  copies System 41's *declared* sanctions; only a hearing *applies* one), that
  **evidence cuts both ways** (a charge with nothing admissible is dismissed,
  and a false accusation reaches acquittal rather than being merely unlikely),
  that **jurisdiction is checked** (a cross-border charge is refused at the
  door), and that **an appeal vacates rather than erases**.
  `tests/kernel/security.test.ts` (14).
- **System 22 repairs** — four real defects found while writing the rumour
  DoD, all fixed and now regression-tested: `staleDays` was measured in *years*
  and then divided by 365 again, so **decay never actually decayed**; decay
  faded toward 0.5 rather than 0, so a reputation of -1 decayed into +0.5 and
  the world slowly forgave; `assertPerception` validated a value and then threw
  it away, so an asserted reputation read as though nobody had said anything;
  and asserted values were validated 0..1, making it impossible to be talked
  about badly. Asserting now also *preserves* evidence instead of wiping it.

**M7 is now landed** (see the block at the end of this
file). The System 26 (ownership/contracts) dependency was settled in favour of
expressing every bequest as a reference to an existing owner.

M5 landed so far (Systems 33, 35, 34 — all uncommitted in git; the user
commits):

- **System 33 (businesses)** — `src/engine/businesses/{types,engine,index}.ts`:
  commercial side of System 32 orgs (forms, lifecycle transitions, offerings,
  seven capacity dimensions with a computed binding constraint, derived roster
  from System 24, derived cash flow from System 25, failure signals that refuse
  to infer `poor_management`). Content: five provisional Arden businesses in
  `src/content/aurelia/businesses.ts` (grain cooperative, mill bakery, docks,
  quay cafe, quay trader), seeded from `sliceSeed` in dependency order so the
  supplier graph is acyclic by construction. `tests/kernel/businesses.test.ts` (4).
- **System 35 (markets)** — `src/engine/markets/{types,pricing,engine,index}.ts`:
  prices are *formed*, never authored: `formPrice` applies landed cost +
  transport → scarcity → structure → tax → expectation → cost floor →
  regulated ceiling, and returns the driver list that accounts for the quote
  to the minor unit. The engine owns the goods catalogue, three local Arden
  markets, participants/entry/exit, demand/supply observation, stock
  receive/withdraw and recorded transactions (money stays System 25's,
  referenced by `ledgerEntryId`). Content: seven goods + three markets in
  `src/content/aurelia/markets.ts`. `tests/kernel/markets.test.ts` (9).
- **System 34 (supply chains & B2B)** — `src/engine/supplyChains/{types,engine,index}.ts`:
  supplier offers (unit price, lead time, capacity, provisional assessments,
  suspension), supply dependencies, purchase orders with the lifecycle
  `issued → accepted → in_transit → received/cancelled/breached`, and
  append-only supply-chain history. Cascades are **derived from the graph**:
  `cascadeFrom` walks dependents breadth-first in registration order (a
  suspension propagates nothing by fiat — `shortages`/`supplyGap` read it off
  capacity + suspension state), `concentration` quantifies correlated-disruption
  exposure, `reliability` is computed from completed orders (late counts
  against), `substitutionCandidates` ranks every other source for the input on
  the declared `SUBSTITUTION_WEIGHTS` with unavailable sources visible and
  zeroed, and `switchSupplier` records the switch with its cost. Lead times put
  logistics lag inside the agreement (`dueAt = placedAt + leadTime`), and
  `breachExpiredOrders` turns a passed due date into a breach deterministically.
  Content: five offers + five dependencies mirroring the System 33
  supplier/customer links, in `src/content/aurelia/supplyChains.ts`, seeded
  after businesses. `tests/kernel/supplyChains.test.ts` (8).
  Gaps logged in `docs/CONTENT_GAPS.md` (M5 section): no delivery/breach Events
  emitted yet, PO settlement/landing is by reference (caller posts the System 25
  ledger entry and System 35 `receiveStock`), substitution weights and supplier
  assessments provisional, lead times authored from the Bible's operations.
  `docs/OWNERSHIP_MATRIX.md` gained the `businesses`/`supplyChains`/`markets`
  slot rows. Also fixed two stale test expectations found while closing the
  markets suite (tax assertion was below the cost floor; the cafe's binding
  constraint is `capital` at 0.55, not `staffing`) — both were wrong
  assumptions in the tests, not engine bugs.
- **System 36 (macroeconomic layer)** — `src/engine/macro/{types,engine,index}.ts`:
  the system *samples* lower-level activity and derives the indicators over
  stated windows. `observePriceIndex`/`observeLaborMarket`/`observeOutput`/
  `observeAggregates` store timestamped samples (upserted per instant, so
  re-seeding cannot duplicate), and `inflation`, `unemployment`, `outputGrowth`,
  `productivity`, `productivityGrowth`, `aggregateGap`, `purchasingPowerChange`
  answer from them — returning **`undefined` when no sample spans the window**
  rather than a guessed number, which is what makes lag visible. `raiseShock`/
  `liftShock` are explicit conditions that never edit an observation, and
  `downturnSignals()` returns named facts in a fixed order instead of
  collapsing them into a "recession" verdict nobody defined. Content seeds only
  two first-frame facts (price index 100, a provisional credit environment) —
  no invented labour force for the slice. `tests/kernel/macro.test.ts` (7).
- **System 28 (transportation & vehicles)** —
  `src/engine/transport/{types,engine,index}.ts`: vehicle instances with
  condition, energy, capacity, owner/operator/location, registration history
  and maintenance state; public transit services with fares and real seat
  capacity; and named disruptions (breakdown, road closure, accident,
  cancellation, fuel shortage, weather). Three boundaries are enforced rather
  than assumed: **routes stay System 45's** (a service references a
  `TransportRoute.id`; the seed resolves a real road route out of Arden, so
  28 cannot disagree with the network), **"broken" is derived** from the
  condition number through `dispatchable` (no stored flag can contradict it),
  and **weather/traffic are caller-supplied** conditions that move
  `estimateTrip`'s duration and risk without changing what the vehicle is.
  `estimateTrip` layers condition over System 45's route baseline and names
  every reason it refuses a trip (dry tank, worn, in the workshop).
  `boardService` refuses to overbook. Content authors four vehicles owned by
  real slice organizations and one docks works coach (the docks are authored
  with 140 shift workers — a works coach is what that implies), and
  **deliberately no municipal transit system**, because the slice has no civic
  organization and inventing one to own a bus would be fiction wearing a
  schema; that gap is logged rather than filled. `tests/kernel/transport.test.ts` (6).
  One real wiring bug fixed on the way: the seed read System 45 outside a
  scope, but the `TravelEngine` constructor initializes its own state on first
  construction, so that read needs its own `travel` scope (scopes never nest).
- **System 31 (insurance & risk management)** —
  `src/engine/insurance/{types,engine,index}.ts`: policies (insurer, holder,
  subject, coverage, limit, deductible, premium, risk score, exclusions,
  beneficiaries, dates, status, history) and claims on the spec's own
  lifecycle graph, with `disputed` / `fraud_suspected` / `appealed` as
  first-class reviewable states. The discipline is what the system *does
  not* own: incidents stay with the system that witnessed them (a claim
  keeps their reference verbatim), and **payouts are arithmetic** —
  `payoutOf(assessed, deductible, remainingCover)` is written once, and
  approval, pre-approval quotes, deductible application and limit capping
  all read from it, so partial coverage cannot be a decision someone makes.
  Money stays System 25's: a paid claim stores the caller's `ledgerEntryId`.
  `quotePremium` rates from the spec's own inputs (probability, severity,
  exposure, claims history, competition, regulation) and returns each
  component separately, so a dear market is never confused with a risky
  subject. `claimsHistoryScore` derives the holder's rating input from their
  own claims. Content: the **grain cooperative's mutual assurance society**
  underwrites two vehicle policies over slice vehicles — a mutual society is
  what the co-op's authored "member_share_payouts" policy implies, and it
  keeps every party a real System 32 organization. `tests/kernel/insurance.test.ts` (8).
- **System 23 (education)** — `src/engine/education/{types,engine,index}.ts`:
  programs run by System 32 organizations, enrollments on the spec's full
  state graph (applied/admitted/enrolled/active/suspended/leave/withdrawn/
  dropped/completed/expelled/transferred/deferred), attendance kept as its
  own fact (**attendance is not enrollment** — a student can hold a seat and
  never attend), institutional assessments, and credentials carrying named
  recognising authorities. The spec's warnings are enforced rather than
  assumed: `assessAccess` weighs the spec's own list of dependencies
  (affordability, legal eligibility, distance, transport, accommodation,
  resources, language, family duties, employment, childcare, safety) with
  burdens inverted, and names every blocker below the floor, so access
  inequality is a record rather than a mystery. Grades are stored as the
  institution's scored opinion with a named assessor and never feed System
  14 — "credentials are formal recognition, competence is not". Capacity
  bites at admission (`classSize`/`availableSeats`), transfers keep both ends
  of the move, and `retentionRate` is derived from the enrollments. Content:
  the **docks' stevedore certification** and the **bakery's flour-milling
  course** — both run by slice organizations that already need the work, so
  no school was invented — and the player is seeded with an *application*,
  never a seat, because taking it is System 17's decision. Seeded after
  materialization (the applicant is a real person) and uses `sim.ids`, the
  live allocator, not the persisted snapshot. `tests/kernel/education.test.ts` (8).
- **M5 DoD, item 1 — reproducible market-shock scenario**
  (`tests/scenarios/marketShockScenario.test.ts`): one grain-cooperative
  failure carried through four systems in causal order, each in its own
  ownership scope (the guard rejects nested mutation): the gap and cascade come
  off the System 34 graph, the bakery stops so the cafe has no substitute, the
  mill market re-forms a higher bread price with a positive scarcity driver,
  and System 36 shows the level jump in a stated window — then, a year on, the
  same level is no longer inflation, because a one-off supply shock raises
  prices once. The test also asserts the *whole world* is reproducible: two
  runs from the same seed produce the same `stateHash()`.
- **M5 DoD, item 2 — ledger conservation as a property**
  (`tests/invariants/ledgerConservation.test.ts`): 10 000 transfers driven by a
  local LCG (never `Math.random`) through System 25, then every balance is
  re-derived independently from the opening deposits plus the ledger, and the
  total is asserted unchanged. Self-pairs are re-drawn rather than skipped, so
  the count of entries really is 10 000 — the first version of this test
  silently posted 9 134 and the property was weaker than it looked.

M6 in progress (Systems 41 — laws & regulatory rules; 49 — information / communication / media):

- **System 41 (laws & regulatory rules)** —
  `src/engine/laws/{types,engine,index}.ts` plus `src/content/aurelia/laws.ts`
  and `tests/kernel/laws.test.ts` (9). The system holds *rules as data* and
  is strict about the four things it is not, because each is another
  system's: **enforcement is not law** (a rule declares sanctions and
  `assess` quotes them; there is no field in the register in which a fine or
  a conviction could be recorded — that is System 48's), **belief is not
  law** (what someone thinks the law says is Systems 15/49's), **jurisdiction
  is System 39's** (a rule references a country id and never defines
  territory), and **authority is the shared primitive** — `registerInto`
  projects the register into the existing `AuthorityEvaluator` rather than
  inventing a second permission model (architectural law 6).
  Three design commitments run through it:
  - **Rules are immutable versions.** `amendRule` closes the predecessor on
    the amendment date and appends a successor, so the law in force when an
    act happened stays readable and an older act remains prosecutable.
  - **An unstated fact is never compliant.** `conditionHolds` returns false
    for a fact the caller did not supply: silence is missing evidence, not
    compliance.
  - **Ambiguity stays ambiguous.** One seeded rule is flagged `ambiguous`
    because "a temporary stall under threshold" never defines either term;
    the engine applies the text as written, and the test suite amends it into
    a defined footprint rather than quietly resolving it.
  Content authors four rules for `COUNTRY-ARDIN`, each derived from
  something already written down (the bakery's mill, the docks' 140-strong
  quay workforce, the market stalls), and **names no enforcement authority**
  on any rule — System 43 does not exist yet, and pointing at a government
  that cannot be resolved is worse than omitting it.
  Four bugs surfaced while landing this, three of them in the engine and all
  four found by tests rather than by reading:
  - `assess` matched rules on subject kind alone, so a mill licence governed
    bread selling. Rules now match on action *and* subject.
  - `inspection` rules listed their obligation but ignored unmet
    conditions, so an overdue mill read as "allowed". Inspection and
    obligation are both "you must comply" rules and now behave alike.
  - A permit was still "valid" at the very instant it expired, yet could also
    be marked expired there. Expiry is now exclusive, so the derived reading
    and the recorded status cannot disagree.
  - My own first test asserted the mill licence conditioned on the mill
    being *operational*, which is not a qualification — an idle mill is not
    thereby unqualified. The rule now conditions on a safety certificate.
  And one test-side repeat of a mistake already made in the transport suite:
  re-seeding from inside an open `laws` scope, which the guard correctly
  rejected.
- **System 49 (information / communication / media)** —
  `src/engine/information/{types,engine,index}.ts`, `src/content/aurelia/information.ts`,
  `tests/kernel/information.test.ts` (8). The system turns on one distinction
  it is forbidden to collapse: **a claim is not a fact**. Every claim starts
  `unverified` — including one from an official source — and `verifyClaim`
  refuses a status change without both a *method* and an *evidence
  reference*, because "I checked it" is not auditable and a status change
  with no evidence is how a rumour becomes a fact by decree. **Exposure is
  not belief**: an `Exposure` records that a node was *reached*, and nothing
  here stores what anyone concluded — that is System 15's, and the M6 DoD
  asserts truth-vs-belief divergence by comparing the world's own record
  with who was reached. **Truth belongs to the world**: a claim points at a
  subject ref and this system never evaluates it. **Transport is System
  50's**: a channel here is an audience and a reach, not a queue.
  Propagation is derived from declared factors (credibility .4, novelty .3,
  emotional charge .3, channel reach, node openness, hop and retell decay)
  and consults **no RNG**, so a rumour's spread is reproducible — not how
  rumours work in life, and the price of being able to assert that one
  spread. Corrections chain forwards, disputes are recorded on both sides,
  forgetting is per-listener and keeps the record, and `isPropagatable`
  deliberately refuses to treat "unverified" as "suppressed": only an
  explicit removal stops a claim, because conflating the two is how a rumour
  engine becomes a censorship engine.
  Two things worth recording:
  - **The type had to be renamed.** The kernel already has an
    `InformationClaim` primitive — the *observer-facing* claim a projection
    hands the UI, with `knownBy` and visibility. System 49's record is the
    world-side one, so it is `CirculatingClaim`. The two are related but not
    the same, and shadowing the primitive would have quietly duplicated it.
  - **I invented an organization id.** The content referenced
    `ORG-QUAY-TRADER`, which does not exist; the slice's fifth business is
    `ORG-FENWICK-STALL`. Caught by the test that asserts every seeded node
    is a real System 32 organization, which is the check that exists for
    exactly this. Three further test-fixture errors were mine too (an
    audience with nobody in it, a "correct twice" assertion that would not
    throw, and `addTime` given a raw number instead of a `Duration`).
  Content authors two notice boards the slice's content implies and **no
  claims at all**: a claim needs an author and an audience, and inventing
  both at seed time would put words in residents' mouths before anyone had
  spoken.

M4 landed (Systems 37, 38 slice, 39, 45, 46, 47, 56 + full world canon):

- **`src/content/aurelia/canon.ts`** — the complete World Bible content as data:
  6 continents (with canonical ~6.8B population targets), 5 oceans, 36 regions,
  48 countries, 34 major settlements, 4 mountain systems, 5 rivers, 6 corridors,
  8 history eras, 6 language families, 7 religions, 17 active world
  developments. `tests/content/aureliaCanon.test.ts` pins the M4 DoD counts
  (6/5/36/48/34), unique IDs, coordinate bounds and referential integrity.
- **`src/content/aurelia/geography.ts`** — the full `WORLD-AURELIA` hierarchy
  (`registerAureliaWorldGeography`) with stable `LocationRef`s, districts for
  Arden, and historical names (`CITY-ARDEN` → "Old Arden" / "Porte-Ardan").
  `GeographyEngine` gained `findByHistoricalName` / `historicalNamesOf`.
- **`src/engine/travel/`** (System 45) — `TransportRoute`, `ActiveJourney`,
  `TravelHistoryEntry`, and `generateCanonicalRoutes()` building the rail/road/
  maritime/flight network from the six corridors plus intercontinental links.
  `TravelEngine` owns active journeys and travel history; `ScaleEngine` gained
  `relocateResident` for cross-settlement movement.
- **`src/engine/population/`** (System 47) — `PopulationAggregate` per
  continent/country/region/settlement and `PopulationEngine`. The canonical
  `distributeAureliaPopulation()` in `src/content/aurelia/population.ts` splits
  the 6.8B deterministically (stable `fnv1a32` weights, exact integer sums at
  every additive level, per-country urbanisation in [0.55, 0.85] around the ~70%
  canon). Provisional — logged in `docs/CONTENT_GAPS.md`.
- **`src/engine/environment/`** (System 46) — weather, pollution/degradation,
  hazard conditions and the disaster pipeline. Weather is *derived*, not rolled:
  `deriveWeather(climate, latitude, month, place)` is deterministic and
  location-dependent (no RNG consumption), and hazards emerge from hazard ×
  exposure × vulnerability instead of a "disaster chance" number. The engine owns
  `systems.environment`, enforces the six-stage pipeline in order
  (`hazard → exposure → vulnerability → impact → response → recovery`) and lifts
  a source condition when it becomes an incident. Canonical climates live in
  `src/content/aurelia/environment.ts` (the 36 authored region descriptors
  normalised onto the World Bible's eight zones + 70 weather places). The slice
  seed now observes Arden's weather at world creation. Tests:
  `tests/kernel/environment.test.ts` (17).
- **`src/engine/countries/`** (System 39) — a country as a *rule-and-institution
  environment*: identity/sovereignty, time-ordered configurations, the
  jurisdiction hierarchy (national → regional → municipal → special, overlap
  allowed), currency references, citizenship/immigration frameworks, pairwise
  border regimes and the data-driven world-rule registry.
  `src/content/aurelia/countries.ts` registers the canonical environment: the 48
  canon countries with their canon government type/capital, the one provisional
  `AUR` currency, the provisional legal-system slug, one shared citizenship and
  entry framework, 48 national + 34 municipal jurisdictions (nested) and the
  nine WORLD_BUILD_12 statements as rules. Two laws shape the engine: histories
  move **forward only** (`amend`/`rename`/`defineBorder`/`defineRule` close the
  previous window and reject an earlier effective date, so the past is never
  rewritten), and a border is **one** fact (stored `countryA < countryB`, so A↔B
  and B↔A are the same regime). `borderAccess` resolves regime → destination
  immigration framework → world rule and is a pure read; jurisdiction nesting
  cannot cycle (a parent must already exist, self-parenting is refused, and
  `jurisdictionChain` reports a corrupted cycle instead of truncating it); and
  `resolveRule` reports only the scopes actually consulted up to the winner
  (System 59 explainability). Provisional decisions are logged in
  `docs/CONTENT_GAPS.md`.
- **`src/engine/infrastructure/`** (System 38) — operational networks, not map
  decoration: `InfrastructureAsset` (kind, location, optional operator, capacity
  utilisation, condition, dependencies, redundancy, users served, maintenance
  record), `OutageRecord` carrying its repair progress, and
  `InfrastructureEngine` owning `systems.infrastructure`. Two rules keep it
  honest: **status is derived, never stored twice** (`capacityStateOf` /
  `serviceStatusOf` compute from demand, condition and the open outage, so a
  stored status can never disagree with the numbers), and **failures cascade
  explicitly** (edges are directional, a `redundant` asset stops the cascade,
  `cascadeFrom` is deterministic breadth-first in registration order, and
  `propagateOutage` reuses the source cause instead of inventing one). Repairs
  climb the spec's own requirement order as a ladder of ceilings, so progress
  stalls at the first unmet requirement rather than jumping to done.
  `src/content/aurelia/infrastructure.ts` registers Arden's 10-asset slice
  network (idempotent, every asset flagged `provisional`; the Bible authors no
  per-city utility inventory, so nothing was invented for the other 33
  settlements — see `docs/CONTENT_GAPS.md`), and `seedPlayableSlice` brings the
  network up at world creation, which `tests/kernel/sliceSeed.test.ts` now pins
  alongside the countries/environment systems. Derived reads only, so the map's
  infrastructure layer reports this engine's own count.

- Tests: `tests/kernel/travel.test.ts` (5), `tests/kernel/population.test.ts` (6),
  `tests/kernel/environment.test.ts` (17), `tests/kernel/countries.test.ts` (16),
  `tests/kernel/mapView.test.ts` (6), `tests/kernel/infrastructure.test.ts` (7),
  `tests/app/worldMap.test.ts` (4).
- **`src/engine/query/mapView.ts` (System 56 lens, M4 DoD closed)** — the map as
  this viewer may see it: LOD-anchored, knowledge-gated (no knowledge, no
  marker, no echo on unknown focus), routes copied verbatim from System 45,
  layers honestly reporting unavailable owners. Wired through the boundary:
  re-exported from `src/engine/query/index.ts`, exposed as
  `SimulationSession.mapView(camera?)` (a read like `personView`; the
  test-pinned surface in `tests/app/appShell.test.ts` now allows it), and
  rendered by `WorldScreen` (LOD switcher, markers with knowledge/state badges,
  routes, layers, notes) with the camera held as presentation state in
  `AppShell` (reset on world swap like all other selection state).

M3 delivered (Systems 55, 56, 57 + UI/UX 01–08, 14, 17–24):

- **`src/app/session/simulationSession.ts` (System 55 boundary)** — the *only*
  module holding a `Simulation`. Closed public surface (pinned by a test):
  `snapshot`, `personView`, `search`, `inspect`, `stateHash`, `act`, `setSpeed`,
  `setPaused`, `advance`, `setAuthority`, `console`, `listSlots`, `save`.
  Nothing returns the `Simulation`, the world bag or a mutable engine object.
- **`src/app/shell/`** — `AppShell.tsx` (anchors, `navModel.ts`, ⌥-shortcuts,
  authority-gated console/debug, pacing loop that advances authoritative time,
  breadcrumbs, interrupt-only notification banner) and the responsive layout.
- **Screens (`src/app/screens/`)** — Life (situation, time, location, needs,
  commitments, current activity, nearby people, events, quick actions), People +
  Person view with knowledge-state badges, World, History, Search, Settings,
  Console (System 57), Debug (UI/UX 22, authorized mode only).
- **`src/app/decision/`** — pure `decisionFlow.ts` walk/commit state machine +
  `DecisionSurface.tsx` binding (keyboard-only walkthrough, explicit commit step,
  estimate-vs-deterministic labelling).
- **Persistence wiring** — `src/platform/localStorageSaveStore.ts` is the
  browser `.reel` store; saving goes through the `world.save` command;
  `src/app/session/worldLoad.ts` dispatches `world.load` (audit + engine
  refusal) and then performs the one platform step a running instance cannot do
  for itself: swapping the `SimulationSession`. Settings shows per-slot world
  date/time, context, format/content version, generation and a *checked*
  integrity state (corrupt slots are listed as unreadable with the engine's own
  explanation and cannot be loaded); destructive loads require confirmation
  (UI/UX 20 sections 4–5). An unlistable store is reported instead of showing an
  empty list (UI/UX 24 section 8).
- **Boundaries enforced by test** — `tests/invariants/architecture.test.ts`
  asserts `src/app/**` imports only
  `@/engine/{query,kernel,commands,primitives,core/simulation,core/ownership,index}`
  (never `@/engine/console`, never a mutator) and that the engine stays DOM-free.
- **Tests** — `tests/app/appShell.test.ts` (session surface, pipeline dispatch,
  pacing, preferences/a11y, decision flow, navigation, knowledge badges, slots
  and world load) and `tests/app/shellWiring.test.ts`.
- Deliberate M3 decisions: reduced motion never gates the pacing loop (it would
  freeze authoritative time); the console is reachable only with non-player
  authority; presentation state (selection, inspector, pending confirmation) is
  reset when a load swaps the world.

Two M2/M3 items remain queued and are logged in `docs/CONTENT_GAPS.md`:
`SaveStore.listSlots()` is not yet tolerant of a slot whose bytes are not a
`.reel` document (the app reports it as "could not be listed"), and NPC
initiative (System 17) is still driven by explicit commands.

### M2 — vertical slice complete (previous sessions)

- **07 scale/materialization** — `src/engine/scale/` with deterministic
  `materializeSettlement()` (seeded `population` stream, sequential ownership
  scopes across identity/family/legalIdentity/scale); 300 residents revealed
  inside `CITY-ARDEN` (within the ~200–2 000 DoD range), idempotent
  re-materialization, aggregate never grows.
- **32 organization core** — `src/engine/organizations/` registry, memberships,
  lifecycle transitions, parent/subsidiary hierarchy. `employment.apply` now
  refuses to hire into an organization that does not exist (cross-system
  precondition in the hire applier); test fixtures register real orgs.
- **37 geography (M2 slice)** — `src/engine/geography/` + canonical World Bible
  chain `WORLD-AURELIA → CONT-ELANDRA → COUNTRY-ARDIN → REGION-ARDAN-BASIN →
  CITY-ARDEN` in `src/content/aurelia/geography.ts`; LocationRefs save/load
  round-trip verified.
- **40 legal identity (M2 slice)** — `src/engine/legalIdentity/`:
  AdministrativeRecord issuance, correction history (previous preserved, value
  applied), status history, expiry, access rules. New `record`/`REC-` entity
  kind in `primitives/ids.ts`.
- **53 partial (life continuity)** — `src/engine/continuity/`: ACTIVE →
  DECEASED → HISTORICAL registry + `pronounceDeath()` coordinating identity and
  continuity writes; PersonId survives death. Estate/inheritance remains M7.
- **Persistence bug fixed (found by the new geography save/load test):**
  `Simulation.serializedWorld()` used to persist only *mounted* SystemDefinitions
  (just the calendar heartbeat), silently dropping every domain engine's
  `world.systems.*` state on save. It now seeds the serialized `systems` from
  the raw bag and lets mounted definitions override their own entry.

The M2 DoD from `PHASES.md` holds: causal chain reproducible from seed
(`tests/scenarios/jobLossScenario.test.ts`), relationship-shift scenario
(`tests/scenarios/relationshipShiftScenario.test.ts`), full command set, and
materialization of a lived-in population.

Scope note: M2's system list also names **33 (organizations & businesses)**;
its M2 reach ("organization core" — employers as real orgs) is delivered by
System 32, and the business/market depth is explicitly M5 work — logged in
`docs/CONTENT_GAPS.md`.

M3 (UI shell) was delivered in `src/app/**` — see the summary at the top of this
section. Proceed to **M4 (Aurelia content + spatial world)** per `PHASES.md`
ordering. Do NOT jump to M5/M6 systems.

## Verification commands (all must be green before you stop)

```
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm test                 # vitest run — full suite (50 files, 409 tests as of last update)
npm run test:scenarios   # the two M2 DoD scenario tests
npm run build            # tsc + vite build
npm run sim -- --seed 0123456789 --days 30 --check-determinism   # headless determinism
```

## What is DONE

### M0 — Scaffold & guardrails
- Vite + React + TS + Vitest + ESLint, path aliases (`@/`), Tailwind v4.
- Docs: `docs/OWNERSHIP_MATRIX.md`, `docs/CONTENT_GAPS.md`,
  `docs/SOURCE_CONFLICTS.md`, this file, `PHASES.md` (root), `AGENTS.md`.
- UI resource pack: adapted shadcn components in `src/ui/` (+ MIT license and
  `SOURCE_MANIFEST.txt`); `cn` resolves via `src/lib/utils.ts`.

### M1 — Kernel (Systems 01–06, 58, 59)
- `core/`: WorldState + `OwnershipGuard` (executable law 1), system register
  (59 ids), `Simulation` step loop, save/load equivalence helpers.
- `primitives/`: money (minor-units, balanced ledger posts), ids (IdAllocator),
  time (integer-minute WorldTime, epoch 1900-01-01Z), EntityRef/LocationRef,
  contracts, relationships, organization, information claims, assets,
  activities, AuthorityCheck, ResolutionObject.
- `time/`: clock + Aurelia calendar (start 1 Jan 2042); speeds 1x/10x/100x/1000x;
  pause freezes authoritative time.
- `rng/`: named streams (world, population, person:<id>, events, markets,
  scenario), xoshiro128\*\* over SplitMix64(masterSeed, path); full state
  serialized; zero `Math.random()` in engine (lint rule + test).
- `events/`: deterministic queue ordered by (timestamp, priority, sequence);
  precondition revalidation at execution; delayed effects inherit
  `causalChainId`; chain-depth/cycle/quota guards.
- `activities/`: activity/schedule/commitment engine (`sim.activities` is the
  live engine — its state lives on the engine object, not `world.systems`).
- `persistence/`: `.reel` format — header, checksum, schema + reference
  validation, atomic store, migration registry.
- `observability/`: trace ring, invariants, metrics, replay harness.
- `config/`: schema + content loaders (System 58).
- Kernel bootstraps commands incl. `time.*`, `world.save|load`
  (`world.load` validates + emits `world.load_requested`; the platform does the
  actual swap via `Simulation.load` + `bootstrapLoadedSimulation` — see
  `docs/CONTENT_GAPS.md`).

### M2 — Vertical slice (person systems + domain engines + commands)
- Person systems 08–17, each with unit tests: `identity`, `aging`, `needs`,
  `health`, `mentation`, `traits`, `skills`, `cognition`, `goals`, `decisions`.
- Domain engines with tests: `relationships`, `family`, `finance`, `employment`,
  `housing`, `inventory`, `food`.
- Command surface (all end-to-end through dispatcher → validation →
  consequences → appliers), unit-tested in `tests/kernel/m2Commands.test.ts` +
  `tests/kernel/domainCommands.test.ts`:
  - `needs.*` (eat/drink/rest/hygiene…)
  - `activity.start|stop`
  - `employment.apply|resign|work_shift` (accept folded into apply — gap logged)
  - `housing.sign_lease|move_in|pay_rent`
  - `finance.transfer|pay_bill`
  - `inventory.transfer`
  - `social.message|visit|apologize`
  - `world.save|load`
- `src/engine/commands/domain/`: `appliers.ts` (against `DomainApplierHost`,
  which exposes `scope`, `world`, `ids`, `activities`, `calendar`,
  `registerEventHandler`), `socialCommands`, `activityCommands`,
  `employmentCommands`, `assetCommands`, `needsCommands`, `index`.
  - Appliers close over the host; `ConsequenceContext` is only
    `{time, rng, emit, log}`; event timestamp is `event.at`.
  - Dispatcher wraps each consequence in `scope.mutate(descriptor.owner)` —
    engines' `assertOwner` passes automatically, no nested scopes.
- **DoD scenarios (both green):**
  - `tests/scenarios/jobLossScenario.test.ts` — missed shift → dismissal →
    income shock → rent threat → second job; reproducible from seed; diverges
    for a different seed.
  - `tests/scenarios/relationshipShiftScenario.test.ts` — contact → conflict →
    repair with direction-correct turning points (apology lands on the
    *recipient's* record of the apologiser, matching System 18 semantics and
    `m2Commands.test.ts`); reproducible state hash.
- Invariants: `tests/invariants/ownership.test.ts` pins command owners
  `["activities","employment","finance","housing","inventory","needs",
  "persistence","relationships","time"]`; `architecture.test.ts` asserts the
  engine stays DOM-free and the UI never imports engine mutators.
- **M2 systems completed in this session:** geography (37), organization core
  (32), legal identity (40), scale/materialization (07), continuity partial
  (53) — engines under `src/engine/{geography,organizations,legalIdentity,scale,continuity}/`,
  canonical slice content under `src/content/aurelia/`, 20 new unit tests in
  `tests/kernel/{geography,organizations,legalIdentity,scaleMaterialization,continuity}.test.ts`.
  `employment.apply` now enforces employer existence through the hire applier
  (covered by "employment.apply at an unknown organization creates no employment").

### M3 — UI shell (Systems 55, 56, 57 + UI/UX 01–08, 14, 17–24)
- `src/app/session/simulationSession.ts` — the only `Simulation` holder; closed,
  test-pinned public surface; projections only (never engine objects).
- `src/app/session/worldLoad.ts` — `world.load` (audited, refusals from the
  engine) then the platform session swap; failures leave the running world intact.
- `src/app/shell/AppShell.tsx` + `navModel.ts` — anchors, ⌥-shortcuts,
  authority-gated console/debug, pacing loop, breadcrumbs, notification banner.
- `src/app/screens/` — Life, People (person view with knowledge badges), World,
  History, Search, Settings (incl. save slots + load), Console, Debug.
- `src/app/decision/` — `decisionFlow.ts` (commit step, keyboard walkthrough,
  estimate-vs-deterministic labelling) + `DecisionSurface.tsx`.
- `src/app/ui/` — knowledge/visibility mappers, preferences (density, motion,
  notifications, authority).
- `src/platform/localStorageSaveStore.ts` — browser `.reel` store used by the app.
- Tests: `tests/app/appShell.test.ts`, `tests/app/shellWiring.test.ts`;
  boundary pinned by `tests/invariants/architecture.test.ts`.
- Deferred (logged in `docs/CONTENT_GAPS.md`): `SaveStore.listSlots()` tolerance
  for bytes that are not a `.reel` document (the app reports "could not be
  listed" and never shows a false empty list).

### M4 — Aurelia content + spatial world (Systems 37, 38 slice, 39, 45, 46, 47, 56)
- **Full world canon (`src/content/aurelia/canon.ts`)** — 6/5/36/48/34 counts,
  4 mountains, 5 rivers, 6 corridors, 8 eras, 6 language families, 7 religions,
  17 active developments. Pinned by `tests/content/aureliaCanon.test.ts` (the
  M4 DoD data-validation test: exact counts + unique IDs + referential integrity
  + coordinate bounds).
- **Geography (37) full hierarchy** — `registerAureliaWorldGeography` registers
  world → 6 continents → 5 oceans → 48 countries → 36 regions → 34 settlements →
  Arden districts with stable `LocationRef`s; `historicalNames` on `LocationRef`
  + `findByHistoricalName` support spatial history for renamed places.
- **Travel (45) + Infrastructure routes (38 slice)** — `src/engine/travel/`
  (`TransportRoute`/`ActiveJourney`/`TravelHistoryEntry`),
  `generateCanonicalRoutes()` (rail + road per corridor, maritime + flight
  intercontinental links), `TravelEngine` (journey lifecycle + history).
  `ScaleEngine.relocateResident` moves a materialized resident between
  settlements. Tests: `tests/kernel/travel.test.ts`.
- **Population (47)** — `src/engine/population/` (`PopulationEngine` +
  `PopulationAggregate`), and the canonical deterministic distribution in
  `src/content/aurelia/population.ts` (exact integer splits of the 6.8B across
  countries/regions/settlements; per-country urbanisation; stable
  `fnv1a32`-derived weights, no RNG consumption). Tests:
  `tests/kernel/population.test.ts`.
- **Environment (46)** — `src/engine/environment/` (`WeatherSnapshot`,
  `PollutionState`, `HazardCondition`, `DisasterIncident` + per-incident stage
  history) and canonical climate content in `src/content/aurelia/environment.ts`.
  Weather is a deterministic function of climate + latitude + month + place
  (no RNG draw), so it is location- and season-dependent without being random;
  hazards are *implied* by the weather and the slow pollution/degradation state
  (a place has a drought because it is arid and dry), and impact is computed from
  hazard × exposure × vulnerability. The disaster pipeline is stage-ordered and
  refuses skips or revisits; ambient conditions are re-derived on every
  evaluation (idempotent, keyed `HAZ-<location>-<kind>`), while explicitly
  declared conditions are never lifted by the engine. Tectonic hazards have no
  ambient rule (no trigger is owned yet) — logged in `docs/CONTENT_GAPS.md`.
  Tests: `tests/kernel/environment.test.ts`.
- Remaining M4: infrastructure operations depth (38) beyond the slice network
  (other settlements stay unauthored by design — see `docs/CONTENT_GAPS.md).

## Next steps (UI build, brief phases U0–U7)

Engine milestones M0–M8 are complete; the remaining work is presentation.

- **U1 — Design system (atmospheric).** Tokens, typeface roles, tone/status
  components, `<EmptyState>`/`<Basis>`/`<Coverage>`, motion tiers; wire the
  existing `--state-*` / `.knowledge-*` semantics consistently.
- **U2 — Core loop.** Needs readings, schedule/commitments + conflict surfacing,
  resolution-level indicator, Tier-1 motion.
- **U3 — People + Genealogy.** Virtualised directory, per-observer perceptions,
  React Flow genealogy, household stints; honest empty states for the 28
  partial systems.
- **U4 — World.** Spatial SVG map from the coordinates already in `MapView`
  (+ d3-zoom), knowledge fog-of-war, LOD↔resolution mapping; place detail,
  travel/border, weather, infrastructure ladder, international.
- **U5 — Society.** Law & Records, Information, Community, Economy tabs;
  Recharts + supply-chain graph.
- **U6 — Continuity/Legacy.** Death determination, estate report, succession
  and control-handoff; the Tier-2 "moment layer" (React Bits, free tier).
- **U7 — Polish/hardening.** axe audit, performance pass vs budgets, keyboard
  walkthrough, responsive pass, save-slot UX, guardrail regression tests (no
  `isMarried`/`legacyBonus`/single reputation score in UI models).

Still-deferred (logged in `docs/CONTENT_GAPS.md`): `SaveStore.listSlots()`
tolerance for non-`.reel` bytes, NPC initiative (System 17) ticking, command
authority enforcement, and a minimal System 26 (contracts/shared ownership)
before the Economy/Law screens.

## Architecture invariants (do not break)

- Engine (`src/engine/`) is pure TypeScript: no DOM, no React imports.
- UI reads only through projections/dispatch — never mutates world state.
- One clock; one owner per field (`docs/OWNERSHIP_MATRIX.md`).
- Seeded RNG only; no `Math.random()` anywhere in `src/engine/`.
- Money math only through `primitives/money.ts`; every mutation posts a
  balanced ledger entry.
- Information ≠ truth: projections are knowledge-filtered (fully wired from M3).
- Reference folder `REEL LIFE FULL PLAN SOURCE/` is read-only specification —
  never imported, never built.

## Session log

- **2026-09-25 (this session):** Fixed the last M2 scenario failure —
  `relationshipShiftScenario.test.ts` now has A apologise to B (recipient-side
  turning point, consistent with `m2Commands.test.ts` System 18 semantics).
  Scenario suite 5/5; full suite 264/264; typecheck + lint clean. Created the
  M0 docs (`docs/OWNERSHIP_MATRIX.md`, `docs/CONTENT_GAPS.md`,
  `docs/SOURCE_CONFLICTS.md`) and this `PROGRESS.md`.
- **2026-09-25 (same session, follow-up):** Lint broke when an external tool
  created `.kilo/worktrees/resonant-change/` (a full project copy with its own
  `tsconfig.json`), causing typescript-eslint to abort on every file with
  "multiple candidate TSConfigRootDirs". Fixed in `eslint.config.js` by pinning
  `parserOptions.tsconfigRootDir = import.meta.dirname` and ignoring `.kilo/**`.
  Full gate re-verified green afterwards: typecheck 0, lint 0, 264/264 tests,
  `npm run build` OK, `npm run sim --check-determinism` PASS.
- **2026-09-26:** Closed the remaining M2 systems — geography (37),
  organization core (32), legal identity (40), scale/materialization (07),
  continuity partial (53) — with engines, canonical slice content
  (`src/content/aurelia/`), and 20 new unit tests (37 files / 285 tests total).
  Wired `employment.apply` to real organizations (hire applier precondition;
  fixtures updated in domainCommands + jobLoss). Found and fixed a
  **persistence bug**: `serializedWorld()` dropped all domain `world.systems`
  state on save (only mounted SystemDefinitions were persisted) — now the raw
  bag is the baseline. Legal corrections now apply the new value while
  preserving history. Gate: typecheck 0, lint 0, 285/285, build OK,
  determinism PASS. M2 is complete; next is M3.
- **2026-09-26 (M3 session):** Built the M3 presentation layer. New:
  `src/app/{shell,decision,ui,session}/`, seven screens, `App.tsx` rewritten to
  own `SimulationSession` + snapshot + preferences. Persistence is wired end to
  end: the browser `.reel` store is handed to the session, `world.save` goes
  through the pipeline, and **load-from-slot now works** —
  `src/app/session/worldLoad.ts` dispatches `world.load` (audit + engine
  refusal), then performs the one platform step a running instance cannot do for
  itself (swapping the session), reporting failure without touching the running
  world. `SaveSlotView` gained format/content version, generation and a *checked*
  integrity state; Settings lists slots with two-step load confirmation and an
  explicit "could not be listed" state instead of a false empty list. Also changed
  `SimulationSession.listSlots()` to return `{ slots, issue? }` (the store's
  enumeration can fail on non-`.reel` bytes — the gap is logged in
  `docs/CONTENT_GAPS.md`). Presentation state is reset when a load swaps the
  world; reduced motion deliberately does not gate the pacing loop.
  Gate: typecheck 0, lint 0, 42 files / 340 tests, `npm run build` OK.
- **2026-09-27 (M4 session):** Closed System 46 (weather / environment /
  disasters) on top of the M4 spatial systems. New: `src/engine/environment/`
  (`types.ts`, `dynamics.ts`, `engine.ts`) and
  `src/content/aurelia/environment.ts`; `seedPlayableSlice` now observes Arden's
  weather when the world is created. Design choices worth knowing:
  weather is *derived* from climate + latitude + month + place id rather than
  drawn from the seeded RNG (so it is reproducible, location-dependent and
  seasonally correct on Aurelia's own latitudes), and hazard conditions are
  *implied* by the weather and the slow pollution/degradation state instead of a
  single "disaster chance" number — the System 46 core principle. Impact is
  hazard × exposure × vulnerability. The pipeline is enforced in order
  (`hazard → exposure → vulnerability → impact → response → recovery`): a skipped
  or repeated stage throws, so the environment's record can never claim an effect
  without its cause. `evaluateHazards` re-derives a place's ambient conditions
  (idempotent, `HAZ-<location>-<kind>`) and never lifts explicitly declared
  conditions; promoting a condition into an incident lifts it. One bug found and
  fixed while testing: the first draft kept old ambient conditions *and* re-added
  the derived set, duplicating every condition on re-evaluation. Also corrected
  the M4 session's truncated `dynamics.ts`/`engine.ts` edits (the ambient-hazard
  block had landed inside `impactSeverity`). Tests:
  `tests/kernel/environment.test.ts` (17). Gate: typecheck 0, lint 0,
  46 files / 377 tests, `npm run build` OK, determinism PASS. Next: System 39
  (countries & world rules), then the knowledge-limited map (56).
- **2026-09-27 (M4 session, continued — System 39):** Closed Countries & World
  Rules on top of the M4 spatial systems. The engine, types and content
  (`src/engine/countries/`, `src/content/aurelia/countries.ts`) were already in
  the tree but unverified: `tests/kernel/countries.test.ts` had been written
  against a *planned* API (`effectiveConfiguration`, `jurisdictionHierarchy`,
  `jurisdictionsForLocation`, `borderRegimeBetween`, `BorderRegime.countries`,
  `historicalNames` as `{ name, until }`) that the engine never exposed — 13 of
  its 16 tests failed and `npm run typecheck` reported 28 errors in that file
  alone. The engine's API is the one consistent with the rest of the kernel
  (`configurationAt`, `jurisdictionsAt`, `jurisdictionChain`, `borderBetween`,
  `historicalNames` as a string list exactly like Geography's `LocationRef`), so
  the **test was aligned to the engine** rather than the engine renamed to the
  test. Three genuine gaps the test exposed were fixed in code, all grounded:
  `constitution` added to `COUNTRY_CHANGE_KINDS` (WORLD_04: a country keeps its
  "founding date, constitutional history"), `defineJurisdiction` refuses a
  self-parent explicitly instead of reporting it as its own missing parent, and
  `jurisdictionChain` now reports a detected cycle rather than silently
  truncating the ancestry. `resolveRule` records only the scopes actually
  consulted up to the winner in `consultedScopes` — it previously echoed the
  whole chain, including scopes it never opened, which is wrong for the
  System 59 explanation that field exists for. The test also caught an id error
  in itself (`COUNTRY-VEYR` is not in canon; the country is `COUNTRY-VEYRA`),
  and now derives expectations from `CANON_COUNTRIES`/`CANON_SETTLEMENTS`
  instead of hard-coded counts. `docs/OWNERSHIP_MATRIX.md` gained the
  `systems.countries` slot and `docs/CONTENT_GAPS.md` the five provisional
  System 39 decisions (currency, legal-system slug, citizenship/entry
  frameworks, absent border geometry, formal-only jurisdictions).
   Gate: typecheck 0, lint 0, 47 files / 393 tests, `npm run build` OK,
   determinism PASS. Next: the knowledge-limited map (56) to close M4.
- **2026-09-27 (M4 session, continued — System 56 map wiring):** Closed M4. The
  `mapView.ts` lens and `tests/kernel/mapView.test.ts` existed in the tree but
  were never green (3/5 failing) and never wired: the query index did not
  export the lens, the session had no map read, and `WorldScreen` rendered only
  the residence chain. Fixes, smallest-first: (1) test aligned to the engine's
  documented anchor rule (the zoom's anchor is always shown — the suite's own
  country assertion already required it); the stale case now focuses the camera
  on the visited city (a region zoom only draws its own anchor's subtree, and
  Westhaven lives under another region); population asserted against System 47's
  own aggregate instead of the slice's scale register (50 000). (2) Two genuine
  engine/test bugs fixed: stale outranks route/event association (otherwise a
  connected settlement could never read as stale — the association survives in
  the routes list and event counts), the no-countries case now deletes through
  `guard.mutate("countries")` instead of tripping the ownership guard, and the
  leak detector compares whole values instead of substrings ("Veyr" is not
  "Veyra"). (3) Wiring: `query/index.ts` re-exports the lens,
  `SimulationSession.mapView(camera?)` added (allowed-surface test updated),
  `WorldScreen` renders LODs/markers/routes/layers/notes with focus control,
  camera state lives in `AppShell` and resets on world swap. New
  `tests/app/worldMap.test.ts` (4) pins the second M4 DoD item at the session
  boundary. Gate: typecheck 0, lint 0, 50 files / 409 tests, `npm run build`
  OK, determinism PASS. Next: M5.
- **2026-09-27 (M4 session, continued — System 38 infrastructure):** Closed the
  last M4 system, **38 (Infrastructure Operations)**, which sits in M4's scope
  but had no engine in the tree: the rest of the M4 work referenced
  "infrastructure" (map layer, ownership slot, seed comment) without anything
  owning it, so it was implemented rather than assumed. New:
  `src/engine/infrastructure/{types,engine}.ts`,
  `src/content/aurelia/infrastructure.ts`, registration from
  `seedPlayableSlice`, `tests/kernel/infrastructure.test.ts` (7). Three design
  choices worth knowing: status is **derived, never stored twice**
  (`capacityStateOf` / `serviceStatusOf` from demand, condition and the open
  outage, so a stored status could never disagree with the numbers); failures
  **cascade explicitly** (edge direction matters, a `redundant` asset stops the
  cascade, `cascadeFrom` is deterministic breadth-first in registration order,
  and `propagateOutage` reuses the source cause instead of inventing one); and
  repair climbs a **ladder of ceilings** in the spec's own requirement order
  (workers → equipment → materials → access → authority → funding → time), so
  progress stalls at the first unmet requirement. Content is deliberately one
  city — Arden's 10-asset network, every asset flagged `provisional` — because
  the Bible authors no per-city utility inventory; the absence is logged rather
  than filled with 33 invented networks. `docs/CONTENT_GAPS.md` gained seven
  System 38 rows, including the two honest gaps: no operators/funding/staffing
  wired yet (requirement gates stand in for payroll), and outages are *returned*
  for a publishing caller but not emitted as Events yet. Also closed the two M4
  coverage holes this audit found: the map's `formerNames` (M4's "spatial
  history for renamed places") is now tested — Arden's canon former names are
  copied from System 37 and a stranger's former name (`Veyr-on-River`) never
  leaks at any zoom — and `tests/kernel/sliceSeed.test.ts` now pins that world
  creation stands up the M4 systems (network, first-frame weather, country
  rules/jurisdiction/currency) idempotently. M4's seven systems are all present
  (37, 38, 39, 45, 46, 47, 56) and both DoD items remain pinned
  (`tests/content/aureliaCanon.test.ts` counts 6/5/36/48/34; the map stays
  knowledge-limited at the session boundary). Gate: typecheck 0, lint 0,
  50 files / 411 tests, `npm run build` OK, determinism PASS. Next: M5.

---

## Superseded: M7 plan (written 2026-09-27, kept as the record it was)

**This block is kept for history. M7 has since landed — see the block at the
end of this file.** Nothing below was implemented as written; where the plan
turned out to be wrong, the landing notes say so.

M7 was **deferred until M6 is complete**, per the ordering in `PHASES.md` and
`AGENTS.md`. Recorded here so the next session does not have to re-derive it.

**Where M7 actually starts from** — M7 looks greenfield but is not; three of
its systems are partly delivered:

| System | Delivered today | M7 increment |
| --- | --- | --- |
| 53 Life Continuity | lifecycle only: `statusOf`/`deathOf`/`registerDeath`/`markHistorical`; a test already proves PersonId survives death | death *determination*, estate, inheritance, descendant continuation, legacy, death records/history |
| 19 Family/Genealogy | households (members with `role`+`joinedAt`, `dissolvedAt`) and lineages (parent/child/biological/adoptive) | membership **exit** history (the spec wants "entry/exit rather than treating household as timeless"), lineage *queries*, family records |
| 54 History/Analytics | `HistoryStore` with `forPerson`/`forChain`/`recent`, retention (importance >= 3 permanent), compression, visibility/`knownBy`, `getTimelineView` | statistics aggregation, causal *explanation* queries, filters/summaries, death/estate/legacy mapping |

**Two gaps shape the milestone:** System 26 (Ownership / Contracts / Asset
Rights) does not exist, and aging has no death wiring.

**Open decision, deliberately not settled:** System 53's estate resolution is
specified in terms of Ownership, Contracts, wills/beneficiaries, debts,
jurisdiction and legal rules. With no System 26 there is no title model to
transfer, though 41 (laws) and 43 (government) are now landed. The two
candidate approaches are (a) scope the estate to systems that exist, with every
bequest expressed as a *reference* to the owning system — 25/27/32/33/31/28/23,
the pattern Systems 31 and 34 already use — which also makes "no arbitrary
hidden modifiers" checkable; or (b) land a minimal System 26 inside M7 first.
**Revisit this with fresh eyes once M6 is finished.**
*(Settled when M7 landed: option (a) was taken. See the M7 block at the end of
this file.)*

**Build order once unblocked:** (1) 19 genealogy increment — lineage queries,
membership exit, family records, because nothing else can start without a way
to find the eldest surviving heir; (2) 53a death determination + records +
aging-to-continuity wiring; (3) 53b estate/inheritance as references to owning
systems; (4) 53c an explicit 53-owned `ControlTransfer` and a control handoff
with no world reset — this changes real code, since `sliceUnderControl` in
`sliceSeed.ts` currently derives control from `scale.residents[0]` and carries
a comment saying M7 replaces it; (5) legacy effects naming target system and
field; (6) 54 statistics / causal queries / mapping; (7) the DoD scenario
`tests/scenarios/multiGenerationScenario.test.ts`.

**M7 DoD as concrete assertions:** the deceased's PersonId still resolves in
identity, lineage, ledger history and timeline, and is referenced by the
transfer, with no system re-keying them; every legacy effect walks back to a
concrete field it changed, with no `legacyBonus`-style scalar anywhere in
continuity or estate state; and the ancestor's `causalChainId` still resolves
after control moves, with other systems' state unchanged except the named
transfers. Note that `HistoryStore.forChain(causalChainId)` already exists as
the seed of the causal query, and the PersonId-survival property is already
asserted once in `continuity.test.ts` — it just needs asserting *across*
systems after control transfer.

---

## M7 — Continuity (landed 2026-09-27)

M7 is **done**: Systems 53, 19's genealogy increment and 54's causal-history
queries are implemented, and the DoD scenario exists. 75 files / 612 tests,
typecheck 0, lint 0, `npm run build` OK, `npm run sim` runs clean (0 invariant
failures, 0 ownership violations).

**The System 26 decision is settled, by choosing (a).** Option (a) — scope the
estate to the systems that exist and express every bequest as a *reference* —
was taken, and it is the approach Systems 31 and 34 already use. The proof that
it was the right call is in the code: `SUCCESSION_TARGETS` in
`src/engine/continuity/estate.ts` is a table of `{ system, field, settable }`,
so a legacy effect can only ever name a real system and a real field. That is
what makes "no arbitrary hidden modifiers" *checkable* rather than aspirational,
and a second ownership record beside `AccountRecord.ownerId` / `ItemInstance
.ownerId` / `Vehicle.ownerId` would have been the duplicate implementation
System 53's own spec warns against. A minimal System 26 is still worth landing
for contracts and shared ownership, but nothing in M7 was waiting on it.

### System 53 (life continuity)

- **`src/engine/continuity/{types,engine}.ts`** — the lifecycle registry plus
  determinations, records, wills, estates and control transfers. A determination
  cites its evidence as `FactRef`s and never copies the facts, so it cannot
  drift from the System 11 condition it rests on; a determination with nothing
  to cite is recorded as `presumed` rather than dressed up as witnessed. Wills
  are validated on the way in (shares must sum to 1) and revocation is a
  separate write, never a deletion.
- **`death.ts`** — the pipeline, as an *orchestrator*: cause -> determination ->
  identity -> health -> continuity -> System 40 civil registration -> household
  exit -> employment exit -> history, one write per owner inside that owner's
  scope. `archiveLife` refuses to archive while an estate is still open, because
  an unsettled estate is active matter.
- **`mortality.ts`** — age mortality wired to System 09, on a per-person named
  stream (`continuity:mortality:<personId>`). Eligibility is evaluated
  separately from probability, and **a zero hazard takes no draw**, so a
  population of young people consumes no randomness at all.
- **`estate.ts`** — `gatherEstate` / `determineBeneficiaries` / `openEstate` /
  `settleEstate`. A will outranks intestacy; intestacy walks descendants ->
  household -> parents -> siblings and stops at the first tier with a survivor,
  naming the relationship. Money moves through System 25 as balanced ledger
  entries; items and vehicles move through Systems 29 and 28. **Residences,
  leases, employment and policies are deliberately not settled** and say so: a
  tenancy is an agreement, a job is an obligation, a policy is a contract.
- **`control.ts`** — `successionCandidates` (eligibility, separate from the
  decision) and `handOverControl` (one appended record, one history entry, no
  other system touched). `sliceUnderControl` in `sliceSeed.ts` now reads the
  last `ControlTransfer` and only falls back to the slice's first resident when
  no transfer exists — so the answer is *derived*, and a load cannot disagree
  with the history that produced it.
- Tests: `tests/kernel/continuity.test.ts` (9), `tests/kernel/continuityEstate.test.ts` (18).

### System 19 (genealogy increment)

`HouseholdMember` gained `leftAt` / `leftReason`, so membership is a record of
*stints* and leaving never deletes; rejoining appends a second stint.
`descendantsOf` / `ancestorsOf` / `siblingsOf` walk explicit lineage links and
never infer kinship from co-residence. `recordParentChild` refuses a link that
would make a person their own ancestor, because an inconsistent lineage graph
cannot be walked. Tests: `tests/kernel/family.test.ts` (8).

### System 54 (causal history)

The `forChain(causalChainId)` query already existed and is now exercised across
systems by the DoD. Estate settlement and control handoff each write an
importance-5 timeline entry, so retention cannot drop them.

### Four real defects found and fixed while writing the DoD

1. **A read was a write.** `new LifeContinuityEngine(...)` and
   `new AgingEngine(...)` initialize their state slot in the constructor, so
   every *read* of continuity or aging demanded a mutation scope — a read path
   was asserting ownership it did not have, and any read on a world where
   nothing had happened yet threw `MissingWriterContextError`. Both engines now
   have `Engine.peek(scope, world)`, a read-only handle that does not claim the
   slot and throws if anything tries to write through it.
2. **The first beneficiary was paid twice.** The remainder logic gave the first
   heir `total - placed` *and* their own floored share, because `placed` did not
   yet include their share. Floors are now computed up front and only the
   indivisible remainder is added — so 101 minor units across two heirs place
   51 and 50, and the remainder is named in the application note.
3. **The household tier of intestacy was silently dead.** The tier looked for an
   *open* stint of the deceased's, but the death pipeline had already stamped
   `leftAt` on it, so the tier always resolved empty and inheritance fell
   through to parents. It now reads the deceased's **last** stint, which is
   answerable precisely because stints are never deleted.
4. **Re-settling a settled estate reported the whole application list again**,
   so a caller counting what it had just applied could pay twice on a retry. It
   is now a no-op reporting *no new* applications; the case still carries the
   full history.

A fifth was a documentation defect: `mortality.ts` claimed a person below the
minimum age "is not assessed at all", while the code reported an assessment with
a zero hazard. The code is the better behaviour — "not eligible at this age" is
a finding, and a sweep that silently omitted people would look like a complete
one — so the comment was corrected rather than the code.

### The DoD scenario

**`tests/scenarios/multiGenerationScenario.test.ts`** (5) runs a whole life and
the next one, asserting the DoD as properties rather than describing it: the
estate settles into concrete fields in the owning systems; no `legacyBonus`
scalar exists anywhere in continuity state; the deceased's PersonId still
resolves in identity, lineage, continuity and timeline and is *named* by the
transfer; the ancestor's `causalChainId` still walks after control moves; the
heir's own life is intact and un-rekeyed; the run reproduces from its seed
(same `stateHash()`); and it survives a save/load with the transfer still in
force. A player's own death is played by the harness, not by System 17's
autonomy — that system does not get to decide a player dies — but every
consequence the death causes is real engine work in each owner's scope.

---

## M8 — Hardening (landed 2026-09-27)

M8 is **done**: 82 files / 686 tests, typecheck 0, lint 0, `npm run build` OK,
`npm run sim` clean (0 invariant failures, 0 ownership violations). All five
deliverables landed, and two of them found real defects rather than confirming
what I expected.

### 1. Performance budgets per resolution level

**`src/engine/observability/budgets.ts`** — five resolution levels
(`abstract -> regional -> settlement -> street -> household`), each with a
budget for resolved persons, events, work units and save bytes. `judgeStep`
returns *every* breach rather than the first, and `BudgetLedger` tracks the
**worst** step rather than the average, because a simulation that is fast except
for one pathological step is not fast and an average would hide exactly the case
worth finding.

The unit is **work units, not wall-clock**: clock assertions are flaky on shared
CI and say more about the machine than about the code. The numbers are round and
marked provisional — tightening them is a decision made against real profiling,
not guessed at here. Tests (11) prove a budget *can* be broken before they prove
one is met, because a budget nobody has ever failed is not a budget.

### 2. Save migrations with fixtures

`MigrationRegistry` existed with **zero registered migrations and zero tests** —
the machinery was never exercised. M8 adds the first real one,
`V1_TO_V2_CONTINUITY_LIFECYCLE`, written from the *actual* v1 shape (verified
against git history: v1's `systems.continuity` was exactly `{ statuses, deaths }`).
The added collections are backfilled **empty**: a v1 world genuinely had no
determinations and no estates, and manufacturing them would be the most
dangerous kind of save bug — invisible, and a lie the engine would treat as
canon. `tests/fixtures/reel/v1Save.ts` is hand-authored rather than generated,
because a fixture produced by the current engine can only ever agree with the
current engine. Tests (13) cover the happy path, the refusal path, idempotence,
and a world with no continuity slot at all.

### 3. The UI/UX 21 accessibility pass

M3 had satisfied three of the spec's six sections structurally. The three the
spec *named* with nothing behind them are now real, as **testable policy** in
`src/app/ui/accessibility.ts` rather than as JSX — a rule that only exists inside
a render function cannot be asserted and will quietly regress:

- **Visual** — a four-step `textScale` applied at the root (so every existing
  `text-sm` moves with it), and every meaningful tone carries a text label, so
  nothing is distinguished by colour alone.
- **Motor** — a 44px minimum target, an explicit focus order matching the reading
  order, and `decisionDeadline`, which returns *no deadline ever*: a life
  simulation is not a reaction game, and a surface that closes itself is a
  decision the player did not get to make.
- **Localisation** — formatting as data, plus an `isLocalizationReady` check that
  flags a bare number interpolated into prose, which cannot be reordered into
  another language.
- Plus a terminology table (one name per concept) and `playerMessage`, which
  requires an error to name a remedy. Tests (22).

### 4. Full cross-system scenario suite

Three scenarios added, completing the list M8 named:

- **`marriageScenario.test.ts`** (5) — courtship to marriage, asserting that
  **status is not quality**: `spouse` is a relationship *context*, and a
  strained couple can marry with the strain intact and the quarrel still on the
  turning-point record. Also asserts no system holds a private `isMarried` flag.
- **`disasterScenario.test.ts`** (5) — a flood from hazard through all six
  stages, asserting the pipeline cannot be skipped and an incident must cite a
  hazard that exists. It also asserts the flood caused **no damage**: nothing
  was invented to look dramatic.
- **`migrationScenario.test.ts`** (6) — pressure, framework, crossing, and the
  property that **pressure moves nobody**: a `MigrationPressure` record leaves
  the identity bag byte-identical, and arrival is not citizenship.

### 5. Content completeness ledger

**`src/engine/config/contentLedger.ts`**, generated into
**`docs/CONTENT_LEDGER.md`**. Reports all 59 approved systems as `complete` /
`partial` / `absent` with a reason for each, plus canon counts. The key design
choice is that `partial` is a first-class value: several systems have complete,
tested engines and deliberately no content because the World Bible authors no
local feuds or parenting situations to fill them with, and inventing canon to
make a report look tidy would be the wrong trade. Counts the World Bible does
not state are recorded as `"not stated"` rather than guessed. Tests (12).

### Five more real defects found and fixed

1. **Migrated saves would have failed validation.** `MigrationRegistry.migrate`
   changed the body but kept the *old* checksum in the header, so every migrated
   save would be *correct* and read as corrupt — the most confusing failure that
   file could have had.
2. **M7 changed a save-visible shape without bumping `SIMULATION_VERSION`.** The
   migration silently became a no-op, because the registry saw the save as
   already current. The version is now 2, with the reason recorded at the
   constant. This was M7's omission, found by M8's fixture.
3. **A read was a write — in two more engines.** `TravelEngine` and
   `InternationalEngine` had the same lazy-initialising constructor that
   `LifeContinuityEngine` and `AgingEngine` had. All four now expose
   `Engine.peek(scope, world)`, a read-only handle that does not claim the state
   slot and throws if anything writes through it.
4. **The content ledger's own `SEEDED_SYSTEMS` list was wrong** — four systems
   (`finance`, `continuity`, `history`, `relationships`) that the seed does not
   populate. The test that checks the list against a real seeded slice is what
   caught it; the list is now verified rather than trusted.
5. **Infrastructure was being reported as incomplete content.** `core`, `time`
   and `persistence` are code, not content, and asking whether the clock has
   "content" is a category error that padded the ledger with noise. The type
   checker also caught four entries (`primitives`, `kernel`, `query`, `commands`)
   that are directories of code but not approved *systems* at all.

- **2026-09-28 (UI build, this session):** U0 audit complete. Verified the
  gate green (82 files / 686 tests, typecheck 0, lint 0). Confirmed dependency
  reality (React 19.3, Vite 8.3, TS 6.0, Tailwind 4.3, `radix-ui` 1.6.7 unified
  package; no React Flow / Motion / Recharts / d3 / TanStack installed yet).
  Audited all 8 shell views and the query projection surface; confirmed the
  engine/UI boundary is enforced three ways (ESLint, `architecture.test.ts`,
  session layer). Findings: the World "map" is a flat marker list even though
  `MapView` already ships `position` (lat/long) — a spatial SVG map is a pure
  UI-rendering change; `CharacterView.tsx` was orphaned dead code whose
  `KnowledgeBadge` tone map conflicted with `knowledge.ts` (removed);
  `PROGRESS.md` header/position were stale at M6 (corrected here). Visual
  direction chosen: **atmospheric / game-like**. Next: U1 design system.

- **2026-09-28 (UI build, follow-up):** U1-a/b design-system foundations. Fixed a
  real accessibility gap: `textScaleClass` existed and was tested but was never
  wired — the `reellife-text-*` classes were undefined in CSS, applied nowhere,
  and had no Settings control. Now `index.css` defines the three root font-size
  steps, `App.tsx` applies the class to `<html>` (so rem-based Tailwind tokens
  scale), and Settings gained a "Text size" control. Added shared presentation
  primitives: pure `coverage.ts` (`complete`/`partial`/`not-stated` labels +
  tones) plus thin `KnowledgeBadge`, `CoverageBadge`, `EmptyState`, `Basis`
  components; `tests/app/coverage.test.ts` (5). Gate: 83 files / 691 tests,
  typecheck 0, lint 0, build OK, determinism PASS. Next: U1 typeface/token
  refinement and Tier-1/2/3 motion, then U2 core loop.


