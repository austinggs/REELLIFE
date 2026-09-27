/**
 * M3 app-layer tests (System 55/56/57; UI/UX 03, 07, 08, 21, 22, 24).
 *
 * The React screens are thin; the behaviour that matters is plain TypeScript —
 * the session (the app's only engine access point), the decision flow, the
 * navigation model and the accessibility preferences. Testing them here means
 * the M3 DoD items (commit step, keyboard-only walkthrough, reduced-motion and
 * density modes) are verified by an assertion rather than by inspection.
 */

import { describe, expect, it } from "vitest";
import {
  SimulationSession,
  type SessionSnapshot,
} from "../../src/app/session/simulationSession.ts";
import {
  applyDecisionKey,
  initialDecisionSurface,
  walkDecisionKeys,
  type DecisionOption,
} from "../../src/app/decision/decisionFlow.ts";
import {
  DEFAULT_UI_PREFERENCES,
  densityClasses,
  motionEnabled,
  parseUiPreferences,
  resolveUiPreferences,
  serializeUiPreferences,
  shouldSurfaceNotification,
} from "../../src/app/ui/prefs.ts";
import {
  SHELL_NAV,
  SHELL_VIEWS,
  visibleNavItems,
  viewForShortcut,
} from "../../src/app/shell/navModel.ts";
import { knowledgeLabel, knowledgeTone, visibilityLabel } from "../../src/app/ui/knowledge.ts";
import { loadWorld } from "../../src/app/session/worldLoad.ts";
import { KNOWLEDGE_STATES, VISIBILITY_LEVELS } from "../../src/engine/primitives/information.ts";
import { MemorySaveStore } from "../../src/engine/persistence/store.ts";

const SEED = "reellife-m3-app-shell";

function session(saveStore?: MemorySaveStore): SimulationSession {
  return SimulationSession.create({
    masterSeed: SEED,
    residentCount: 40,
    checkInvariants: true,
    ...(saveStore === undefined ? {} : { saveStore }),
  });
}

function hungerOf(snapshot: SessionSnapshot): number {
  return snapshot.situation?.needs.find((need) => need.kind === "hunger")?.level ?? -1;
}

describe("simulation session (System 55, UI/UX 24)", () => {
  it("opens a lived-in world and exposes only projection data", () => {
    const live = session();
    const snapshot = live.snapshot();

    expect(live.controlledPersonId).not.toBeNull();
    expect(snapshot.situation?.displayName).not.toBe("Unknown person");
    expect(snapshot.worldView.places.length).toBeGreaterThan(0);
    expect(snapshot.clock.speeds).toContain(1);
    expect(snapshot.notifications.notifications.length).toBeGreaterThanOrEqual(0);
    // Nothing engine-shaped leaks out through the snapshot.
    expect(Object.keys(snapshot)).not.toContain("sim");
  });

  it("keeps a closed public surface: reads, dispatch and explicit time advance", () => {
    const allowed = new Set([
      "constructor",
      "snapshot",
      "personView",
      "mapView",
      "search",
      "inspect",
      "stateHash",
      "act",
      "setSpeed",
      "setPaused",
      "advance",
      "setAuthority",
      "console",
      "listSlots",
      "save",
      "controlledPersonId",
      "currentAuthority",
    ]);
    const surface = Object.getOwnPropertyNames(SimulationSession.prototype).filter(
      (name) => !allowed.has(name),
    );
    // Any new member must be a deliberate, reviewed addition to the boundary.
    expect(surface).toEqual([]);
  });

  it("routes player intent through the command pipeline", () => {
    const live = session();
    const before = hungerOf(live.snapshot());

    const outcome = live.act("person.eat");
    expect(outcome.status).toBe("applied");
    expect(outcome.eventTypes.length).toBeGreaterThan(0);
    expect(hungerOf(live.snapshot())).toBeGreaterThan(before);

    // A command the world does not own is refused by the pipeline, not the UI.
    const unknown = live.act("person.teleport");
    expect(unknown.status).toBe("rejected");
    expect(unknown.applied).toBe(false);
  });

  it("treats pacing as audited commands and advances time through the step loop", () => {
    const live = session();
    expect(live.setSpeed(100).status).toBe("applied");
    expect(live.snapshot().clock.speed).toBe(100);

    expect(live.setPaused(true).status).toBe("applied");
    expect(live.snapshot().clock.paused).toBe(true);
    expect(live.setPaused(false).status).toBe("applied");

    const before = live.snapshot().clock.timeMinutes;
    const steps = live.advance(5);
    expect(steps).toBe(5);
    expect(live.snapshot().clock.timeMinutes).toBe(before + 5);

    const log = live.snapshot().commandLog;
    expect(log.some((entry) => entry.type === "time.set_speed" && entry.origin === "player")).toBe(
      true,
    );
  });

  it("keeps console mutations behind debug authority", () => {
    const live = session();
    const refused = live.console("time.set_speed speed=1000");
    expect(refused.status).toBe("denied");
    expect(live.snapshot().clock.speed).toBe(1);

    live.setAuthority("debug");
    const allowed = live.console("time.set_speed speed=1000");
    expect(allowed.status).toBe("ok");
    expect(live.snapshot().clock.speed).toBe(1000);
    expect(live.snapshot().commandLog.some((entry) => entry.origin === "console")).toBe(true);

    // Reads never require authority.
    live.setAuthority("player");
    const read = live.console("time");
    expect(read.status).toBe("ok");
    expect(read.lines.some((line) => line.kind === "read")).toBe(true);
  });

  it("saves through the pipeline and lists the slot it wrote", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    const outcome = await live.save("shell-slot");
    expect(outcome.status).toBe("applied");

    const listing = await live.listSlots();
    expect(listing.slots.map((slot) => slot.slotName)).toContain("shell-slot");
  });

  it("loads a saved slot without re-seeding the world", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    live.act("person.eat");
    const before = live.snapshot();
    await live.save("shell-load");

    const loaded = await SimulationSession.load({
      masterSeed: SEED,
      slotName: "shell-load",
      saveStore: store,
      checkInvariants: true,
    });

    const after = loaded.snapshot();
    expect(loaded.controlledPersonId).toBe(live.controlledPersonId);
    expect(after.situation?.displayName).toBe(before.situation?.displayName);
    expect(after.clock.timeMinutes).toBe(before.clock.timeMinutes);
    expect(after.worldView.materializedResidents).toBe(before.worldView.materializedResidents);
  });

  it("refuses to load without an explicit save store", async () => {
    await expect(
      SimulationSession.load({ masterSeed: SEED, slotName: "nope" }),
    ).rejects.toThrow(/save store/i);
  });
});


describe("decision surface (UI/UX 07)", () => {
  const options: readonly DecisionOption[] = [
    {
      commandType: "person.eat",
      label: "Eat a meal",
      expectation: "Deterministic: satisfies hunger by a fixed amount.",
      outcomeKind: "deterministic",
    },
    {
      commandType: "person.sleep",
      label: "Sleep",
      expectation: "Deterministic: restores sleep by a fixed amount.",
      outcomeKind: "deterministic",
    },
  ];

  it("walks a decision with the keyboard alone and commits exactly once", () => {
    const live = session();
    let commits = 0;
    const commit = (option: DecisionOption) => {
      commits += 1;
      return live.act(option.commandType, { ...option.params });
    };

    const before = hungerOf(live.snapshot());
    // Keyboard-only: the first option is already selected, so Enter previews it
    // and Enter again commits — no pointer involved at any point.
    const state = walkDecisionKeys(initialDecisionSurface(options), ["Enter", "Enter"], commit);

    expect(commits).toBe(1);
    expect(state.stage).toBe("resolved");
    expect(state.outcome?.applied).toBe(true);
    expect(state.preview?.commandType).toBe("person.eat");
    expect(state.log.some((line) => line.startsWith("Previewing"))).toBe(true);
    expect(state.log.some((line) => line.startsWith("Committed"))).toBe(true);
    expect(hungerOf(live.snapshot())).toBeGreaterThan(before);
  });

  it("never mutates while merely previewing, moving or backing out", () => {
    let commits = 0;
    const commit = (): never => {
      commits += 1;
      throw new Error("commit must not run");
    };

    const state = walkDecisionKeys(
      initialDecisionSurface(options),
      ["ArrowDown", "Enter", "Escape", "ArrowUp", "Enter", "Escape", "Home", "End", "Tab"],
      commit,
    );

    expect(commits).toBe(0);
    expect(state.stage).toBe("choosing");
    expect(state.outcome).toBeUndefined();
  });

  it("wraps selection and reports refusals with the pipeline's own reasons", () => {
    const live = session();
    const wrap = walkDecisionKeys(initialDecisionSurface(options), ["ArrowUp"], () => {
      throw new Error("no commit");
    });
    expect(wrap.selectedIndex).toBe(1);

    const refusedOptions: readonly DecisionOption[] = [
      {
        commandType: "person.teleport",
        label: "Teleport",
        expectation: "Not possible.",
        outcomeKind: "estimate",
      },
    ];
    const refused = applyDecisionKey(
      {
        ...initialDecisionSurface(refusedOptions),
        stage: "previewing",
        preview: refusedOptions[0],
      },
      "Enter",
      (option) => live.act(option.commandType),
    );
    expect(refused.outcome?.applied).toBe(false);
    expect(refused.log.some((line) => line.includes("rejected"))).toBe(true);
  });

  it("uses the world's own quick actions as the offered options", () => {
    const live = session();
    const situation = live.snapshot().situation;
    expect(situation).not.toBeNull();
    const offered = (situation?.quickActions ?? []).map((action) => ({
      commandType: action.commandType,
      label: action.label,
      expectation: action.expectation,
      outcomeKind: action.outcomeKind,
    }));
    expect(offered.length).toBeGreaterThan(0);
    // Committing the first offered action is a real, applied command.
    const state = applyDecisionKey(
      { ...initialDecisionSurface(offered), stage: "previewing", preview: offered[0] },
      "Enter",
      (option) => live.act(option.commandType),
    );
    expect(state.outcome?.applied).toBe(true);
  });
});


describe("accessibility and reading preferences (UI/UX 21, UI/UX 08)", () => {
  it("honours reduced motion from either the player or the operating system", () => {
    expect(motionEnabled(DEFAULT_UI_PREFERENCES, false)).toBe(true);
    expect(motionEnabled(DEFAULT_UI_PREFERENCES, true)).toBe(false);
    expect(motionEnabled({ ...DEFAULT_UI_PREFERENCES, reducedMotion: true }, false)).toBe(false);
  });

  it("offers distinct density modes without shrinking text", () => {
    expect(densityClasses("comfortable")).toBe("space-y-6");
    expect(densityClasses("compact")).toBe("space-y-3");
    expect(densityClasses("comfortable")).not.toBe(densityClasses("compact"));
  });

  it("survives corrupt or stale stored preferences", () => {
    expect(parseUiPreferences(null)).toEqual(DEFAULT_UI_PREFERENCES);
    expect(parseUiPreferences("{ not json")).toEqual(DEFAULT_UI_PREFERENCES);
    expect(resolveUiPreferences([1, 2, 3])).toEqual(DEFAULT_UI_PREFERENCES);
    expect(resolveUiPreferences({ density: "cavernous", authority: "godmode" })).toEqual(
      DEFAULT_UI_PREFERENCES,
    );
    const roundTripped = parseUiPreferences(
      serializeUiPreferences({ ...DEFAULT_UI_PREFERENCES, density: "compact", authority: "debug" }),
    );
    expect(roundTripped.density).toBe("compact");
    expect(roundTripped.authority).toBe("debug");
  });

  it("only interrupts for what the player asked to be interrupted by", () => {
    const urgent = { delivery: "interrupt" as const, relevance: 7 };
    const inbox = { delivery: "inbox" as const, relevance: 3 };
    const optional = { delivery: "optional" as const, relevance: 1 };

    expect(shouldSurfaceNotification(DEFAULT_UI_PREFERENCES, urgent)).toBe(true);
    expect(shouldSurfaceNotification(DEFAULT_UI_PREFERENCES, inbox)).toBe(true);
    expect(shouldSurfaceNotification(DEFAULT_UI_PREFERENCES, optional)).toBe(false);
    expect(
      shouldSurfaceNotification({ ...DEFAULT_UI_PREFERENCES, notificationMode: "urgent" }, inbox),
    ).toBe(false);
    expect(
      shouldSurfaceNotification({ ...DEFAULT_UI_PREFERENCES, notificationMode: "all" }, optional),
    ).toBe(true);
  });
});

describe("shell navigation (UI/UX 03)", () => {
  it("keeps a stable anchor set with one keyboard route each", () => {
    expect(SHELL_NAV.map((item) => item.view)).toEqual([...SHELL_VIEWS]);
    const shortcuts = SHELL_NAV.map((item) => item.shortcut);
    expect(new Set(shortcuts).size).toBe(shortcuts.length);
    expect(SHELL_NAV.every((item) => item.description.length > 0)).toBe(true);
  });

  it("hides debug surfaces until authority is granted", () => {
    const player = visibleNavItems("player").map((item) => item.view);
    expect(player).toContain("life");
    expect(player).not.toContain("console");
    expect(player).not.toContain("debug");

    const debug = visibleNavItems("debug").map((item) => item.view);
    expect(debug).toContain("console");
    expect(debug).toContain("debug");
  });

  it("maps numeric shortcuts onto the anchor list", () => {
    expect(viewForShortcut("1")).toBe("life");
    expect(viewForShortcut(String(SHELL_VIEWS.length))).toBe(SHELL_VIEWS[SHELL_VIEWS.length - 1]);
    expect(viewForShortcut("0")).toBeUndefined();
    expect(viewForShortcut("9")).toBeUndefined();
    expect(viewForShortcut("l")).toBeUndefined();
  });
});

/** Simulates a save damaged in storage: the body no longer matches its checksum. */
function damageChecksum(text: string): string {
  const file = JSON.parse(text) as { readonly header: { readonly checksum: string } };
  const checksum = file.header.checksum;
  const flipped = `${checksum.startsWith("0") ? "1" : "0"}${checksum.slice(1)}`;
  return JSON.stringify({ ...file, header: { ...file.header, checksum: flipped } });
}

describe("save slots and world load (UI/UX 20 sections 4-5, UI/UX 24 section 8)", () => {
  it("lists version, generation and a *checked* integrity state per slot", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    await live.save("integrity-ok");

    const listing = await live.listSlots();
    expect(listing.issue).toBeUndefined();
    const slot = listing.slots.find((candidate) => candidate.slotName === "integrity-ok");
    expect(slot).toBeDefined();
    expect(slot?.integrity).toBe("verified");
    expect(slot?.issue).toBeUndefined();
    expect(slot?.formatVersion).toBeGreaterThan(0);
    expect(slot?.contentVersion.length ?? 0).toBeGreaterThan(0);
    expect(slot?.generation).toBeGreaterThanOrEqual(0);
    expect(slot?.sizeBytes ?? 0).toBeGreaterThan(0);
    expect(slot?.worldDateLabel.length ?? 0).toBeGreaterThan(0);
  });

  it("shows a corrupt slot as unreadable, with the engine's own explanation", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    await live.save("integrity-bad");
    store.corrupt("integrity-bad", damageChecksum);

    const slot = (await live.listSlots()).slots.find(
      (candidate) => candidate.slotName === "integrity-bad",
    );
    // The slot is still listed — a damaged save is surfaced, never hidden — but
    // its integrity state comes from the store's validator, not its header.
    expect(slot?.integrity).toBe("corrupt");
    expect(slot?.issue ?? "").toMatch(/validation/i);
  });

  it("reports an unlistable store instead of claiming there are no saves", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    await live.save("junk");
    store.corrupt("junk", () => "{ not a reel file");

    const listing = await live.listSlots();
    expect(listing.slots).toEqual([]);
    expect(listing.issue ?? "").not.toBe("");
  });

  it("records the load intent and then swaps in the saved world", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    live.act("person.eat");
    live.advance(3);
    const savedTime = live.snapshot().clock.timeMinutes;
    await live.save("swap-me");

    // Keep playing, so the running world has demonstrably moved past the save.
    live.advance(5);
    expect(live.snapshot().clock.timeMinutes).toBeGreaterThan(savedTime);

    const result = await loadWorld(live, {
      masterSeed: SEED,
      slotName: "swap-me",
      saveStore: store,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.snapshot().clock.timeMinutes).toBe(savedTime);
    expect(result.session.controlledPersonId).toBe(live.controlledPersonId);
    expect(result.message).toContain("swap-me");
    // The load itself is an audited command, not a silent side channel.
    expect(
      live.snapshot().commandLog.some((entry) => entry.type === "world.load"),
    ).toBe(true);
  });

  it("keeps the running world when a slot cannot be loaded", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    await live.save("broken");
    store.corrupt("broken", damageChecksum);

    const before = live.snapshot().clock.timeMinutes;
    const result = await loadWorld(live, { masterSeed: SEED, slotName: "broken", saveStore: store });

    expect(result.ok).toBe(false);
    // The engine's own words, not a UI guess: the save failed validation.
    expect(result.message).toMatch(/validation/i);
    // The caller's session is untouched and still live.
    expect(live.snapshot().clock.timeMinutes).toBe(before);
    expect(live.act("person.eat").applied).toBe(true);
  });

  it("refuses a slot name the engine rejects, before any swap is attempted", async () => {
    const store = new MemorySaveStore();
    const live = session(store);

    const result = await loadWorld(live, { masterSeed: SEED, slotName: "   ", saveStore: store });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/slotName/);
  });

  it("reports a slot that does not exist, naming it, and keeps the world", async () => {
    const store = new MemorySaveStore();
    const live = session(store);
    const before = live.snapshot().clock.timeMinutes;

    const result = await loadWorld(live, { masterSeed: SEED, slotName: "ghost-slot", saveStore: store });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ghost-slot");
    expect(live.snapshot().clock.timeMinutes).toBe(before);
  });
});

describe("knowledge presentation (UI/UX 02 section 3, UI/UX 19 section 4)", () => {
  it("gives every knowledge state a distinct, non-empty label", () => {
    const labels = KNOWLEDGE_STATES.map((state) => knowledgeLabel(state));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(KNOWLEDGE_STATES.length);
  });

  it("never lets a withheld fact look like a certain one", () => {
    // "Hidden" is not "unlikely": it is one the viewer is not entitled to see.
    expect(knowledgeTone("known")).toBe("default");
    expect(knowledgeTone("hidden")).not.toBe(knowledgeTone("known"));
    expect(knowledgeTone("estimate")).not.toBe(knowledgeTone("known"));
    expect(knowledgeLabel("hidden")).not.toBe(knowledgeLabel("known"));
  });

  it("names every entitlement level the engine can report", () => {
    const labels = VISIBILITY_LEVELS.map((level) => visibilityLabel(level));
    expect(labels.every((label) => label.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(VISIBILITY_LEVELS.length);
  });
});

