import { parseToolCall } from "@frenchfry/core";
import type { ReactElement } from "react";
import { isValidElement } from "react";
import { expect, test } from "vitest";

import { createToolRendererRegistry, renderToolCall } from "./renderers.js";

test("createToolRendererRegistry returns an immutable map", () => {
  // Arrange
  const registry = createToolRendererRegistry({
    render_weather: () => null,
  });

  // Act
  const mutateRegistry = (): void => {
    Object.assign(registry, {
      render_weather: () => "changed",
    });
  };

  // Assert
  expect(Object.isFrozen(registry)).toBe(true);
  expect(mutateRegistry).toThrowError();
});

test("renderToolCall returns fallback when no renderer exists", () => {
  // Arrange
  const toolCall = parseToolCall({
    arguments: { city: "Paris" },
    id: "tool-1",
    name: "render_weather",
  });
  const registry = createToolRendererRegistry({});

  // Act
  const result = renderToolCall(toolCall, registry, "fallback");

  // Assert
  expect(result).toBe("fallback");
});

test("renderToolCall returns a react element when renderer exists", () => {
  // Arrange
  const toolCall = parseToolCall({
    arguments: { city: "Paris" },
    id: "tool-1",
    name: "render_weather",
  });
  const WeatherRenderer = ({ id }: { arguments: Record<string, unknown>; id: string }) => id;
  const registry = createToolRendererRegistry({
    render_weather: WeatherRenderer,
  });

  // Act
  const element = renderToolCall(toolCall, registry, null);

  // Assert
  expect(isValidElement(element)).toBe(true);
  if (!isValidElement(element)) {
    throw new Error("Expected a valid React element");
  }
  const typedElement = element as ReactElement<{ id: string }>;
  expect(typedElement.type).toBe(WeatherRenderer);
  expect(typedElement.props.id).toBe("tool-1");
});
