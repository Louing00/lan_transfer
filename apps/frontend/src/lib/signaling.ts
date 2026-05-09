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
  onMessage?: (message: ServerMessage) => void;
};

export class SignalingClient {
  private socket?: WebSocket;

  constructor(
    private readonly roomId: string,
    private readonly deviceId: string,
    private readonly deviceName: string,
    private readonly handlers: SignalingHandlers
  ) {}

  connect() {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const params = new URLSearchParams({
      roomId: this.roomId,
      deviceId: this.deviceId,
      name: this.deviceName
    });
    this.socket = new WebSocket(`${protocol}//${window.location.host}/ws?${params.toString()}`);

    this.socket.addEventListener("open", () => this.handlers.onOpen?.());
    this.socket.addEventListener("close", () => this.handlers.onClose?.());
    this.socket.addEventListener("message", (event) => {
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
    this.socket?.close();
  }
}
