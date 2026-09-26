import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SYSTEM_IDS, SYSTEM_TITLES, SECTION_OWNERS, STATE_SECTIONS } from "../../src/engine/core/ownership.ts";
import { ENTITY_KINDS, ID_PREFIX, isValidIdShape } from "../../src/engine/primitives/ids.ts";

const root = resolve(__dirname, "../..");

function filesUnder(directory: string, extension = ".ts"): string[] {
  const absolute = join(root, directory);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
    .map((entry) => join(entry.parentPath, entry.name));
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

/**
 * Strips comments and string/template literals so the architectural scans below
 * look at code rather than prose. Without this, a doc comment explaining that
 * `Math.random()` is banned would itself be reported as a violation.
 *
 * This is a deliberately simple heuristic (it does not parse template
 * interpolation); it only ever removes text, so a violation could be hidden
 * inside a template expression, never invented.
 */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const ENGINE_FILES = filesUnder("src/engine");
const UI_COMPONENT_FILES = filesUnder("src/ui/components", ".tsx");

describe("architecture invariants (System 01 / System 59)", () => {
  it("finds the engine sources to audit", () => {
    expect(ENGINE_FILES.length).toBeGreaterThan(25);
  });

  it("never uses uncontrolled randomness in authoritative code", () => {
    const offenders = ENGINE_FILES.filter((file) => /Math\.random\s*\(/.test(codeOnly(read(file))));
    expect(offenders).toEqual([]);
  });

  it("never reads a real-world clock inside the engine", () => {
    const offenders = ENGINE_FILES.filter((file) => /Date\.now\s*\(/.test(codeOnly(read(file))));
    expect(offenders).toEqual([]);
  });

  it("never writes to stdout from the engine", () => {
    const offenders = ENGINE_FILES.filter((file) =>
      /console\.(log|warn|error|info)\s*\(/.test(codeOnly(read(file))),
    );
    expect(offenders).toEqual([]);
  });

  it("keeps the engine free of DOM and framework imports", () => {
    const forbidden = [
      /from ["']react["']/,
      /from ["']react-dom/,
      /from ["']@\/app\//,
      /from ["']@\/ui\//,
      /from ["']@\/platform\//,
      /from ["']@\/tools\//,
    ];
    const offenders: string[] = [];
    for (const file of ENGINE_FILES) {
      const source = read(file);
      if (forbidden.some((pattern) => pattern.test(source))) {
        offenders.push(relative(root, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("uses explicit .ts extensions on every relative engine import", () => {
    // Required by Node's native type-stripping, which the headless harness uses.
    const withoutExtension = /from\s+["'](\.\.?\/[^"']*?)(?<!\.ts)["']/g;
    const offenders: string[] = [];
    for (const file of ENGINE_FILES) {
      const matches = read(file).matchAll(withoutExtension);
      for (const match of matches) {
        offenders.push(`${relative(root, file)} -> ${match[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the command surface on the correct side of the boundary", () => {
    const appFiles = [...filesUnder("src/app", ".ts"), ...filesUnder("src/app", ".tsx")];
    const allowed =
      /@\/engine\/(query|kernel|commands|primitives|core\/simulation|core\/ownership|index)/;
    const engineImports = appFiles.flatMap((file) =>
      [...read(file).matchAll(/from\s+["'](@\/engine\/[^"']+)["']/g)].map((match) => ({
        file: relative(root, file),
        specifier: match[1] ?? "",
      })),
    );
    const offenders = engineImports.filter((entry) => !allowed.test(entry.specifier));
    expect(offenders).toEqual([]);
  });
});

describe("system register coverage (System 01)", () => {
  it("mirrors the approved 01-59 register exactly", () => {
    expect(SYSTEM_IDS).toHaveLength(59);
    expect(new Set(SYSTEM_IDS).size).toBe(59);
    expect(SYSTEM_IDS[0]).toBe("core");
    expect(SYSTEM_IDS[58]).toBe("observability");
  });

  it("gives every system a human-readable title", () => {
    for (const id of SYSTEM_IDS) {
      expect(SYSTEM_TITLES[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("declares an owner for every state section", () => {
    for (const section of STATE_SECTIONS) {
      const owner = SECTION_OWNERS[section];
      expect(SYSTEM_IDS).toContain(owner);
    }
  });

  it("gives every entity kind a unique ID prefix", () => {
    const prefixes = ENTITY_KINDS.map((kind) => ID_PREFIX[kind]);
    expect(new Set(prefixes).size).toBe(ENTITY_KINDS.length);
    expect(isValidIdShape("PER-000001")).toBe(true);
    expect(isValidIdShape("CITY-ARDEN")).toBe(true);
    expect(isValidIdShape("")).toBe(false);
    expect(isValidIdShape("has space")).toBe(false);
  });
});

describe("vendored UI component adaptation (UI components V1)", () => {
  it("vendors the curated shadcn sources with the MIT notice", () => {
    expect(UI_COMPONENT_FILES.length).toBeGreaterThanOrEqual(13);
    expect(existsSync(join(root, "src/ui/components/LICENSE.md"))).toBe(true);
    expect(existsSync(join(root, "src/ui/components/SOURCE_MANIFEST.txt"))).toBe(true);
  });

  it("resolves the shadcn registry specifiers that do not exist outside that repo", () => {
    const offenders: string[] = [];
    for (const file of UI_COMPONENT_FILES) {
      const source = read(file);
      if (/from\s+["']cn["']/.test(source)) offenders.push(`${relative(root, file)} (cn)`);
      if (/from\s+["']@\/registry\//.test(source)) offenders.push(`${relative(root, file)} (registry)`);
    }
    expect(offenders).toEqual([]);
  });

  it("keeps vendored components on the presentation side of the boundary", () => {
    const offenders = UI_COMPONENT_FILES.filter((file) => /@\/engine\//.test(read(file)));
    expect(offenders.map((file) => relative(root, file))).toEqual([]);
  });
});
