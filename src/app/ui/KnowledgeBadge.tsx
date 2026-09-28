import { knowledgeLabel, knowledgeTone } from "@/app/ui/knowledge.ts";
import type { KnowledgeState } from "@/engine/primitives/index.ts";
import { Badge } from "@/ui/components/badge.tsx";

export interface KnowledgeBadgeProps {
  readonly state: KnowledgeState;
}

/**
 * The one knowledge badge (UI/UX 02 §3): a text label plus a tone, so a fact's
 * knowledge state is never signalled by colour alone. Screens render this
 * instead of repeating the label+tone pairing by hand.
 */
export function KnowledgeBadge({ state }: KnowledgeBadgeProps) {
  return (
    <Badge variant={knowledgeTone(state)} className="text-[10px] uppercase">
      {knowledgeLabel(state)}
    </Badge>
  );
}
