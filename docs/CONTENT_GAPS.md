# Content Gaps & Provisional Decisions

The World Bible defers exact economic/civic content by design (no canonical
GDPs, currencies, company names, city populations, religious shares, named
wars). This file logs every place the implementation filled a gap with a
provisional decision, so the choice is visible and revisable instead of hidden
in code. Nothing here is canon.

## Provisional content

| Gap | Provisional decision | Where |
| --- | --- | --- |
| No canonical currency defined | Single provisional currency `AUR` ("Aurelian mark") used for all Money values | seeded through fixtures/tests; `primitives/money.ts` is currency-agnostic |
| No canonical calendar detail beyond the epoch | WorldTime = integer minutes since 1900-01-01T00:00Z; Aurelian calendar derived by `time/calendar.ts`; sim start defaults to 1 Jan 2042 | `primitives/time.ts`, `time/calendar.ts` |
| No canonical occupations/wage tables | Employment records carry free-text `occupationCode` and an agreed `wage` Money; no labour-market content yet | `employment/` |

## Mechanics the M2 slice deliberately does not have yet

| Topic | Current behaviour | Owning system / milestone that resolves it |
| --- | --- | --- |
| Job applications vs offers | `employment.apply` hires directly. There is no offer state for `employment.accept` to accept, so `accept` is folded into `apply` until System 24 matures | System 24 (Employment) — M5 polish |
| Payroll | `employment.work_shift` records the shift as an activity only; wages move by explicit `finance.transfer` with category `"wage"`. No automatic payroll runs | System 24/25 — M5 |
| Overdrafts / arrears | Finance permits negative balances (rent arrears are load-bearing in the job-loss scenario). No overdraft rules, interest, or collections | System 25 — M5 |
| Starting a conflict | No command: conflict is not something an actor *chooses* in M2. Tests record it through the relationships engine directly, with the gap stated in the test header | System 21 (Conflict) — M6 |
| NPC initiative | The decisions engine (System 17) evaluates options but nothing ticks it autonomously; NPC behaviour in scenarios is driven by explicit `origin: "npc"` commands | System 17 wiring — late M2/M3 |
| Authority | Commands declare no `authorityRequirement` yet; the authority evaluator exists (`primitives/authority.ts`) but domain commands don't gate on it | System 20/48 — M6 |
| `world.load` hot-swap | A `world.load` command cannot replace the running Simulation mid-dispatch. It validates, emits `world.load_requested`, and the platform performs the swap via `Simulation.load` + `bootstrapLoadedSimulation` | documented on the command; the M3 app performs the swap in `src/app/session/worldLoad.ts` |
| Save-slot listing vs corrupt bytes | `SaveStore.listSlots()` reads each slot's raw text and calls `slotInfoOf`, so a slot whose bytes are not a JSON `.reel` document makes the whole call throw (there is no metadata to return) and every other slot disappears with it. The M3 Settings screen therefore reports "saved worlds could not be listed" with the store's own message instead of showing a false empty list; a slot that parses but fails validation *is* listed as `corrupt` with the validator's explanation and cannot be loaded | System 06 — a store-level "unreadable slot" entry in `ReelSlotInfo`/`listSlots()` is the follow-up (deliberately not invented in M3, since it changes the persistence contract) |

## Provisional decisions introduced with the M2 closing systems

| Gap | Provisional decision | Where |
| --- | --- | --- |
| No canonical name tables (World Bible defines naming *cultures*, not lists) | Neutral international pools of 30 given + 30 family names for materialized residents | `src/content/aurelia/names.ts` (flagged non-canon in-file) |
| No canonical demographics for Arden | Age structure shares: child .24 / youngAdult .18 / adult .38 / senior .20; slice aggregate 50 000 in tests | `scale/engine.ts` `DEFAULT_AGE_STRUCTURE` |
| No canonical civil registry (institutions are M6) | Authority slug `AURELIA_CIVIL_REGISTRY`; birth registration identifiers `AUR-<SETTLEMENT>-<seq>` | `scale/materialize.ts` |
| Only the canonical spine exists in geography | 5 places: world → continent → country → region → city. Districts/neighborhoods and the full 6/5/36/48/34 hierarchy arrive with M4 | `src/content/aurelia/geography.ts` |
| No canonical organization capacity/policy data | New organizations start with neutral capacity 0.5 on every dimension and empty institutional memory | `organizations/engine.ts` |
| M2's system list includes **33 (Organizations & Businesses)** while M5 also owns it | M2 scope for 33 is delivered by the System 32 core (employers as real orgs); businesses/markets depth stays M5 | decision logged here per `PHASES.md` wording ("organization core") |

## Provisional decisions introduced with M4

| Gap | Provisional decision | Where |
| --- | --- | --- |
| No canonical per-country/city populations (World Bible defers them) | Deterministic distribution of the 6.8B: continent targets are canon; country/region/settlement totals are exact integer splits by a stable `fnv1a32(id)` weight; per-country urbanisation in [0.55, 0.85] around the ~70% global canon; settlements are the urbanised subset of their country | `src/content/aurelia/population.ts` |
| No canonical age demographics | Age distribution child .24 / youngAdult .18 / adult .38 / senior .20 reused at every level | `src/content/aurelia/population.ts` `AURELIA_AGE_DISTRIBUTION` |
| No canonical currencies / central banks (System 39) | One provisional currency `AUR` ("Aurelian mark", scale 2) referenced by all 48 countries and flagged `provisional`, so Money stays usable until a currency content pack exists (M5) | `src/content/aurelia/countries.ts` `AURELIA_CURRENCY` |
| No per-country legal-system assignment (System 39) | Every country references the single provisional slug `LEGAL-AURELIAN-CODIFIED`; legal families are System 41's to author (M6), and no 48 invented facts were created | `src/content/aurelia/countries.ts` `AURELIA_LEGAL_SYSTEM_ID` |
| No authored citizenship/immigration policy (System 39) | One shared provisional citizenship framework (`CIT-AURELIAN-STANDARD`: birth/descent/naturalization, 5 years, dual allowed) and one shared entry framework (`IMM-AURELIAN-STANDARD`: `passport_required`, work permit required, 90 visa-free days, permanent residency allowed) | `src/content/aurelia/countries.ts` |
| No border geometry or treaties (System 39) | No bilateral border regimes are authored. `borderAccess` answers from the destination country's immigration framework and, failing that, from the provisional world rule `border.default_access` = `passport_required`; a crossing is still permitted with a document check (`conditional`, not `denied`) | `src/content/aurelia/countries.ts`, `src/engine/countries/engine.ts` |
| No jurisdiction map beyond formal sovereignty (System 39) | One national jurisdiction per country plus one municipal jurisdiction per canonical settlement, nested municipal-inside-national; overlapping authorities (enclaves, free zones, disputed control) are **not** authored because the Bible authors none, though the model supports them | `src/content/aurelia/countries.ts` `aureliaJurisdictions` |
| No canonical transport timetable | Route durations/costs derived from great-circle distance and fixed mode speeds (road 80 / rail 160 / maritime 45 / flight 700 kph) | `src/engine/travel/routes.ts` |
| No canonical map from the Bible's regional climate labels to its eight zones | The 36 authored descriptors ("fertile_valley", "taiga_forest", "mediterranean_arid", …) map onto the eight zones (tropical, subtropical, temperate, arid, semi-arid, alpine, subpolar, polar) through one explicit table; all eight zones are represented, none invented | `src/content/aurelia/environment.ts` `CLIMATE_ZONE_BY_DESCRIPTOR` |
| No canonical weather data | Weather is *derived*, not authored: per-zone base temperature/precipitation/wind + seasonal amplitude (peak by hemisphere) + a stable `fnv1a32(place:month)` jitter; the condition is read off fixed thresholds | `src/engine/environment/dynamics.ts` `deriveWeather` |
| No canonical condition thresholds | Flood onset 40 mm, drought onset 6 mm, extreme heat 34 °C, wildfire needs ≥26 °C with <8 mm and rises with wind, landslide needs ≥60 mm on alpine ground | `src/engine/environment/dynamics.ts` `ambientHazards` |
| No canonical pollution/degradation rates | Per-period increments: emissions/water draw push the air/water indices (which relax on their own); degradation accrues at 1% of the net pressure and **never** falls — mitigation slows it, it does not undo it | `src/engine/environment/dynamics.ts` `nextPollution` |
| No canonical exposure/vulnerability weights | Documented fixed weights, each set summing to 1; impact = intensity × (0.5 + 0.5·exposure) × (0.4 + 0.6·vulnerability) | `src/engine/environment/dynamics.ts` |
| Tectonic hazards have no trigger yet | `earthquake`/`volcanic` are valid `HazardKind`s the engine can hold or have declared, but no rule produces them: they are not implied by weather or pollution, and seismic/volcanic probability needs the trigger owner (System 52 global events, M6). Recorded as a deliberate absence rather than a fake chance roll | `src/engine/environment/dynamics.ts` (ambient-rules comment) |
| No climate for continents/oceans/districts | `climateZoneAt` answers only for the 36 canonical regions and their 34 settlements; any other place has *no* climate rather than a guessed default | `src/content/aurelia/environment.ts` |
| Which country/region is hit by a weather hazard | Derived only from climate + pollution. Real-world modifiers the World Bible does name (rain shadow, ocean currents, elevation) are not modelled yet | follow-up with the knowledge-limited map (56); System 39 (M4) landed the country rules but no terrain/current modifiers |
| No per-city utility inventory (System 38) | Only the playable slice's network is authored: Arden's 10 assets (two grid substations, water treatment works, reservoir pumps, sanitation works, telecom exchange, district-hospital power/water, rail terminus, ring-road junction, waste depot) with a real dependency order and one deliberately overloaded asset. Every other settlement is left unauthored rather than fabricating 33 more networks | `src/content/aurelia/infrastructure.ts` |
| No canonical capacity/condition thresholds (System 38) | Capacity states are read off utilisation (≤0.50 underused, ≤0.85 normal, ≤1.00 congested, above overloaded) and service status off condition (≤0.50 degraded, ≤0.20 failed); an asset with an open outage or failed fabric reports capacity state `failed` whatever its demand | `src/engine/infrastructure/types.ts` (`CAPACITY_THRESHOLDS`, `CONDITION_THRESHOLDS`) |
| No canonical maintenance rates (System 38) | One deferred service window costs 0.02 condition; one completed window restores 0.10, capped at 1.0. "Maintenance depends on … age, damage, and organizational choices" is therefore modelled as backlog arithmetic, not as a staff roster (M5) | `src/engine/infrastructure/engine.ts` |
| No canonical repair ladder (System 38) | Repair progress ceilings follow the spec's own requirement order — workers 0, equipment 0.30, materials 0.50, access 0.65, authority 0.80, funding 0.95, all met = 1.0 — so progress can never pass the first unmet requirement and `meetRequirement` refuses to skip a rung | `src/engine/infrastructure/engine.ts` `REPAIR_MILESTONES` |
| No operators, funding or staffing bound to infrastructure (System 38) | `operatorOrgId` is part of the asset model but unauthored (canonical operators arrive with the M5 organization/economy work); servicing is recorded by the caller, and no money moves for maintenance funding yet — the spec's funding/staffing/material dependencies live as requirement gates rather than payroll and purchases | `src/engine/infrastructure/engine.ts`, `src/content/aurelia/infrastructure.ts` |
| Outages are not published as Events yet (System 38) | `raiseOutage`/`propagateOutage` **return** the outage records and the cascade members so the publishing caller can emit the events ("failures generate Events with downstream effects rather than directly scripting every impacted system"). No command or operational scheduler raises an outage on its own yet — that needs M5's funding/staffing loop to have a cause to act on | `src/engine/infrastructure/engine.ts` |
| Disaster damage to infrastructure (Systems 46/38) | System 46's exposure model already takes an `infrastructureQuality` factor from its caller, but nothing yet converts a declared hazard or active disaster into `raiseOutage(cause: "disaster")` + `propagateOutage`. The two ends exist and are tested; the damage-resolution step between them waits for System 46's response/recovery stage in M6 | `src/engine/environment/dynamics.ts`, `src/engine/infrastructure/engine.ts` |

## Canonical content still waiting for its milestone

- Occupations, skills, education, foods, items, vehicles, buildings, businesses,
  technologies, laws, holidays, culture, diseases, org templates, currencies
  content packs under `src/content/` — **M5–M6**.
- Named institutions/companies/banks/universities, exact city populations,
  religious shares, GDP/central banks (deferred by the World Bible by design) —
  remain provisional; only the flagged single currency `AUR` is encoded today.
