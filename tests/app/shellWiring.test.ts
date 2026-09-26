/**
 * Shell wiring smoke test (System 55/56, UI/UX 01).
 *
 * The screens are thin and tested through their pure modules, but the shell
 * itself is the one place where a broken import or a module that touches the DOM
 * at import time would only show up in a browser. Importing the whole shell graph
 * here means the app cannot ship a screen the shell renders but nobody loaded.
 *
 * A stated limitation: this runs in a node environment without a DOM, so it
 * verifies module loading, not rendering. Interaction behaviour is asserted
 * through the pure modules in `appShell.test.ts`.
 */

import { describe, expect, it } from "vitest";

describe("shell wiring (System 55/56, UI/UX 01)", () => {
  it("loads the app, the shell and every screen it renders", async () => {
    const app = await import("../../src/app/App.tsx");
    const shell = await import("../../src/app/shell/AppShell.tsx");
    const screens = await Promise.all([
      import("../../src/app/screens/LifeScreen.tsx"),
      import("../../src/app/screens/PeopleScreen.tsx"),
      import("../../src/app/screens/WorldScreen.tsx"),
      import("../../src/app/screens/HistoryScreen.tsx"),
      import("../../src/app/screens/SearchScreen.tsx"),
      import("../../src/app/screens/SettingsScreen.tsx"),
      import("../../src/app/screens/ConsoleScreen.tsx"),
      import("../../src/app/screens/DebugScreen.tsx"),
      import("../../src/app/decision/DecisionSurface.tsx"),
    ]);

    expect(typeof app.default).toBe("function");
    expect(typeof shell.AppShell).toBe("function");
    for (const module of screens) {
      expect(Object.values(module).some((value) => typeof value === "function")).toBe(true);
    }
  });
});
