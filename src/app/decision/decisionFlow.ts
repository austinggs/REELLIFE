/**
 * Decision & action surface, as a pure state machine (UI/UX 07).
 *
 * The UI is the one place where a stray click becomes an authoritative state
 * change, so the decision flow is deliberately *not* entangled with React:
 * every transition is a pure function, and the only function that dispatches is
 * `commit`. That is what makes the commit step real (UI/UX 07 section 5) and
 * what makes the keyboard-only walkthrough testable.
 *
 *   choosing  ──Enter──▶ previewing ──Enter──▶ resolved     (dispatch happened)
 *      ▲                    │                     │
 *      └────Escape/Arrow────┴─────Escape/Enter────┘         (no dispatch)
 */

import type { SessionCommandOutcome } from "../session/simulationSession.ts";

export type DecisionStage = "choosing" | "previewing" | "resolved";

/** One offered action: a command type plus the facts needed to preview it. */
export interface DecisionOption {
  readonly commandType: string;
  readonly label: string;
  /** What the simulation can legitimately promise about this action. */
  readonly expectation: string;
  /** Known-deterministic outcomes are stated as certainties; estimates are not. */
  readonly outcomeKind: "deterministic" | "estimate";
  readonly params?: Readonly<Record<string, unknown>>;
  readonly requiresDebug?: boolean;
}

export interface DecisionSurfaceState {
  readonly options: readonly DecisionOption[];
  readonly selectedIndex: number;
  readonly stage: DecisionStage;
  readonly preview?: DecisionOption;
  readonly outcome?: SessionCommandOutcome;
  /** Human-readable trail of what the surface has shown (commit results included). */
  readonly log: readonly string[];
}

/** Keys the surface responds to; anything else is ignored, never guessed at. */
export const DECISION_KEYS = [
  "ArrowDown",
  "ArrowUp",
  "Enter",
  "Escape",
  "Home",
  "End",
] as const;
export type DecisionKey = (typeof DECISION_KEYS)[number];

export function initialDecisionSurface(options: readonly DecisionOption[]): DecisionSurfaceState {
  return { options, selectedIndex: 0, stage: "choosing", log: [] };
}

function clampIndex(index: number, length: number): number {
  if (length === 0) return 0;
  if (index < 0) return length - 1;
  if (index >= length) return 0;
  return index;
}

/**
 * Applies one key press. `commit` is called only for Enter while previewing,
 * so moving focus or backing out can never mutate the world.
 */
export function applyDecisionKey(
  state: DecisionSurfaceState,
  key: string,
  commit: (option: DecisionOption) => SessionCommandOutcome,
): DecisionSurfaceState {
  const { options } = state;

  switch (key) {
    case "ArrowDown":
      if (state.stage === "previewing") {
        // While previewing, the arrow keys return to the choice list.
        return { ...state, stage: "choosing", preview: undefined };
      }
      return {
        ...state,
        stage: "choosing",
        preview: undefined,
        selectedIndex: clampIndex(state.selectedIndex + 1, options.length),
      };

    case "ArrowUp":
      if (state.stage === "previewing") {
        return { ...state, stage: "choosing", preview: undefined };
      }
      return {
        ...state,
        stage: "choosing",
        preview: undefined,
        selectedIndex: clampIndex(state.selectedIndex - 1, options.length),
      };

    case "Home":
      return { ...state, selectedIndex: 0 };

    case "End":
      return { ...state, selectedIndex: Math.max(0, options.length - 1) };

    case "Escape":
      // Backing out is always safe: no command, no state change.
      if (state.stage === "choosing") return state;
      return {
        ...state,
        stage: "choosing",
        preview: undefined,
        selectedIndex: state.preview === undefined
          ? state.selectedIndex
          : clampIndex(
              options.findIndex((option) => option.commandType === state.preview?.commandType),
              options.length,
            ),
      };

    case "Enter": {
      if (state.stage === "resolved") {
        return { ...state, stage: "choosing", preview: undefined, outcome: undefined };
      }
      if (state.stage === "choosing") {
        const preview = options[state.selectedIndex];
        if (preview === undefined) return state;
        return {
          ...state,
          stage: "previewing",
          preview,
          log: [...state.log, `Previewing ${preview.label} — ${preview.expectation}`],
        };
      }
      const preview = state.preview;
      if (preview === undefined) return { ...state, stage: "choosing" };
      const outcome = commit(preview);
      return {
        ...state,
        stage: "resolved",
        outcome,
        log: [
          ...state.log,
          `${outcome.applied ? "Committed" : "Refused"} ${preview.label} (${outcome.status})`,
          ...outcome.reasons,
          ...(outcome.error === undefined ? [] : [`Error: ${outcome.error}`]),
          ...(outcome.eventTypes.length === 0
            ? []
            : [`Events: ${outcome.eventTypes.join(", ")}`]),
        ],
      };
    }

    default:
      return state;
  }
}

/**
 * Runs a whole keyboard walkthrough: a sequence of key presses, each applied in
 * order. Used by the UI tests and by anyone auditing that a decision is
 * reachable without a pointer (UI/UX 21 section on keyboard operation).
 */
export function walkDecisionKeys(
  initial: DecisionSurfaceState,
  keys: readonly string[],
  commit: (option: DecisionOption) => SessionCommandOutcome,
): DecisionSurfaceState {
  return keys.reduce(
    (state, key) => applyDecisionKey(state, key, commit),
    initial,
  );
}
