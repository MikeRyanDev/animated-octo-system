import { z } from "zod";

const envSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
});

/**
 * Runtime schema for OpenAI Realtime session creation payload.
 */
export const openAiSessionPayloadSchema = z.object({
  instructions: z.string().optional(),
  model: z.string().min(1),
  voice: z.string().optional(),
});

/**
 * Validated payload shape for session creation.
 */
export type OpenAiSessionPayload = z.infer<typeof openAiSessionPayloadSchema>;

/**
 * Reads and validates the OpenAI API key from environment variables.
 *
 * @param env Environment variable object.
 * @returns Non-empty OpenAI API key.
 */
export function getOpenAIApiKey(env: NodeJS.ProcessEnv): string {
  const parsed = envSchema.parse({ OPENAI_API_KEY: env.OPENAI_API_KEY });
  return parsed.OPENAI_API_KEY;
}

/**
 * Builds a normalized request object for OpenAI Realtime session creation.
 *
 * @param apiKey OpenAI API key used by server-side proxy runtime.
 * @param payload Client-provided session payload to validate.
 * @returns URL and request init values for `fetch`.
 */
export function buildRealtimeSessionRequest(
  apiKey: string,
  payload: unknown,
): {
  init: RequestInit;
  url: string;
} {
  const validatedPayload = openAiSessionPayloadSchema.parse(payload);

  return {
    init: {
      body: JSON.stringify(validatedPayload),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    url: "https://api.openai.com/v1/realtime/sessions",
  };
}
