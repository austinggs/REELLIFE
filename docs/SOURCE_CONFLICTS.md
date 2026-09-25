# Source Conflicts

Known inconsistencies inside `REEL LIFE FULL PLAN SOURCE`. The reference folder
is authoritative, but where it disagrees with itself the decision taken is
recorded here instead of being made silently in code.

| # | Conflict | Decision |
| - | -------- | -------- |
| 1 | World Bible drafting inconsistency: one document says "30 named major settlements" while the detailed settlement lists name **34**. | Encode all 34 when M4 content lands; the M4 data-validation test asserts the 6/5/36/48/**34** counts. The "30" is treated as a typo, not a reason to delete cities. |
| 2 | `REELLIFE_MASTER_AI_PROMPT_V2.txt` references `REELLIFE_PLAN_V2_REPLANNED.txt`, which is absent from the bundle. | Noted as a gap, not a blocker. `PHASES.md` (root) carries the milestone plan actually being executed. |
| 3 | The bundled shadcn components import from bare `"cn"`, `@/registry/new-york-v4/...` and assume Tailwind v4 idioms. | Adapted on adoption: `src/ui/` copies resolve `cn` from `src/lib/utils.ts` and project path aliases; components were not imported verbatim. |

When a new conflict is found in the source corpus: add a row here **before**
writing code that depends on either reading.
