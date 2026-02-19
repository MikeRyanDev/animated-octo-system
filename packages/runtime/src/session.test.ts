import { expect, test } from "vitest";

import { buildRealtimeSessionRequest, getOpenAIApiKey } from "./session.js";

test("getOpenAIApiKey reads a non-empty API key", () => {
  // Arrange
  const env = { OPENAI_API_KEY: "sk-test" };

  // Act
  const apiKey = getOpenAIApiKey(env);

  // Assert
  expect(apiKey).toBe("sk-test");
});

test("getOpenAIApiKey rejects missing API key", () => {
  // Arrange
  const env = {};

  // Act
  const run = (): unknown => getOpenAIApiKey(env);

  // Assert
  expect(run).toThrowError();
});

test("buildRealtimeSessionRequest validates and serializes payload", () => {
  // Arrange
  const payload = { model: "gpt-realtime", voice: "alloy" };

  // Act
  const request = buildRealtimeSessionRequest("sk-test", payload);

  // Assert
  expect(request.url).toBe("https://api.openai.com/v1/realtime/sessions");
  expect(request.init.method).toBe("POST");
  expect(request.init.headers).toMatchObject({
    Authorization: "Bearer sk-test",
    "Content-Type": "application/json",
  });
  expect(request.init.body).toBe(JSON.stringify(payload));
});

test("buildRealtimeSessionRequest rejects invalid payload", () => {
  // Arrange
  const payload = { model: "" };

  // Act
  const run = (): unknown => buildRealtimeSessionRequest("sk-test", payload);

  // Assert
  expect(run).toThrowError();
});
