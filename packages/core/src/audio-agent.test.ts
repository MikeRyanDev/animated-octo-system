import { type Observable, firstValueFrom, of, toArray } from "rxjs";
import { expect, test } from "vitest";

import {
  type AudioAgentEventInput,
  type AudioAgentState,
  createAudioAgentState$,
  reduceAudioAgentState,
  toAudioAgentEvent,
} from "./audio-agent.js";

test("reduceAudioAgentState toggles mute state", () => {
  // Arrange
  const initialState: AudioAgentState = {
    isMuted: false,
    ui: [],
  };

  // Act
  const mutedState = reduceAudioAgentState(initialState, {
    type: "mute_toggled",
  });

  // Assert
  expect(mutedState.isMuted).toBe(true);
});

test("reduceAudioAgentState appends rendered ui wrappers", () => {
  // Arrange
  const initialState: AudioAgentState = {
    isMuted: false,
    ui: [],
  };

  // Act
  const nextState = reduceAudioAgentState(initialState, {
    type: "ui_wrapper_received",
    wrapper: {
      ui: [
        {
          card: {
            children: "hello",
          },
        },
      ],
    },
  });

  // Assert
  expect(nextState.ui).toHaveLength(1);
  expect(nextState.ui[0]).toMatchObject({
    ui: [
      {
        card: {
          children: "hello",
        },
      },
    ],
  });
});

test("createAudioAgentState$ emits reduced snapshots", async () => {
  // Arrange
  const mutedEvent: AudioAgentEventInput = { type: "muted" };
  const uiWrapperEvent: AudioAgentEventInput = {
    type: "ui.wrapper",
    wrapper: {
      ui: [
        {
          panel: {
            children: "world",
          },
        },
      ],
    },
  };
  const events$: Observable<AudioAgentEventInput> = of(mutedEvent, uiWrapperEvent);

  // Act
  const snapshots = await firstValueFrom(
    createAudioAgentState$(events$, {
      isMuted: false,
      ui: [],
    }).pipe(toArray()),
  );

  // Assert
  expect(snapshots).toHaveLength(2);
  expect(snapshots[0]?.isMuted).toBe(true);
  expect(snapshots[1]?.ui).toHaveLength(1);
});

test("toAudioAgentEvent rejects invalid external events", () => {
  // Arrange
  const input = {
    type: "unknown",
  };

  // Act
  const run = (): unknown => toAudioAgentEvent(input);

  // Assert
  expect(run).toThrowError();
});

test("toAudioAgentEvent maps external event names to internal event names", () => {
  // Arrange
  const toggleInput: AudioAgentEventInput = { type: "mute.toggled" };
  const wrapperInput: AudioAgentEventInput = {
    type: "ui.wrapper",
    wrapper: {
      ui: [
        {
          badge: {
            children: "mapped",
          },
        },
      ],
    },
  };

  // Act
  const toggleEvent = toAudioAgentEvent(toggleInput);
  const wrapperEvent = toAudioAgentEvent(wrapperInput);

  // Assert
  expect(toggleEvent.type).toBe("mute_toggled");
  expect(wrapperEvent.type).toBe("ui_wrapper_received");
});

test("toAudioAgentEvent accepts already-normalized internal events", () => {
  // Arrange
  const internalEvent = {
    type: "unmuted",
  } as const;

  // Act
  const result = toAudioAgentEvent(internalEvent);

  // Assert
  expect(result).toEqual(internalEvent);
});

test("reduceAudioAgentState handles muted and unmuted events", () => {
  // Arrange
  const state: AudioAgentState = {
    isMuted: false,
    ui: [],
  };

  // Act
  const mutedState = reduceAudioAgentState(state, { type: "muted" });
  const unmutedState = reduceAudioAgentState(mutedState, { type: "unmuted" });

  // Assert
  expect(mutedState.isMuted).toBe(true);
  expect(unmutedState.isMuted).toBe(false);
});

test("audioAgentUiWrapperSchema rejects non-object wrapper payload", () => {
  // Arrange
  const input = null;

  // Act
  const run = (): unknown =>
    toAudioAgentEvent({
      type: "ui.wrapper",
      wrapper: input as unknown as { ui: Array<Record<string, unknown>> },
    });

  // Assert
  expect(run).toThrowError();
});

test("toAudioAgentEvent returns passthrough for unmuted external event", () => {
  // Arrange
  const event: AudioAgentEventInput = {
    type: "unmuted",
  };

  // Act
  const result = toAudioAgentEvent(event);

  // Assert
  expect(result).toMatchObject({ type: "unmuted" });
});
