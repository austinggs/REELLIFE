# Ownership Matrix (System 01)

Architectural law 1: **every persistent state field has exactly one authoritative
owner.** This document is the human-readable mirror of the executable register in
`src/engine/core/ownership.ts`. If the two ever disagree, the code is wrong or
this file is stale — fix whichever is out of date.

## Enforcement

- `SYSTEM_IDS` lists the 59 approved systems, in register order (index + 1 = the
  system number in `REEL LIFE FULL PLAN SOURCE/REELLIFE_SYSTEMS_V3`).
- `OwnershipGuard` wraps every world-state mutation: `guard.mutate(systemId, fn)`
  throws if `systemId` does not own the section being written.
- Nested mutation scopes are rejected; a system may not open a scope inside
  another system's scope.
- Cross-system work happens through *sequential* scopes or through consequence
  handlers (each consequence is wrapped in its owner's scope by the dispatcher).
  `scale/materialize.ts` is the reference example: identity, family,
  legalIdentity and scale each get their own scope, never nested.
- Persistence: `Simulation.serializedWorld()` writes the whole `world.systems`
  bag (every owner's state), with mounted SystemDefinitions overriding their
  own entry through their serializer. Dropping entries was a real bug — the
  save/load round-trip tests in `tests/kernel/{geography,scaleMaterialization}.test.ts`
  guard it.
- `tests/invariants/ownership.test.ts` asserts that every command's declared
  owner is a real `SystemId`, and pins the set of systems that currently own
  commands.

## World-state sections

| Section     | Owner        | Contents                                                        |
| ----------- | ------------ | --------------------------------------------------------------- |
| `meta`      | `core`       | World identity, format version, creation metadata               |
| `shared`    | `core`       | Cross-cutting shared state (e.g. persisted IdAllocator snapshot)|
| `clock`     | `time`       | Authoritative `WorldTime` (integer minutes since Aurelia epoch) |
| `rng`       | `rng`        | Serialized stream states (xoshiro128\*\* per named stream)      |
| `events`    | `events`     | Event queue state                                               |
| `activities`| `activities` | Activity/schedule engine state                                  |
| `history`   | `history`    | Derived timeline/journal append-only store                      |
| `commands`  | `core`       | Command log / dispatch metadata                                 |
| `config`    | `config`     | Loaded configuration                                            |
| `systems`   | `core`       | Container; `systems.<id>` is owned by system `<id>` itself      |

Rule: `systems.<systemId>` may only be written while the `<systemId>` scope is
open. Engines re-assert ownership internally via `scope.assertOwner(...)`.

## Command ownership (systems that currently own commands)

`activities`, `employment`, `finance`, `housing`, `inventory`, `needs`,
`persistence`, `relationships`, `time`.

A command's *owner* is the system whose rules validate and resolve it. Its
*consequences* are delivered to the systems that own the mutated state, each
inside its own scope, by the dispatcher — a command may therefore touch several
systems without ever violating single ownership.

## Engine-owned state slots (most recently added)

Each domain engine owns exactly one slot inside `world.systems`, asserts
`scope.assertOwner("<id>")` at every mutating entry point, and is restored by the
persistence layer from the raw `systems` bag (see the persistence note above).

| System            | Slot                  | Engine                                | Notes                                                                                                                 |
| ----------------- | --------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `infrastructure` (38) | `systems.infrastructure` | `src/engine/infrastructure/engine.ts` | operational networks: assets (kind, location, optional operator, capacity utilisation, condition, dependencies, redundancy, users served, built date, maintenance record) plus outages and their repair progress. Every write (`defineAsset`, `setDemand`, `setCondition`, `recordMaintenance`, `deferMaintenance`, `raiseOutage`, `meetRequirement`, `advanceRepair`, `propagateOutage`) asserts ownership; capacity state, service status, dependency/dependent/cascade queries, `overloaded()` and `maintenanceDue()` are derived reads with nothing stored twice |
| `businesses` (33) | `systems.businesses` | `src/engine/businesses/engine.ts` | commercial state of firms: form, lifecycle, offerings, capacity dimensions, supplier/customer references, accounts, strategy, operations, history. Every write (`register`, `setLifecycle`, `declareFailure`, `addOffering`, `removeOffering`, `setWorkforceTarget`, `setCapacity`) asserts ownership; roster/cash-flow/failure signals/usable capacity/binding constraint are derived from Systems 24/25/33 facts |
| `supplyChains` (34) | `systems.supplyChains` | `src/engine/supplyChains/engine.ts` | B2B procurement: supplier offers (unit price, lead time, capacity, assessments, suspension), supply dependencies, purchase orders (issued→accepted→in_transit→received/cancelled/breached) and append-only supply-chain history. Every write (`defineOffer`, `defineDependency`, `setRequiredUnits`, `placeOrder`, `acceptOrder`, `shipOrder`, `receiveOrder`, `cancelOrder`, `declareBreach`, `breachExpiredOrders`, `suspendSupplier`, `restoreSupplier`, `switchSupplier`) asserts ownership; `cascadeFrom`, `concentration`, `reliability`, `supplyGap`, `shortages` and `substitutionCandidates` are derived from the graph and order history |
| `markets` (35)      | `systems.markets`     | `src/engine/markets/engine.ts`        | goods catalogue, local markets, participants and the inputs each price is formed from; every write (`defineGood`, `defineMarket`, `addParticipant`, `removeParticipant`, `setStructure`, `observeDemand`, `recordSupply`, `setTax`, `setPriceCeiling`, `setExpectedPrice`, `receiveStock`, `withdrawStock`, `recordTransaction`) asserts ownership; `quote`, `scarcity`, `shortages`, `surpluses` and `availability` are derived from `formPrice` and the market's own state |
| `macro` (36)        | `systems.macro`       | `src/engine/macro/engine.ts`          | aggregate observations (price index, labour, output, aggregates), the credit environment plus its history, and explicitly raised/lifted macro shocks. Every write (`observePriceIndex`, `observeLaborMarket`, `observeOutput`, `observeAggregates`, `setCreditEnvironment`, `raiseShock`, `liftShock`) asserts ownership; `inflation`, `unemployment`, `outputGrowth`, `productivity`, `productivityGrowth`, `aggregateGap`, `purchasingPowerChange`, `activeShocks` and `downturnSignals` are derived over the stated windows and return `undefined` when no sample spans them |
| `transport` (28)     | `systems.transport`   | `src/engine/transport/engine.ts`      | vehicle instances (kind, mode, owner/operator/location, condition, capacity, energy, registration and maintenance history) plus public transit services (route reference, stops, fare, seat capacity, running state) and named disruptions. Every write (`defineVehicle`, `transferOwnership`, `setOperator`, `moveVehicle`, `refuel`, `consumeEnergy`, `setCondition`, `beginMaintenance`, `completeMaintenance`, `defineService`, `boardService`, `alightService`, `setServiceRunning`, `setFare`, `raiseDisruption`, `resolveDisruption`) asserts ownership; `dispatchable`, `energyShare`, `breakdownRisk`, `estimateTrip` and `seatsAvailable` are derived — routes stay System 45's |
| `insurance` (31)     | `systems.insurance`   | `src/engine/insurance/engine.ts`      | policies (insurer, holder, subject, coverage, limit, deductible, premium, risk score, exclusions, beneficiaries, dates, status, history) and claims with the spec's lifecycle (claimed → reviewing → approved/denied → paid, with disputed / fraud-suspected / appealed states). Every write (`issuePolicy`, `cancelPolicy`, `closePolicy`, `reratePolicy`, `fileClaim`, `transitionClaim`, `approveClaim`, `denyClaim`, `disputeClaim`, `suspectFraud`, `appealClaim`, `payClaim`) asserts ownership; `payoutOf`, `paidTotal`, `remainingCover`, `quotePayout`, `claimsHistoryScore` are derived — payouts are arithmetic, and the money is System 25's |
| `education` (23)     | `systems.education`   | `src/engine/education/engine.ts`      | programs (institution organization, qualification, location, capacity, term count, cost, entry requirements, teachers), enrollments on the spec's state graph with attendance, institutional assessments and history, and issued credentials with named recognising authorities. Every write (`defineProgram`, `apply`, `admit`, `enroll`, `recordAttendance`, `assess`, `complete`, `transitionEnrollment`, `transfer`, `issueCredential`, `revokeCredential`) asserts ownership; `assessAccess`, `classSize`, `availableSeats`, `attendanceRate`, `retentionRate` and `isCredentialRecognized` are derived — grades are the institution's opinion, never skill truth |
| `countries` (39)  | `systems.countries`   | `src/engine/countries/engine.ts`      | country identity + time-ordered configurations, jurisdictions, currency references, citizenship/immigration frameworks, bilateral border regimes and the world-rule registry; every write (`define`, `amend`, `rename`, `recordChange`, `defineJurisdiction`, `defineCurrency`, `defineCitizenshipFramework`, `defineImmigrationFramework`, `defineBorder`, `defineRule`) asserts ownership; `borderAccess`/`resolveRule`/`jurisdictionsAt` are reads only |
| `environment` (46)| `systems.environment` | `src/engine/environment/engine.ts`    | weather, pollution, hazards, disasters; every write (`observeWeather`, `applyPollution`, `declareHazard`, `liftHazard`, `evaluateHazards`, `raiseDisaster`, `advanceDisaster`) asserts ownership; a disaster's source condition is lifted by the same owner, never by a caller |
| `population` (47) | `systems.population`  | `src/engine/population/engine.ts`     | per-continent/country/region/settlement aggregates                                                                     |
| `travel` (45)     | `systems.travel`      | `src/engine/travel/engine.ts`         | canonical routes, active journeys, travel history                                                                      |
| `geography` (37)  | `systems.geography`   | `src/engine/geography/engine.ts`      | canonical `LocationRef` hierarchy                                                                                      |

## Notes

- The guard is deliberately coarse (per top-level section, not per field). It is
  cheap enough to run always and catches the failure that happens in practice:
  one system quietly writing another system's state instead of emitting a
  command or event.
- Adding a new system = add its id to `SYSTEM_IDS` (register position matters),
  its title to `SYSTEM_TITLES`, implement under `src/engine/<id>/`, and have its
  engine assert ownership on writes. The invariant suite will then hold you to it.
