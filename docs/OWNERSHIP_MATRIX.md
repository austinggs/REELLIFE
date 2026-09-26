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

## Notes

- The guard is deliberately coarse (per top-level section, not per field). It is
  cheap enough to run always and catches the failure that happens in practice:
  one system quietly writing another system's state instead of emitting a
  command or event.
- Adding a new system = add its id to `SYSTEM_IDS` (register position matters),
  its title to `SYSTEM_TITLES`, implement under `src/engine/<id>/`, and have its
  engine assert ownership on writes. The invariant suite will then hold you to it.
