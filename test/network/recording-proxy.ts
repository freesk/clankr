// The first observer: a loopback HTTP proxy that records every destination a
// proxy-honouring client asks for. Allowed destinations are forwarded so the
// session keeps working; anything else is refused and never leaves the machine.

import { createServer, type IncomingMessage, request, type ServerResponse } from "node:http";
import { connect, type Socket } from "node:net";
import type { Destination } from "./destinations.ts";
import { isAllowedDestination, parseEndpoint } from "./destinations.ts";

export interface ProxyRecord extends Destination {
  /** "connect" for HTTPS tunnels, "http" for plain absolute-URL requests. */
  method: "connect" | "http";
  allowed: boolean;
}

export interface RecordingProxy {
  port: number;
  records: ProxyRecord[];
  close(): Promise<void>;
}

export async function startRecordingProxy(allowed: Destination[]): Promise<RecordingProxy> {
  const records: ProxyRecord[] = [];
  const openSockets = new Set<Socket>();
  const server = createServer((clientRequest, clientResponse) =>
    handlePlainRequest(clientRequest, clientResponse, allowed, records),
  );
  server.on("connect", (clientRequest: IncomingMessage, clientSocket: Socket, head: Buffer) =>
    handleConnect(clientRequest, clientSocket, head, allowed, records),
  );
  server.on("connection", (socket: Socket) => {
    openSockets.add(socket);
    socket.on("close", () => openSockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("proxy has no port");
  return {
    port: address.port,
    records,
    close: () =>
      new Promise((resolve) => {
        for (const socket of openSockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

function handlePlainRequest(
  clientRequest: IncomingMessage,
  clientResponse: ServerResponse,
  allowed: Destination[],
  records: ProxyRecord[],
): void {
  let target: URL;
  try {
    target = new URL(clientRequest.url ?? "");
  } catch {
    clientResponse.writeHead(400).end("absolute URL required");
    return;
  }
  const destination = { host: target.hostname, port: Number(target.port || 80) };
  const isAllowed = isAllowedDestination(destination, allowed);
  records.push({ ...destination, method: "http", allowed: isAllowed });
  if (!isAllowed) {
    clientResponse.writeHead(403).end("blocked by the vix network test");
    return;
  }
  const upstream = request(target, {
    method: clientRequest.method,
    headers: clientRequest.headers,
  });
  upstream.on("response", (response) => {
    clientResponse.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(clientResponse);
  });
  upstream.on("error", () => clientResponse.destroy());
  clientRequest.pipe(upstream);
}

function handleConnect(
  clientRequest: IncomingMessage,
  clientSocket: Socket,
  head: Buffer,
  allowed: Destination[],
  records: ProxyRecord[],
): void {
  const destination = parseEndpoint(clientRequest.url ?? "");
  if (!destination) {
    clientSocket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    return;
  }
  const isAllowed = isAllowedDestination(destination, allowed);
  records.push({ ...destination, method: "connect", allowed: isAllowed });
  if (!isAllowed) {
    clientSocket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    return;
  }
  const upstream = connect(destination.port, destination.host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    upstream.write(head);
    upstream.pipe(clientSocket);
    clientSocket.pipe(upstream);
  });
  upstream.on("error", () => clientSocket.destroy());
  clientSocket.on("error", () => upstream.destroy());
}
