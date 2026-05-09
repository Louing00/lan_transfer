import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mime from "mime";
import { RelayError, RelayService } from "./services/relayService.js";
import { RoomService } from "./services/roomService.js";
import { attachSignalingServer } from "./ws/signalingServer.js";

const port = Number(process.env.PORT ?? 8080);
const roomService = new RoomService(Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 60 * 2));
const relayService = new RelayService();
const frontendDist = path.resolve(fileURLToPath(new URL("../../frontend/dist", import.meta.url)));

const server = createServer(async (request, response) => {
  try {
    await routeRequest(request, response);
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "Internal server error" });
  }
});

attachSignalingServer(server, roomService);

server.listen(port, () => {
  console.log(`Lindrop server listening on http://0.0.0.0:${port}`);
});

async function routeRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      name: "lindrop",
      transport: "webrtc-datachannel",
      relayEnabled: relayService.isEnabled()
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/relay/status") {
    sendJson(response, 200, { enabled: relayService.isEnabled() });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/relay/session") {
    const body = await readJsonBody<{ password?: string }>(request, 4096);
    const session = relayService.createSession(body.password ?? "");
    if (!session) {
      sendJson(response, relayService.isEnabled() ? 403 : 503, { error: relayService.isEnabled() ? "Invalid password" : "Relay is disabled" });
      return;
    }
    sendJson(response, 200, session);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    sendJson(response, 201, roomService.createRoom());
    return;
  }

  const relayRoomMatch = url.pathname.match(/^\/api\/relay\/rooms\/([A-Z0-9]+)\/files$/);
  if (request.method === "GET" && relayRoomMatch) {
    if (!roomService.getRoom(relayRoomMatch[1])) {
      sendJson(response, 404, { error: "Room not found or expired" });
      return;
    }
    sendJson(response, 200, { files: relayService.listRoomFiles(relayRoomMatch[1]) });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/relay/files") {
    if (!relayService.isSessionValid(getBearerToken(request))) {
      sendJson(response, 401, { error: "Relay authorization required" });
      return;
    }

    const roomId = (url.searchParams.get("roomId") ?? "").trim().toUpperCase();
    if (!roomService.getRoom(roomId)) {
      sendJson(response, 404, { error: "Room not found or expired" });
      return;
    }

    const fileName = String(request.headers["x-file-name"] ?? "relay-file");
    const mimeType = String(request.headers["x-file-type"] ?? "application/octet-stream");
    try {
      const file = await relayService.saveFile(request, roomId, fileName, mimeType);
      sendJson(response, 201, file);
    } catch (error) {
      if (error instanceof RelayError) {
        sendJson(response, error.statusCode, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  const relayFileMatch = url.pathname.match(/^\/api\/relay\/files\/([0-9a-f-]+)$/);
  if (request.method === "GET" && relayFileMatch) {
    if (!relayService.sendFile(relayFileMatch[1], response)) {
      sendJson(response, 404, { error: "File not found or expired" });
    }
    return;
  }

  const roomMatch = url.pathname.match(/^\/api\/rooms\/([A-Z0-9]+)$/);
  if (request.method === "GET" && roomMatch) {
    const room = roomService.getRoom(roomMatch[1]);
    if (!room) {
      sendJson(response, 404, { error: "Room not found or expired" });
      return;
    }
    sendJson(response, 200, room);
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  serveStatic(url.pathname, request, response);
}

function serveStatic(urlPathname: string, request: IncomingMessage, response: ServerResponse) {
  if (!existsSync(frontendDist)) {
    sendHtml(
      response,
      503,
      "<h1>Lindrop frontend is not built</h1><p>Run <code>npm run build</code> first.</p>"
    );
    return;
  }

  const decodedPathname = decodeURIComponent(urlPathname);
  const requestedPath = path.normalize(decodedPathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(frontendDist, requestedPath);

  if (!filePath.startsWith(frontendDist)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!existsSync(filePath)) {
    const acceptsHtml = request.headers.accept?.includes("text/html") ?? false;
    const hasExtension = path.extname(filePath).length > 0;
    filePath = acceptsHtml || !hasExtension ? path.join(frontendDist, "index.html") : filePath;
  }

  if (!existsSync(filePath)) {
    sendJson(response, 404, { error: "Not found" });
    return;
  }

  response.statusCode = 200;
  response.setHeader("Content-Type", mime.getType(filePath) ?? "application/octet-stream");
  response.setHeader("Cache-Control", path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable");
  createReadStream(filePath).pipe(response);
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(payload));
}

function sendHtml(response: ServerResponse, statusCode: number, html: string) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(html);
}

function getBearerToken(request: IncomingMessage) {
  const authorization = request.headers.authorization ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
}

async function readJsonBody<T>(request: IncomingMessage, maxBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxBytes) {
      throw new RelayError(413, "Request body is too large");
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}
