# ReelLife UI Rebuild — Implementation Document

> Authoritative working document for the UI layer rebuild. The engine
> (`src/engine/`) is complete through M8; this document covers only the
> presentation layer (`src/app/`, `src/ui/`, `src/index.css`).
>
> **Status:** U0–U7 complete. Every planned phase has landed; the deferred
> items and the reasons are recorded in `docs/CONTENT_GAPS.md`.
> **Last updated:** 2026-09-28.
> **Gate at last update:** typecheck 0, lint 0, 92 files / 793 tests, build OK,
> determinism PASS.

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

- **Spatial map**: landed in U4 as a **point-and-route SVG plot**. `MapView`
  already shipped `position { latitude, longitude, confidence }`, and `canon.ts`
  has a `GeoPoint` for every continent/ocean/country/region/settlement/mountain/
  river. **No polygon boundary geometry exists** — a filled political map would
  need provisional boundary invention, so it stays a deliberate "not drawn" and
  the map says so in words.
- **New surfaces** (brief section 9): three of the four landed in U5 as the
  **Society** anchor (Alt+4) with tabs for Law & Records, Information, Community
  and Economy. **Continuity/Legacy remains.** The organising rule of that phase
  is *a catalogue is not an experience* — see the U5 notes.
- **No virtualisation**, no charts, no supply-chain graph. Genealogy exists as of
  U3, but as generational rows plus a native-SVG pedigree rather than a node-link
  canvas (see the U3 phase notes and `docs/CONTENT_GAPS.md`).

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
- Canon counts the Bible does not state are shown as "not stated" (GDP, named
  firms, exact city populations, religious shares, named wars).
- Settlements: the source says both 34 and 30; all 34 are encoded and the
  contradiction is carried, not "fixed" in the UI.
- A count the viewer cannot act on is a count, not a list: the People directory
  reports the people the player has not met as a figure and never as rows.
- **There is no single reputation score anywhere in the UI**, not even as a
  convenience total. Perceptions are shown observer by observer, and the only
  aggregate offered is explicitly labelled a mean of the views actually held.

## 6. Phase plan and definition-of-done

- **U0 — Audit** — done. PROGRESS.md corrected; dead code removed; baseline captured.
- **U1 — Design system** — done.
  - U1-a text-scale wiring (CSS + root class + Settings control).
  - U1-b primitives: `coverage.ts`, `KnowledgeBadge`, `CoverageBadge`,
    `EmptyState`, `Basis`, with `tests/app/coverage.test.ts`.
  - U1-c motion-tier policy (`motion.ts` + `tests/app/motion.test.ts`) and
    typeface roles.
  - U1-b primitives, all thin components over pure tested helpers
    (`knowledge.ts`, `coverage.ts`) — the point being that the rule is a
    function that can be asserted, not a branch inside a render:

    | Primitive | Purpose |
    | --- | --- |
    | `KnowledgeBadge` | the one known/estimate/rumour/... badge (label + tone) |
    | `CoverageBadge` | complete / partial / not-stated badge |
    | `EmptyState` | honest "nothing recorded yet" with what is missing and why |
    | `Basis` | the named binding constraint / "why this is shown" annotation |
- **U2 — Core loop** — done. `CommitmentView.conflicts` from
  `ActivitiesEngine.conflictsFor` (System 05): a clash is reported, never
  resolved, and overlapping minutes are prose (`overlapLabel`). Needs carry the
  engine's own urgency word into `urgencyTone` (System 10) rather than the UI
  thresholding a level. Resolution is reported as the measurable fact (how many
  people here are simulated life by life) because `observability/budgets.ts` is a
  static taxonomy, not a live level. `EmptyState` on every empty panel, including
  the new "detail level" note.
- **U3 — People + Genealogy** — done, with two deliberate deviations:
  - `getPeopleDirectory` — self + household + recorded ties (Systems 18/19).
    Everyone the viewer has not met is returned as a **count**, so a stranger is
    never rendered as an acquaintance.
  - `getFamilyView` — System 19's household, membership *stints*,
    parents/partners/children/siblings, and the ancestor/descendant walks.
  - `getPerceptionView` — System 22 observer by observer, with the observer's
    name knowledge-filtered and the aggregate explicitly labelled a mean.
  - **Deviation 1: no React Flow.** Lineage is a native SVG from the pure
    `src/app/people/lineageLayout.ts`, with edges only where a parent was
    recorded. Rationale in `docs/CONTENT_GAPS.md`.
  - **Deviation 2: no list virtualisation.** The directory is bounded by what
    the systems have recorded, so a virtualiser would be an unmeasured
    dependency.
  - DoD note: the keyboard walkthrough is satisfied structurally (no new
    interactive primitive was introduced — the only new controls are the existing
    `Button`), and reduced motion is untouched because the diagram has no
    animation.
- **U4 — World** — done. The World screen's flat marker list is now a spatial
  SVG plot, and every claim below is asserted rather than asserted-in-prose:
  - `src/app/world/mapProjection.ts` is **pure geometry** — bounds, the
    equirectangular projection, the camera, and the layout — so the arithmetic is
    testable without a DOM, which the project has no jsdom for.
  - **The layout accounts for everything.** Every marker and route the
    projection returned is either drawn or returned in `undrawnMarkers` /
    `undrawnRoutes` with a reason. A place with no position is *listed and
    explained*, not dropped.
  - **Fog of war survives drawing.** A test runs the real knowledge-limited
    `MapView` through the layout at every LOD and both zoom levels, proving the
    drawn set is exactly the permitted set — the picture cannot reveal a place
    the projection withheld.
  - **Zoom is a lens, not a claim.** Radius and state are identical at every
    magnification; only position changes. A settlement does not become a
    continent by being magnified.
  - **The picture is decorative.** The SVG is `aria-hidden` and the roster under
    it is complete — the old `MapMarkerItem` detail (population, weather,
    hazards, disasters, political, former names, event count, approximate
    position) moved into it rather than being lost to a dot.
  - Keyboard-first interaction: zoom buttons, arrow-key pan and `+`/`-` zoom
    from a focusable labelled viewport. No wheel-zoom, no drag — logged as a
    deliberate deferral, not an oversight.
  - Not done, and deliberately: coastlines, borders, and any filled political
    geometry. The content does not contain them.
- **U5 — Society** — done, as the ninth nav anchor (Alt+4; History…Debug shift to
  Alt+5…9) with four tabs. Phase rule: **a catalogue is not an experience.**
  - Measured the seeded slice before designing anything: 4 law rules / 0 permits;
    5 cultural groups + 11 traditions / 0 participation; 307 information nodes /
    0 claims, 0 exposures, 0 links; 3 markets + 7 goods / 0 transactions. All four
    systems ship a catalogue and no lived activity, so every tab reports "what
    exists" and "what has happened to you" separately.
  - `getLawView` — rules as written, with sanction amounts, required credentials,
    whether the viewer holds one, and any ambiguity the engine flagged. It never
    interprets a rule into "what you may do": permission is decided through the
    command pipeline.
  - `getInformationView` — keeps three things apart that are easy to collapse:
    whether a claim is **true**, whether someone was **reached** by it, and what
    anyone **believed** (which System 49 does not model). A reached claim is
    labelled "which is not the same as being believed".
  - `getCommunityView` — the menu of traditions available where you are, kept
    explicitly apart from your membership of it.
  - `getEconomyView` — the market's own prices, costs and tax, copied; the
    concentration figure is the largest recorded share, not an invented index;
    and the tab says outright that no price has been tested against a buyer.
  - The World Bible's own gap notes ("authors no statute book", "authors no
    currencies") ride on the affected rows via `CoverageBadge`.
  - Not done: charts (Recharts), the supply-chain graph, and anything System 26
    (contracts) would own. Logged in `docs/CONTENT_GAPS.md`.
- **U6 — Continuity/Legacy** — done, as a fifth tab on the Society anchor
  (deliberately *not* a tenth nav entry: that would shift every keyboard
  shortcut a second time in two phases).
  - Measured first: `systems.continuity` is **not mounted** in the playable
    slice, and 0 of 300 residents are non-`active`. Every death, estate and
    succession row is therefore empty on a fresh world.
  - **Not seeded.** The repository has already settled this: *"a v1 world
    genuinely had no determinations, no estates and no heirs; manufacturing them
    would be invisible and would become canon"* (`CONTENT_GAPS.md`, M8). So the
    surface is a live empty state that says why, and it is **not a blank page**
    because the household roster (System 19) is real data.
  - Reads through `LifeContinuityEngine.peek` — the read-only handle M8 added so
    reading continuity cannot claim a state slot.
  - Faithfulness, asserted: `probable` is never shown as certain, an inference is
    never shown as a witness, evidence is referenced by count and owning system
    rather than restated, estate items each name the system that holds them,
    beneficiaries name their basis, and a control handoff never rewrites the
    person it came from.
  - No score for a life: a test asserts the serialised view contains no
    `legacyBonus`, `legacyScore` or reputation field.
  - The engine corrected one of my tests: `determineDeath` refuses a
    determination citing no fact, so "at least one referenced fact" is the
    invariant.
  - Not done: the Tier-2 "moment layer" (React Bits) — see U7.
- **U7 — Polish/hardening** — done. Two new test files, no new dependency.
  - **`tests/invariants/guardrails.test.ts`** (17) — the guardrails the brief names
    by name, plus the invariants that make the UI reviewable: no `isMarried`, no
    `legacyBonus`/`legacyScore`, no `reputationScore`, no `guard.mutate` anywhere
    in `src/app`; no click handler on a non-interactive element; every custom
    focusable region carries a role *and* a name; no `aria-hidden` on a focusable
    control; the Society tabs use the real ARIA tab pattern; no screen pins a
    pixel width, and any multi-column grid declares a single-column base. Plus a
    **projection-purity** block: all 17 read-path projections are called, the
    state hash must not move, no ownership violation may be recorded, and each
    must return the identical value twice — a read that mutated, or that drifted,
    would break determinism silently.
  - **`tests/app/keyboardWalkthrough.test.ts`** (5) — the walkthrough as data, not
    prose: six steps each naming the file and literal that proves the control
    still exists, plus focus order, per-anchor shortcuts and the 44px policy.
  - Performance is asserted in **work units, not wall clock** — the engine's own
    `MAP_MARKER_BUDGET`/`MAP_ROUTE_BUDGET` hold at every LOD, and the resolution
    taxonomy is still declared. The project already rejected wall-clock budgets
    as flaky on shared CI, and that stance is kept.
  - **Honest limits, recorded in `CONTENT_GAPS.md`:** the a11y audit is static,
    not `axe` (the project has no DOM); the bundle is 712 kB raw / **200 kB gzip**
    and stays one chunk, because the engine is held synchronously by the session
    and splitting it would create a second way for the UI to be incomplete; and
    the Tier-2 moment layer, charts and System 26 are **deferred with reasons**
    rather than bolted on during a hardening phase.
  - Save-slot UX was already complete from M3 (two-step load confirmation and an
    explicit "could not be listed" state instead of a false empty list) and is
    re-verified by the existing suite rather than rebuilt.

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
- **2026-09-28 — U2 + U3 landed.** The dislocated fragment that used to trail
  this file (the primitives table and two guardrail notes) was moved back into
  sections 4 and 5 where it belonged.
  - **U2.** `CommitmentView.conflicts` from `ActivitiesEngine.conflictsFor`;
    `formatDuration`/`overlapLabel` in the projection; `urgencyTone` in
    `knowledge.ts`; needs urgency + clash surface on the Life screen; the
    honest "detail level" note reporting measured residents. New helper exports
    for the shared projection helpers, and tests for clashes and urgency.
  - **U3.** New `src/engine/query/socialViews.ts` (directory, family, perceptions),
    `src/app/people/lineageLayout.ts` + `LineageTree.tsx`, rewritten
    `PeopleScreen`, three new session reads, and four new/updated test files.
  - The session's closed-surface guard (`tests/app/appShell.test.ts`) failed on
    the three new session methods exactly as intended; they were added to the
    boundary allowlist with a comment rather than the guard being loosened.
- **2026-09-28 — U4 landed.** The spatial map. New `mapProjection.ts` (pure) and
  `SpatialMap.tsx`; the World screen's `MapMarkerItem` became the map's
  accessible roster. `tests/app/mapProjection.test.ts` (22) plus 4 integration
  assertions in `worldMap.test.ts` that prove the drawing step cannot resurrect a
  withheld place at any zoom. Two findings from those tests are worth keeping in
  mind: a `NaN` zoom used to blank the whole canvas (now clamped), and a lone
  marker correctly does not move when you zoom about the centre — a test that
  assumed otherwise was wrong, not the code.
- **2026-09-28 — U5 landed.** The Society anchor with four tabs. The design was
  set by measurement rather than assumption: all four systems ship a catalogue
  and no lived activity, so the phase's rule became *a catalogue is not an
  experience* and every tab keeps "what exists" apart from "what happened to
  you". Two guards caught real mistakes — a hardcoded `viewForShortcut("9")` that
  had become a valid shortcut when the anchor list grew to nine, and the
  closed-surface test on the four new session reads. Both were fixed at the
  cause, and the shortcut assertion is now derived from `SHELL_VIEWS.length`.
- **2026-09-28 — U6 landed.** Continuity & Legacy, as a fifth Society tab. The
  phase turned on a measurement: System 53 is unmounted in the playable slice and
  nobody in it is dead, so every death/estate/succession row is empty. Seeding a
  death to fill the screen was declined on the project's own recorded reasoning
  (manufactured records "would become canon"), and the surface ships as a live
  empty state that is still useful because the household roster is real data.
  The engine corrected one of my tests along the way: a determination must cite
  at least one fact.
- **2026-09-28 — U7 landed; the rebuild is complete.** Two new test files and no
  new dependency. `tests/invariants/guardrails.test.ts` enforces the semantic
  guardrails by name (no marriage flag, no legacy/life score, no scalar
  reputation, no `guard.mutate` in the app) and the structural accessibility and
  responsive rules, then proves the read path is pure by calling all 17
  projections and asserting the state hash does not move. `tests/app/
  keyboardWalkthrough.test.ts` holds the walkthrough as data so it fails when a
  control is renamed. Two of my own assertions were wrong and were rewritten
  rather than the code: demanding a breakpoint on surfaces that are legitimately
  fluid single-column, and a focus-order rule that wrongly assumed
  `notificationFeed` precedes the main region. Three deferrals are recorded with
  reasons in `CONTENT_GAPS.md` — the static (non-`axe`) audit, the single 200 kB
  gzip chunk, and the Tier-2 moment layer, charts and System 26.

