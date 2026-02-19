import { expect, test } from "vitest";

import {
  buildClientSecretRequest,
  buildUnifiedWebRtcCallRequest,
  realtimeClientSecretRequestSchema,
  realtimeUnifiedCallSessionSchema,
} from "./realtime.js";

test("buildClientSecretRequest builds request for ephemeral client secret", () => {
  // Arrange
  const payload = {
    session: {
      audio: {
        output: {
          voice: "marin",
        },
      },
      model: "gpt-realtime",
      type: "realtime",
    },
  };

  // Act
  const request = buildClientSecretRequest("sk-test", payload);

  // Assert
  expect(request.url).toBe("https://api.openai.com/v1/realtime/client_secrets");
  expect(request.init.method).toBe("POST");
  expect(request.init.headers).toMatchObject({
    Authorization: "Bearer sk-test",
    "Content-Type": "application/json",
  });
  expect(request.init.body).toBe(JSON.stringify(payload));
});

test("buildUnifiedWebRtcCallRequest builds multipart request for unified WebRTC", () => {
  // Arrange
  const session = {
    model: "gpt-realtime",
    type: "realtime",
  };

  // Act
  const request = buildUnifiedWebRtcCallRequest("sk-test", {
    sdp: "v=0",
    session,
  });

  // Assert
  expect(request.url).toBe("https://api.openai.com/v1/realtime/calls");
  expect(request.init.method).toBe("POST");
  expect(request.init.headers).toMatchObject({
    Authorization: "Bearer sk-test",
  });
  expect(request.init.body).toBeInstanceOf(FormData);

  const body = request.init.body;
  if (!(body instanceof FormData)) {
    throw new Error("Expected form data body");
  }

  expect(body.get("sdp")).toBe("v=0");
  expect(body.get("session")).toBe(JSON.stringify(session));
});

test("schemas reject invalid realtime payloads", () => {
  // Arrange
  const invalidClientSecretPayload = { session: { model: "" } };
  const invalidUnifiedPayload = { model: "" };

  // Act
  const parseClientSecret = (): unknown =>
    realtimeClientSecretRequestSchema.parse(invalidClientSecretPayload);
  const parseUnified = (): unknown => realtimeUnifiedCallSessionSchema.parse(invalidUnifiedPayload);

  // Assert
  expect(parseClientSecret).toThrowError();
  expect(parseUnified).toThrowError();
});
