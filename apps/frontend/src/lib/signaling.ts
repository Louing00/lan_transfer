export type Device = {
  id: string;
  name: string;
  joinedAt: number;
  lastSeenAt: number;
};

export type ServerMessage =
  | { type: "room-state"; roomId: string; selfId: string; devices: Device[] }
  | { type: "peer-joined"; device: Device; initiator: boolean }
  | { type: "peer-left"; deviceId: string }
  | { type: "signal"; from: string; payload: SignalPayload }
  | { type: "error"; message: string; to?: string };

export type SignalPayload =
  | { kind: "offer"; description: RTCSessionDescriptionInit }
  | { kind: "answer"; description: RTCSessionDescriptionInit }
  | { kind: "ice-candidate"; candidate: RTCIceCandidateInit };

type SignalingHandlers = {
  onOpen?: () => void;
  onClose?: () => void;
  onReconnecting?: () => void;
  onMessage?: (message: ServerMessage) => void;
};

export class SignalingClient {
  private socket?: WebSocket;
  private reconnectTimer?: number;
  private heartbeatTimer?: number;
  private reconnectAttempt = 0;
  private manuallyClosed = false;

  constructor(
    private readonly roomId: string,
    private readonly deviceId: string,
    private readonly deviceName: string,
    private readonly handlers: SignalingHandlers
  ) {}

  connect() {
    this.manuallyClosed = false;
    this.openSocket();
  }

  private openSocket() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      roomId: this.roomId,
      deviceId: this.deviceId,
      name: this.deviceName
    });
    const socket = new WebSocket(`${protocol}//${window.location.host}/ws?${params.toString()}`);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.startHeartbeat();
      this.handlers.onOpen?.();
    });
    socket.addEventListener("close", (event) => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.stopHeartbeat();
      if (this.manuallyClosed) return;
      this.handlers.onClose?.();
      if (event.code !== 1008) {
        this.scheduleReconnect();
      }
    });
    socket.addEventListener("message", (event) => {
      try {
        this.handlers.onMessage?.(JSON.parse(event.data) as ServerMessage);
      } catch {
        console.warn("Ignored malformed signaling message");
      }
    });
  }

  sendSignal(to: string, payload: SignalPayload) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: "signal", to, payload }));
    }
  }

  close() {
    this.manuallyClosed = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = undefined;
  }

  private scheduleReconnect() {
    if (this.reconnectTimer || this.manuallyClosed) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, 10000);
    this.reconnectAttempt += 1;
    this.handlers.onReconnecting?.();
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket();
    }, delay);
  }

  private startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, 20000);
  }

  private stopHeartbeat() {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}
