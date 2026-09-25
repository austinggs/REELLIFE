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

**Phase: M2 (vertical slice) — kernel + person systems + domain engines +
command surface + DoD scenarios COMPLETE. Remaining M2 scope: geography,
organization core, legal identity, population materialization.**

M0 and M1 are fully done. The M2 definition-of-done from `PHASES.md` requires:
one full causal chain reproducible from seed (✅ `tests/scenarios/jobLossScenario.test.ts`),
cross-system scenario tests for job loss and relationship shift (✅ both under
`tests/scenarios/`), and the listed command set (✅ — see below). The remaining
M2 systems not yet implemented: **37 geography, 40 organization core,
33 legal identity, 38 population/materialization (~200–2 000 active
individuals in one city)**.

After the remaining M2 systems: proceed to **M3 UI shell** per `PHASES.md`
ordering. Do NOT jump to M5/M6 systems before M2 DoD passes.

## Verification commands (all must be green before you stop)

```
npm run typecheck        # tsc --noEmit
npm run lint             # eslint .
npm test                 # vitest run — full suite (32 files, 264 tests as of last update)
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

## What is NOT done (next steps, in order)

1. **Rest of M2:** System 37 geography (stable LocationRefs, one city),
   System 40 organization core (employers as orgs), System 33 legal identity,
   System 38 population materialization (~200–2 000 individuals, aggregate →
   materialized), then re-verify the M2 DoD in `PHASES.md`.
2. **M3 UI shell** (Systems 55–57 + UI/UX 01–08, 14, 17–24): shell anchors
   (Life/People/World/History/Search/Settings), Life screen, Person view with
   knowledge-state badges, decision surface, notification feed, System 57
   console, debug UI behind authorized mode. `src/app/` currently holds only
   scaffolds (`App.tsx` is a 12-line placeholder not yet wired to the engine);
   adapted shadcn components are ready in `src/ui/`.
3. **M4–M8** per `PHASES.md` (Aurelia content, economy, society/law/info,
   continuity, hardening).

3. **M4–M8** per `PHASES.md` (Aurelia content, economy, society/law/info,
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
