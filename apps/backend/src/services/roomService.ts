import { randomBytes } from "node:crypto";

export type Device = {
  id: string;
  name: string;
  joinedAt: number;
  lastSeenAt: number;
};

export type RoomSnapshot = {
  id: string;
  createdAt: number;
  expiresAt: number;
  devices: Device[];
};

type RoomRecord = {
  id: string;
  createdAt: number;
  expiresAt: number;
  devices: Map<string, Device>;
};

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class RoomService {
  private readonly rooms = new Map<string, RoomRecord>();

  constructor(private readonly roomTtlMs = 1000 * 60 * 60 * 2) {}

  createRoom(): RoomSnapshot {
    this.cleanupExpiredRooms();
    let id = this.createRoomId();
    while (this.rooms.has(id)) {
      id = this.createRoomId();
    }

    const now = Date.now();
    const room: RoomRecord = {
      id,
      createdAt: now,
      expiresAt: now + this.roomTtlMs,
      devices: new Map()
    };

    this.rooms.set(id, room);
    return this.snapshot(room);
  }

  getRoom(roomId: string): RoomSnapshot | null {
    this.cleanupExpiredRooms();
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }
    return this.snapshot(room);
  }

  joinRoom(roomId: string, device: Pick<Device, "id" | "name">): Device | null {
    this.cleanupExpiredRooms();
    const room = this.rooms.get(roomId);
    if (!room) {
      return null;
    }

    const now = Date.now();
    const joinedDevice: Device = {
      id: device.id,
      name: device.name || "未命名设备",
      joinedAt: room.devices.get(device.id)?.joinedAt ?? now,
      lastSeenAt: now
    };
    room.devices.set(joinedDevice.id, joinedDevice);
    return joinedDevice;
  }

  leaveRoom(roomId: string, deviceId: string): Device | null {
    const room = this.rooms.get(roomId);
    const device = room?.devices.get(deviceId) ?? null;
    if (!room || !device) {
      return null;
    }
    room.devices.delete(deviceId);
    if (room.devices.size === 0 && Date.now() > room.createdAt + 1000 * 60 * 5) {
      this.rooms.delete(roomId);
    }
    return device;
  }

  touch(roomId: string, deviceId: string) {
    const room = this.rooms.get(roomId);
    const device = room?.devices.get(deviceId);
    if (device) {
      device.lastSeenAt = Date.now();
    }
  }

  listDevices(roomId: string): Device[] {
    return this.getRoom(roomId)?.devices ?? [];
  }

  cleanupExpiredRooms() {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      if (room.expiresAt < now) {
        this.rooms.delete(roomId);
      }
    }
  }

  private createRoomId() {
    const bytes = randomBytes(6);
    return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  }

  private snapshot(room: RoomRecord): RoomSnapshot {
    return {
      id: room.id,
      createdAt: room.createdAt,
      expiresAt: room.expiresAt,
      devices: Array.from(room.devices.values())
    };
  }
}
