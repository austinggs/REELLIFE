import { CoverageBadge } from "@/app/ui/CoverageBadge.tsx";
import type { CoverageLevel } from "@/app/ui/coverage.ts";

export interface EmptyStateProps {
  readonly title?: string;
  /**
   * What is missing and how it might appear. Copy rule: explain the gap and the
   * likely source, and never invent content to make a screen look full.
   */
  readonly body: string;
  readonly coverage?: CoverageLevel;
}

/**
 * An honest empty state (UI/UX 24 §8; brief §6). "Nothing recorded yet" is a
 * first-class answer, not a missing render: it says what is absent and, where
 * the projection provides it, how much of the system exists to begin with.
 */
export function EmptyState({ title = "Nothing recorded yet", body, coverage }: EmptyStateProps) {
  return (
    <div className="rounded-md border border-dashed p-4 text-sm">
      <p className="flex flex-wrap items-center gap-2 font-medium">
        {title}
        {coverage === undefined ? null : <CoverageBadge level={coverage} />}
      </p>
      <p className="mt-1 text-muted-foreground">{body}</p>
    </div>
  );
}
