// A local HTTP server that imitates the LM Studio endpoints vix uses. Test code only:
// it lets the client be tested end to end without LM Studio running.

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { type Config, type ConfigInput, configSchema } from "../config/index.ts";
import type { SessionState } from "../contracts/index.ts";

export interface FakeModel {
  key: string;
  type?: "llm" | "embedding";
  maxContextLength?: number;
  vision?: boolean;
  loadedContextLengths?: number[];
}

export interface FakeServerOptions {
  /** When set, requests must carry exactly this bearer token. */
  requiredToken?: string;
  models?: FakeModel[];
  /** Keys whose load request fails with a 500. */
  failingLoads?: string[];
  /** Server-sent event payloads for each chat request, `[DONE]` is appended. */
  chatChunks?: unknown[];
  /** Keep the chat stream open after the chunks, to test cancellation. */
  holdChatOpen?: boolean;
  /** Answer 404 on the v1 API, like LM Studio before 0.4.0. */
  withoutV1Api?: boolean;
}

export interface RecordedRequest {
  method: string;
  path: string;
  authorization: string | undefined;
  body: unknown;
}

interface Instance {
  id: string;
  contextLength: number;
}

export class FakeLmStudioServer {
  readonly requests: RecordedRequest[] = [];
  /** Resolves when a held-open chat stream is closed by the client. */
  chatClosed: Promise<void> = Promise.resolve();
  private readonly server: Server;
  private readonly instances = new Map<string, Instance[]>();
  private instanceCounter = 0;

  private readonly options: FakeServerOptions;

  constructor(options: FakeServerOptions = {}) {
    this.options = options;
    for (const model of options.models ?? []) {
      this.instances.set(
        model.key,
        (model.loadedContextLengths ?? []).map((contextLength) =>
          this.newInstance(model.key, contextLength),
        ),
      );
    }
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
  }

  async start(): Promise<string> {
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    const { port } = this.server.address() as AddressInfo;
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  loadedContextLengths(key: string): number[] {
    return (this.instances.get(key) ?? []).map((instance) => instance.contextLength);
  }

  private newInstance(key: string, contextLength: number): Instance {
    this.instanceCounter += 1;
    return {
      id: this.instanceCounter === 1 ? key : `${key}:${this.instanceCounter}`,
      contextLength,
    };
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await readBody(request);
    const path = request.url ?? "/";
    this.requests.push({
      method: request.method ?? "GET",
      path,
      authorization: request.headers.authorization,
      body,
    });
    if (!this.authorized(request.headers.authorization, response)) return;
    if (this.options.withoutV1Api && path.startsWith("/api/v1/")) {
      return sendJson(response, 404, { error: "Unexpected endpoint or method." });
    }
    if (path === "/api/v1/models") return sendJson(response, 200, { models: this.modelList() });
    if (path === "/api/v1/models/load") return this.load(body as Record<string, unknown>, response);
    if (path === "/api/v1/models/unload")
      return this.unload(body as Record<string, unknown>, response);
    if (path === "/v1/chat/completions") return this.chat(response);
    sendJson(response, 404, { error: "Unexpected endpoint or method." });
  }

  /** Mirrors LM Studio, which echoes a malformed token back in its error message. */
  private authorized(header: string | undefined, response: ServerResponse): boolean {
    const required = this.options.requiredToken;
    if (!required || header === `Bearer ${required}`) return true;
    const message = header
      ? `Malformed LM Studio API token provided: ${header.replace("Bearer ", "")}.`
      : "An LM Studio API token is required to make requests to this server.";
    sendJson(response, 401, {
      error: { type: "invalid_request", code: "invalid_api_key", message },
    });
    return false;
  }

  private modelList() {
    return (this.options.models ?? []).map((model) => ({
      type: model.type ?? "llm",
      key: model.key,
      display_name: model.key.toUpperCase(),
      params_string: "4B",
      quantization: { name: "Q4_K_M", bits_per_weight: 4 },
      max_context_length: model.maxContextLength ?? 131_072,
      capabilities: { vision: model.vision ?? false, trained_for_tool_use: true },
      loaded_instances: (this.instances.get(model.key) ?? []).map((instance) => ({
        id: instance.id,
        config: { context_length: instance.contextLength },
      })),
    }));
  }

  private load(body: Record<string, unknown>, response: ServerResponse): void {
    const key = String(body.model);
    if (this.options.failingLoads?.includes(key)) {
      sendJson(response, 500, { error: { message: "Failed to load model: insufficient memory" } });
      return;
    }
    const instance = this.newInstance(key, Number(body.context_length));
    this.instances.set(key, [...(this.instances.get(key) ?? []), instance]);
    sendJson(response, 200, {
      type: "llm",
      instance_id: instance.id,
      status: "loaded",
      load_config: { context_length: instance.contextLength },
    });
  }

  private unload(body: Record<string, unknown>, response: ServerResponse): void {
    for (const [key, list] of this.instances) {
      this.instances.set(
        key,
        list.filter((instance) => instance.id !== body.instance_id),
      );
    }
    sendJson(response, 200, { instance_id: body.instance_id });
  }

  private chat(response: ServerResponse): void {
    response.writeHead(200, { "Content-Type": "text/event-stream" });
    for (const chunk of this.options.chatChunks ?? []) {
      response.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
    if (this.options.holdChatOpen) {
      this.chatClosed = new Promise((resolve) => response.on("close", () => resolve()));
      return;
    }
    response.end("data: [DONE]\n\n");
  }
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  const parts: Buffer[] = [];
  for await (const part of request) parts.push(part as Buffer);
  const text = Buffer.concat(parts).toString("utf8");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

/** A full config pointing at a fake server, with any overrides applied. */
export function configForServer(baseUrl: string, overrides: ConfigInput = {}): Config {
  return configSchema.parse({ ...overrides, lmStudio: { baseUrl, ...overrides.lmStudio } });
}

/** A minimal session for tests that switch models. */
export function testSession(): SessionState {
  return {
    id: "test-session",
    messages: [],
    model: undefined,
    permissionMode: "ask",
    grants: { tools: new Set(), dataFiles: new Set() },
    reasoning: "off",
    ephemeral: true,
  };
}
