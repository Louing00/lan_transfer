import type { IncomingMessage, Server } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import type { Device, RoomService } from "../services/roomService.js";

type SignalMessage = {
  type: "signal";
  to: string;
  payload: unknown;
};

type ClientContext = {
  roomId: string;
  device: Device;
  socket: WebSocket;
};

const socketsByRoom = new Map<string, Map<string, ClientContext>>();

export function attachSignalingServer(server: Server, roomService: RoomService) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const context = createContext(request, socket, roomService);
    if (!context) {
      socket.close(1008, "Invalid room");
      return;
    }

    const roomSockets = getRoomSockets(context.roomId);
    const previous = roomSockets.get(context.device.id);
    if (previous && previous.socket.readyState === previous.socket.OPEN) {
      previous.socket.close(1000, "Device reconnected");
    }

    const existingDevices = roomService
      .listDevices(context.roomId)
      .filter((device) => device.id !== context.device.id);

    roomSockets.set(context.device.id, context);

    send(context.socket, {
      type: "room-state",
      roomId: context.roomId,
      selfId: context.device.id,
      devices: existingDevices
    });

    broadcast(context.roomId, context.device.id, {
      type: "peer-joined",
      device: context.device,
      initiator: true
    });

    socket.on("message", (raw) => {
      roomService.touch(context.roomId, context.device.id);
      handleMessage(context, raw.toString());
    });

    socket.on("close", () => {
      roomSockets.delete(context.device.id);
      roomService.leaveRoom(context.roomId, context.device.id);
      broadcast(context.roomId, context.device.id, {
        type: "peer-left",
        deviceId: context.device.id
      });
    });
  });
}

function createContext(request: IncomingMessage, socket: WebSocket, roomService: RoomService) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const roomId = (url.searchParams.get("roomId") ?? "").trim().toUpperCase();
  const deviceId = (url.searchParams.get("deviceId") ?? "").trim();
  const name = (url.searchParams.get("name") ?? "").trim().slice(0, 48);

  if (!roomId || !deviceId) {
    return null;
  }

  const device = roomService.joinRoom(roomId, { id: deviceId, name });
  if (!device) {
    return null;
  }

  return { roomId, device, socket };
}

function handleMessage(context: ClientContext, raw: string) {
  let message: SignalMessage | null = null;
  try {
    message = JSON.parse(raw) as SignalMessage;
  } catch {
    send(context.socket, { type: "error", message: "Invalid JSON message" });
    return;
  }

  if (message.type !== "signal" || !message.to) {
    return;
  }

  const target = socketsByRoom.get(context.roomId)?.get(message.to);
  if (!target || target.socket.readyState !== target.socket.OPEN) {
    send(context.socket, { type: "error", message: "Peer is not connected", to: message.to });
    return;
  }

  send(target.socket, {
    type: "signal",
    from: context.device.id,
    payload: message.payload
  });
}

function getRoomSockets(roomId: string) {
  let roomSockets = socketsByRoom.get(roomId);
  if (!roomSockets) {
    roomSockets = new Map();
    socketsByRoom.set(roomId, roomSockets);
  }
  return roomSockets;
}

function broadcast(roomId: string, exceptDeviceId: string, payload: unknown) {
  const roomSockets = socketsByRoom.get(roomId);
  if (!roomSockets) {
    return;
  }

  for (const [deviceId, context] of roomSockets) {
    if (deviceId !== exceptDeviceId && context.socket.readyState === context.socket.OPEN) {
      send(context.socket, payload);
    }
  }
}

function send(socket: WebSocket, payload: unknown) {
  socket.send(JSON.stringify(payload));
}
