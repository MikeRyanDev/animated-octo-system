import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotEnv } from "dotenv";

import {
  buildUnifiedWebRtcCallRequest,
  getOpenAIApiKey,
  realtimeUnifiedCallSessionSchema,
} from "@frenchfry/runtime";

const currentDirectory = dirname(fileURLToPath(import.meta.url));
loadDotEnv({ path: resolve(currentDirectory, "../../../.env") });

/**
 * Runtime configuration for the demo server.
 */
export interface DemoServerConfig {
  model: string;
  port: number;
  voice: string;
}

/**
 * Resolves runtime configuration from environment variables.
 *
 * @param env Node process environment.
 * @returns Validated demo server config.
 */
export function resolveDemoServerConfig(env: NodeJS.ProcessEnv): DemoServerConfig {
  const model = env.REALTIME_MODEL ?? "gpt-realtime";
  const port = Number.parseInt(env.DEMO_SERVER_PORT ?? "3001", 10);
  const voice = env.REALTIME_VOICE ?? "marin";

  return {
    model,
    port: Number.isFinite(port) ? port : 3001,
    voice,
  };
}

/**
 * Reads request text body as UTF-8.
 *
 * @param request Incoming HTTP request.
 * @returns Raw request body.
 */
export async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Writes common JSON response headers.
 *
 * @param response Node response object.
 * @param statusCode HTTP status code.
 */
export function writeJsonHeaders(response: ServerResponse, statusCode: number): void {
  response.writeHead(statusCode, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
  });
}

/**
 * Starts the demo server that proxies unified WebRTC SDP exchange to OpenAI.
 *
 * @param env Node process environment.
 * @returns Running HTTP server instance.
 */
export function startDemoServer(env: NodeJS.ProcessEnv): ReturnType<typeof createServer> {
  const config = resolveDemoServerConfig(env);
  const apiKey = getOpenAIApiKey(env);

  const server = createServer(async (request, response) => {
    const method = request.method ?? "GET";
    const url = request.url ?? "/";

    if (method === "OPTIONS") {
      writeJsonHeaders(response, 204);
      response.end();
      return;
    }

    if (method === "GET" && url === "/health") {
      writeJsonHeaders(response, 200);
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (method === "POST" && url === "/session") {
      try {
        const offerSdp = await readRequestBody(request);

        if (!offerSdp) {
          writeJsonHeaders(response, 400);
          response.end(JSON.stringify({ error: "Missing SDP offer payload" }));
          return;
        }

        const session = realtimeUnifiedCallSessionSchema.parse({
          audio: {
            output: {
              voice: config.voice,
            },
          },
          model: config.model,
          type: "realtime",
        });

        const sessionRequest = buildUnifiedWebRtcCallRequest(apiKey, {
          sdp: offerSdp,
          session,
        });

        const openAiResponse = await fetch(sessionRequest.url, sessionRequest.init);
        const answerSdp = await openAiResponse.text();

        response.writeHead(openAiResponse.status, {
          "Access-Control-Allow-Headers": "Content-Type",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Origin": "*",
          "Content-Type": "application/sdp; charset=utf-8",
        });
        response.end(answerSdp);
      } catch (error) {
        writeJsonHeaders(response, 500);
        response.end(
          JSON.stringify({
            error: error instanceof Error ? error.message : "Unknown session error",
          }),
        );
      }
      return;
    }

    writeJsonHeaders(response, 404);
    response.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(config.port);

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = startDemoServer(process.env);
  const config = resolveDemoServerConfig(process.env);

  process.stdout.write(
    `Frenchfry demo server running on http://localhost:${config.port.toString()}\n`,
  );

  process.on("SIGINT", () => {
    server.close(() => {
      process.exit(0);
    });
  });
}
