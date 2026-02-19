import {
  type OpenAiSessionPayload,
  buildRealtimeSessionRequest,
  getOpenAIApiKey,
} from "@frenchfry/runtime";

/**
 * Builds a Realtime session request from environment and validated payload.
 *
 * @param env Process environment for API key lookup.
 * @param payload Session payload forwarded to OpenAI.
 * @returns URL and fetch init object for session creation.
 */
export function createRealtimeSessionRequestFromEnv(
  env: NodeJS.ProcessEnv,
  payload: OpenAiSessionPayload,
): {
  init: RequestInit;
  url: string;
} {
  const apiKey = getOpenAIApiKey(env);
  return buildRealtimeSessionRequest(apiKey, payload);
}
