/**
 * Knowledge-state presentation helpers (UI/UX 02 section 3, UI/UX 19 section 4).
 *
 * "Information is not truth" has to be *visible* or it is not honoured. Every
 * fact the shell renders carries how well the viewer is supposed to know it, and
 * these helpers turn that engine vocabulary into labels and tones. They are
 * presentation-only: no engine rule lives here, and no state is derived.
 */

import type { KnowledgeState, Visibility } from "@/engine/primitives/index.ts";

/** Badge variant names available in the vendored shadcn badge component. */
export type KnowledgeTone = "default" | "secondary" | "destructive" | "outline";

const KNOWLEDGE_LABELS: Readonly<Record<KnowledgeState, string>> = {
  known: "Known",
  estimate: "Estimate",
  rumor: "Rumour",
  inference: "Inference",
  unknown: "Unknown",
  hidden: "Hidden",
};

const KNOWLEDGE_TONES: Readonly<Record<KnowledgeState, KnowledgeTone>> = {
  known: "default",
  estimate: "secondary",
  rumor: "outline",
  inference: "secondary",
  unknown: "outline",
  hidden: "destructive",
};

export function knowledgeLabel(state: KnowledgeState): string {
  return KNOWLEDGE_LABELS[state];
}

export function knowledgeTone(state: KnowledgeState): KnowledgeTone {
  return KNOWLEDGE_TONES[state];
}

/**
 * Need urgency tones (System 10).
 *
 * Urgency is the engine's own verdict on how pressing a need is — the UI maps it
 * to a badge and never computes it from the 0..1 level, because that threshold
 * is an engine rule. The projection widens the field to `string`, so this map is
 * total over the engine's five words and falls back to the quietest tone rather
 * than inventing a colour for a state the engine does not have.
 */
const URGENCY_TONES: Readonly<Record<string, KnowledgeTone>> = {
  satisfied: "outline",
  low: "outline",
  moderate: "secondary",
  high: "default",
  critical: "destructive",
};

export function urgencyTone(urgency: string): KnowledgeTone {
  return URGENCY_TONES[urgency] ?? "outline";
}

/**
 * Entitlement, not confidence. A `secret` fact is not "unlikely"; it is one the
 * viewer is not entitled to see at all, so the label says so.
 */
export function visibilityLabel(visibility: Visibility): string {
  switch (visibility) {
    case "public":
      return "Public";
    case "restricted":
      return "Restricted";
    case "private":
      return "Private";
    case "secret":
      return "Secret";
    case "unknown":
      return "Unknown";
  }
}
