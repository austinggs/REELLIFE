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
| `world.load` hot-swap | A `world.load` command cannot replace the running Simulation mid-dispatch. It validates, emits `world.load_requested`, and the platform performs the swap via `Simulation.load` + `bootstrapLoadedSimulation` | documented on the command; M3 UI is the first consumer |

## Provisional decisions introduced with the M2 closing systems

| Gap | Provisional decision | Where |
| --- | --- | --- |
| No canonical name tables (World Bible defines naming *cultures*, not lists) | Neutral international pools of 30 given + 30 family names for materialized residents | `src/content/aurelia/names.ts` (flagged non-canon in-file) |
| No canonical demographics for Arden | Age structure shares: child .24 / youngAdult .18 / adult .38 / senior .20; slice aggregate 50 000 in tests | `scale/engine.ts` `DEFAULT_AGE_STRUCTURE` |
| No canonical civil registry (institutions are M6) | Authority slug `AURELIA_CIVIL_REGISTRY`; birth registration identifiers `AUR-<SETTLEMENT>-<seq>` | `scale/materialize.ts` |
| Only the canonical spine exists in geography | 5 places: world → continent → country → region → city. Districts/neighborhoods and the full 6/5/36/48/34 hierarchy arrive with M4 | `src/content/aurelia/geography.ts` |
| No canonical organization capacity/policy data | New organizations start with neutral capacity 0.5 on every dimension and empty institutional memory | `organizations/engine.ts` |
| M2's system list includes **33 (Organizations & Businesses)** while M5 also owns it | M2 scope for 33 is delivered by the System 32 core (employers as real orgs); businesses/markets depth stays M5 | decision logged here per `PHASES.md` wording ("organization core") |

## Canonical content still waiting for its milestone

- Full Aurelia world data (6 continents / 5 oceans / 36 regions / 48 countries /
  34 settlements, languages, religions, eras, active developments) — **M4**.
- Occupations, skills, education, foods, items, vehicles, buildings, businesses,
  technologies, laws, holidays, culture, diseases, weather, org templates,
  currencies content packs under `src/content/` — **M4–M6**.
