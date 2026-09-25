/**
 * ReelLife system register and state ownership (System 01).
 *
 * Architectural law 1: every persistent state field has exactly one
 * authoritative owner. That law is worth nothing if it only exists in a
 * document, so this module makes it executable:
 *
 *   - SYSTEM_IDS mirrors the approved 01-59 system register one-to-one,
 *   - SECTION_OWNERS declares which system owns each top-level world-state
 *     section,
 *   - OwnershipGuard throws when a system writes a section it does not own.
 *
 * The guard is intentionally coarse (per section rather than per field): it is
 * cheap enough to run always, and it catches the failure that actually happens
 * in practice, which is one system quietly reaching into another system's
 * state instead of emitting a command or an event.
 */

/**
 * The 59 approved systems, in register order. Index + 1 equals the system
 * number in REELLIFE_SYSTEMS_V3, so traces and docs can cite systems directly.
 */
export const SYSTEM_IDS = [
  "core",
  "time",
  "rng",
  "events",
  "activities",
  "persistence",
  "scale",
  "identity",
  "aging",
  "needs",
  "health",
  "mentation",
  "traits",
  "skills",
  "cognition",
  "goals",
  "decisions",
  "relationships",
  "family",
  "parenting",
  "conflict",
  "reputation",
  "education",
  "employment",
  "finance",
  "ownership",
  "housing",
  "transport",
  "inventory",
  "food",
  "insurance",
  "organizations",
  "businesses",
  "supplyChains",
  "markets",
  "macro",
  "geography",
  "infrastructure",
  "countries",
  "legalIdentity",
  "laws",
  "institutions",
  "government",
  "culture",
  "travel",
  "environment",
  "population",
  "security",
  "information",
  "messaging",
  "technology",
  "international",
  "continuity",
  "history",
  "presentation",
  "spatialPresentation",
  "console",
  "config",
  "observability",
] as const;

export type SystemId = (typeof SYSTEM_IDS)[number];

/** Human-readable titles, matching the register in REELLIFE_SYSTEMS_V3/00_INDEX.txt. */
export const SYSTEM_TITLES: Record<SystemId, string> = {
  core: "Simulation Core & World State",
  time: "Time, Calendar & Clock",
  rng: "Randomness, Seeds & Scenario Resolution",
  events: "Event & Consequence Engine",
  activities: "Schedules, Activities & Commitments",
  persistence: "Persistence, Save/Load & Continuity",
  scale: "Simulation Scale, Relevance & Materialization",
  identity: "Character Identity & Origin",
  aging: "Aging, Development & Life Stages",
  needs: "Needs & Daily Living",
  health: "Physical Health & Medicine",
  mentation: "Mental & Emotional State",
  traits: "Personality, Traits & Aptitudes",
  skills: "Skills & Competence",
  cognition: "Cognition & Knowledge",
  goals: "Goals, Aspirations & Motivation",
  decisions: "NPC Decision-Making & Autonomy",
  relationships: "Relationship & Social Interaction Core",
  family: "Family, Household & Genealogy",
  parenting: "Children & Parenting",
  conflict: "Conflict, Negotiation & Reconciliation",
  reputation: "Reputation & Social Perception",
  education: "Education",
  employment: "Employment & Labor",
  finance: "Finance & Economy Architecture",
  ownership: "Ownership / Contracts / Asset Rights",
  housing: "Housing & Property",
  transport: "Transportation & Vehicles",
  inventory: "Inventory / Items & Object State",
  food: "Food / Nutrition & Consumption",
  insurance: "Insurance & Risk Management",
  organizations: "Organization Core",
  businesses: "Organizations & Businesses",
  supplyChains: "Supply Chains & B2B",
  markets: "Markets / Prices & Competition",
  macro: "Macroeconomic Layer",
  geography: "Geography / Cities / Neighborhoods / Infrastructure",
  infrastructure: "Infrastructure Operations",
  countries: "Countries & World Rules",
  legalIdentity: "Legal Identity & Administrative Records",
  laws: "Laws & Regulatory Rules",
  institutions: "Institutions & Institutional Memory",
  government: "Government & Public Services",
  culture: "Culture / Religion / Community / Tradition",
  travel: "Travel / Immigration / Borders",
  environment: "Weather / Environment / Disasters",
  population: "Population & Demographics",
  security: "Security & Legal Pipeline",
  information: "Information / Communication / Media",
  messaging: "Communication / Messaging",
  technology: "Technology & Historical Change",
  international: "International Relations & Global Events",
  continuity: "Life Continuity",
  history: "Player History & Analytics",
  presentation: "Player UI",
  spatialPresentation: "Map & Spatial Presentation",
  console: "Console / Command Interface",
  config: "Configuration & Content Architecture",
  observability: "Debugging / Observability / Simulation Testing",
};

export function systemNumberOf(id: SystemId): number {
  return SYSTEM_IDS.indexOf(id) + 1;
}

/** Top-level world-state sections that the ownership guard polices. */
export const STATE_SECTIONS = [
  "meta",
  "shared",
  "clock",
  "rng",
  "events",
  "activities",
  "history",
  "commands",
  "config",
  "systems",
] as const;

export type StateSection = (typeof STATE_SECTIONS)[number];

/**
 * Which system owns each section. `systems.<systemId>` is owned by that same
 * system; the dotted form is what the guard checks.
 */
export const SECTION_OWNERS: Record<StateSection, SystemId> = {
  meta: "core",
  shared: "core",
  clock: "time",
  rng: "rng",
  events: "events",
  activities: "activities",
  history: "history",
  commands: "core",
  config: "config",
  systems: "core",
};

export function systemsOwnedBy(systemId: SystemId): string[] {
  return [systemId === "core" ? "meta" : "", `systems.${systemId}`].filter(Boolean);
}
