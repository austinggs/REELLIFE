import { coverageLabel, coverageTone, type CoverageLevel } from "@/app/ui/coverage.ts";
import { Badge } from "@/ui/components/badge.tsx";

export interface CoverageBadgeProps {
  readonly level: CoverageLevel;
}

/**
 * The one coverage badge: complete / partial / not-stated, always labelled
 * (UI/UX 24 §8). It tells the player how much of a system they are really
 * seeing, so an empty panel reads as an honest gap rather than a bug.
 */
export function CoverageBadge({ level }: CoverageBadgeProps) {
  return (
    <Badge variant={coverageTone(level)} className="text-[10px] uppercase">
      {coverageLabel(level)}
    </Badge>
  );
}
