import { expect, test } from "vitest";

import { parseToolCall } from "./tools.js";

test("parseToolCall returns normalized payload", () => {
  // Arrange
  const input = {
    arguments: { city: "Paris" },
    id: "tool-1",
    name: "lookup_weather",
  };

  // Act
  const toolCall = parseToolCall(input);

  // Assert
  expect(toolCall.id).toBe("tool-1");
  expect(toolCall.name).toBe("lookup_weather");
  expect(toolCall.arguments.city).toBe("Paris");
});

test("parseToolCall rejects missing fields", () => {
  // Arrange
  const input = { id: "tool-1", name: "lookup_weather" };

  // Act
  const run = (): unknown => parseToolCall(input);

  // Assert
  expect(run).toThrowError();
});
