REELLIFE — CONTINUE EXISTING IMPLEMENTATION

You are taking over an existing ReelLife development session from another AI coding agent.

Your job is NOT to restart, redesign, or rebuild ReelLife from scratch.

Your job is to inspect the CURRENT CODEBASE, determine exactly where the previous implementation stopped, and continue development from that point while using the ORIGINAL REFERENCE FOLDER as the authoritative specification - "REEL LIFE FULL PLAN SOURCE" .

---

1. TWO SOURCES OF TRUTH

There are two different things you must keep separate:

A. CURRENT CODEBASE

This represents the actual implementation state.

Use it to determine:

- what has already been implemented
- what is partially implemented
- what is missing
- what is broken
- what architecture has already been established
- what the previous agent was working on
- what should logically be done next

B. ORIGINAL REFERENCE FOLDER

This is the project's original specification/reference material.

Use it to determine:

- intended architecture
- system specifications
- requirements
- terminology
- rules
- data structures
- dependencies between systems
- intended behavior
- constraints
- implementation order

The reference material is not a command to overwrite the existing implementation.

When the current implementation differs from the reference, investigate the difference before changing anything.

---

2. FIRST TASK — DO NOT CODE YET

Before modifying any files, inspect the project thoroughly.

Determine:

1. Current project structure
2. Existing source files
3. Existing systems/modules
4. Existing tests
5. Existing configuration
6. Package/dependency state
7. What has already been completed
8. What is partially complete
9. What is missing
10. What appears to have been the previous agent's immediate task
11. Whether there are compile/runtime/test errors
12. What the next logical implementation step is according to the reference material

Do not make speculative changes during this inspection.

---

3. FIND THE ORIGINAL REFERENCE MATERIAL

Locate the original ReelLife reference folder/files in the workspace.

Read the relevant reference material before implementing the next feature.

Do not assume that filenames alone tell you the implementation state.

Trace relationships between:

- specifications
- systems
- types
- engine modules
- tests
- UI
- data
- configuration

---

4. ESTABLISH THE CURRENT IMPLEMENTATION STATE

Create an internal mental map of:

REFERENCE SPECIFICATION
→ intended system

CURRENT CODE
→ implemented system

GAP
→ remaining work

Do not duplicate systems that already exist.

Do not replace working implementations merely because you would personally structure them differently.

Preserve existing architecture unless there is a concrete reason, supported by the reference material or an actual bug, to change it.

---

5. CONTINUE FROM WHERE THE PREVIOUS AGENT STOPPED

Once you understand the state of the project:

- identify the exact unfinished task
- inspect the surrounding implementation
- inspect relevant reference specifications
- inspect related tests
- determine the smallest coherent next implementation step

Then implement it.

Do not jump ahead several systems unless the current task requires it.

---

6. PRESERVE REELLIFE'S ARCHITECTURE

Treat the existing architecture as intentional.

In particular:

- Keep the simulation/engine logic framework-agnostic.
- Keep UI concerns separate from engine logic.
- Maintain deterministic behavior where the specification requires it.
- Do not introduce unnecessary dependencies.
- Do not replace existing libraries/frameworks without a concrete reason.
- Do not create parallel implementations of an existing system.
- Reuse existing types and utilities where appropriate.
- Follow the project's existing naming conventions.
- Follow the project's existing folder/module conventions.

The React/Vite/TypeScript/Tailwind stack is the presentation layer; do not allow UI concerns to leak into the core simulation engine.

---

7. TEST BEFORE DECLARING SUCCESS

After implementation:

1. Run the relevant tests.
2. Run type checking.
3. Run the relevant build/check commands.
4. Fix errors caused by your changes.
5. Verify that existing functionality has not regressed.

Do not claim something is complete merely because the code compiles.

---

8. IMPORTANT — DO NOT MAKE UNNECESSARY CHANGES

Avoid:

- broad refactors
- cosmetic rewrites
- dependency replacement
- architecture rewrites
- renaming unrelated files
- rewriting existing working systems
- implementing future systems prematurely

The goal is to continue the existing project, not to demonstrate a different architecture.

---

9. WHEN YOU ENCOUNTER AMBIGUITY

If the reference material is ambiguous:

1. Check the surrounding specifications.
2. Check existing implementation patterns.
3. Check related systems.
4. Check tests.
5. Choose the interpretation most consistent with the existing ReelLife architecture.

Do not invent major mechanics without evidence.

---

10. WORKING STYLE

Work autonomously once the project state is understood.

For each meaningful implementation step:

Inspect → Understand → Implement → Test → Verify → Continue

Do not repeatedly ask for permission for routine implementation decisions.

If you encounter a genuinely architectural ambiguity that cannot be resolved from the repository or reference material, stop at that decision point and explain the ambiguity clearly.

---

FINAL OBJECTIVE

Continue ReelLife from the exact state in which the previous coding agent left it.

The original reference material tells you what ReelLife is supposed to become.

The current codebase tells you how far ReelLife has already progressed.

Your responsibility is to bridge those two states carefully, without losing existing work.

DO NOT START OVER.
DO NOT REBUILD EXISTING SYSTEMS.
DO NOT IGNORE THE REFERENCE MATERIAL.
DO NOT ASSUME THE PROJECT IS EMPTY.

First inspect. Then understand. Then continue.


ORIGINAL AI SESSION PLAN:

REELLIFE — BUILD PLAN (v1)
1. What I verified in REEL LIFE FULL PLAN SOURCE
Package	Contents	Status
REELLIFE_SYSTEMS_V3/	00_INDEX, systems 01–59, REELLIFE_MASTER_SYSTEM_ARCHITECTURE_V3.txt	Read: index, master arch, and 14 system specs (01–08, 10, 11, 17, 18, 24, 25, 27, 29, 32, 37, 40, 53, 55, 57, 58, 59). All follow one template: Role / Owns / Does NOT own / Model / Rules / Interactions / Testing + 13 shared architectural laws.
REELLIFE_WORLD_BIBLE_V1/	00_INDEX, WORLD_BUILD_01–14	All 14 read — Aurelia canon fully captured below.
REELLIFE_UI_UX_SPECIFICATIONS_V1/	00_INDEX, UI_UX_01–24, master ref	All read.
REELLIFE_UI_COMPONENTS_V1/	00_INDEX, selection rules, acquisition log, React Bits reference (link-only), SHADCN_MIT/ (13 .tsx + MIT license)	Read; imports inspected.
Root docs	REELLIFE_IMPLEMENTATION_CONTEXT.txt, REELLIFE_MASTER_AI_PROMPT_V2.txt, REELLIFE_SOURCE_INDEX.txt, REELLIFE_UPSTREAM_TREE_MANIFEST.txt	All read.
Non-negotiable constraints extracted: JS/TS web stack only (no Rust/C++/Python/Unity/Godot); browser-native HTML/CSS valid as foundation; no paid-AI runtime dependency; .reel is the native save format; robert1811/life-simulator is reference-only and must not be recreated; pipeline is Intent → Command → Validation → Action Resolution → Event → Consequences → New State; the 13 architectural laws (single owner per field, one clock, seeded RNG, UI never mutates state, information ≠ truth, etc.).

Environment facts (checked): Node v24.19.0, npm 11.17.0, git 2.55.0; npm registry reachable (PONG); workspace is not a git repo yet; REELLIFE_PLAN_V2_REPLANNED.txt referenced by the master prompt does not exist in the bundle (noted as a gap, not a blocker).

Bundled shadcn reality check: components import cn from bare "cn", @/registry/new-york-v4/ui/button, and depend on radix-ui (unified package), class-variance-authority, lucide-react, cmdk. Tailwind v4 idioms (size-4, data-slot, ring-[3px]). Adopting them requires React + Tailwind v4 + import-path adaptation (allowed: the pack is a resource, and the manifest explicitly says don't add deps just because they appear in it).

2. Canonical content inventory I must encode (from the World Bible)
Planet WORLD-AURELIA; start 1 January 2042; ~6.8B pop; ~70% urban; era = Contemporary Age; scales: 6 continents, 5 oceans, 36 regions (6×6), 48 countries, 34 named major settlements (documented drafting inconsistency says "30" — I will encode all 34 and log the discrepancy rather than delete cities), 4 mountain systems, 5 rivers, 6 corridors, 8 history eras, 6 language families (~39 languages) + 6 scripts, 7 religions, 5 resource groups, 5 financial centers, 10 org types, 11 institutional areas, 11 technology eras / 9 development stages, 17 active world developments.
Data models to implement verbatim-ish: ActiveEvent (19 fields), WorldTimeline (9 categories), WorldState (28 fields), Organization (33 fields), Institution (15), PopulationRegion (21), Household (15), Country (23), Region (17), Technology (23), Settlement hierarchy (11 levels), ID scheme (WORLD-…, CONT-…, COUNTRY-…, REGION-…, CITY-…, RIVER-…, ORG-…, EVENT-…).
Deferred-by-design content (must NOT be invented as canon): exact country GDP/currencies/central banks, named companies/banks/universities, exact city populations, religious population shares, named wars. → I'll encode only what's needed to run (one provisional currency, flagged) and log the rest in docs/CONTENT_GAPS.md.
3. Core architectural decisions
Two-world separation in one repo: a pure-TypeScript, DOM-free engine (authoritative) and a thin app (React) that only reads projections and dispatches commands. Nothing in app/ may import an engine mutator.
Ownership is enforced, not documented: WorldState.mutate(ownerSystemId, fn) + a dev-mode guard; every system declares ownedPaths; a test asserts the declared sets are disjoint and that all persistent state is claimed exactly once. → satisfies law #1 and the master-arch lock checklist.
One clock: WorldTime = integer minutes since Aurelia epoch (epoch 1900-01-01T00:00Z); calendar derived; speeds 1x/10x/100x/1000x change cadence only; pause freezes authoritative time; ordering key = (timestamp, priority, sequence).
Money: { currencyId, minorUnits: safe-integer }; all math through money.ts with overflow guards; every mutation posts a balanced ledger entry (law #12).
RNG: named streams (world, population, person:<id>, events, markets, scenario), xoshiro128** seeded by SplitMix64 over masterSeed + stream path; full state serialized; zero Math.random() in engine/ (enforced by lint + a test that greps it). Eligibility is evaluated separately from probability; ResolutionObject records candidates, weights, selected outcome, RNG metadata.
Events are plumbing: queue ordered deterministically, preconditions revalidated at execution, delayed effects become future scheduled events, chain-depth/cycle/quota guards, causalChainId + parentEventId for the explainability requirement (System 59).
Relevance & materialization: Abstract → Light → Active → High Detail; individuals are materialized from persisted aggregate context and then kept on a persistent dossier, so re-materialization restores a life instead of inventing one (System 07).
Information ≠ truth: every projection is knowledge-filtered by viewer; UI renders known | estimate | rumor | inference | unknown | hidden as distinct semantic states.
4. Proposed repository layout (project at workspace root, source folder untouched)

c:\Users\Atawaji Nathaniel\Documents\REELLIFE\
├─ REEL LIFE FULL PLAN SOURCE\        (reference only — never built, never imported)
├─ index.html            vite.config.ts        vitest.config.ts
├─ package.json  tsconfig.json  tsconfig.node.json  eslint.config.js
├─ docs\ ARCHITECTURE.md  OWNERSHIP_MATRIX.md  CONTENT_GAPS.md
│         SOURCE_CONFLICTS.md  MILESTONES.md  .reel-FORMAT.md
├─ src\engine\
│   ├─ core\        WorldState, registries, EntityRef, lifecycle, system registry, Simulation (step loop)
│   ├─ primitives\  money, ids, time, LocationRef, EventRef, Contract, Relationship, Organization,
│   │               InformationClaim, Asset, Activity, AuthorityCheck, ResolutionObject
│   ├─ time\ rng\ events\ activities\ persistence\ scale\
│   ├─ person\      identity, aging, needs, health, mental, traits, skills, cognition, goals
│   ├─ decisions\   NPC autonomy (candidate gen → eligibility → authority → scoring → intention)
│   ├─ social\ family\ economy\ orgs\ world\ society\ security\ info\ global\ continuity\
│   ├─ commands\    registry, validators, authority, dispatch pipeline
│   ├─ query\       presentation projections (knowledge-filtered) — the UI's only read path
│   ├─ history\ console\ observability\ (timeline/journal/stats, console parser, traces/invariants/metrics/replay)
│   └─ config\      schemas + content loaders (System 58)
├─ src\content\     aurelia\ (world, countries, settlements, regions, history, languages, religions,
│                   economy, institutions, technology, population, worldState, activeEvents)
│                   occupations, skills, education, foods, items, vehicles, buildings, businesses,
│                   technologies, laws, holidays, culture, diseases, weather, orgTemplates, currencies
├─ src\app\         React views: Life, People/Social, World, History, Search, Settings, Debug
├─ src\ui\          bundled shadcn components (adapted) + lib/utils.ts (cn)
├─ src\lib\         dispatch client, query client, formatting, accessibility/theme
└─ tests\           unit per system + cross-system scenarios + invariants + determinism/save-load equivalence
Scripts: dev, build, preview, typecheck, lint, test, test:invariants, test:scenarios, sim (headless fast-forward: npm run sim -- --seed 12345 --years 5 --check-determinism).

5. System → module map and milestone sequencing
The master prompt forbids implementing all 59 systems at once and prescribes a vertical slice. I'll build in dependency order, each milestone independently runnable and tested.

M0 — Scaffold & guardrails. Vite/TS/Vitest/ESLint, path aliases, docs (OWNERSHIP_MATRIX, SOURCE_CONFLICTS, CONTENT_GAPS), CI-style scripts. DoD: typecheck, lint, test all green on an empty state module.

M1 — Kernel (Systems 01, 02, 03, 04, 05, 06, 58, 59). Primitives; taxonomy IDs; clock/calendar; RNG streams + distributions; event engine; activity/schedule/commitment engine; .reel persistence (format header, checksum, schema validation, reference validation, atomic store, migration registry); config/content schemas; observability (trace ring, invariants, metrics, replay harness). DoD: determinism test (same seed ⇒ identical state hash over N steps), save/load equivalence test, temporal-ordering test, no-Math.random test, npm run sim works headless.

M2 — Vertical slice (Systems 07, 08, 09, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 24, 25, 26, 27, 29, 30, 32, 33, 37, 40, 53 partial). Person identity, aging, needs, health, mental state, traits, skills, cognition, goals; NPC decision loop; relationships + household; ledgers/accounts; employment; housing/lease; inventory/items; food/nutrition; organization core; geography; legal identity; materialization of a small active population (~200–2 000 individuals) inside one city so the world feels lived-in. Commands: person.eat|sleep|rest|hygiene|socialize, activity.start|stop, employment.apply|accept|resign|work_shift, housing.sign_lease|move_in|pay_rent, finance.transfer|pay_bill, social.message|visit|apologize, world.save|load, time.set_speed|pause. DoD: one full causal chain reproducible from seed (e.g. missed shift → dismissal → income shock → rent threat → NPC takes second job), plus cross-system scenario tests for job loss and relationship shift.

M3 — UI shell (Systems 55, 56, 57 + UI/UX 01–08, 14, 17–24). Shell with Life / People / World / History / Search / Settings anchors; Life screen (situation, time, location, needs, active commitments, current activity, nearby people, event feed, quick actions); Person view with knowledge-state badges; Decision surface with commit step and estimate-vs-deterministic labelling; notification feed with relevance filtering; console (System 57) with read/mutation distinction and authority levels; debug UI (UI/UX 22) behind an authorized mode. DoD: a test asserts the UI bundle contains no engine-mutator import; keyboard-only walkthrough of a decision; reduced-motion + density modes.

M4 — Aurelia content + spatial world (Systems 37, 38, 46, 47, 39, 45, 56). Full canonical world data; geography hierarchy with stable LocationRefs; aggregate population per region/city with deterministic materialization; weather/environment/disaster; world view with LOD + knowledge-limited markers; spatial history for renamed places. DoD: data-validation test asserting 6/5/36/48/34 counts and unique IDs; map renders only player-known markers.

M5 — Economy & organizations (Systems 23, 25, 28, 31, 33, 34, 35, 36). Markets/prices/competition, businesses, supply chains/B2B, macro layer, education, transport, insurance. DoD: market-shock scenario reproducible; ledger conservation property test over 10 000 transactions.

M6 — Society, law, information, global, security (Systems 41–44, 48, 49, 50, 51, 52, 21, 22, 20). Laws/regulatory rules, government/public services, institutions + institutional memory, culture/religion, security & legal pipeline (incident → investigation → court → hidden orgs), information graph/media/messaging, technology diffusion, international relations, conflict/negotiation, reputation, parenting. DoD: rumor-propagation scenario (truth vs belief divergence asserted), one legal-pipeline scenario.

M7 — Continuity (Systems 53, 54, 19 genealogy, legacy). Death → determination → records → estate/probate → inheritance → descendant control transfer → legacy traced through concrete assets/records/relationships/organizations; Timeline/Journal/Statistics as derived-only presentations. DoD: multi-generation test proving PersonId survives, no arbitrary hidden modifiers, causal history intact after control transfer.

M8 — Hardening. Performance budgets per resolution level, save migrations with fixtures, accessibility pass (UI/UX 21), full cross-system scenario suite (job loss, marriage, disaster, death, rumor, inheritance, migration, market shock), content completeness ledger.

CURRENT PROGRESS: .\PROGRESS.md