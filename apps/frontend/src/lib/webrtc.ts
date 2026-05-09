import type { SignalPayload } from "./signaling";

export type PeerStatus = "new" | "connecting" | "connected" | "disconnected" | "failed" | "closed";

type PeerRecord = {
  id: string;
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
};

type PeerHandlers = {
  sendSignal: (peerId: string, payload: SignalPayload) => void;
  onStatus: (peerId: string, status: PeerStatus) => void;
  onDataChannel: (peerId: string, channel: RTCDataChannel) => void;
};

export class PeerConnectionManager {
  private readonly peers = new Map<string, PeerRecord>();

  constructor(private readonly handlers: PeerHandlers) {}

  async ensurePeer(peerId: string, initiator: boolean) {
    const existing = this.peers.get(peerId);
    if (existing) {
      return existing;
    }

    const pc = new RTCPeerConnection({
      iceServers: getIceServers()
    });

    const record: PeerRecord = { id: peerId, pc };
    this.peers.set(peerId, record);

    pc.addEventListener("icecandidate", (event) => {
      if (event.candidate) {
        this.handlers.sendSignal(peerId, {
          kind: "ice-candidate",
          candidate: event.candidate.toJSON()
        });
      }
    });

    pc.addEventListener("connectionstatechange", () => {
      this.handlers.onStatus(peerId, pc.connectionState as PeerStatus);
    });

    pc.addEventListener("datachannel", (event) => {
      record.channel = event.channel;
      this.configureChannel(peerId, event.channel);
    });

    if (initiator) {
      const channel = pc.createDataChannel("lindrop-files", { ordered: true });
      record.channel = channel;
      this.configureChannel(peerId, channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.handlers.sendSignal(peerId, { kind: "offer", description: offer });
    }

    return record;
  }

  async handleSignal(peerId: string, payload: SignalPayload) {
    const record = await this.ensurePeer(peerId, false);

    if (payload.kind === "offer") {
      await record.pc.setRemoteDescription(payload.description);
      const answer = await record.pc.createAnswer();
      await record.pc.setLocalDescription(answer);
      this.handlers.sendSignal(peerId, { kind: "answer", description: answer });
      return;
    }

    if (payload.kind === "answer") {
      await record.pc.setRemoteDescription(payload.description);
      return;
    }

    if (payload.kind === "ice-candidate") {
      await record.pc.addIceCandidate(payload.candidate);
    }
  }

  getOpenChannel() {
    for (const peer of this.peers.values()) {
      if (peer.channel?.readyState === "open") {
        return { peerId: peer.id, channel: peer.channel };
      }
    }
    return null;
  }

  closePeer(peerId: string) {
    const peer = this.peers.get(peerId);
    peer?.channel?.close();
    peer?.pc.close();
    this.peers.delete(peerId);
  }

  closeAll() {
    for (const peerId of this.peers.keys()) {
      this.closePeer(peerId);
    }
  }

  private configureChannel(peerId: string, channel: RTCDataChannel) {
    channel.binaryType = "arraybuffer";
    channel.bufferedAmountLowThreshold = 1024 * 1024;
    channel.addEventListener("open", () => {
      this.handlers.onStatus(peerId, "connected");
      this.handlers.onDataChannel(peerId, channel);
    });
    channel.addEventListener("close", () => this.handlers.onStatus(peerId, "closed"));
    channel.addEventListener("error", () => this.handlers.onStatus(peerId, "failed"));
  }
}

function getIceServers(): RTCIceServer[] {
  const configured = import.meta.env.VITE_ICE_SERVERS;
  if (configured) {
    try {
      return JSON.parse(configured) as RTCIceServer[];
    } catch {
      console.warn("VITE_ICE_SERVERS is not valid JSON. Falling back to public STUN.");
    }
  }

  return [{ urls: "stun:stun.l.google.com:19302" }];
}
