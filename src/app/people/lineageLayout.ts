/**
 * Genealogy layout (U3).
 *
 * Pure geometry, kept out of the component so it can be tested without a DOM:
 * the app has no jsdom, and adding one just to assert that an SVG drew itself
 * would be a poor trade. The component paints what this returns and nothing else.
 *
 * Two rules the layout must not break:
 *
 *   1. Rows are generations. The subject sits in the middle, ancestry above,
 *      descendants below, so vertical position always means "related to you by
 *      this many generations" rather than being decoration.
 *   2. An edge is drawn only where System 19 recorded a parent. No edge is ever
 *      inferred from two nodes happening to be adjacent on screen.
 */

import type { KnowledgeState } from "@/engine/primitives/index.ts";
import type { LineageLevelView } from "@/engine/query/index.ts";

export const LINEAGE_NODE_WIDTH = 148;
export const LINEAGE_NODE_HEIGHT = 46;
export const LINEAGE_COLUMN_GAP = 16;
export const LINEAGE_ROW_GAP = 34;
export const LINEAGE_PADDING = 12;

export type LineageNodeKind = "ancestor" | "subject" | "descendant";

export interface LineageNode {
  readonly id: string;
  readonly label: string;
  readonly kind: LineageNodeKind;
  /** 0 is the subject's own row, negative is up the ancestry, positive down. */
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly knowledge: KnowledgeState;
}

/** A recorded parent link. `from` is the parent, one row nearer the top. */
export interface LineageEdge {
  readonly from: string;
  readonly to: string;
}

export interface LineageRow {
  readonly row: number;
  readonly label: string;
  readonly kind: LineageNodeKind;
  readonly y: number;
}

export interface LineageDiagram {
  readonly nodes: readonly LineageNode[];
  readonly edges: readonly LineageEdge[];
  readonly rows: readonly LineageRow[];
  readonly width: number;
  readonly height: number;
}

export interface LineageInput {
  readonly subjectId: string;
  readonly subjectLabel: string;
  readonly subjectKnowledge?: KnowledgeState;
  /** The subject's own recorded parents, so the first edge can be drawn. */
  readonly subjectParentIds: readonly string[];
  readonly ancestors: readonly LineageLevelView[];
  readonly descendants: readonly LineageLevelView[];
}

interface PlacedPerson {
  readonly personId: string;
  readonly displayName: string;
  readonly knowledge: KnowledgeState;
}

/**
 * Lays out a pedigree around one person.
 *
 * The result is empty — zero nodes, zero edges — when the record holds no kin,
 * which is the honest drawing of an empty family: a diagram with only the
 * subject in it. The caller renders the explanation.
 */
export function buildLineageDiagram(input: LineageInput): LineageDiagram {
  const ancestorLevels = [...input.ancestors].sort(
    (a, b) => b.generationsAway - a.generationsAway,
  );
  const descendantLevels = [...input.descendants].sort(
    (a, b) => a.generationsAway - b.generationsAway,
  );
  const deepest = ancestorLevels[0]?.generationsAway ?? 0;

  const subject: PlacedPerson = {
    personId: input.subjectId,
    displayName: input.subjectLabel,
    knowledge: input.subjectKnowledge ?? "known",
  };

  const rowWidthOf = (count: number): number =>
    count * LINEAGE_NODE_WIDTH + Math.max(0, count - 1) * LINEAGE_COLUMN_GAP;

  const widest = Math.max(
    1,
    ...ancestorLevels.map((level) => level.people.length),
    ...descendantLevels.map((level) => level.people.length),
  );
  const width = LINEAGE_PADDING * 2 + rowWidthOf(widest);

  const nodes: LineageNode[] = [];
  const rows: LineageRow[] = [];
  const parentIdsById = new Map<string, readonly string[]>();

  const placeRow = (
    row: number,
    label: string,
    kind: LineageNodeKind,
    people: readonly PlacedPerson[],
  ): void => {
    const y = LINEAGE_PADDING + (row + deepest) * (LINEAGE_NODE_HEIGHT + LINEAGE_ROW_GAP);
    rows.push({ row, label, kind, y });
    const startX = (width - rowWidthOf(people.length)) / 2;
    people.forEach((person, index) => {
      nodes.push({
        id: person.personId,
        label: person.displayName,
        kind,
        row,
        x: startX + index * (LINEAGE_NODE_WIDTH + LINEAGE_COLUMN_GAP),
        y,
        width: LINEAGE_NODE_WIDTH,
        height: LINEAGE_NODE_HEIGHT,
        knowledge: person.knowledge,
      });
    });
  };

  for (const level of ancestorLevels) {
    placeRow(-level.generationsAway, level.label, "ancestor", level.people);
    for (const person of level.people) parentIdsById.set(person.personId, person.parentIds);
  }
  placeRow(0, input.subjectLabel, "subject", [subject]);
  parentIdsById.set(input.subjectId, input.subjectParentIds);
  for (const level of descendantLevels) {
    placeRow(level.generationsAway, level.label, "descendant", level.people);
    for (const person of level.people) parentIdsById.set(person.personId, person.parentIds);
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges: LineageEdge[] = [];
  const drawn = new Set<string>();
  for (const node of nodes) {
    for (const parentId of parentIdsById.get(node.id) ?? []) {
      if (!nodeIds.has(parentId)) continue;
      const key = `${parentId}->${node.id}`;
      if (drawn.has(key)) continue;
      drawn.add(key);
      edges.push({ from: parentId, to: node.id });
    }
  }

  const rowCount = rows.length;
  const height =
    LINEAGE_PADDING * 2 +
    rowCount * LINEAGE_NODE_HEIGHT +
    Math.max(0, rowCount - 1) * LINEAGE_ROW_GAP;

  return { nodes, edges, rows, width, height };
}
