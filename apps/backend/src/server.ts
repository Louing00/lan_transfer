import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mime from "mime";
import { RoomService } from "./services/roomService.js";
import { attachSignalingServer } from "./ws/signalingServer.js";

const port = Number(process.env.PORT ?? 8080);
const roomService = new RoomService(Number(process.env.ROOM_TTL_MS ?? 1000 * 60 * 60 * 2));
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
      transport: "webrtc-datachannel"
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/rooms") {
    sendJson(response, 201, roomService.createRoom());
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
