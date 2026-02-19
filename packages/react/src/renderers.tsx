import type { ToolCall } from "@frenchfry/core";
import { type ComponentType, type ReactNode, createElement } from "react";

/**
 * Renderer component contract for a specific tool call payload.
 */
export type ToolRenderer = ComponentType<{ arguments: Record<string, unknown>; id: string }>;

/**
 * Lookup map between tool names and renderers.
 */
export type ToolRendererRegistry = Record<string, ToolRenderer>;

/**
 * Creates an immutable renderer registry from a user-provided map.
 *
 * @param renderers Tool-name-to-component mapping.
 * @returns Frozen registry map used by rendering helpers.
 */
export function createToolRendererRegistry(renderers: ToolRendererRegistry): ToolRendererRegistry {
  return Object.freeze({ ...renderers });
}

/**
 * Converts a parsed tool call into a React element using a renderer registry.
 *
 * @param toolCall Parsed tool call from core runtime.
 * @param registry Renderer registry.
 * @param fallback Optional fallback node when no renderer is registered.
 * @returns React node for the tool call.
 */
export function renderToolCall(
  toolCall: ToolCall,
  registry: ToolRendererRegistry,
  fallback: ReactNode = null,
): ReactNode {
  const renderer = registry[toolCall.name];

  if (!renderer) {
    return fallback;
  }

  return createElement(renderer, {
    arguments: toolCall.arguments,
    id: toolCall.id,
  });
}
