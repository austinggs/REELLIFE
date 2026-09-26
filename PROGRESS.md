# REELLIFE — PROGRESS

> **MANDATORY FOR EVERY AGENT/SESSION THAT WORKS HERE:**
> Read this file first. When you finish (or stop), **update it** — correct the
> status lines, add/remove rows below, and refresh the "Current position"
> section so the next session can resume from your exact stopping point.
> A stale `PROGRESS.md` is a bug; treat it like failing tests.
> Keep `docs/OWNERSHIP_MATRIX.md`, `docs/CONTENT_GAPS.md`,
> `docs/SOURCE_CONFLICTS.md` in sync when your change affects them.

Last updated: 2026-09-26 (M4 in progress — full Aurelia canon + geography + travel + population land; next is weather/environment (46) and countries/world rules (39)).
Gate: typecheck 0, lint 0, 45 files / 360 tests, `npm run build` OK.

---

## Current position

**Phase: M4 in progress — the full Aurelia world definition is now canonical
content, and the spatial systems (geography, travel, population) are landing.
Next: weather/environment/disaster (System 46) and countries & world rules
(System 39), then the knowledge-limited map (System 56) to close the M4 DoD.**

M4 landed so far (Systems 37, 45, 47 + full world canon):

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
- Tests: `tests/kernel/travel.test.ts` (5), `tests/kernel/population.test.ts` (6).

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
npm test                 # vitest run — full suite (42 files, 340 tests as of last update)
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

### M4 — Aurelia content + spatial world (Systems 37, 38 partial, 45, 47)
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
- Remaining M4: weather/environment/disaster (46), countries & world rules (39),
  infrastructure operations depth (38), and the knowledge-limited map (56).

## What is NOT done (next steps, in order)

1. **M4 remainder** per `PHASES.md`: weather/environment/disaster (46),
   countries & world rules (39), infrastructure operations (38), and the
   knowledge-limited map with LOD (56) — the second M4 DoD item ("map renders
   only player-known markers") is the map work that closes M4.
2. **M5–M8** per `PHASES.md` (economy, society/law/info, continuity,
   hardening).
3. **Deferred M3-adjacent polish** (logged in `docs/CONTENT_GAPS.md`):
   `SaveStore.listSlots()` tolerance for non-`.reel` bytes, NPC initiative
   (System 17) autonomous ticking, and command authority requirements
   (`authorityRequirement` is declared but not yet enforced by domain commands).

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
