/**
 * ReelLife headless simulation harness (System 59).
 *
 * Runs the authoritative simulation without a browser, which is how the kernel is
 * validated: determinism, save/load equivalence, invariants and performance are
 * all checkable from a terminal.
 *
 * Usage (no extra dependencies: Node runs the TypeScript directly):
 *   npm run sim -- --seed reellife-kernel-1 --days 30
 *   npm run sim -- --seed reellife-kernel-1 --days 30 --check-determinism
 *   npm run sim -- --seed reellife-kernel-1 --hours 6 --save demo --quiet
 */

import { performance } from "node:perf_hooks";
import { createKernelSimulation, bootstrapLoadedSimulation } from "../engine/kernel/bootstrap.ts";
import { TIME_COMMAND_TYPES } from "../engine/commands/builtin/timeCommands.ts";
import { Simulation } from "../engine/core/simulation.ts";
import {
  getClockView,
  getEventFeedView,
  getSimulationHealthView,
  getTimelineView,
  getWorldSummaryView,
} from "../engine/query/projections.ts";
import { addTime, days, hours, minutes } from "../engine/primitives/time.ts";
import type { Duration, WorldTime } from "../engine/primitives/time.ts";

interface CliOptions {
  readonly seed: string;
  readonly duration: Duration;
  readonly durationLabel: string;
  readonly checkDeterminism: boolean;
  readonly saveSlot: string | null;
  readonly quiet: boolean;
  readonly speed: number;
  readonly json: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let seed = "reellife-kernel-seed-0001";
  let duration = days(1);
  let durationLabel = "1 day";
  let checkDeterminism = false;
  let saveSlot: string | null = null;
  let quiet = false;
  let speed = 1;
  let json = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--seed":
        if (!next) throw new Error("--seed requires a value");
        seed = next;
        index += 1;
        break;
      case "--days":
        duration = days(Number(next ?? "1"));
        durationLabel = `${next ?? "1"} day(s)`;
        index += 1;
        break;
      case "--hours":
        duration = hours(Number(next ?? "1"));
        durationLabel = `${next ?? "1"} hour(s)`;
        index += 1;
        break;
      case "--minutes":
        duration = minutes(Number(next ?? "1"));
        durationLabel = `${next ?? "1"} minute(s)`;
        index += 1;
        break;
      case "--speed":
        speed = Number(next ?? "1");
        index += 1;
        break;
      case "--check-determinism":
        checkDeterminism = true;
        break;
      case "--save":
        saveSlot = next ?? "harness";
        index += 1;
        break;
      case "--quiet":
        quiet = true;
        break;
      case "--json":
        json = true;
        break;
      default:
        if (arg !== undefined && arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
    }
  }

  return { seed, duration, durationLabel, checkDeterminism, saveSlot, quiet, speed, json };
}

function runOne(options: CliOptions): { readonly sim: Simulation; readonly steps: number } {
  const sim = createKernelSimulation({ masterSeed: options.seed, checkInvariants: true });

  // Pacing is a command, exactly as it would be from the UI.
  const speedCommand = sim.dispatcher.createCommand(
    TIME_COMMAND_TYPES.setSpeed,
    "PER-000000" as never,
    { speed: options.speed },
    "system",
  );
  const speedResult = sim.dispatcher.dispatch(speedCommand);
  if (speedResult.status !== "applied") {
    throw new Error(`Could not set speed: ${speedResult.reasons.join("; ")}`);
  }

  const target = addTime(sim.clock.time as WorldTime, options.duration);
  const advanced = sim.advanceTo(target);
  return { sim, steps: advanced.steps };
}

function main(argv: readonly string[]): number {
  const options = parseArgs(argv);

  const started = performance.now();
  const { sim, steps } = runOne(options);
  const elapsedMs = Math.round(performance.now() - started);

  const clock = getClockView(sim);
  const world = getWorldSummaryView(sim);
  const health = getSimulationHealthView(sim);
  const events = getEventFeedView(sim, null, { limit: 5, minimumImportance: 1 });
  const timeline = getTimelineView(sim, null, { limit: 5 });

  let determinismOk: boolean | null = null;
  let saveLoadOk: boolean | null = null;
  let hash = sim.stateHash();

  if (options.checkDeterminism) {
    const second = runOne(options);
    const secondHash = second.sim.stateHash();
    determinismOk = secondHash === hash && second.steps === steps;
    if (!determinismOk) hash = `${hash} != ${secondHash}`;
  }

  if (options.saveSlot !== null) {
    const file = sim.toSave(options.saveSlot, "harness");
    const reloaded = bootstrapLoadedSimulation(
      Simulation.fromSaveFile(file, { masterSeed: options.seed }),
    );
    saveLoadOk = reloaded.stateHash() === sim.stateHash();
  }

  if (options.json) {
    console.log(
      JSON.stringify({ world, clock, health, steps, elapsedMs, determinismOk, saveLoadOk, hash }, null, 2),
    );
  } else {
    console.log("=".repeat(72));
    console.log("REEL LIFE - headless kernel run");
    console.log("=".repeat(72));
    console.log(`World       : ${world.worldName} (${world.worldId})`);
    console.log(`Start date  : ${world.startDateLabel}`);
    console.log(
      `Now         : ${clock.dateTimeLabel}  (${clock.weekdayName}, ${clock.season}, ${clock.dayPhase})`,
    );
    console.log(`Speed       : ${clock.speed}x ${clock.paused ? "(paused)" : "(running)"}`);
    console.log(`Advanced    : ${options.durationLabel} -> ${steps} quanta in ${elapsedMs} ms`);
    console.log(
      `Content     : ${world.contentVersion} (simulation v${world.simulationVersion}, schema v${world.schemaVersion})`,
    );
    console.log(`Provisional : ${world.provisionalContent.join(", ") || "none"}`);
    console.log(`Seed        : ${world.masterSeed}`);
    console.log("");
    console.log(`Pending events : ${health.pendingEvents}`);
    console.log(
      `Timeline items : ${health.timelineEntries} (compressed ${health.compressedTimelineEntries})`,
    );
    console.log(
      `Unhandled consequences : ${
        health.unhandledConsequenceTypes.length === 0
          ? "none"
          : health.unhandledConsequenceTypes.join(", ")
      }`,
    );
    console.log(`Invariant failures     : ${health.invariantFailures}`);
    console.log(
      `Ownership violations   : ${
        health.ownershipViolations.length === 0 ? "none" : health.ownershipViolations.join("; ")
      }`,
    );
    console.log("");

    if (!options.quiet) {
      console.log("Recent events (relevance filtered):");
      for (const event of events) {
        console.log(`  ${event.timeLabel}  ${event.summary}  [${event.type}]`);
      }
      console.log("");
      console.log("Timeline:");
      for (const item of timeline) {
        console.log(
          `  ${item.timeLabel}  (${item.kind}, importance ${item.importance}) ${item.summary}`,
        );
      }
      console.log("");
    }

    console.log(`State hash : ${hash}`);
    if (determinismOk !== null) {
      console.log(`Determinism: ${determinismOk ? "PASS" : "FAIL"} (same seed reproduces identical state)`);
    }
    if (saveLoadOk !== null) {
      console.log(`Save/load  : ${saveLoadOk ? "PASS" : "FAIL"} (reloaded state matches continued state)`);
    }
    console.log("=".repeat(72));
  }

  if (determinismOk === false || saveLoadOk === false) return 1;
  if (health.invariantFailures > 0 || health.ownershipViolations.length > 0) return 2;
  return 0;
}

process.exitCode = main(process.argv.slice(2));

