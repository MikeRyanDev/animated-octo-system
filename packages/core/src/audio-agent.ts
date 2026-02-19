import type { UiWrapper } from "@hashbrownai/core";
import { type Observable, map, scan } from "rxjs";
import { z } from "zod";

/**
 * Runtime schema for UI wrapper payloads emitted by tool calls.
 */
export const audioAgentUiWrapperSchema = z.custom<UiWrapper>((input: unknown): boolean => {
  if (!input || typeof input !== "object") {
    return false;
  }

  const candidate = input as { ui?: unknown };
  return Array.isArray(candidate.ui);
});

const audioAgentInternalEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("muted") }),
  z.object({ type: z.literal("unmuted") }),
  z.object({ type: z.literal("mute_toggled") }),
  z.object({ type: z.literal("ui_wrapper_received"), wrapper: audioAgentUiWrapperSchema }),
]);

const audioAgentExternalEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mute.toggled") }),
  z.object({ type: z.literal("ui.wrapper"), wrapper: audioAgentUiWrapperSchema }),
]);

/**
 * UI wrapper payload used by Frenchfry state and render pipelines.
 */
export type AudioAgentUiWrapper = UiWrapper;

/**
 * Supported external event input for audio-agent state transitions.
 */
export type AudioAgentEventInput =
  | AudioAgentEvent
  | {
      type: "muted" | "unmuted" | "mute.toggled";
    }
  | {
      type: "ui.wrapper";
      wrapper: AudioAgentUiWrapper;
    };

/**
 * Internal reducer event used to model all audio-agent state transitions.
 */
export type AudioAgentEvent = z.infer<typeof audioAgentInternalEventSchema>;

/**
 * Immutable audio-agent state snapshot.
 */
export interface AudioAgentState {
  isMuted: boolean;
  ui: AudioAgentUiWrapper[];
}

/**
 * Parses unknown event input into the internal reducer event shape.
 *
 * @param input Unknown event payload from a side-effect boundary.
 * @returns Validated internal audio-agent event.
 */
export function toAudioAgentEvent(input: unknown): AudioAgentEvent {
  const internalResult = audioAgentInternalEventSchema.safeParse(input);

  if (internalResult.success) {
    return internalResult.data;
  }

  const externalEvent = audioAgentExternalEventSchema.parse(input);

  if (externalEvent.type === "mute.toggled") {
    return {
      type: "mute_toggled",
    };
  }

  return {
    type: "ui_wrapper_received",
    wrapper: externalEvent.wrapper,
  };
}

/**
 * Reduces the current audio-agent state using a single event.
 *
 * @param state Previous immutable state snapshot.
 * @param event Validated event to apply.
 * @returns Next immutable state snapshot.
 */
export function reduceAudioAgentState(
  state: AudioAgentState,
  event: AudioAgentEvent,
): AudioAgentState {
  switch (event.type) {
    case "muted": {
      return {
        isMuted: true,
        ui: state.ui,
      };
    }
    case "unmuted": {
      return {
        isMuted: false,
        ui: state.ui,
      };
    }
    case "mute_toggled": {
      return {
        isMuted: !state.isMuted,
        ui: state.ui,
      };
    }
    case "ui_wrapper_received": {
      return {
        isMuted: state.isMuted,
        ui: [...state.ui, event.wrapper],
      };
    }
    /* c8 ignore next 4 */
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

/**
 * Creates a reactive stream of reduced audio-agent state snapshots.
 *
 * @param events$ Stream of external or internal audio-agent events.
 * @param initialState Initial immutable state.
 * @returns Reduced state stream.
 */
export function createAudioAgentState$(
  events$: Observable<AudioAgentEventInput>,
  initialState: AudioAgentState,
): Observable<AudioAgentState> {
  return events$.pipe(
    map((event) => toAudioAgentEvent(event)),
    scan((state, event) => reduceAudioAgentState(state, event), initialState),
  );
}
