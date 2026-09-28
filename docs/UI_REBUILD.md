# ReelLife UI Rebuild — Implementation Document

> Authoritative working document for the UI layer rebuild. The engine
> (`src/engine/`) is complete through M8; this document covers only the
> presentation layer (`src/app/`, `src/ui/`, `src/index.css`).
>
> **Status:** in progress. U0 audit + U1-a/b/c done.
> **Last updated:** 2026-09-28.
> **Gate at last update:** typecheck 0, lint 0, tests green, build OK, determinism PASS.

---

## 1. Purpose and scope

The engine is far ahead of the UI. Of 59 systems, 31 are complete with canon
content and 28 are "partial" (engine built and tested, but the playable slice
does not populate them). The UI's job is to make the engine **legible and
playable without lying** about what it does or does not model.

This document records: the actual UI state (audit), the chosen design system, the
architecture rules every screen must obey, the semantic guardrails, the phase
plan, and the open decisions.

## 2. Current UI state (audit, verified at `694c7da`)

### 2.1 Dependency reality (from `package.json`)

| Package | Version | Notes |
| --- | --- | --- |
| react / react-dom | 19.3.0 | |
| vite / @vitejs/plugin-react | 8.3.0 / 6.1.1 | |
| typescript | 6.0.3 | `strict`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| tailwindcss / @tailwindcss/vite | 4.3.3 | CSS-first config (`@import "tailwindcss"`) |
| radix-ui | 1.6.7 | the **unified** `radix-ui` package (Base-UI-era shadcn) |
| lucide-react / cmdk / clsx / tailwind-merge / cva | 1.47 / 1.1 / 2.1 / 3.7 / 0.7 | |
| vitest / eslint / typescript-eslint | 5.0.1 / 10.11 / 8.70 | |

**Not installed** (greenfield decisions when a phase needs them): React Flow,
Motion, Recharts, d3, TanStack Virtual/Table, Leaflet/MapLibre, Testing Library,
jsdom.

### 2.2 What exists (M3 shell)

- **8 shell views** (`src/app/shell/navModel.ts`): Life, People, World, History,
  Search, Settings, Console, Debug. Console/Debug are authority-gated. Keyboard
  shortcuts `Alt+1` to `Alt+8`.
- **`SimulationSession`** (`src/app/session/simulationSession.ts`) — the *only*
  module holding a `Simulation`. Screens receive read-only projections and
  callbacks; nothing can reach `world.systems`.
- **Screens** render knowledge-filtered projections with knowledge-state badges
  and honest empty states (`src/app/screens/`).
- **Decision surface** (`src/app/decision/`) — keyboard state machine
  `choosing -> previewing -> resolved`, deterministic-vs-estimate labelled,
  never expires.
- **Accessibility policy** as testable code (`src/app/ui/accessibility.ts`,
  `prefs.ts`): 4-step text scale, 44px targets, focus order, terminology table,
  `playerMessage` (cause + remedy), `isLocalizationReady`.
- **Query projection layer** (`src/engine/query/`) — `getLifeSituation`,
  `getMapView`, `getPersonView`, `getTimelineView`, `getWorldView`, and more.

### 2.3 What is missing

- **Spatial map**: the World "map" is a flat marker list. `MapView` already ships
  `position { latitude, longitude, confidence }`, and `canon.ts` has a `GeoPoint`
  for every continent/ocean/country/region/settlement/mountain/river (plus
  corridors as settlement chains). **No polygon boundary geometry exists** — a
  filled political map would need provisional boundary invention (log in
  `CONTENT_GAPS.md`); a point + route map is fully canon-grounded.
- **New surfaces** (brief section 9): Law & Records, Economy, Information,
  Community, Continuity/Legacy. None exist yet.
- **No virtualisation**, no genealogy graph, no charts, no supply-chain graph.

### 2.4 Defects found and fixed

- `PROGRESS.md` header/position were stale (said M6; session log reached M8) — fixed (U0).
- `CharacterView.tsx` was orphaned dead code whose `KnowledgeBadge` tone map
  conflicted with `knowledge.ts` — removed (U0).
- `textScaleClass()` existed and was tested but **never wired** — CSS classes
  undefined, applied nowhere, no control. Fixed (U1-a).

## 3. Design system: atmospheric / game-like (owner-approved)

The direction is atmospheric, but the brief is explicit that atmosphere must be
subject-specific and honest, not a generic game skin. No decorative gradients, no
all-caps eyebrow labels on every heading, no invented spectacle.

### 3.1 Tokens

- **Colour**: existing OKLCH tokens in `src/index.css` (`:root` + `.dark`),
  including the `--state-*` knowledge palette
  (known/estimate/rumor/inference/unknown/hidden).
- **Typeface roles** (U1-c, **provisional** — revisit in U7):
  - `--font-display` — serif stack (`ui-serif, Georgia, "Times New Roman", serif`)
    for identity/editorial moments (app title, character name).
  - `--font-body` — system sans stack for content.
  Both are font *stacks* that degrade gracefully; no webfont dependency is added,
  so the game stays self-contained and offline-friendly.
- **Radius/spacing**: existing shadcn tokens + `densityClasses`
  (comfortable/compact).
- **Text scale**: one `html.reellife-text-*` root class (87.5% / default /
  112.5% / 125%) so every rem-based `text-*` token moves with the setting.

### 3.2 Knowledge vs coverage (two independent axes)

- **Knowledge** (`knowledge.ts`) — *how well* the viewer knows a fact:
  known / estimate / rumor / inference / unknown / hidden.
- **Coverage** (`coverage.ts`) — *how much* of a system exists to render:
  `complete` / `partial` / `not-stated`. This is what powers honest empty states.

### 3.3 Motion tiers (`motion.ts`)

- **Tier 1 "response"** — panels, confirms, row expands. Allowed everywhere.
- **Tier 2 "moment"** — life-stage, death, estate, succession. Only on the screens
  that warrant it; skippable, never blocks input, plain-text equivalent.
- **Tier 3 "ambient"** — background texture/particles. Off by default, opt-in,
  disabled under reduced motion or low power.
- Gate: `motionEnabled()` (player choice OR OS preference) + `motionAllowed()`.
  The root carries `data-motion="full" | "reduced"`.

### 3.4 Accessibility floor (non-negotiable, `accessibility.ts`)

Text scale (4 steps, root class), 44px targets, focus order, tone-always-labelled,
no time pressure, one term per concept, errors name a remedy, localisation as data.

### 3.5 Shared presentation primitives

## 4. Architecture and rules

```
UI event -> command surface -> SimulationSession -> engine (owner scope)
engine state -> SimulationSession projection (read-only) -> hooks -> screens
```

- **R1 one writer / R2 session-only door**: the UI never mutates world state; all
  actions go through `SimulationSession.act(...)`; reads go through query
  projections. Enforced three ways: ESLint `no-restricted-imports` (the engine may
  not import `@/app`, `@/ui`, React or DOM globals),
  `tests/invariants/architecture.test.ts`, and the session-layer pattern itself.
- **R3 reads must not write**: engines expose `Engine.peek(scope, world)`.
- **R4 determinism / R5 save-equivalence**: UI randomness (cosmetic particles)
  must be isolated and must never feed the sim. Save shapes are versioned
  (`SIMULATION_VERSION`), migrated and checksummed.
- **R6 performance budgets**: five resolution levels (abstract -> regional ->
  settlement -> street -> household; caps 0/64/512/2048/8192 resolved persons per
  step), measured in work units (`src/engine/observability/budgets.ts`).
  **Important:** `budgets.ts` is *telemetry* — a static taxonomy plus `judgeStep`.
  There is no runtime "current resolution level" field in world state, so the UI
  must not fabricate one. What it can honestly show: the map LOD, the count of
  materialized residents, and the budget metrics on the Debug screen.
- **R7 derived vs owned**: derived readings (careReading, standingBetween, ...)
  are shown with their named basis/constraint — never cached as stored truth.

### 4.1 Adding data to a screen

Never import an engine class into a component. Add or extend a projection in
`src/engine/query/`, surface it through `SimulationSession`, and test it. The
architecture invariant test fails if a component reaches past the session.

## 5. Semantic guardrails: what the UI must never claim

- No single reputation score (reputation is per-observer, per-domain, with decay).
- No `isMarried` flag; `spouse` is a relationship *context*; status is not quality.
- Conflict "unresolved" is a valid terminal state, not a failure.
- Sanctions are conditions, not prices; **charge vs conviction** stay distinct.
- Government budgets are authorizations; policies carry an implementation gap.
- Information tracks exposure/delivery, **not** belief/comprehension; claims keep
  provenance, verification, corrections and disputes.
- Technology has three gates — exists -> available -> adopted; show the stuck gate.
- Migration pressure **moves nobody**; crossing is travel; arrival is not citizenship.
- Weather is **derived** (climate + season + deterministic jitter); disasters cause
  no automatic damage (content gap).
- Infrastructure repair ladder: workers -> equipment -> materials -> access ->
  authority -> funding; show the blocking rung.
- Fog of war: the map shows only what the player character knows.
- Determinations cite evidence; `presumed` is not `witnessed`.
- Estates: will outranks intestacy (descendants -> household -> parents ->
  siblings, stopping at the first tier with a survivor); money splits by share, a
  single item goes whole; no heir -> `unclaimed`; residences, leases, jobs and
  policies are `settable: false`.
- **No `legacyBonus` scalar**; legacy is concrete owning-system fields only.

## 6. Phase plan and definition-of-done

- **U0 — Audit** — done. PROGRESS.md corrected; dead code removed; baseline captured.
- **U1 — Design system** — done.
  - U1-a text-scale wiring (CSS + root class + Settings control).
  - U1-b primitives: `coverage.ts`, `KnowledgeBadge`, `CoverageBadge`,
    `EmptyState`, `Basis`, with `tests/app/coverage.test.ts`.
  - U1-c motion-tier policy (`motion.ts` + `tests/app/motion.test.ts`) and
    typeface roles.
- **U2 — Core loop.** Needs readings, schedule/commitments + conflict surfacing,
  honest resolution reporting (telemetry, not a fabricated live level), honest
  empty states throughout. DoD: keyboard walkthrough, reduced-motion verified.
- **U3 — People + Genealogy.** Virtualised directory; per-observer perceptions;
  React Flow genealogy; household stints; honest empty states for the 28 partial
  systems.
- **U4 — World.** Spatial SVG map (point + route, fog-of-war, LOD tied to zoom);
  place detail, travel/border access, weather, infrastructure ladder, international.
- **U5 — Society.** Law & Records, Information, Community, Economy tabs.
- **U6 — Continuity/Legacy.** Death determination, estate report, succession and
  control handoff, archived lives; the Tier-2 moment layer.
- **U7 — Polish/hardening.** axe audit, performance pass against budgets,
  keyboard walkthrough, responsive pass, save-slot UX, guardrail regression tests.

**Definition-of-done for every phase:** gate green; `PROGRESS.md` updated;
provisional decisions in `CONTENT_GAPS.md`; contradictions carried in
`SOURCE_CONFLICTS.md`; empty states verified; keyboard-only walkthrough passed;
reduced-motion verified.

## 7. Open decisions and defaults

1. **Visual direction** — **decided**: atmospheric / game-like.
2. **Target platform** — default: desktop-first, responsive down to mobile.
3. **Web Worker for the engine** — default: defer until profiling shows stalls.
4. **React Bits Pro vs free** — default: free tier only (Tier-2 moment layer).
5. **System 26 (contracts/shared ownership)** — default: defer; flag before U5.

## 8. Testing and verification gate

Run before and after every session:

- `npm run typecheck` (0 errors)
- `npm run lint` (0 errors)
- `npm test` (Vitest)
- `npm run build`
- `npm run sim -- --check-determinism` (0 invariant failures, 0 ownership violations)

UI-specific additions as surfaces land: projection unit tests (respecting the
architecture boundary), accessibility-policy tests per surface, empty-state
component tests, and (U7) guardrail regression tests asserting no `isMarried`,
no `legacyBonus`, and no single reputation score in any UI model.

## 9. Change log

- **2026-09-28, commit `a62c9c1`** — U0 audit close-out (PROGRESS.md correction,
  `CharacterView` removal) + U1-a text-scale wiring + U1-b primitives.
- **2026-09-28** — U1-c motion-tier policy + typeface roles; `EmptyState` wired
  into the Life screen; this document created.

- Canon counts the Bible does not state are shown as "not stated" (GDP, named
  firms, exact city populations, religious shares, named wars).
- Settlements: the source says both 34 and 30; all 34 are encoded and the
  contradiction is carried, not "fixed" in the UI.


| Primitive | Purpose |
| --- | --- |
| `KnowledgeBadge` | the one known/estimate/rumour/... badge (label + tone) |
| `CoverageBadge` | complete / partial / not-stated badge |
| `EmptyState` | honest "nothing recorded yet" with what is missing and why |
| `Basis` | the named binding constraint / "why this is shown" annotation |

All are thin components over pure, tested helpers (`knowledge.ts`, `coverage.ts`).

