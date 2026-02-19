import { z } from "zod";

const realtimeAudioOutputSchema = z.object({
  voice: z.string().min(1),
});

const realtimeAudioSchema = z.object({
  output: realtimeAudioOutputSchema.optional(),
});

/**
 * Runtime schema for OpenAI Realtime session configuration used by calls and client-secret minting.
 */
export const realtimeUnifiedCallSessionSchema = z.object({
  audio: realtimeAudioSchema.optional(),
  instructions: z.string().optional(),
  model: z.string().min(1),
  type: z.literal("realtime"),
});

/**
 * Runtime schema for OpenAI client-secret minting requests.
 */
export const realtimeClientSecretRequestSchema = z.object({
  session: realtimeUnifiedCallSessionSchema,
});

const unifiedWebRtcCallRequestSchema = z.object({
  sdp: z.string().min(1),
  session: realtimeUnifiedCallSessionSchema,
});

/**
 * Validated session model used by OpenAI Realtime request builders.
 */
export type RealtimeUnifiedCallSession = z.infer<typeof realtimeUnifiedCallSessionSchema>;

/**
 * Builds a server-side request for ephemeral Realtime client secrets.
 *
 * @param apiKey Standard server-side OpenAI API key.
 * @param payload Unknown payload to validate as client-secret input.
 * @returns URL and request init values for `fetch`.
 */
export function buildClientSecretRequest(
  apiKey: string,
  payload: unknown,
): {
  init: RequestInit;
  url: string;
} {
  const validatedPayload = realtimeClientSecretRequestSchema.parse(payload);

  return {
    init: {
      body: JSON.stringify(validatedPayload),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    },
    url: "https://api.openai.com/v1/realtime/client_secrets",
  };
}

/**
 * Builds a server-side unified-interface WebRTC call request.
 *
 * @param apiKey Standard server-side OpenAI API key.
 * @param payload Unknown payload containing browser offer SDP and validated session configuration.
 * @returns URL and request init values for `fetch`.
 */
export function buildUnifiedWebRtcCallRequest(
  apiKey: string,
  payload: unknown,
): {
  init: RequestInit;
  url: string;
} {
  const validatedPayload = unifiedWebRtcCallRequestSchema.parse(payload);
  const formData = new FormData();

  formData.set("sdp", validatedPayload.sdp);
  formData.set("session", JSON.stringify(validatedPayload.session));

  return {
    init: {
      body: formData,
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      method: "POST",
    },
    url: "https://api.openai.com/v1/realtime/calls",
  };
}
