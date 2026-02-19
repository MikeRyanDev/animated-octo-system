import type { AudioAgentUiWrapper, RealtimeWebRtcClient } from "@frenchfry/core";
import { act, renderHook } from "@testing-library/react";
import type { ReactElement } from "react";
import { Observable, Subject } from "rxjs";
import { expect, test, vi } from "vitest";

import {
  type AudioAgentUiKit,
  createAudioAgentController,
  renderAudioAgentUi,
  resolveUiSchema,
  useAudioAgent,
} from "./use-audio-agent.js";

function createMockUiKit(): AudioAgentUiKit {
  return {
    render: (value): ReactElement[] => {
      return value.ui.map((node, index) => {
        return <div key={`node-${index.toString()}`}>{JSON.stringify(node)}</div>;
      });
    },
    serializedSchema: JSON.stringify({ type: "object" }),
  };
}

test("createAudioAgentController updates mute state", () => {
  // Arrange
  const controller = createAudioAgentController({
    events$: new Subject(),
  });

  // Act
  controller.mute();

  // Assert
  expect(controller.getState().isMuted).toBe(true);
  controller.teardown();
});

test("createAudioAgentController consumes external events", () => {
  // Arrange
  const externalEvents$ = new Subject<
    { type: "muted" } | { type: "ui.wrapper"; wrapper: AudioAgentUiWrapper }
  >();
  const controller = createAudioAgentController({
    events$: externalEvents$,
  });
  const stateSnapshots: Array<{ isMuted: boolean; uiCount: number }> = [];
  const unsubscribe = controller.subscribe(() => {
    const snapshot = controller.getState();
    stateSnapshots.push({
      isMuted: snapshot.isMuted,
      uiCount: snapshot.ui.length,
    });
  });

  // Act
  externalEvents$.next({ type: "muted" });
  externalEvents$.next({
    type: "ui.wrapper",
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
  expect(stateSnapshots.some((snapshot) => snapshot.isMuted)).toBe(true);
  expect(controller.getState().ui).toHaveLength(1);
  unsubscribe();
  controller.teardown();
});

test("useAudioAgent does not disconnect on rerender with equivalent options", async () => {
  // Arrange
  const disconnect = vi.fn(() => undefined);
  const fakeClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect: vi.fn(async () => undefined),
    connectionEvents$: new Subject(),
    uiJson$: new Subject(),
    disconnect,
    sendEvent: vi.fn(() => undefined),
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };

  const { rerender } = renderHook(
    (props: { instructions: string }) => {
      return useAudioAgent({
        realtime: {
          autoConnect: false,
          createClient: () => fakeClient,
          instructions: props.instructions,
          sessionEndpoint: "/session",
        },
        uiKit: [createMockUiKit()],
      });
    },
    { initialProps: { instructions: "first" } },
  );

  // Act
  rerender({ instructions: "second" });

  // Assert
  expect(disconnect).not.toHaveBeenCalled();
});

test("renderAudioAgentUi returns null when wrappers are empty", () => {
  // Arrange
  const wrappers: AudioAgentUiWrapper[] = [];

  // Act
  const rendered = renderAudioAgentUi(wrappers, [createMockUiKit()]);

  // Assert
  expect(rendered).toBeNull();
});

test("renderAudioAgentUi renders wrapper nodes with provided kits", () => {
  // Arrange
  const wrappers: AudioAgentUiWrapper[] = [
    {
      ui: [
        {
          panel: {
            children: "world",
          },
        },
      ],
    },
  ];

  // Act
  const rendered = renderAudioAgentUi(wrappers, [createMockUiKit()]);

  // Assert
  expect(Array.isArray(rendered)).toBe(true);
});

test("resolveUiSchema uses serialized schema when present", () => {
  // Arrange
  const uiKit: AudioAgentUiKit[] = [createMockUiKit()];

  // Act
  const schema = resolveUiSchema(uiKit);

  // Assert
  expect(schema).toMatchObject({ type: "object" });
});

test("useAudioAgent exposes controls and realtime client integration", async () => {
  // Arrange
  const connectionEvents$ = new Subject<{ type: "connected" } | { type: "disconnected" }>();
  const audioAgentEvents$ = new Subject<{
    type: "ui.wrapper";
    wrapper: AudioAgentUiWrapper;
  }>();
  const microphoneLevel$ = new Subject<number>();
  const toolExecutionState$ = new Subject<{ activeToolCallCount: number; isRunning: boolean }>();
  const connect = vi.fn(async () => undefined);
  const disconnect = vi.fn(() => undefined);
  const sendEvent = vi.fn(() => undefined);
  const sendText = vi.fn(() => undefined);
  const setMuted = vi.fn(() => undefined);

  const fakeClient: RealtimeWebRtcClient = {
    audioAgentEvents$,
    connect,
    connectionEvents$,
    microphoneLevel$,
    uiJson$: new Subject(),
    disconnect,
    sendEvent,
    sendText,
    setMuted,
    toolExecutionState$,
  };

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: true,
        createClient: () => fakeClient,
        instructions: "render UI",
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    connectionEvents$.next({ type: "connected" });
    microphoneLevel$.next(0.75);
    toolExecutionState$.next({ activeToolCallCount: 1, isRunning: true });
    result.current.mute();
    result.current.unmute();
    result.current.toggleMute();
    result.current.sendText("hello");
    audioAgentEvents$.next({
      type: "ui.wrapper",
      wrapper: {
        ui: [{ card: { children: "x" } }],
      },
    });
  });

  // Assert
  expect(connect).toHaveBeenCalled();
  expect(sendEvent).toHaveBeenCalledTimes(1);
  expect(setMuted).toHaveBeenCalled();
  expect(sendText).toHaveBeenCalledWith("hello");
  expect(result.current.isConnected).toBe(true);
  expect(result.current.microphoneLevel).toBe(0.75);
  expect(result.current.activeToolCallCount).toBe(1);
  expect(result.current.isToolRunning).toBe(true);
  expect(result.current.render()).not.toBeUndefined();

  // Cleanup
  act(() => {
    result.current.disconnect();
  });

  expect(disconnect).toHaveBeenCalled();
});

test("useAudioAgent forwards tools to client and session update payload", async () => {
  // Arrange
  const connect = vi.fn(async () => undefined);
  const sendEvent = vi.fn(() => undefined);
  const createClient = vi.fn(
    (sessionEndpoint: string, options?: { tools?: readonly unknown[] }): RealtimeWebRtcClient => {
      expect(sessionEndpoint).toBe("/session");
      expect(options?.tools).toHaveLength(1);

      return {
        audioAgentEvents$: new Subject(),
        connect,
        connectionEvents$: new Subject(),
        uiJson$: new Subject(),
        disconnect: vi.fn(() => undefined),
        sendEvent,
        sendText: vi.fn(() => undefined),
        setMuted: vi.fn(() => undefined),
      };
    },
  );
  const tools = [
    {
      description: "Get weather for a location",
      handler: async () => {
        return { status: "ok" };
      },
      name: "get_weather",
      schema: { properties: { location: { type: "string" } }, type: "object" },
    },
  ] as const;

  // Act
  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient,
        sessionEndpoint: "/session",
      },
      tools,
      uiKit: [createMockUiKit()],
    });
  });
  await act(async () => {
    await result.current.connect();
  });

  // Assert
  expect(connect).toHaveBeenCalledTimes(1);
  expect(sendEvent).toHaveBeenCalledTimes(1);
  expect(sendEvent).toHaveBeenCalledWith(
    "session.update",
    expect.objectContaining({
      session: expect.objectContaining({
        tools: expect.arrayContaining([
          expect.objectContaining({ name: "render_ui" }),
          expect.objectContaining({ name: "get_weather" }),
        ]),
      }),
    }),
  );
});

test("resolveUiSchema falls back when serialized schema is invalid", () => {
  // Arrange
  const uiKit: AudioAgentUiKit[] = [
    {
      render: () => [],
      serializedSchema: "[]",
    },
  ];

  // Act
  const schema = resolveUiSchema(uiKit);

  // Assert
  expect(schema).toMatchObject({ type: "object" });
});

test("useAudioAgent handles no-realtime mode and safe disconnect", async () => {
  // Arrange
  const { result } = renderHook(() => {
    return useAudioAgent({
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await result.current.connect();
  });
  act(() => {
    result.current.disconnect();
    result.current.sendText("ignored");
  });

  // Assert
  expect(result.current.isConnected).toBe(false);
  expect(result.current.lastErrorMessage).toBeUndefined();
});

test("useAudioAgent handles connection error and reconnect guard", async () => {
  // Arrange
  const connectionEvents$ = new Subject<
    { type: "connected" } | { type: "disconnected" } | { message: string; type: "error" }
  >();
  const audioAgentEvents$ = new Subject<{
    type: "ui.wrapper";
    wrapper: AudioAgentUiWrapper;
  }>();
  const connect = vi.fn(async () => undefined);
  const createClient = vi.fn((): RealtimeWebRtcClient => {
    return {
      audioAgentEvents$,
      connect,
      connectionEvents$,
      uiJson$: new Subject(),
      disconnect: vi.fn(() => undefined),
      sendEvent: vi.fn(() => undefined),
      sendText: vi.fn(() => undefined),
      setMuted: vi.fn(() => undefined),
    };
  });

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await result.current.connect();
    await result.current.connect();
  });
  act(() => {
    connectionEvents$.next({ message: "boom", type: "error" });
    connectionEvents$.next({ type: "connected" });
    connectionEvents$.next({ type: "disconnected" });
  });

  // Assert
  expect(createClient).toHaveBeenCalledTimes(1);
  expect(connect).toHaveBeenCalledTimes(1);
  expect(result.current.lastErrorMessage).toBe("boom");
  expect(result.current.isConnected).toBe(false);
});

test("useAudioAgent allows reconnect after disconnected event", async () => {
  // Arrange
  const firstConnectionEvents$ = new Subject<{ type: "connected" } | { type: "disconnected" }>();
  const secondConnectionEvents$ = new Subject<{ type: "connected" } | { type: "disconnected" }>();
  const firstClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect: vi.fn(async () => undefined),
    connectionEvents$: firstConnectionEvents$,
    uiJson$: new Subject(),
    disconnect: vi.fn(() => undefined),
    sendEvent: vi.fn(() => undefined),
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };
  const secondClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect: vi.fn(async () => undefined),
    connectionEvents$: secondConnectionEvents$,
    uiJson$: new Subject(),
    disconnect: vi.fn(() => undefined),
    sendEvent: vi.fn(() => undefined),
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };
  const createClient = vi
    .fn<() => RealtimeWebRtcClient>()
    .mockReturnValueOnce(firstClient)
    .mockReturnValueOnce(secondClient);

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await result.current.connect();
  });
  act(() => {
    firstConnectionEvents$.next({ type: "disconnected" });
  });
  await act(async () => {
    await result.current.connect();
  });

  // Assert
  expect(createClient).toHaveBeenCalledTimes(2);
  expect(firstClient.connect).toHaveBeenCalledTimes(1);
  expect(secondClient.connect).toHaveBeenCalledTimes(1);
});

test("useAudioAgent ignores stale connect completion after disconnect", async () => {
  // Arrange
  let resolveConnect: (() => void) | undefined;
  const connect = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveConnect = resolve;
      }),
  );
  const disconnect = vi.fn(() => undefined);
  const sendEvent = vi.fn(() => undefined);
  const fakeClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect,
    connectionEvents$: new Subject(),
    uiJson$: new Subject(),
    disconnect,
    sendEvent,
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient: () => fakeClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  let pendingConnect: Promise<void> | undefined;
  await act(async () => {
    pendingConnect = result.current.connect();
  });
  act(() => {
    result.current.disconnect();
  });
  await act(async () => {
    resolveConnect?.();
    await pendingConnect;
  });

  // Assert
  expect(disconnect).toHaveBeenCalled();
  expect(sendEvent).not.toHaveBeenCalled();
});

test("useAudioAgent surfaces connect errors and clears stale client ref", async () => {
  // Arrange
  const failingConnect = vi
    .fn<() => Promise<void>>()
    .mockRejectedValueOnce(new Error("connect failed"))
    .mockResolvedValueOnce(undefined);
  const createClient = vi.fn((): RealtimeWebRtcClient => {
    return {
      audioAgentEvents$: new Subject(),
      connect: failingConnect,
      connectionEvents$: new Subject(),
      uiJson$: new Subject(),
      disconnect: vi.fn(() => undefined),
      sendEvent: vi.fn(() => undefined),
      sendText: vi.fn(() => undefined),
      setMuted: vi.fn(() => undefined),
    };
  });

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await expect(result.current.connect()).rejects.toThrowError("connect failed");
  });
  await act(async () => {
    await result.current.connect();
  });

  // Assert
  expect(result.current.lastErrorMessage).toBe("connect failed");
  expect(createClient).toHaveBeenCalledTimes(2);
});

test("useAudioAgent maps non-Error connect failures to generic message", async () => {
  // Arrange
  const createClient = vi.fn((): RealtimeWebRtcClient => {
    return {
      audioAgentEvents$: new Subject(),
      connect: vi.fn(async () => {
        throw "raw-failure";
      }),
      connectionEvents$: new Subject(),
      uiJson$: new Subject(),
      disconnect: vi.fn(() => undefined),
      sendEvent: vi.fn(() => undefined),
      sendText: vi.fn(() => undefined),
      setMuted: vi.fn(() => undefined),
    };
  });

  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await expect(result.current.connect()).rejects.toBe("raw-failure");
  });

  // Assert
  expect(result.current.lastErrorMessage).toBe("Connection failed");
});

test("useAudioAgent unsubscribes and disconnects on unmount", async () => {
  // Arrange
  const externalUnsubscribe = vi.fn(() => undefined);
  const externalEvents$ = new Observable<{ type: "muted" }>(() => {
    return (): void => {
      externalUnsubscribe();
    };
  });
  const disconnect = vi.fn(() => undefined);
  const fakeClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect: vi.fn(async () => undefined),
    connectionEvents$: new Subject(),
    uiJson$: new Subject(),
    disconnect,
    sendEvent: vi.fn(() => undefined),
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };

  const { result, unmount } = renderHook(() => {
    return useAudioAgent({
      events$: externalEvents$,
      realtime: {
        autoConnect: false,
        createClient: () => fakeClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await result.current.connect();
  });
  unmount();

  // Assert
  expect(externalUnsubscribe).toHaveBeenCalledTimes(1);
  expect(disconnect).toHaveBeenCalledTimes(1);
});

test("useAudioAgent exposes raw tool-call json from realtime client", async () => {
  // Arrange
  const uiJson$ = new Subject<string>();
  const fakeClient: RealtimeWebRtcClient = {
    audioAgentEvents$: new Subject(),
    connect: vi.fn(async () => undefined),
    connectionEvents$: new Subject(),
    uiJson$,
    disconnect: vi.fn(() => undefined),
    sendEvent: vi.fn(() => undefined),
    sendText: vi.fn(() => undefined),
    setMuted: vi.fn(() => undefined),
  };
  const { result } = renderHook(() => {
    return useAudioAgent({
      realtime: {
        autoConnect: false,
        createClient: () => fakeClient,
        sessionEndpoint: "/session",
      },
      uiKit: [createMockUiKit()],
    });
  });

  // Act
  await act(async () => {
    await result.current.connect();
  });
  act(() => {
    uiJson$.next('{"ui":[{"card":{"children":"from-tool"}}]}');
  });

  // Assert
  expect(result.current.rawUiJson).toBe('{"ui":[{"card":{"children":"from-tool"}}]}');
});

test("useAudioAgent respects initial state and applies external events", () => {
  // Arrange
  const events$ = new Subject<{ type: "muted" }>();
  const initialUi: AudioAgentUiWrapper[] = [
    {
      ui: [{ badge: { children: "seed" } }],
    },
  ];

  // Act
  const { result } = renderHook(() => {
    return useAudioAgent({
      events$,
      initialIsMuted: true,
      initialUi,
      uiKit: [createMockUiKit()],
    });
  });
  act(() => {
    events$.next({ type: "muted" });
  });

  // Assert
  expect(result.current.isMuted).toBe(true);
  expect(result.current.render()).not.toBeNull();
});
