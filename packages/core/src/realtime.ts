import { s } from "@hashbrownai/core";
import { type Observable, Subject } from "rxjs";
import { z } from "zod";

import {
  type AudioAgentEventInput,
  type AudioAgentUiWrapper,
  audioAgentUiWrapperSchema,
} from "./audio-agent.js";
import { type ConnectionEvent, parseConnectionEvent } from "./state.js";

const realtimeEnvelopeSchema = z.object({
  event_id: z.string().min(1).optional(),
  type: z.string().min(1),
});

const realtimeFunctionCallOutputItemSchema = z.object({
  arguments: z.string().min(1),
  call_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: z.literal("function_call"),
});

const realtimeOutputItemDoneSchema = z.object({
  item: realtimeFunctionCallOutputItemSchema,
  type: z.literal("response.output_item.done"),
});

const realtimeFunctionCallArgumentsDoneSchema = z.object({
  arguments: z.string(),
  call_id: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  type: z.literal("response.function_call_arguments.done"),
});

const realtimeFunctionCallArgumentsDeltaSchema = z.object({
  call_id: z.string().min(1).optional(),
  delta: z.string(),
  name: z.string().min(1).optional(),
  type: z.literal("response.function_call_arguments.delta"),
});

const realtimeUiEventCandidateSchema = z.union([
  realtimeOutputItemDoneSchema,
  realtimeFunctionCallArgumentsDoneSchema,
]);

const realtimeServerErrorEventSchema = z.object({
  error: z
    .object({
      message: z.string().min(1).optional(),
    })
    .optional(),
  message: z.string().min(1).optional(),
  type: z.literal("error"),
});

/**
 * Realtime event envelope sent over the data channel.
 */
export type RealtimeEventEnvelope = z.infer<typeof realtimeEnvelopeSchema> &
  Record<string, unknown>;

/**
 * Minimal event payload for mutating a Realtime session.
 */
export interface RealtimeSessionUpdatePayload {
  session: Record<string, unknown>;
}

/**
 * Tool contract used by the realtime client for local function-call execution.
 */
export interface RealtimeTool {
  description: string;
  handler: (input: unknown, abortSignal: AbortSignal) => Promise<unknown>;
  name: string;
  schema: unknown;
}

/**
 * Builds a client event envelope for the Realtime event channel.
 *
 * @param type Event type.
 * @param payload Additional event payload fields.
 * @param createEventId Event-id generator for observability.
 * @returns Normalized event envelope.
 */
export function createRealtimeClientEvent(
  type: string,
  payload: object,
  createEventId: () => string,
): RealtimeEventEnvelope {
  return {
    event_id: createEventId(),
    type,
    ...(payload as Record<string, unknown>),
  };
}

/**
 * Parses raw JSON data-channel messages into normalized realtime envelopes.
 *
 * @param raw Raw event payload.
 * @returns Parsed event envelope.
 */
export function parseRealtimeServerEvent(raw: string): RealtimeEventEnvelope {
  const parsed = JSON.parse(raw) as unknown;
  const envelope = realtimeEnvelopeSchema.parse(parsed);

  return {
    ...envelope,
    ...(parsed as Record<string, unknown>),
  };
}

/**
 * Attempts to extract a UI wrapper emitted through a function-call event.
 *
 * @param event Parsed realtime server event.
 * @returns Normalized audio-agent event when a UI wrapper is present.
 */
export function toAudioAgentUiEvent(
  event: RealtimeEventEnvelope,
): AudioAgentEventInput | undefined {
  const candidateResult = realtimeUiEventCandidateSchema.safeParse(event);

  if (!candidateResult.success) {
    return undefined;
  }

  const argumentsText =
    candidateResult.data.type === "response.output_item.done"
      ? candidateResult.data.item.arguments
      : candidateResult.data.arguments;

  const parsedArguments = JSON.parse(argumentsText) as unknown;
  const wrapperResult = audioAgentUiWrapperSchema.safeParse(parsedArguments);

  if (!wrapperResult.success) {
    return undefined;
  }

  return {
    type: "ui.wrapper",
    wrapper: wrapperResult.data,
  };
}

/**
 * Data-channel interface used by the realtime client.
 */
export interface RealtimeDataChannel {
  onclose: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onopen: (() => void) | null;
  readyState?: "closed" | "closing" | "connecting" | "open";
  send: (payload: string) => void;
}

/**
 * Local audio track interface used by the realtime client.
 */
export interface RealtimeLocalAudioTrack {
  enabled: boolean;
  stop: () => void;
}

/**
 * Local audio stream interface used by the realtime client.
 */
export interface RealtimeLocalAudioStream {
  getAudioTracks: () => RealtimeLocalAudioTrack[];
}

/**
 * Media-device access interface used by the realtime client.
 */
export interface RealtimeMediaDevices {
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<RealtimeLocalAudioStream>;
}

/**
 * Peer-connection interface used by the realtime client.
 */
export interface RealtimePeerConnection {
  addTrack: (track: RealtimeLocalAudioTrack, stream: RealtimeLocalAudioStream) => void;
  close: () => void;
  createDataChannel: (label: string) => RealtimeDataChannel;
  createOffer: () => Promise<{ sdp: string | undefined }>;
  ontrack?: ((event: { streams: Array<{ id?: string }> }) => void) | null;
  setLocalDescription: (description: { sdp: string; type: "offer" }) => Promise<void>;
  setRemoteDescription: (description: { sdp: string; type: "answer" }) => Promise<void>;
}

/**
 * HTTP response abstraction used by the realtime client.
 */
export interface RealtimeHttpResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/**
 * HTTP fetch abstraction used by the realtime client.
 */
export type RealtimeFetch = (input: string, init: RequestInit) => Promise<RealtimeHttpResponse>;

/**
 * Configuration for the dependency-injected realtime WebRTC client.
 */
export interface RealtimeWebRtcClientOptions {
  channelOpenTimeoutMs?: number;
  createAudioElement?: () => {
    autoplay: boolean;
    muted: boolean;
    play: () => Promise<void>;
    srcObject: unknown;
  };
  createEventId: () => string;
  createPeerConnection: () => RealtimePeerConnection;
  fetch: RealtimeFetch;
  mediaDevices: RealtimeMediaDevices;
  sessionEndpoint: string;
  createAudioLevelMonitor?: (stream: RealtimeLocalAudioStream) => RealtimeAudioLevelMonitor;
  tools?: readonly RealtimeTool[];
}

/**
 * Active tool execution state exposed by realtime clients.
 */
export interface RealtimeToolExecutionState {
  activeToolCallCount: number;
  isRunning: boolean;
}

/**
 * Audio-level monitor for microphone input.
 */
export interface RealtimeAudioLevelMonitor {
  level$: Observable<number>;
  stop: () => void;
}

/**
 * Runtime client interface for the browser WebRTC session.
 */
export interface RealtimeWebRtcClient {
  audioAgentEvents$: Observable<AudioAgentEventInput>;
  connectionEvents$: Observable<ConnectionEvent>;
  microphoneLevel$?: Observable<number>;
  toolExecutionState$?: Observable<RealtimeToolExecutionState>;
  uiJson$: Observable<string>;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendEvent: (type: string, payload: object) => void;
  sendText: (text: string) => void;
  setMuted: (muted: boolean) => void;
}

/**
 * Creates a dependency-injected WebRTC client that streams realtime events.
 *
 * @param options Client dependencies and session endpoint.
 * @returns Realtime client interface.
 */
export function createRealtimeWebRtcClient(
  options: RealtimeWebRtcClientOptions,
): RealtimeWebRtcClient {
  const connectionEventsSubject = new Subject<ConnectionEvent>();
  const audioAgentEventsSubject = new Subject<AudioAgentEventInput>();
  const uiJsonSubject = new Subject<string>();
  const microphoneLevelSubject = new Subject<number>();
  const toolExecutionStateSubject = new Subject<RealtimeToolExecutionState>();

  let channel: RealtimeDataChannel | undefined;
  let isChannelOpen = false;
  let localTracks: RealtimeLocalAudioTrack[] = [];
  let pendingEvents: RealtimeEventEnvelope[] = [];
  let peerConnection: RealtimePeerConnection | undefined;
  let audioLevelMonitor: RealtimeAudioLevelMonitor | undefined;
  let audioLevelSubscription: { unsubscribe: () => void } | undefined;
  let processedToolCallIds: Record<string, true> = {};
  let toolCallAbortControllers: Record<string, AbortController> = {};
  let activeToolCallCount = 0;
  let toolArgumentBuffers: Record<string, string> = {};
  let toolNamesByCallId: Record<string, string> = {};

  /**
   * Normalizes unknown errors into user-safe string messages.
   *
   * @param error Unknown thrown value.
   * @returns Error message.
   */
  function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return "Tool execution failed";
  }

  /**
   * Emits a normalized tool execution state snapshot.
   */
  function emitToolExecutionState(): void {
    toolExecutionStateSubject.next({
      activeToolCallCount,
      isRunning: activeToolCallCount > 0,
    });
  }

  /**
   * Sends function call output and triggers an audio follow-up response.
   *
   * @param callId Realtime tool call id.
   * @param output Structured output payload.
   */
  function sendFunctionCallOutput(callId: string, output: Record<string, unknown>): void {
    sendEvent("conversation.item.create", {
      item: {
        call_id: callId,
        output: JSON.stringify(output),
        type: "function_call_output",
      },
    });

    sendEvent("response.create", {
      response: {
        output_modalities: ["audio"],
      },
    });
  }

  /**
   * Executes a registered local tool for a model function call.
   *
   * @param callId Tool call id.
   * @param name Tool name.
   * @param argumentsText JSON argument payload.
   */
  async function executeToolCall(
    callId: string,
    name: string,
    argumentsText: string,
  ): Promise<void> {
    const tool = options.tools?.find((candidate) => candidate.name === name);

    if (!tool) {
      sendFunctionCallOutput(callId, {
        error: {
          code: "tool_not_found",
          message: `No local tool is registered with name "${name}".`,
        },
        ok: false,
      });
      return;
    }

    let parsedArguments: unknown;
    try {
      parsedArguments =
        argumentsText.trim().length > 0 ? (JSON.parse(argumentsText) as unknown) : {};
    } catch {
      sendFunctionCallOutput(callId, {
        error: {
          code: "invalid_tool_arguments",
          message: `Tool "${name}" received invalid JSON arguments.`,
        },
        ok: false,
      });
      return;
    }

    const previousController = toolCallAbortControllers[callId];
    if (previousController) {
      previousController.abort();
    }

    const abortController = new AbortController();
    activeToolCallCount += 1;
    emitToolExecutionState();
    toolCallAbortControllers = {
      ...toolCallAbortControllers,
      [callId]: abortController,
    };

    try {
      const result = await tool.handler(parsedArguments, abortController.signal);
      if (abortController.signal.aborted) {
        return;
      }

      sendFunctionCallOutput(callId, {
        ok: true,
        result,
      });
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      sendFunctionCallOutput(callId, {
        error: {
          code: "tool_execution_failed",
          message: toErrorMessage(error),
        },
        ok: false,
      });
    } finally {
      const { [callId]: _, ...nextControllers } = toolCallAbortControllers;
      toolCallAbortControllers = nextControllers;
      activeToolCallCount = Math.max(0, activeToolCallCount - 1);
      emitToolExecutionState();
    }
  }

  /**
   * Emits a validated connection event.
   *
   * @param event Event payload.
   */
  function emitConnection(event: ConnectionEvent): void {
    connectionEventsSubject.next(parseConnectionEvent(event));
  }

  /**
   * Connects the client to the configured realtime session endpoint.
   */
  async function connect(): Promise<void> {
    const createdPeerConnection = options.createPeerConnection();
    const createdChannel = createdPeerConnection.createDataChannel("oai-events");
    channel = createdChannel;
    const stream = await options.mediaDevices.getUserMedia({ audio: true });
    let resolveChannelOpen: (() => void) | undefined;
    const channelOpenPromise = new Promise<void>((resolve) => {
      resolveChannelOpen = resolve;
    });

    localTracks = stream.getAudioTracks();
    for (const track of localTracks) {
      createdPeerConnection.addTrack(track, stream);
    }

    if (options.createAudioLevelMonitor) {
      audioLevelMonitor = options.createAudioLevelMonitor(stream);
      audioLevelSubscription = audioLevelMonitor.level$.subscribe((level) => {
        microphoneLevelSubject.next(level);
      });
    }

    const onChannelOpen = (): void => {
      isChannelOpen = true;
      for (const pendingEvent of pendingEvents) {
        createdChannel.send(JSON.stringify(pendingEvent));
      }
      pendingEvents = [];
      emitConnection({ type: "connected" });
      resolveChannelOpen?.();
    };
    createdChannel.onopen = onChannelOpen;
    createdPeerConnection.ontrack = (event) => {
      const stream = event.streams[0];

      if (!stream || !options.createAudioElement) {
        return;
      }

      const audioElement = options.createAudioElement();
      audioElement.autoplay = true;
      audioElement.muted = false;
      audioElement.srcObject = stream;
      void audioElement.play();
    };

    createdChannel.onclose = () => {
      emitConnection({
        reason: "data channel closed",
        type: "disconnected",
      });
    };

    createdChannel.onmessage = (messageEvent) => {
      try {
        const serverEvent = parseRealtimeServerEvent(messageEvent.data);
        const serverErrorResult = realtimeServerErrorEventSchema.safeParse(serverEvent);

        if (serverErrorResult.success) {
          emitConnection({
            message:
              serverErrorResult.data.error?.message ??
              serverErrorResult.data.message ??
              "Realtime server error",
            type: "error",
          });
          return;
        }

        const functionArgumentDeltaResult =
          realtimeFunctionCallArgumentsDeltaSchema.safeParse(serverEvent);
        if (functionArgumentDeltaResult.success) {
          const callId = functionArgumentDeltaResult.data.call_id ?? "__default__";
          const previous = toolArgumentBuffers[callId] ?? "";
          const resolvedName =
            functionArgumentDeltaResult.data.name ?? toolNamesByCallId[callId] ?? undefined;

          if (callId !== "__default__" && resolvedName) {
            toolNamesByCallId = {
              ...toolNamesByCallId,
              [callId]: resolvedName,
            };
          }

          toolArgumentBuffers = {
            ...toolArgumentBuffers,
            [callId]: `${previous}${functionArgumentDeltaResult.data.delta}`,
          };

          if (!resolvedName || resolvedName === "render_ui") {
            uiJsonSubject.next(toolArgumentBuffers[callId] ?? "");
          }

          return;
        }

        const functionArgumentDoneResult =
          realtimeFunctionCallArgumentsDoneSchema.safeParse(serverEvent);
        if (functionArgumentDoneResult.success) {
          const callId = functionArgumentDoneResult.data.call_id;
          const resolvedName =
            functionArgumentDoneResult.data.name ??
            (callId ? toolNamesByCallId[callId] : undefined) ??
            undefined;
          const bufferedArguments =
            callId && toolArgumentBuffers[callId] ? toolArgumentBuffers[callId] : "";
          const argumentsText = functionArgumentDoneResult.data.arguments || bufferedArguments;

          if (callId) {
            if (processedToolCallIds[callId]) {
              return;
            }

            processedToolCallIds = {
              ...processedToolCallIds,
              [callId]: true,
            };

            const { [callId]: __, ...nextNamesByCallId } = toolNamesByCallId;
            toolNamesByCallId = nextNamesByCallId;
            const { [callId]: _, ...nextBuffers } = toolArgumentBuffers;
            toolArgumentBuffers = nextBuffers;
          }

          handleToolArguments(argumentsText, callId, resolvedName);
          return;
        }

        const outputItemDoneResult = realtimeOutputItemDoneSchema.safeParse(serverEvent);
        if (outputItemDoneResult.success) {
          const callId = outputItemDoneResult.data.item.call_id;

          if (callId) {
            if (processedToolCallIds[callId]) {
              return;
            }

            processedToolCallIds = {
              ...processedToolCallIds,
              [callId]: true,
            };
          }

          handleToolArguments(
            outputItemDoneResult.data.item.arguments,
            callId,
            outputItemDoneResult.data.item.name,
          );
          return;
        }
      } catch {
        emitConnection({
          message: "Failed to parse realtime server event",
          type: "error",
        });
      }
    };

    const offer = await createdPeerConnection.createOffer();

    if (!offer.sdp) {
      emitConnection({
        message: "Missing SDP in local offer",
        type: "error",
      });
      throw new Error("Missing SDP in local offer");
    }

    await createdPeerConnection.setLocalDescription({
      sdp: offer.sdp,
      type: "offer",
    });

    const response = await options.fetch(options.sessionEndpoint, {
      body: offer.sdp,
      headers: {
        "Content-Type": "application/sdp",
      },
      method: "POST",
    });

    if (!response.ok) {
      emitConnection({
        message: `Session endpoint request failed: ${response.status.toString()}`,
        type: "error",
      });
      throw new Error(`Session endpoint request failed: ${response.status.toString()}`);
    }

    const answerSdp = await response.text();

    await createdPeerConnection.setRemoteDescription({
      sdp: answerSdp,
      type: "answer",
    });

    peerConnection = createdPeerConnection;
    channel = createdChannel;

    if (createdChannel.readyState === "open") {
      onChannelOpen();
    }

    const channelOpenTimeoutMs = options.channelOpenTimeoutMs ?? 15_000;
    const timeoutPromise = new Promise<void>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Data channel did not open within ${channelOpenTimeoutMs.toString()}ms`));
      }, channelOpenTimeoutMs);
    });

    await Promise.race([channelOpenPromise, timeoutPromise]);
  }

  /**
   * Disconnects and releases local resources.
   */
  function disconnect(): void {
    for (const track of localTracks) {
      track.stop();
    }

    localTracks = [];
    audioLevelSubscription?.unsubscribe();
    audioLevelSubscription = undefined;
    audioLevelMonitor?.stop();
    audioLevelMonitor = undefined;
    microphoneLevelSubject.next(0);

    if (peerConnection) {
      peerConnection.close();
      peerConnection = undefined;
    }

    isChannelOpen = false;
    channel = undefined;
    pendingEvents = [];
    processedToolCallIds = {};
    for (const abortController of Object.values(toolCallAbortControllers)) {
      abortController.abort();
    }
    toolCallAbortControllers = {};
    activeToolCallCount = 0;
    emitToolExecutionState();
    toolArgumentBuffers = {};
    toolNamesByCallId = {};

    emitConnection({
      reason: "client disconnected",
      type: "disconnected",
    });
  }

  /**
   * Sends a normalized client event over the data channel.
   *
   * @param type Event type.
   * @param payload Event payload.
   */
  function sendEvent(type: string, payload: object): void {
    if (!channel) {
      return;
    }

    const event = createRealtimeClientEvent(type, payload, options.createEventId);

    if (isChannelOpen || channel.readyState === "open") {
      channel.send(JSON.stringify(event));
      return;
    }

    pendingEvents = [...pendingEvents, event];
  }

  /**
   * Sends a text input turn and triggers model inference.
   *
   * @param text User text input.
   */
  function sendText(text: string): void {
    sendEvent("conversation.item.create", {
      item: {
        content: [{ text, type: "input_text" }],
        role: "user",
        type: "message",
      },
    });

    sendEvent("response.create", {
      response: {
        output_modalities: ["audio"],
      },
    });
  }

  /**
   * Handles completed tool-call arguments from realtime server events.
   *
   * @param argumentsText Raw JSON argument string.
   * @param callId Optional function call id for tool output response.
   * @param functionName Optional function name emitted by model.
   */
  function handleToolArguments(
    argumentsText: string,
    callId: string | undefined,
    functionName: string | undefined,
  ): void {
    if (functionName && functionName !== "render_ui") {
      if (callId) {
        void executeToolCall(callId, functionName, argumentsText);
      }
      return;
    }

    uiJsonSubject.next(argumentsText);

    let parsedArguments: unknown;
    try {
      parsedArguments = JSON.parse(argumentsText) as unknown;
    } catch {
      if (callId) {
        sendFunctionCallOutput(callId, {
          error: {
            code: "invalid_ui_payload",
            message: "render_ui payload is not valid JSON.",
          },
          ok: false,
        });
      }
      return;
    }

    const wrapperResult = audioAgentUiWrapperSchema.safeParse(parsedArguments);

    if (!wrapperResult.success) {
      if (callId) {
        sendFunctionCallOutput(callId, {
          error: {
            code: "invalid_ui_payload",
            message: "render_ui payload does not match the UI schema.",
          },
          ok: false,
        });
      }

      return;
    }

    audioAgentEventsSubject.next({
      type: "ui.wrapper",
      wrapper: wrapperResult.data,
    });

    if (!callId) {
      return;
    }

    sendFunctionCallOutput(callId, {
      ok: true,
      result: {
        rendered: true,
      },
    });
  }

  /**
   * Enables or disables local microphone tracks.
   *
   * @param muted Whether local microphone audio should be muted.
   */
  function setMuted(muted: boolean): void {
    for (const track of localTracks) {
      track.enabled = !muted;
    }
  }

  return {
    audioAgentEvents$: audioAgentEventsSubject.asObservable(),
    connect,
    connectionEvents$: connectionEventsSubject.asObservable(),
    disconnect,
    microphoneLevel$: microphoneLevelSubject.asObservable(),
    sendEvent,
    sendText,
    setMuted,
    toolExecutionState$: toolExecutionStateSubject.asObservable(),
    uiJson$: uiJsonSubject.asObservable(),
  };
}

/**
 * Browser dependency adapter for creating a realtime WebRTC client.
 *
 * @param sessionEndpoint Session endpoint served by the app backend.
 * @returns Browser-ready realtime client.
 */
export function createBrowserRealtimeWebRtcClient(
  sessionEndpoint: string,
  options: {
    tools?: readonly RealtimeTool[];
  } = {},
): RealtimeWebRtcClient {
  const supportsAudioLevelMonitor =
    typeof AudioContext !== "undefined" &&
    typeof requestAnimationFrame !== "undefined" &&
    typeof cancelAnimationFrame !== "undefined";

  const baseOptions: RealtimeWebRtcClientOptions = {
    createEventId: () => crypto.randomUUID(),
    createPeerConnection: () => {
      return new RTCPeerConnection() as unknown as RealtimePeerConnection;
    },
    fetch: async (input, init) => {
      const response = await fetch(input, init);

      return {
        ok: response.ok,
        status: response.status,
        text: async () => response.text(),
      };
    },
    mediaDevices: {
      getUserMedia: async (constraints) => {
        return (await navigator.mediaDevices.getUserMedia(
          constraints,
        )) as unknown as RealtimeLocalAudioStream;
      },
    },
    createAudioElement: () => {
      return document.createElement("audio");
    },
    sessionEndpoint,
  };

  if (supportsAudioLevelMonitor) {
    baseOptions.createAudioLevelMonitor = (stream) => {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      const source = audioContext.createMediaStreamSource(stream as unknown as MediaStream);
      source.connect(analyser);
      const sampleBuffer = new Uint8Array(analyser.fftSize);
      const levelSubject = new Subject<number>();
      let isStopped = false;
      let animationFrameId = 0;

      const sample = (): void => {
        if (isStopped) {
          return;
        }

        analyser.getByteTimeDomainData(sampleBuffer);
        let maxDelta = 0;
        for (const value of sampleBuffer) {
          const centered = Math.abs(value - 128);
          if (centered > maxDelta) {
            maxDelta = centered;
          }
        }

        const normalized = Math.min(1, maxDelta / 128);
        levelSubject.next(normalized);
        animationFrameId = requestAnimationFrame(sample);
      };

      animationFrameId = requestAnimationFrame(sample);

      return {
        level$: levelSubject.asObservable(),
        stop: () => {
          isStopped = true;
          cancelAnimationFrame(animationFrameId);
          source.disconnect();
          analyser.disconnect();
          levelSubject.complete();
          void audioContext.close();
        },
      };
    };
  }

  if (options.tools) {
    baseOptions.tools = options.tools;
  }

  return createRealtimeWebRtcClient(baseOptions);
}

/**
 * Builds the default session update payload for UI rendering tool support.
 *
 * @param parametersJsonSchema Tool parameter schema for `render_ui`.
 * @param instructions Optional user/system instructions.
 * @returns Session update payload for tool configuration.
 */
export function createDefaultUiSessionUpdatePayload(
  parametersJsonSchema: Record<string, unknown>,
  instructions: string | undefined,
  tools: readonly RealtimeTool[] = [],
): RealtimeSessionUpdatePayload {
  const additionalTools = tools
    .filter((tool) => tool.name !== "render_ui")
    .map((tool) => {
      return {
        description: tool.description,
        name: tool.name,
        parameters: toToolJsonSchema(tool.schema),
        type: "function" as const,
      };
    });

  return {
    session: {
      instructions,
      type: "realtime",
      tool_choice: "auto",
      tools: [
        {
          description: "Render UI elements in the client.",
          name: "render_ui",
          parameters: parametersJsonSchema,
          type: "function",
        },
        ...additionalTools,
      ],
    },
  };
}

/**
 * Normalizes a tool schema into JSON schema object form accepted by Realtime.
 *
 * @param schema Tool schema input.
 * @returns JSON schema object.
 */
export function toToolJsonSchema(schema: unknown): Record<string, unknown> {
  if (s.isHashbrownType(schema)) {
    return parseSerializedJsonObject(JSON.stringify(s.toJsonSchema(schema)));
  }

  const parsedObject = z.record(z.string(), z.unknown()).safeParse(schema);

  if (!parsedObject.success) {
    return {};
  }

  return parsedObject.data;
}

/**
 * Parses a JSON schema string into a validated object.
 *
 * @param serializedSchema Serialized JSON schema value.
 * @returns Parsed JSON object.
 */
export function parseSerializedJsonObject(serializedSchema: string): Record<string, unknown> {
  const parsed = JSON.parse(serializedSchema) as unknown;
  const parsedObjectResult = z.record(z.string(), z.unknown()).safeParse(parsed);

  if (!parsedObjectResult.success) {
    return {};
  }

  return parsedObjectResult.data;
}

/**
 * Returns a conservative fallback schema for rendering UI wrappers.
 *
 * @returns JSON schema object.
 */
export function createFallbackUiWrapperJsonSchema(): Record<string, unknown> {
  return {
    additionalProperties: false,
    properties: {
      ui: {
        items: {
          type: "object",
        },
        type: "array",
      },
    },
    required: ["ui"],
    type: "object",
  };
}

/**
 * Tries to parse a UI wrapper from an unknown tool-call argument payload.
 *
 * @param input Unknown parsed JSON payload.
 * @returns Validated wrapper, if any.
 */
export function parseAudioAgentUiWrapper(input: unknown): AudioAgentUiWrapper | undefined {
  const result = audioAgentUiWrapperSchema.safeParse(input);

  if (!result.success) {
    return undefined;
  }

  return result.data;
}
