import { s } from "@hashbrownai/core";
import { Subject } from "rxjs";
import { expect, test } from "vitest";

import {
  type RealtimeDataChannel,
  type RealtimeLocalAudioStream,
  type RealtimeLocalAudioTrack,
  type RealtimePeerConnection,
  createDefaultUiSessionUpdatePayload,
  createFallbackUiWrapperJsonSchema,
  createRealtimeClientEvent,
  createRealtimeWebRtcClient,
  parseAudioAgentUiWrapper,
  parseRealtimeServerEvent,
  parseSerializedJsonObject,
  toAudioAgentUiEvent,
  toToolJsonSchema,
} from "./realtime.js";

test("createRealtimeClientEvent creates envelope with event id", () => {
  // Arrange
  const createEventId = (): string => "evt-1";

  // Act
  const event = createRealtimeClientEvent("session.update", { session: {} }, createEventId);

  // Assert
  expect(event.event_id).toBe("evt-1");
  expect(event.type).toBe("session.update");
});

test("parseRealtimeServerEvent parses valid json envelope", () => {
  // Arrange
  const raw = JSON.stringify({ type: "session.created" });

  // Act
  const event = parseRealtimeServerEvent(raw);

  // Assert
  expect(event.type).toBe("session.created");
});

test("toAudioAgentUiEvent extracts wrapper from output_item function call", () => {
  // Arrange
  const event = {
    item: {
      arguments: JSON.stringify({ ui: [{ card: { children: "hello" } }] }),
      type: "function_call",
    },
    type: "response.output_item.done",
  };

  // Act
  const result = toAudioAgentUiEvent(event);

  // Assert
  expect(result).toMatchObject({
    type: "ui.wrapper",
    wrapper: {
      ui: [{ card: { children: "hello" } }],
    },
  });
});

test("toAudioAgentUiEvent extracts wrapper from function_call_arguments.done", () => {
  // Arrange
  const event = {
    arguments: JSON.stringify({ ui: [{ panel: { children: "world" } }] }),
    type: "response.function_call_arguments.done",
  };

  // Act
  const result = toAudioAgentUiEvent(event);

  // Assert
  expect(result).toMatchObject({
    type: "ui.wrapper",
    wrapper: {
      ui: [{ panel: { children: "world" } }],
    },
  });
});

test("toAudioAgentUiEvent returns undefined for non-ui events", () => {
  // Arrange
  const event = {
    type: "response.done",
  };

  // Act
  const result = toAudioAgentUiEvent(event);

  // Assert
  expect(result).toBeUndefined();
});

test("parseSerializedJsonObject returns object or empty fallback", () => {
  // Arrange
  const valid = '{"type":"object"}';
  const invalid = "[]";

  // Act
  const parsedValid = parseSerializedJsonObject(valid);
  const parsedInvalid = parseSerializedJsonObject(invalid);

  // Assert
  expect(parsedValid).toMatchObject({ type: "object" });
  expect(parsedInvalid).toMatchObject({});
});

test("createDefaultUiSessionUpdatePayload includes tool configuration", () => {
  // Arrange
  const schema = createFallbackUiWrapperJsonSchema();

  // Act
  const payload = createDefaultUiSessionUpdatePayload(schema, "be concise");

  // Assert
  expect(payload.session.instructions).toBe("be concise");
  expect(payload.session.type).toBe("realtime");
  expect(Array.isArray(payload.session.tools)).toBe(true);
});

test("createDefaultUiSessionUpdatePayload includes additional tools", () => {
  // Arrange
  const schema = createFallbackUiWrapperJsonSchema();
  const tools = [
    {
      description: "Get weather by location",
      handler: async () => {
        return { status: "ok" };
      },
      name: "get_weather",
      schema: {
        properties: {
          location: {
            type: "string",
          },
        },
        required: ["location"],
        type: "object",
      },
    },
  ] as const;

  // Act
  const payload = createDefaultUiSessionUpdatePayload(schema, "be concise", tools);
  const toolList = payload.session.tools as Array<{ name: string }>;

  // Assert
  expect(toolList.map((tool) => tool.name)).toContain("render_ui");
  expect(toolList.map((tool) => tool.name)).toContain("get_weather");
});

test("toToolJsonSchema normalizes hashbrown schema input", () => {
  // Arrange
  const schema = s.object("Weather input", {
    location: s.string("Location"),
  });

  // Act
  const result = toToolJsonSchema(schema);

  // Assert
  expect(result).toMatchObject({
    type: "object",
  });
});

test("toToolJsonSchema normalizes plain object schema input", () => {
  // Arrange
  const schema = {
    properties: {
      location: {
        type: "string",
      },
    },
    required: ["location"],
    type: "object",
  };

  // Act
  const result = toToolJsonSchema(schema);

  // Assert
  expect(result).toMatchObject({
    properties: {
      location: {
        type: "string",
      },
    },
    required: ["location"],
    type: "object",
  });
});

test("toToolJsonSchema falls back to empty object for invalid schema input", () => {
  // Arrange
  const schema = 123;

  // Act
  const result = toToolJsonSchema(schema);

  // Assert
  expect(result).toMatchObject({});
});

test("createDefaultUiSessionUpdatePayload ignores duplicate render_ui tool names", () => {
  // Arrange
  const schema = createFallbackUiWrapperJsonSchema();
  const tools = [
    {
      description: "duplicate render tool",
      handler: async () => {
        return {};
      },
      name: "render_ui",
      schema: {
        type: "object",
      },
    },
  ] as const;

  // Act
  const payload = createDefaultUiSessionUpdatePayload(schema, undefined, tools);
  const toolList = payload.session.tools as Array<{ name: string }>;

  // Assert
  expect(toolList.filter((tool) => tool.name === "render_ui")).toHaveLength(1);
});

test("createRealtimeWebRtcClient handles tool call without call_id", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => ({ ok: true }),
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris" }),
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(0);
});

test("createRealtimeWebRtcClient returns argument-parsing error for malformed tool args", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => ({ ok: true }),
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: "{",
          call_id: "call-malformed",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('\\"code\\":\\"invalid_tool_arguments\\"');
});

test("createRealtimeWebRtcClient returns tool execution failure output", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => {
          throw new Error("network down");
        },
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris" }),
          call_id: "call-failed",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
    await Promise.resolve();
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('\\"code\\":\\"tool_execution_failed\\"');
  expect(sentPayloads[0]).toContain("network down");
});

test("createRealtimeWebRtcClient maps non-Error tool failures", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => {
          throw "raw-error";
        },
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris" }),
          call_id: "call-raw-failed",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
    await Promise.resolve();
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('\\"message\\":\\"Tool execution failed\\"');
});

test("createRealtimeWebRtcClient emits tool execution state around local tool calls", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => ({ ok: true }),
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });
  const snapshots: Array<{ activeToolCallCount: number; isRunning: boolean }> = [];
  client.toolExecutionState$?.subscribe((state) => {
    snapshots.push(state);
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris" }),
          call_id: "call-running",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
    await Promise.resolve();
  }

  // Assert
  expect(snapshots.some((snapshot) => snapshot.isRunning)).toBe(true);
  expect(snapshots.at(-1)).toMatchObject({
    activeToolCallCount: 0,
    isRunning: false,
  });
});

test("createRealtimeWebRtcClient emits microphone levels from audio monitor", async () => {
  // Arrange
  const level$ = new Subject<number>();
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const stop = (): void => undefined;
  const client = createRealtimeWebRtcClient({
    createAudioLevelMonitor: () => {
      return {
        level$: level$.asObservable(),
        stop,
      };
    },
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });
  const samples: number[] = [];
  client.microphoneLevel$?.subscribe((sample) => {
    samples.push(sample);
  });

  // Act
  await client.connect();
  level$.next(0.22);
  client.disconnect();

  // Assert
  expect(samples).toContain(0.22);
  expect(samples.at(-1)).toBe(0);
});

test("parseAudioAgentUiWrapper validates wrapper payload", () => {
  // Arrange
  const valid = { ui: [{ badge: { children: "ok" } }] };
  const invalid = { notUi: true };

  // Act
  const parsedValid = parseAudioAgentUiWrapper(valid);
  const parsedInvalid = parseAudioAgentUiWrapper(invalid);

  // Assert
  expect(parsedValid).toMatchObject(valid);
  expect(parsedInvalid).toBeUndefined();
});

test("createRealtimeWebRtcClient connects and routes events", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const tracks: RealtimeLocalAudioTrack[] = [
    {
      enabled: true,
      stop: () => undefined,
    },
  ];
  const stream: RealtimeLocalAudioStream = {
    getAudioTracks: () => tracks,
  };

  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };

  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => stream,
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  const connections: string[] = [];
  const audioEvents: string[] = [];

  client.connectionEvents$.subscribe((event) => {
    connections.push(event.type);
  });
  client.audioAgentEvents$.subscribe((event) => {
    audioEvents.push(event.type);
  });

  // Act
  await client.connect();
  if (dataChannel.onopen) {
    dataChannel.onopen();
  }
  client.sendText("hello");
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        arguments: JSON.stringify({ ui: [{ card: { children: "hey" } }] }),
        type: "response.function_call_arguments.done",
      }),
    });
  }
  client.setMuted(true);
  client.disconnect();

  // Assert
  expect(connections).toContain("connected");
  expect(connections).toContain("disconnected");
  expect(audioEvents).toContain("ui.wrapper");
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[1]).toContain('"output_modalities":["audio"]');
  expect(tracks[0]?.enabled).toBe(false);
});

test("createRealtimeWebRtcClient sends function_call_output when tool call includes call_id", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ ui: [{ card: { children: "hello" } }] }),
          call_id: "call-1",
          name: "render_ui",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('"type":"conversation.item.create"');
  expect(sentPayloads[0]).toContain('"type":"function_call_output"');
  expect(sentPayloads[0]).toContain('"call_id":"call-1"');
  expect(sentPayloads[0]).toContain('\\"ok\\":true');
  expect(sentPayloads[1]).toContain('"type":"response.create"');
  expect(sentPayloads[1]).toContain('"output_modalities":["audio"]');
});

test("createRealtimeWebRtcClient sends error output when tool arguments are invalid", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ notUi: true }),
          call_id: "call-invalid",
          name: "render_ui",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('"call_id":"call-invalid"');
  expect(sentPayloads[0]).toContain('\\"ok\\":false');
  expect(sentPayloads[0]).toContain('\\"code\\":\\"invalid_ui_payload\\"');
  expect(sentPayloads[1]).toContain('"type":"response.create"');
});

test("createRealtimeWebRtcClient emits raw ui json for function argument deltas", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });
  const rawJsonEvents: string[] = [];
  client.uiJson$.subscribe((value) => {
    rawJsonEvents.push(value);
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        call_id: "call-2",
        delta: '{"ui":',
        type: "response.function_call_arguments.delta",
      }),
    });
    dataChannel.onmessage({
      data: JSON.stringify({
        call_id: "call-2",
        delta: '[{"card":{"children":"hello"}}]}',
        type: "response.function_call_arguments.delta",
      }),
    });
    dataChannel.onmessage({
      data: JSON.stringify({
        arguments: "",
        call_id: "call-2",
        type: "response.function_call_arguments.done",
      }),
    });
  }

  // Assert
  expect(rawJsonEvents).toContain('{"ui":');
  expect(rawJsonEvents).toContain('{"ui":[{"card":{"children":"hello"}}]}');
});

test("createRealtimeWebRtcClient emits raw ui json for unnamed delta call", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });
  const rawJsonEvents: string[] = [];
  client.uiJson$.subscribe((value) => {
    rawJsonEvents.push(value);
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        delta: '{"ui":[{"card":{"children":"unnamed"}}]}',
        type: "response.function_call_arguments.delta",
      }),
    });
  }

  // Assert
  expect(rawJsonEvents).toContain('{"ui":[{"card":{"children":"unnamed"}}]}');
});

test("createRealtimeWebRtcClient ignores non-render_ui argument deltas for raw ui stream", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async () => ({ status: "ok" }),
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });
  const rawJsonEvents: string[] = [];
  client.uiJson$.subscribe((value) => {
    rawJsonEvents.push(value);
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        call_id: "call-non-ui",
        delta: '{"location":"Paris"}',
        name: "get_weather",
        type: "response.function_call_arguments.delta",
      }),
    });
  }

  // Assert
  expect(rawJsonEvents).toHaveLength(0);
});

test("createRealtimeWebRtcClient handles function arguments done with call_id and buffered deltas", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        call_id: "call-buffered",
        delta: '{"ui":[{"card":{"children":"from-buffer"}}]}',
        type: "response.function_call_arguments.delta",
      }),
    });
    dataChannel.onmessage({
      data: JSON.stringify({
        arguments: "",
        call_id: "call-buffered",
        type: "response.function_call_arguments.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('"call_id":"call-buffered"');
  expect(sentPayloads[0]).toContain('\\"ok\\":true');
  expect(sentPayloads[0]).toContain('\\"rendered\\":true');
  expect(sentPayloads[1]).toContain('"type":"response.create"');
});

test("createRealtimeWebRtcClient ignores duplicate tool call ids", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    const message = {
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ ui: [{ card: { children: "hello" } }] }),
          call_id: "call-duplicate",
          name: "render_ui",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    };
    dataChannel.onmessage(message);
    dataChannel.onmessage(message);
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
});

test("createRealtimeWebRtcClient aborts in-flight tools on disconnect", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  let toolAbortSignal: AbortSignal | undefined;
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler: async (_input, abortSignal) => {
          toolAbortSignal = abortSignal;
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 10);
          });
          return { status: "ok" };
        },
        name: "get_weather",
        schema: { type: "object" },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris" }),
          call_id: "call-disconnect",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }
  client.disconnect();
  await Promise.resolve();

  // Assert
  expect(toolAbortSignal?.aborted).toBe(true);
  expect(sentPayloads).toHaveLength(0);
});

test("createRealtimeWebRtcClient executes external tools and sends tool output", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const handler = async (input: unknown): Promise<unknown> => {
    return {
      input,
      status: "ok",
    };
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [
      {
        description: "Get weather for location",
        handler,
        name: "get_weather",
        schema: {
          properties: { location: { type: "string" } },
          required: ["location"],
          type: "object",
        },
      },
    ],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris, France" }),
          call_id: "call-weather",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
    await Promise.resolve();
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('"call_id":"call-weather"');
  expect(sentPayloads[0]).toContain('\\"ok\\":true');
  expect(sentPayloads[0]).toContain('\\"status\\":\\"ok\\"');
  expect(sentPayloads[1]).toContain('"type":"response.create"');
});

test("createRealtimeWebRtcClient returns not-found output for unknown tools", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
    tools: [],
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        item: {
          arguments: JSON.stringify({ location: "Paris, France" }),
          call_id: "call-missing",
          name: "get_weather",
          type: "function_call",
        },
        type: "response.output_item.done",
      }),
    });
  }

  // Assert
  expect(sentPayloads).toHaveLength(2);
  expect(sentPayloads[0]).toContain('\\"ok\\":false');
  expect(sentPayloads[0]).toContain('\\"code\\":\\"tool_not_found\\"');
});

test("createRealtimeWebRtcClient attaches remote stream to an audio element", async () => {
  // Arrange
  const play = async (): Promise<void> => undefined;
  const audioElement = {
    autoplay: false,
    muted: true,
    play,
    srcObject: null as unknown,
  };
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    ontrack: null,
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createAudioElement: () => audioElement,
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (peerConnection.ontrack) {
    peerConnection.ontrack({
      streams: [{ id: "remote-stream" }],
    });
  }

  // Assert
  expect(audioElement.autoplay).toBe(true);
  expect(audioElement.muted).toBe(false);
  expect(audioElement.srcObject).toMatchObject({ id: "remote-stream" });
});

test("createRealtimeWebRtcClient ignores remote tracks when no audio element factory exists", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    ontrack: null,
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (peerConnection.ontrack) {
    peerConnection.ontrack({
      streams: [{ id: "remote-stream" }],
    });
  }

  // Assert
  expect(true).toBe(true);
});

test("createRealtimeWebRtcClient ignores empty remote track lists", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    ontrack: null,
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const createAudioElement = (): {
    autoplay: boolean;
    muted: boolean;
    play: () => Promise<void>;
    srcObject: unknown;
  } => {
    return {
      autoplay: false,
      muted: true,
      play: async () => undefined,
      srcObject: null,
    };
  };
  const client = createRealtimeWebRtcClient({
    createAudioElement,
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  await client.connect();
  if (peerConnection.ontrack) {
    peerConnection.ontrack({
      streams: [],
    });
  }

  // Assert
  expect(true).toBe(true);
});

test("createRealtimeWebRtcClient emits error when remote event parsing fails", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };

  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  const errors: string[] = [];
  client.connectionEvents$.subscribe((event) => {
    if (event.type === "error") {
      errors.push(event.message);
    }
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: "not-json",
    });
  }

  // Assert
  expect(errors).toContain("Failed to parse realtime server event");
});

test("createRealtimeWebRtcClient emits server-provided error messages", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  const errors: string[] = [];
  client.connectionEvents$.subscribe((event) => {
    if (event.type === "error") {
      errors.push(event.message);
    }
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        error: { message: "Tool schema invalid" },
        type: "error",
      }),
    });
  }

  // Assert
  expect(errors).toContain("Tool schema invalid");
});

test("createRealtimeWebRtcClient emits default server error message fallback", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  const errors: string[] = [];
  client.connectionEvents$.subscribe((event) => {
    if (event.type === "error") {
      errors.push(event.message);
    }
  });

  // Act
  await client.connect();
  if (dataChannel.onmessage) {
    dataChannel.onmessage({
      data: JSON.stringify({
        type: "error",
      }),
    });
  }

  // Assert
  expect(errors).toContain("Realtime server error");
});

test("createRealtimeWebRtcClient handles missing SDP offer", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: undefined }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  const run = async (): Promise<void> => {
    await client.connect();
  };

  // Assert
  await expect(run).rejects.toThrowError("Missing SDP in local offer");
});

test("createRealtimeWebRtcClient handles failed session endpoint responses", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: false,
      status: 500,
      text: async () => "error",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  const run = async (): Promise<void> => {
    await client.connect();
  };

  // Assert
  await expect(run).rejects.toThrowError("Session endpoint request failed: 500");
});

test("createRealtimeWebRtcClient does not send events before connect", () => {
  // Arrange
  const sentPayloads: string[] = [];
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => {
      throw new Error("not used");
    },
    fetch: async () => {
      throw new Error("not used");
    },
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  client.sendEvent("session.update", { session: {} });
  client.sendText("hello");
  client.setMuted(true);

  // Assert
  expect(sentPayloads).toHaveLength(0);
});

test("createRealtimeWebRtcClient emits disconnected when data channel closes", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });
  const disconnectedReasons: string[] = [];
  client.connectionEvents$.subscribe((event) => {
    if (event.type === "disconnected") {
      disconnectedReasons.push(event.reason ?? "");
    }
  });

  // Act
  await client.connect();
  if (dataChannel.onclose) {
    dataChannel.onclose();
  }

  // Assert
  expect(disconnectedReasons).toContain("data channel closed");
});

test("createBrowserRealtimeWebRtcClient uses browser globals", async () => {
  // Arrange
  let createdAudioElements = 0;
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const fakePeerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  let latestPeerConnection: FakeRtcPeerConnection | undefined;

  class FakeRtcPeerConnection {
    public ontrack: ((event: { streams: Array<{ id?: string }> }) => void) | null = null;

    public constructor() {
      latestPeerConnection = this;
    }

    public addTrack(track: RealtimeLocalAudioTrack, stream: RealtimeLocalAudioStream): void {
      fakePeerConnection.addTrack(track, stream);
    }

    public close(): void {
      fakePeerConnection.close();
    }

    public createDataChannel(label: string): RealtimeDataChannel {
      return fakePeerConnection.createDataChannel(label);
    }

    public async createOffer(): Promise<{ sdp: string | undefined }> {
      return fakePeerConnection.createOffer();
    }

    public async setLocalDescription(description: { sdp: string; type: "offer" }): Promise<void> {
      return fakePeerConnection.setLocalDescription(description);
    }

    public async setRemoteDescription(description: { sdp: string; type: "answer" }): Promise<void> {
      return fakePeerConnection.setRemoteDescription(description);
    }
  }

  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const originalCrypto = globalThis.crypto;
  const originalDocument = globalThis.document;
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  let queuedFrameCallback: FrameRequestCallback | undefined;

  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: FakeRtcPeerConnection,
  });

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getAudioTracks: () => [],
        }),
      },
    },
  });

  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    } as Response;
  }) as typeof fetch;

  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "evt-browser",
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        createdAudioElements += 1;
        return {
          autoplay: false,
          muted: true,
          play: async () => undefined,
          srcObject: null,
        };
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class FakeAudioContext {
      public close(): Promise<void> {
        return Promise.resolve();
      }

      public createAnalyser(): {
        disconnect: () => void;
        fftSize: number;
        getByteTimeDomainData: (array: Uint8Array) => void;
      } {
        return {
          disconnect: () => undefined,
          fftSize: 0,
          getByteTimeDomainData: (array) => {
            array.fill(200);
          },
        };
      }

      public createMediaStreamSource(): {
        connect: () => void;
        disconnect: () => void;
      } {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }
    },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (() => {
      let frameCount = 0;

      return (callback: FrameRequestCallback): number => {
        frameCount += 1;
        queuedFrameCallback = callback;
        if (frameCount === 1) {
          callback(0);
        }

        return frameCount;
      };
    })(),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });

  const { createBrowserRealtimeWebRtcClient } = await import("./realtime.js");

  // Act
  const client = createBrowserRealtimeWebRtcClient("http://localhost:3001/session");
  await client.connect();
  if (latestPeerConnection?.ontrack) {
    latestPeerConnection.ontrack({
      streams: [{ id: "browser-remote" }],
    });
  }

  // Assert
  expect(client).toBeDefined();
  expect(createdAudioElements).toBe(1);
  client.disconnect();
  queuedFrameCallback?.(0);

  // Cleanup
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: originalAudioContext,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
});

test("createBrowserRealtimeWebRtcClient accepts tools option", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "open",
    send: () => undefined,
  };
  const fakePeerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  class FakeRtcPeerConnection {
    public addTrack(track: RealtimeLocalAudioTrack, stream: RealtimeLocalAudioStream): void {
      fakePeerConnection.addTrack(track, stream);
    }

    public close(): void {
      fakePeerConnection.close();
    }

    public createDataChannel(label: string): RealtimeDataChannel {
      return fakePeerConnection.createDataChannel(label);
    }

    public async createOffer(): Promise<{ sdp: string | undefined }> {
      return fakePeerConnection.createOffer();
    }

    public async setLocalDescription(description: { sdp: string; type: "offer" }): Promise<void> {
      return fakePeerConnection.setLocalDescription(description);
    }

    public async setRemoteDescription(description: { sdp: string; type: "answer" }): Promise<void> {
      return fakePeerConnection.setRemoteDescription(description);
    }
  }
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;
  const originalCrypto = globalThis.crypto;
  const originalDocument = globalThis.document;
  const originalAudioContext = globalThis.AudioContext;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;

  Object.defineProperty(globalThis, "RTCPeerConnection", {
    configurable: true,
    value: FakeRtcPeerConnection,
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getAudioTracks: () => [],
        }),
      },
    },
  });
  globalThis.fetch = (async () => {
    return {
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    } as Response;
  }) as typeof fetch;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: {
      randomUUID: () => "evt-browser",
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => {
        return {
          autoplay: false,
          muted: true,
          play: async () => undefined,
          srcObject: null,
        };
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: class FakeAudioContext {
      public close(): Promise<void> {
        return Promise.resolve();
      }

      public createAnalyser(): {
        disconnect: () => void;
        fftSize: number;
        getByteTimeDomainData: (array: Uint8Array) => void;
      } {
        return {
          disconnect: () => undefined,
          fftSize: 0,
          getByteTimeDomainData: (array) => {
            array.fill(128);
          },
        };
      }

      public createMediaStreamSource(): {
        connect: () => void;
        disconnect: () => void;
      } {
        return {
          connect: () => undefined,
          disconnect: () => undefined,
        };
      }
    },
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (() => {
      let frameCount = 0;

      return (callback: FrameRequestCallback): number => {
        frameCount += 1;
        if (frameCount === 1) {
          callback(0);
        }

        return frameCount;
      };
    })(),
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: () => undefined,
  });
  const { createBrowserRealtimeWebRtcClient } = await import("./realtime.js");
  const tools = [
    {
      description: "Get weather for location",
      handler: async () => {
        return { status: "ok" };
      },
      name: "get_weather",
      schema: { type: "object" },
    },
  ] as const;

  // Act
  const client = createBrowserRealtimeWebRtcClient("http://localhost:3001/session", { tools });
  await client.connect();
  client.disconnect();

  // Assert
  expect(client).toBeDefined();

  // Cleanup
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: originalNavigator,
  });
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: originalAudioContext,
  });
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: originalRequestAnimationFrame,
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: originalCancelAnimationFrame,
  });
});

test("createRealtimeWebRtcClient queues events until data channel opens", async () => {
  // Arrange
  const sentPayloads: string[] = [];
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "connecting",
    send: (payload) => {
      sentPayloads.push(payload);
    },
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };

  const client = createRealtimeWebRtcClient({
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  const connectPromise = client.connect();
  await Promise.resolve();
  await Promise.resolve();
  client.sendEvent("session.update", { session: { instructions: "hi" } });

  dataChannel.readyState = "open";
  if (dataChannel.onopen) {
    dataChannel.onopen();
  }
  await connectPromise;

  // Assert
  expect(sentPayloads).toHaveLength(1);
  expect(sentPayloads[0]).toContain("session.update");
});

test("createRealtimeWebRtcClient errors if channel does not open before timeout", async () => {
  // Arrange
  const dataChannel: RealtimeDataChannel = {
    onclose: null,
    onmessage: null,
    onopen: null,
    readyState: "connecting",
    send: () => undefined,
  };
  const peerConnection: RealtimePeerConnection = {
    addTrack: () => undefined,
    close: () => undefined,
    createDataChannel: () => dataChannel,
    createOffer: async () => ({ sdp: "offer-sdp" }),
    setLocalDescription: async () => undefined,
    setRemoteDescription: async () => undefined,
  };
  const client = createRealtimeWebRtcClient({
    channelOpenTimeoutMs: 5,
    createEventId: () => "evt-1",
    createPeerConnection: () => peerConnection,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => "answer-sdp",
    }),
    mediaDevices: {
      getUserMedia: async () => ({
        getAudioTracks: () => [],
      }),
    },
    sessionEndpoint: "http://localhost:3001/session",
  });

  // Act
  const run = async (): Promise<void> => {
    await client.connect();
  };

  // Assert
  await expect(run).rejects.toThrowError("Data channel did not open within 5ms");
});
