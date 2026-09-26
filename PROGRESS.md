# REELLIFE — PROGRESS

> **MANDATORY FOR EVERY AGENT/SESSION THAT WORKS HERE:**
> Read this file first. When you finish (or stop), **update it** — correct the
> status lines, add/remove rows below, and refresh the "Current position"
> section so the next session can resume from your exact stopping point.
> A stale `PROGRESS.md` is a bug; treat it like failing tests.
> Keep `docs/OWNERSHIP_MATRIX.md`, `docs/CONTENT_GAPS.md`,
> `docs/SOURCE_CONFLICTS.md` in sync when your change affects them.

Last updated: 2026-09-25 (M2 scenario DoD gate: both scenario tests passing;
typecheck/lint/test all green — 32 files / 264 tests).

---

## Current position

**Phase: M2 COMPLETE — every M2 system, command and DoD scenario in
`PHASES.md` is implemented and tested. Next: M3 UI shell.**

M0 and M1 were already done; this session closed the remaining M2 systems:

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

Proceed to **M3 UI shell** per `PHASES.md` ordering. Do NOT jump to M5/M6
systems.

## Verification commands (all must be green before you stop)

```
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm test                 # vitest run — full suite (37 files, 285 tests as of last update)
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

## What is NOT done (next steps, in order)

1. **M3 UI shell** (Systems 55–57 + UI/UX 01–08, 14, 17–24): shell anchors
   (Life/People/World/History/Search/Settings), Life screen, Person view with
   knowledge-state badges, decision surface, notification feed, System 57
   console, debug UI behind authorized mode. `src/app/` currently holds only
   scaffolds (`App.tsx` is a 12-line placeholder not yet wired to the engine);
   adapted shadcn components are ready in `src/ui/`.
2. **M4–M8** per `PHASES.md` (Aurelia content, economy, society/law/info,
   continuity, hardening).

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
