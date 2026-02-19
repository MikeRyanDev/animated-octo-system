import { parseToolCall } from "@frenchfry/core";
import { createToolRendererRegistry, renderToolCall } from "@frenchfry/react";
import type { ReactNode } from "react";

const registry = createToolRendererRegistry({
  show_text: ({ arguments: args, id }: { arguments: Record<string, unknown>; id: string }) => {
    const textValue = typeof args.text === "string" ? args.text : "";
    return `${id}: ${textValue}`;
  },
});

/**
 * Demo React entry component for rendering tool output.
 *
 * @returns Demo UI tree.
 */
export function App(): ReactNode {
  const toolCall = parseToolCall({
    arguments: { text: "Frenchfry demo" },
    id: "demo-1",
    name: "show_text",
  });

  return renderToolCall(toolCall, registry, "No renderer");
}
