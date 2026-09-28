import { useMemo } from "react";
import { EmptyState } from "@/app/ui/EmptyState.tsx";
import { knowledgeLabel } from "@/app/ui/knowledge.ts";
import type { LineageLevelView, RelativeView } from "@/engine/query/index.ts";
import {
  buildLineageDiagram,
  LINEAGE_NODE_HEIGHT,
  LINEAGE_NODE_WIDTH,
  type LineageEdge,
  type LineageNode,
  type LineageRow,
} from "@/app/people/lineageLayout.ts";

/** Names are clamped because SVG cannot measure text without a DOM. */
const LABEL_LIMIT = 18;

function shorten(label: string): string {
  return label.length <= LABEL_LIMIT ? label : `${label.slice(0, LABEL_LIMIT - 1)}…`;
}

export interface LineageTreeProps {
  readonly subjectId: string;
  readonly subjectLabel: string;
  /** The subject's recorded parents, so the first edge is a real one. */
  readonly subjectParentIds: readonly string[];
  readonly ancestors: readonly LineageLevelView[];
  readonly descendants: readonly LineageLevelView[];
  readonly emptyTitle: string;
  readonly emptyBody: string;
}

/**
 * The viewer's recorded descent (System 19), drawn (U3).
 *
 * The picture is decorative on purpose: every fact in it is also in the roster
 * below, because a diagram whose only content is shape and colour tells a screen
 * reader nothing. Rows are generations — the subject in the middle, ancestry
 * above, descendants below — and an edge only exists where a parent was
 * actually recorded.
 */
export function LineageTree({
  subjectId,
  subjectLabel,
  subjectParentIds,
  ancestors,
  descendants,
  emptyTitle,
  emptyBody,
}: LineageTreeProps) {
  const diagram = useMemo(
    () =>
      buildLineageDiagram({
        subjectId,
        subjectLabel,
        subjectParentIds,
        ancestors,
        descendants,
      }),
    [subjectId, subjectLabel, subjectParentIds, ancestors, descendants],
  );

  const hasKin = ancestors.length > 0 || descendants.length > 0;
  if (!hasKin) {
    return <EmptyState title={emptyTitle} body={emptyBody} />;
  }

  const nodeById = new Map<string, LineageNode>(diagram.nodes.map((node) => [node.id, node]));

  // The accessible face of the same diagram: every node once, with its name and
  // how well the viewer knows it, grouped by the generation row it sits in.
  const peopleForRow = (row: LineageRow): readonly RelativeView[] => {
    if (row.kind === "subject") {
      return [
        {
          personId: subjectId,
          displayName: subjectLabel,
          knowledge: "known",
          parentIds: subjectParentIds,
        },
      ];
    }
    const levels = row.kind === "ancestor" ? ancestors : descendants;
    const level = levels.find((entry) =>
      row.kind === "ancestor"
        ? -entry.generationsAway === row.row
        : entry.generationsAway === row.row,
    );
    return level?.people ?? [];
  };
  const roster = diagram.rows.map((row) => ({ row, people: peopleForRow(row) }));

  return (
    <div className="space-y-4">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${diagram.width} ${diagram.height}`}
        className="h-auto w-full max-w-3xl"
      >
        {diagram.edges.map((edge: LineageEdge) => {
          const parent = nodeById.get(edge.from);
          const child = nodeById.get(edge.to);
          if (parent === undefined || child === undefined) return null;
          return (
            <line
              key={`${edge.from}->${edge.to}`}
              x1={parent.x + LINEAGE_NODE_WIDTH / 2}
              y1={parent.y + LINEAGE_NODE_HEIGHT}
              x2={child.x + LINEAGE_NODE_WIDTH / 2}
              y2={child.y}
              className="stroke-muted-foreground/50"
              strokeWidth={1.5}
            />
          );
        })}
        {diagram.nodes.map((node) => (
          <g key={node.id}>
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx={8}
              className={
                node.kind === "subject"
                  ? "fill-primary/15 stroke-primary"
                  : "fill-muted stroke-border"
              }
              strokeWidth={node.kind === "subject" ? 2 : 1}
            />
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground text-[11px] font-medium"
            >
              {shorten(node.label)}
            </text>
          </g>
        ))}
      </svg>

      {/* The accessible face of the same diagram. */}
      <ol className="space-y-2">
        {roster.map(({ row, people }) => (
          <li key={row.row} className="rounded-md border p-3 text-sm">
            <span className="font-medium">{row.label}</span>
            <ul className="mt-1 flex flex-wrap gap-2">
              {people.map((person) => (
                <li
                  key={person.personId}
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  {person.displayName}
                  <span className="ml-1 uppercase">{knowledgeLabel(person.knowledge)}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
