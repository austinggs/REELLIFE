/**
 * ReelLife engine barrel.
 *
 * Import order below mirrors the dependency order of the architecture:
 * primitives -> rng -> time -> events -> activities -> history -> commands ->
 * observability -> config -> persistence -> core.
 *
 * The engine is authoritative, DOM-free and framework-free. Presentation code
 * should import command queries from `@/engine/query` and dispatch through the
 * simulation's dispatcher rather than reaching into domain state.
 */

export * from "./primitives/index.ts";
export * from "./rng/index.ts";
export * from "./time/index.ts";
export * from "./events/index.ts";
export * from "./activities/index.ts";
export * from "./history/index.ts";
export * from "./commands/index.ts";
export * from "./observability/index.ts";
export * from "./config/index.ts";
export * from "./persistence/index.ts";
export * from "./core/index.ts";
export * from "./cognition/index.ts";
export * from "./goals/index.ts";
export * from "./decisions/index.ts";
export * from "./relationships/index.ts";
export * from "./family/index.ts";
export * from "./finance/index.ts";
export * from "./employment/index.ts";
export * from "./housing/index.ts";
export * from "./inventory/index.ts";
export * from "./food/index.ts";










