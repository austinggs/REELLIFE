/**
 * Genealogy layout (U3; System 19 rendering).
 *
 * The layout is pure so it can be asserted without a DOM. What matters is not
 * pixel beauty but three claims a diagram can quietly get wrong: that vertical
 * position means generation, that an edge only exists where a parent was
 * recorded, and that nothing is drawn outside the canvas the component hands to
 * the browser.
 */

import { describe, expect, it } from "vitest";
import {
  buildLineageDiagram,
  LINEAGE_NODE_HEIGHT,
  LINEAGE_NODE_WIDTH,
  type LineageInput,
} from "../../src/app/people/lineageLayout.ts";
import type { LineageLevelView, RelativeView } from "../../src/engine/query/index.ts";

function relative(personId: string, parentIds: readonly string[] = []): RelativeView {
  return { personId, displayName: personId, knowledge: "known", parentIds };
}

function level(
  generationsAway: number,
  people: readonly RelativeView[],
  label = `generation ${generationsAway}`,
): LineageLevelView {
  return { generationsAway, label, people };
}

function input(over: Partial<LineageInput> = {}): LineageInput {
  return {
    subjectId: "me",
    subjectLabel: "The Viewer",
    subjectParentIds: [],
    ancestors: [],
    descendants: [],
    ...over,
  };
}

describe("lineage layout (U3)", () => {
  it("draws only the subject when the record holds no kin", () => {
    const diagram = buildLineageDiagram(input());
    expect(diagram.nodes).toHaveLength(1);
    expect(diagram.nodes[0]?.kind).toBe("subject");
    expect(diagram.nodes[0]?.row).toBe(0);
    expect(diagram.edges).toHaveLength(0);
    expect(diagram.rows).toHaveLength(1);
  });

  it("puts ancestry above the subject and descendants below", () => {
    const diagram = buildLineageDiagram(
      input({
        ancestors: [level(2, [relative("grandparent")]), level(1, [relative("parent")])],
        descendants: [level(1, [relative("child")]), level(2, [relative("grandchild")])],
      }),
    );

    const rowOf = (id: string) => diagram.nodes.find((node) => node.id === id)?.row;
    const yOf = (id: string) => diagram.nodes.find((node) => node.id === id)?.y ?? -1;

    expect(rowOf("me")).toBe(0);
    expect(rowOf("parent")).toBe(-1);
    expect(rowOf("grandparent")).toBe(-2);
    expect(rowOf("child")).toBe(1);
    expect(rowOf("grandchild")).toBe(2);

    // Vertical position is generation order, not decoration.
    expect(yOf("grandparent")).toBeLessThan(yOf("parent"));
    expect(yOf("parent")).toBeLessThan(yOf("me"));
    expect(yOf("me")).toBeLessThan(yOf("child"));
    expect(yOf("child")).toBeLessThan(yOf("grandchild"));
  });

  it("draws an edge only where a parent was recorded", () => {
    const diagram = buildLineageDiagram(
      input({
        subjectParentIds: ["parent"],
        ancestors: [
          level(1, [relative("parent"), relative("step-parent", ["grandparent"])]),
          level(2, [relative("grandparent")]),
        ],
        descendants: [level(1, [relative("child", ["me"])])],
      }),
    );

    const edges = new Set(diagram.edges.map((edge) => `${edge.from}->${edge.to}`));
    expect(edges.has("parent->me")).toBe(true);
    expect(edges.has("grandparent->step-parent")).toBe(true);
    expect(edges.has("me->child")).toBe(true);
    // Nobody recorded the parent, so no line may be drawn to it.
    expect(edges.has("parent->step-parent")).toBe(false);
    expect(edges.has("grandparent->parent")).toBe(false);
  });

  it("never draws an edge to something it did not place", () => {
    const diagram = buildLineageDiagram(
      input({
        subjectParentIds: ["someone-outside-the-record"],
        ancestors: [level(1, [relative("parent", ["absent-grandparent"])])],
      }),
    );
    const placed = new Set(diagram.nodes.map((node) => node.id));
    expect(diagram.edges).toHaveLength(0);
    for (const edge of diagram.edges) {
      expect(placed.has(edge.from)).toBe(true);
      expect(placed.has(edge.to)).toBe(true);
    }
  });

  it("places each person once, wholly inside the canvas", () => {
    const diagram = buildLineageDiagram(
      input({
        subjectParentIds: ["parent"],
        ancestors: [level(1, [relative("parent"), relative("other-parent")])],
        descendants: [level(1, [relative("child", ["me"]), relative("child-2", ["me"])])],
      }),
    );

    const ids = diagram.nodes.map((node) => node.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const node of diagram.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + LINEAGE_NODE_WIDTH).toBeLessThanOrEqual(diagram.width);
      expect(node.y + LINEAGE_NODE_HEIGHT).toBeLessThanOrEqual(diagram.height);
    }
  });

  it("widens the canvas to fit the widest generation", () => {
    const narrow = buildLineageDiagram(input({ ancestors: [level(1, [relative("a")])] }));
    const wide = buildLineageDiagram(
      input({ ancestors: [level(1, [relative("a"), relative("b"), relative("c")])] }),
    );
    expect(wide.width).toBeGreaterThan(narrow.width);
  });
});
