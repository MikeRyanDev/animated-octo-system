import { z } from "zod";

/**
 * Runtime schema for a tool call payload received from the model.
 */
export const toolCallSchema = z.object({
  arguments: z.record(z.string(), z.unknown()),
  id: z.string().min(1),
  name: z.string().min(1),
});

/**
 * Tool call normalized by the core package.
 */
export type ToolCall = z.infer<typeof toolCallSchema>;

/**
 * Parses unknown input into a validated tool call.
 *
 * @param input Unknown external value.
 * @returns Validated tool call payload.
 */
export function parseToolCall(input: unknown): ToolCall {
  return toolCallSchema.parse(input);
}
