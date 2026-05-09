import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type RelayFile = {
  id: string;
  roomId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  path: string;
};

export type RelayFileView = Omit<RelayFile, "path"> & {
  downloadUrl: string;
};

export class RelayService {
  private readonly files = new Map<string, RelayFile>();
  private readonly sessions = new Map<string, number>();
  private readonly uploadDir: string;

  constructor(
    private readonly adminPassword = process.env.RELAY_ADMIN_PASSWORD ?? "",
    private readonly ttlMs = Number(process.env.RELAY_FILE_TTL_MS ?? 1000 * 60 * 60 * 2),
    private readonly maxFileBytes = Number(process.env.RELAY_MAX_FILE_BYTES ?? 1024 * 1024 * 1024)
  ) {
    this.uploadDir = process.env.RELAY_UPLOAD_DIR ?? path.join(tmpdir(), "lindrop-relay");
    mkdirSync(this.uploadDir, { recursive: true });
  }

  isEnabled() {
    return this.adminPassword.length > 0;
  }

  createSession(password: string) {
    if (!this.isEnabled() || !this.isPasswordValid(password)) {
      return null;
    }

    const token = randomBytes(32).toString("hex");
    this.sessions.set(token, Date.now() + this.ttlMs);
    return {
      token,
      expiresAt: this.sessions.get(token)!
    };
  }

  isSessionValid(token: string) {
    this.cleanupExpired();
    const expiresAt = this.sessions.get(token);
    return Boolean(expiresAt && expiresAt > Date.now());
  }

  async saveFile(request: IncomingMessage, roomId: string, fileName: string, mimeType: string) {
    this.cleanupExpired();
    const contentLength = Number(request.headers["content-length"] ?? 0);
    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      throw new RelayError(411, "Missing Content-Length");
    }
    if (contentLength > this.maxFileBytes) {
      throw new RelayError(413, "File is too large");
    }

    const id = randomUUID();
    const filePath = path.join(this.uploadDir, `${id}.bin`);
    let received = 0;

    request.on("data", (chunk: Buffer) => {
      received += chunk.byteLength;
      if (received > this.maxFileBytes) {
        request.destroy(new RelayError(413, "File is too large"));
      }
    });

    try {
      await pipeline(request, createWriteStream(filePath, { flags: "wx" }));
    } catch (error) {
      if (existsSync(filePath)) {
        rmSync(filePath, { force: true });
      }
      throw error;
    }

    const stats = statSync(filePath);
    const now = Date.now();
    const file: RelayFile = {
      id,
      roomId,
      name: sanitizeFileName(fileName),
      mimeType: mimeType || "application/octet-stream",
      size: stats.size,
      createdAt: now,
      expiresAt: now + this.ttlMs,
      path: filePath
    };
    this.files.set(id, file);
    return toView(file);
  }

  listRoomFiles(roomId: string) {
    this.cleanupExpired();
    return Array.from(this.files.values())
      .filter((file) => file.roomId === roomId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(toView);
  }

  sendFile(fileId: string, response: ServerResponse) {
    this.cleanupExpired();
    const file = this.files.get(fileId);
    if (!file || !existsSync(file.path)) {
      return false;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", file.mimeType);
    response.setHeader("Content-Length", String(file.size));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    createReadStream(file.path).pipe(response);
    return true;
  }

  private cleanupExpired() {
    const now = Date.now();
    for (const [fileId, file] of this.files) {
      if (file.expiresAt <= now) {
        this.files.delete(fileId);
        rmSync(file.path, { force: true });
      }
    }

    for (const [token, expiresAt] of this.sessions) {
      if (expiresAt <= now) {
        this.sessions.delete(token);
      }
    }
  }

  private isPasswordValid(password: string) {
    const expected = Buffer.from(this.adminPassword);
    const actual = Buffer.from(password);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}

export class RelayError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

function toView(file: RelayFile): RelayFileView {
  return {
    id: file.id,
    roomId: file.roomId,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    createdAt: file.createdAt,
    expiresAt: file.expiresAt,
    downloadUrl: `/api/relay/files/${file.id}`
  };
}

function sanitizeFileName(name: string) {
  const cleaned = decodeURIComponent(name || "relay-file").replace(/[\\/:*?"<>|]/g, "_").trim();
  return cleaned.slice(0, 180) || "relay-file";
}
