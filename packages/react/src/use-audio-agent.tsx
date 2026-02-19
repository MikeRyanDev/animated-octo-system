import type {
  AudioAgentEventInput,
  AudioAgentState,
  AudioAgentUiWrapper,
  RealtimeTool,
  RealtimeWebRtcClient,
} from "@frenchfry/core";
import {
  createAudioAgentState$,
  createBrowserRealtimeWebRtcClient,
  createDefaultUiSessionUpdatePayload,
  createFallbackUiWrapperJsonSchema,
  parseSerializedJsonObject,
} from "@frenchfry/core";
import {
  Fragment,
  type ReactElement,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { EMPTY, type Observable, Subject, merge, startWith } from "rxjs";

/**
 * Minimal renderer contract for Hashbrown-compatible UI kits.
 */
export interface AudioAgentUiKit {
  render: (value: AudioAgentUiWrapper) => ReactElement[];
  serializedSchema?: string;
}

/**
 * Realtime options for the audio-agent hook.
 */
export interface UseAudioAgentRealtimeOptions {
  autoConnect?: boolean;
  createClient?: (
    sessionEndpoint: string,
    options?: { tools?: readonly RealtimeTool[] },
  ) => RealtimeWebRtcClient;
  instructions?: string;
  sessionEndpoint: string;
}

/**
 * Options accepted by `useAudioAgent`.
 */
export interface UseAudioAgentOptions {
  events$?: Observable<AudioAgentEventInput>;
  initialIsMuted?: boolean;
  initialUi?: AudioAgentUiWrapper[];
  realtime?: UseAudioAgentRealtimeOptions;
  tools?: readonly RealtimeTool[];
  uiKit: AudioAgentUiKit[];
}

/**
 * Public API exposed by the `useAudioAgent` hook.
 */
export interface UseAudioAgentResult {
  activeToolCallCount: number;
  connect: () => Promise<void>;
  disconnect: () => void;
  isConnected: boolean;
  isMuted: boolean;
  isToolRunning: boolean;
  lastErrorMessage: string | undefined;
  microphoneLevel: number;
  mute: () => void;
  rawUiJson: string;
  render: () => ReactNode;
  sendText: (text: string) => void;
  toggleMute: () => void;
  unmute: () => void;
}

/**
 * Internal controller contract for managing audio-agent state transitions.
 */
export interface AudioAgentController {
  getState: () => AudioAgentState;
  mute: () => void;
  subscribe: (listener: () => void) => () => void;
  toggleMute: () => void;
  unmute: () => void;
  teardown: () => void;
}

/**
 * Configuration for the internal audio-agent controller.
 */
export interface AudioAgentControllerOptions {
  events$: Observable<AudioAgentEventInput>;
  initialIsMuted?: boolean;
  initialUi?: AudioAgentUiWrapper[];
}

/**
 * Renders accumulated UI wrappers through the provided Hashbrown-compatible UI kits.
 *
 * @param wrappers Ordered wrappers to render.
 * @param uiKits Available UI kits that can render wrapper nodes.
 * @returns React node collection for all rendered wrappers.
 */
export function renderAudioAgentUi(
  wrappers: AudioAgentUiWrapper[],
  uiKits: AudioAgentUiKit[],
): ReactNode {
  const renderedWrappers = wrappers.map((wrapper, wrapperIndex) => {
    const renderedNodes = uiKits.flatMap((uiKit) => uiKit.render(wrapper));

    return <Fragment key={`wrapper-${wrapperIndex.toString()}`}>{renderedNodes}</Fragment>;
  });

  if (renderedWrappers.length === 0) {
    return null;
  }

  return renderedWrappers;
}

/**
 * Creates an audio-agent controller backed by an RxJS event/reducer pipeline.
 *
 * @param options Controller configuration.
 * @returns Controller API for muting and state subscription.
 */
export function createAudioAgentController(
  options: AudioAgentControllerOptions,
): AudioAgentController {
  const initialState: AudioAgentState = {
    isMuted: options.initialIsMuted ?? false,
    ui: options.initialUi ?? [],
  };

  const localEvents$ = new Subject<AudioAgentEventInput>();
  const state$ = createAudioAgentState$(merge(options.events$, localEvents$), initialState).pipe(
    startWith(initialState),
  );

  let currentState = initialState;
  const listeners = new Set<() => void>();
  const stateSubscription = state$.subscribe((nextState) => {
    currentState = nextState;

    for (const listener of listeners) {
      listener();
    }
  });

  /**
   * Dispatches a local event through the reducer pipeline.
   *
   * @param event Event payload.
   */
  function dispatch(event: AudioAgentEventInput): void {
    localEvents$.next(event);
  }

  /**
   * Subscribes to reduced state updates.
   *
   * @param listener Snapshot listener callback.
   * @returns Unsubscribe callback.
   */
  function subscribe(listener: () => void): () => void {
    listeners.add(listener);

    return (): void => {
      listeners.delete(listener);
    };
  }

  /**
   * Returns the latest immutable state snapshot.
   *
   * @returns Current state.
   */
  function getState(): AudioAgentState {
    return currentState;
  }

  /**
   * Sets mute state to true.
   */
  function mute(): void {
    dispatch({ type: "muted" });
  }

  /**
   * Sets mute state to false.
   */
  function unmute(): void {
    dispatch({ type: "unmuted" });
  }

  /**
   * Inverts mute state.
   */
  function toggleMute(): void {
    dispatch({ type: "mute.toggled" });
  }

  /**
   * Tears down active subscriptions and stream resources.
   */
  function teardown(): void {
    stateSubscription.unsubscribe();
    localEvents$.complete();
  }

  return {
    getState,
    mute,
    subscribe,
    teardown,
    toggleMute,
    unmute,
  };
}

/**
 * Resolves a JSON schema for the render-ui tool from the provided UI kit list.
 *
 * @param uiKit UI kits provided to the hook.
 * @returns JSON schema for render tool arguments.
 */
export function resolveUiSchema(uiKit: AudioAgentUiKit[]): Record<string, unknown> {
  const primaryKit = uiKit[0];

  if (primaryKit?.serializedSchema) {
    const parsedSchema = parseSerializedJsonObject(primaryKit.serializedSchema);

    if (Object.keys(parsedSchema).length > 0) {
      return parsedSchema;
    }
  }

  return createFallbackUiWrapperJsonSchema();
}

/**
 * React hook for audio-agent controls and Hashbrown UI rendering.
 *
 * @param options Hook configuration.
 * @returns Public controls, connection status, and render function.
 */
export function useAudioAgent(options: UseAudioAgentOptions): UseAudioAgentResult {
  const [activeToolCallCount, setActiveToolCallCount] = useState<number>(0);
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [isToolRunning, setIsToolRunning] = useState<boolean>(false);
  const [lastErrorMessage, setLastErrorMessage] = useState<string | undefined>(undefined);
  const [microphoneLevel, setMicrophoneLevel] = useState<number>(0);
  const [rawUiJson, setRawUiJson] = useState<string>("");
  const realtimeEvents$ = useMemo(() => new Subject<AudioAgentEventInput>(), []);
  const externalEvents$ = useMemo(() => new Subject<AudioAgentEventInput>(), []);
  const mergedEvents$ = useMemo(
    () => merge(externalEvents$, realtimeEvents$),
    [externalEvents$, realtimeEvents$],
  );
  const initialIsMutedRef = useRef(options.initialIsMuted);
  const initialUiRef = useRef(options.initialUi);

  const controller = useMemo(() => {
    const controllerOptions: AudioAgentControllerOptions = {
      events$: mergedEvents$,
    };

    if (initialIsMutedRef.current !== undefined) {
      controllerOptions.initialIsMuted = initialIsMutedRef.current;
    }

    if (initialUiRef.current !== undefined) {
      controllerOptions.initialUi = initialUiRef.current;
    }

    return createAudioAgentController(controllerOptions);
  }, [mergedEvents$]);

  const clientRef = useRef<RealtimeWebRtcClient | undefined>(undefined);
  const connectOperationRef = useRef<Promise<void> | undefined>(undefined);
  const connectRequestIdRef = useRef<number>(0);
  const connectionSubscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined);
  const audioSubscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined);
  const microphoneLevelSubscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined);
  const toolExecutionSubscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined);
  const uiJsonSubscriptionRef = useRef<{ unsubscribe: () => void } | undefined>(undefined);

  /**
   * Unsubscribes all active realtime client subscriptions.
   */
  const clearClientSubscriptions = useCallback((): void => {
    connectionSubscriptionRef.current?.unsubscribe();
    connectionSubscriptionRef.current = undefined;
    audioSubscriptionRef.current?.unsubscribe();
    audioSubscriptionRef.current = undefined;
    microphoneLevelSubscriptionRef.current?.unsubscribe();
    microphoneLevelSubscriptionRef.current = undefined;
    toolExecutionSubscriptionRef.current?.unsubscribe();
    toolExecutionSubscriptionRef.current = undefined;
    uiJsonSubscriptionRef.current?.unsubscribe();
    uiJsonSubscriptionRef.current = undefined;
  }, []);

  const connect = useCallback(async (): Promise<void> => {
    const realtimeOptions = options.realtime;
    if (!realtimeOptions) {
      return;
    }

    if (connectOperationRef.current) {
      return connectOperationRef.current;
    }

    if (clientRef.current) {
      return;
    }

    const createClient = realtimeOptions.createClient ?? createBrowserRealtimeWebRtcClient;
    const client = options.tools
      ? createClient(realtimeOptions.sessionEndpoint, { tools: options.tools })
      : createClient(realtimeOptions.sessionEndpoint);
    const connectRequestId = connectRequestIdRef.current + 1;
    connectRequestIdRef.current = connectRequestId;

    clientRef.current = client;

    connectionSubscriptionRef.current = client.connectionEvents$.subscribe((event) => {
      if (event.type === "connected") {
        setIsConnected(true);
      }

      if (event.type === "disconnected") {
        setIsConnected(false);
        clientRef.current = undefined;
      }

      if (event.type === "error") {
        setLastErrorMessage(event.message);
      }
    });

    audioSubscriptionRef.current = client.audioAgentEvents$.subscribe((event) => {
      realtimeEvents$.next(event);
    });
    microphoneLevelSubscriptionRef.current = client.microphoneLevel$?.subscribe((level) => {
      setMicrophoneLevel(level);
    });
    toolExecutionSubscriptionRef.current = client.toolExecutionState$?.subscribe((state) => {
      setActiveToolCallCount(state.activeToolCallCount);
      setIsToolRunning(state.isRunning);
    });
    uiJsonSubscriptionRef.current = client.uiJson$.subscribe((json) => {
      setRawUiJson(json);
    });

    const connectOperation = (async (): Promise<void> => {
      try {
        await client.connect();
      } catch (error) {
        clearClientSubscriptions();
        if (clientRef.current === client) {
          clientRef.current = undefined;
        }
        setIsConnected(false);
        setLastErrorMessage(error instanceof Error ? error.message : "Connection failed");
        throw error;
      }

      const isStaleConnection =
        connectRequestIdRef.current !== connectRequestId || clientRef.current !== client;
      if (isStaleConnection) {
        client.disconnect();
        return;
      }

      const uiSchema = resolveUiSchema(options.uiKit);
      const sessionPayload = createDefaultUiSessionUpdatePayload(
        uiSchema,
        realtimeOptions.instructions,
        options.tools ?? [],
      );

      client.sendEvent("session.update", sessionPayload);
    })();
    const trackedConnectOperation = connectOperation.finally(() => {
      if (connectOperationRef.current === trackedConnectOperation) {
        connectOperationRef.current = undefined;
      }
    });
    connectOperationRef.current = trackedConnectOperation;

    return connectOperationRef.current;
  }, [clearClientSubscriptions, options.realtime, options.tools, options.uiKit, realtimeEvents$]);

  const disconnect = useCallback((): void => {
    connectRequestIdRef.current += 1;
    const client = clientRef.current;
    clientRef.current = undefined;
    clearClientSubscriptions();
    setIsConnected(false);
    setMicrophoneLevel(0);
    setIsToolRunning(false);
    setActiveToolCallCount(0);

    if (!client) {
      return;
    }

    client.disconnect();
  }, [clearClientSubscriptions]);

  useEffect(() => {
    const sourceEvents$ = options.events$ ?? EMPTY;
    const subscription = sourceEvents$.subscribe((event) => {
      externalEvents$.next(event);
    });

    return (): void => {
      subscription.unsubscribe();
    };
  }, [externalEvents$, options.events$]);

  useEffect(() => {
    if (options.realtime?.autoConnect ?? false) {
      void connect();
    }
  }, [connect, options.realtime?.autoConnect]);

  useEffect(() => {
    return (): void => {
      disconnect();
      controller.teardown();
      externalEvents$.complete();
      realtimeEvents$.complete();
    };
  }, [controller, disconnect, externalEvents$, realtimeEvents$]);

  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  const mute = useCallback((): void => {
    controller.mute();
    clientRef.current?.setMuted(true);
  }, [controller]);

  const unmute = useCallback((): void => {
    controller.unmute();
    clientRef.current?.setMuted(false);
  }, [controller]);

  const toggleMute = useCallback((): void => {
    const shouldMute = !state.isMuted;

    controller.toggleMute();
    clientRef.current?.setMuted(shouldMute);
  }, [controller, state.isMuted]);

  const sendText = useCallback((text: string): void => {
    clientRef.current?.sendText(text);
  }, []);

  return {
    activeToolCallCount,
    connect,
    disconnect,
    isConnected,
    isMuted: state.isMuted,
    isToolRunning,
    lastErrorMessage,
    microphoneLevel,
    mute,
    rawUiJson,
    render: () => renderAudioAgentUi(state.ui, options.uiKit),
    sendText,
    toggleMute,
    unmute,
  };
}
