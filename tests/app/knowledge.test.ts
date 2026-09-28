/**
 * Knowledge, urgency and visibility vocabulary (U1/U2; UI/UX 02 §3, UI/UX 19 §4).
 *
 * Two different honest-answer axes live here. Knowledge says *how well* the
 * viewer is supposed to know a fact; urgency is the engine's own verdict on how
 * pressing a need is. Neither is computed in the presentation layer — both are
 * mappings from engine vocabulary onto badge tones — so these tests pin that the
 * mappings stay total (no engine state arrives without a tone) and distinct
 * (colour is never the only signal a screen carries).
 */

import { describe, expect, it } from "vitest";
import { KNOWLEDGE_STATES } from "../../src/engine/primitives/information.ts";
import {
  knowledgeLabel,
  knowledgeTone,
  urgencyTone,
  visibilityLabel,
} from "../../src/app/ui/knowledge.ts";

/** The five words `computeUrgency` in System 10 can emit. */
const NEED_URGENCIES = ["satisfied", "low", "moderate", "high", "critical"] as const;

const VISIBILITIES = ["public", "restricted", "private", "secret", "unknown"] as const;

describe("knowledge states (UI/UX 02 §3)", () => {
  it("labels every state the engine can emit, each one distinctly", () => {
    const labels = KNOWLEDGE_STATES.map(knowledgeLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(KNOWLEDGE_STATES.length);
  });

  it("gives every state a tone, so colour is never the only signal", () => {
    for (const state of KNOWLEDGE_STATES) expect(knowledgeTone(state)).toBeDefined();
  });

  it("never presents an unknown or hidden fact as if it were known", () => {
    expect(knowledgeLabel("unknown")).not.toBe(knowledgeLabel("known"));
    expect(knowledgeLabel("hidden")).not.toBe(knowledgeLabel("known"));
    expect(knowledgeTone("hidden")).not.toBe(knowledgeTone("known"));
  });
});

describe("need urgency (System 10)", () => {
  it("maps each engine urgency word onto a badge tone", () => {
    for (const urgency of NEED_URGENCIES) expect(urgencyTone(urgency)).toBeDefined();
  });

  it("escalates a critical need above a satisfied one", () => {
    expect(urgencyTone("critical")).not.toBe(urgencyTone("satisfied"));
  });

  it("falls back quietly rather than inventing a tone for an unknown word", () => {
    expect(urgencyTone("meltdown")).toBe("outline");
    expect(urgencyTone("")).toBe("outline");
  });
});

describe("visibility (entitlement, not confidence)", () => {
  it("names every visibility level the engine can attach to a fact", () => {
    const labels = VISIBILITIES.map(visibilityLabel);
    for (const label of labels) expect(label.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(VISIBILITIES.length);
  });

  it("does not describe a secret as merely unlikely", () => {
    expect(visibilityLabel("secret")).toBe("Secret");
  });
});
