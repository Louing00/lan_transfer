import { Check, Copy, Download, Edit3, LogOut, Pause, Play, QrCode, RefreshCw, Send, Server, ShieldCheck, Smartphone, Square, Upload, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { getDeviceId, getDeviceName, setDeviceName } from "../lib/device";
import { formatBytes, formatPercent, formatSpeed } from "../lib/format";
import { createId } from "../lib/id";
import { type Device, SignalingClient, type ServerMessage } from "../lib/signaling";
import { PeerConnectionManager, type PeerStatus } from "../lib/webrtc";
import { type FileMeta, useTransferStore } from "../stores/transferStore";

type Props = {
  roomId: string;
};

type ControlMessage =
  | ({ type: "file-meta"; fromPeerId?: string } & FileMeta)
  | { type: "file-accept"; id: string }
  | { type: "file-reject"; id: string }
  | { type: "file-paused"; id: string }
  | { type: "file-resumed"; id: string }
  | { type: "file-stopped"; id: string }
  | { type: "file-complete"; id: string };

const chunkSize = 64 * 1024;
const maxBufferedAmount = 4 * 1024 * 1024;
const relayTokenKey = "lindrop.relayToken";

type RelayFile = {
  id: string;
  roomId: string;
  name: string;
  mimeType: string;
  size: number;
  createdAt: number;
  expiresAt: number;
  downloadUrl: string;
};

export function RoomPage({ roomId }: Props) {
  const [deviceName, setName] = useState(() => getDeviceName());
  const [nameDraft, setNameDraft] = useState(deviceName);
  const [isEditingName, setIsEditingName] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [signalStatus, setSignalStatus] = useState<"connecting" | "connected" | "closed">("connecting");
  const [peerStatuses, setPeerStatuses] = useState<Record<string, PeerStatus>>({});
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [toast, setToast] = useState("");
  const [relayEnabled, setRelayEnabled] = useState(false);
  const [relayToken, setRelayToken] = useState(() => sessionStorage.getItem(relayTokenKey) ?? "");
  const [relayPassword, setRelayPassword] = useState("");
  const [relayFiles, setRelayFiles] = useState<RelayFile[]>([]);
  const [relayUploading, setRelayUploading] = useState(false);
  const [relayProgress, setRelayProgress] = useState(0);

  const deviceId = useMemo(() => getDeviceId(), []);
  const roomUrl = useMemo(() => `${window.location.origin}/room/${roomId}`, [roomId]);
  const signalingRef = useRef<SignalingClient>();
  const peerManagerRef = useRef<PeerConnectionManager>();
  const channelsRef = useRef(new Map<string, RTCDataChannel>());
  const outgoingFileRef = useRef<File | null>(null);
  const outgoingPeerIdRef = useRef<string | null>(null);
  const incomingChunksRef = useRef<ArrayBuffer[]>([]);
  const incomingMetaRef = useRef<(FileMeta & { fromPeerId: string }) | null>(null);

  const {
    pendingIncoming,
    outgoing,
    incoming,
    setPendingIncoming,
    setOutgoing,
    setIncoming,
    patchOutgoing,
    patchIncoming,
    reset
  } = useTransferStore();

  useWakeLock(Boolean(outgoing?.status === "transferring" || incoming?.status === "transferring"));

  useEffect(() => {
    void fetch("/api/relay/status")
      .then((response) => response.json())
      .then((status: { enabled: boolean }) => setRelayEnabled(status.enabled))
      .catch(() => setRelayEnabled(false));
  }, []);

  useEffect(() => {
    void refreshRelayFiles();
    const timer = window.setInterval(() => void refreshRelayFiles(), 10000);
    return () => window.clearInterval(timer);
  }, [roomId]);

  useEffect(() => {
    reset();
    channelsRef.current.clear();
    outgoingPeerIdRef.current = null;
    incomingChunksRef.current = [];

    const signaling = new SignalingClient(roomId, deviceId, deviceName, {
      onOpen: () => setSignalStatus("connected"),
      onClose: () => setSignalStatus("closed"),
      onMessage: (message) => handleServerMessage(message)
    });

    const manager = new PeerConnectionManager({
      sendSignal: (peerId, payload) => signaling.sendSignal(peerId, payload),
      onStatus: (peerId, status) => setPeerStatuses((current) => ({ ...current, [peerId]: status })),
      onDataChannel: (peerId, channel) => {
        channelsRef.current.set(peerId, channel);
        channel.addEventListener("message", (event) => handleChannelMessage(peerId, event.data));
      }
    });

    signalingRef.current = signaling;
    peerManagerRef.current = manager;
    signaling.connect();

    function handleServerMessage(message: ServerMessage) {
      if (message.type === "room-state") {
        setDevices(message.devices);
        void Promise.all(message.devices.map((device) => manager.ensurePeer(device.id, false)));
      }

      if (message.type === "peer-joined") {
        setDevices((current) => mergeDevice(current, message.device));
        void manager.ensurePeer(message.device.id, message.initiator);
      }

      if (message.type === "peer-left") {
        setDevices((current) => current.filter((device) => device.id !== message.deviceId));
        setPeerStatuses((current) => {
          const next = { ...current };
          delete next[message.deviceId];
          return next;
        });
        channelsRef.current.delete(message.deviceId);
        manager.closePeer(message.deviceId);
      }

      if (message.type === "signal") {
        void manager.handleSignal(message.from, message.payload).catch((error) => {
          console.error(error);
          setToast("P2P 协商失败，请检查网络或刷新房间");
        });
      }

      if (message.type === "error") {
        setToast(message.message);
      }
    }

    return () => {
      signaling.close();
      manager.closeAll();
      channelsRef.current.clear();
    };
  }, [deviceId, deviceName, reset, roomId]);

  const connectedPeer = peerManagerRef.current?.getOpenChannel();
  const connectedCount = Object.values(peerStatuses).filter((status) => status === "connected").length;
  const statusText = getStatusText(signalStatus, connectedCount, devices.length);
  const isTransferBusy = outgoing?.status === "waiting" || outgoing?.status === "transferring" || outgoing?.status === "paused";

  async function copyRoomUrl() {
    await navigator.clipboard.writeText(roomUrl);
    setToast("房间链接已复制");
  }

  function saveName() {
    const saved = setDeviceName(nameDraft);
    setName(saved);
    setNameDraft(saved);
    setIsEditingName(false);
  }

  async function unlockRelay(event: FormEvent) {
    event.preventDefault();
    if (!relayPassword.trim()) {
      setToast("请输入管理员密码");
      return;
    }

    const response = await fetch("/api/relay/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: relayPassword })
    });

    if (!response.ok) {
      setToast(response.status === 503 ? "服务器未开启中继模式" : "管理员密码不正确");
      return;
    }

    const session = (await response.json()) as { token: string };
    sessionStorage.setItem(relayTokenKey, session.token);
    setRelayToken(session.token);
    setRelayPassword("");
    setToast("服务器中继已解锁");
  }

  async function refreshRelayFiles() {
    const response = await fetch(`/api/relay/rooms/${roomId}/files`);
    if (!response.ok) {
      return;
    }
    const payload = (await response.json()) as { files: RelayFile[] };
    setRelayFiles(payload.files);
  }

  async function uploadViaRelay() {
    if (!selectedFile) {
      setToast("请先选择文件");
      return;
    }
    if (!relayToken) {
      setToast("请先输入管理员密码解锁中继");
      return;
    }

    setRelayUploading(true);
    setRelayProgress(0);
    try {
      await uploadRelayFile(roomId, selectedFile, relayToken, (progress) => setRelayProgress(progress));
      setToast("已上传到服务器中继");
      await refreshRelayFiles();
    } catch (error) {
      console.error(error);
      setToast(error instanceof Error ? error.message : "中继上传失败");
    } finally {
      setRelayUploading(false);
    }
  }

  async function sendSelectedFile() {
    const target = peerManagerRef.current?.getOpenChannel();
    if (!selectedFile || !target) {
      setToast("请先等待另一台设备完成 P2P 连接");
      return;
    }

    const fileId = createId("file");
    outgoingFileRef.current = selectedFile;
    outgoingPeerIdRef.current = target.peerId;
    setOutgoing({
      id: fileId,
      name: selectedFile.name,
      size: selectedFile.size,
      done: 0,
      status: "waiting",
      direction: "outgoing"
    });

    sendControl(target.channel, {
      type: "file-meta",
      id: fileId,
      name: selectedFile.name,
      size: selectedFile.size,
      mimeType: selectedFile.type,
      lastModified: selectedFile.lastModified
    });
  }

  async function acceptIncoming() {
    if (!pendingIncoming) return;
    const channel = channelsRef.current.get(pendingIncoming.fromPeerId);
    if (!channel) {
      setToast("发送设备已断开");
      return;
    }

    incomingChunksRef.current = [];
    incomingMetaRef.current = pendingIncoming;
    setIncoming({
      id: pendingIncoming.id,
      name: pendingIncoming.name,
      size: pendingIncoming.size,
      done: 0,
      status: "transferring",
      direction: "incoming",
      startedAt: performance.now()
    });
    setPendingIncoming(undefined);
    sendControl(channel, { type: "file-accept", id: pendingIncoming.id });
  }

  function rejectIncoming() {
    if (!pendingIncoming) return;
    const channel = channelsRef.current.get(pendingIncoming.fromPeerId);
    if (channel) {
      sendControl(channel, { type: "file-reject", id: pendingIncoming.id });
    }
    setPendingIncoming(undefined);
  }

  async function handleChannelMessage(peerId: string, data: string | ArrayBuffer | Blob) {
    if (typeof data === "string") {
      handleControlMessage(peerId, JSON.parse(data) as ControlMessage);
      return;
    }

    const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
    const meta = incomingMetaRef.current;
    if (!meta) {
      return;
    }

    incomingChunksRef.current.push(buffer);
    const done = incomingChunksRef.current.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const status = useTransferStore.getState().incoming?.status === "paused" ? "paused" : "transferring";
    patchIncoming({ done, status });
  }

  function handleControlMessage(peerId: string, message: ControlMessage) {
    if (message.type === "file-meta") {
      setPendingIncoming({ ...message, fromPeerId: peerId });
      return;
    }

    if (message.type === "file-accept") {
      const channel = channelsRef.current.get(peerId);
      const file = outgoingFileRef.current;
      if (channel && file) {
        void transmitFile(channel, file, message.id);
      }
      return;
    }

    if (message.type === "file-reject") {
      patchOutgoing({ status: "rejected" });
      return;
    }

    if (message.type === "file-paused") {
      const meta = incomingMetaRef.current;
      if (meta?.id === message.id) {
        patchIncoming({ status: "paused" });
      }
      return;
    }

    if (message.type === "file-resumed") {
      const meta = incomingMetaRef.current;
      if (meta?.id === message.id) {
        patchIncoming({ status: "transferring" });
      }
      return;
    }

    if (message.type === "file-stopped") {
      const meta = incomingMetaRef.current;
      if (meta?.id === message.id) {
        incomingMetaRef.current = null;
        incomingChunksRef.current = [];
        patchIncoming({ status: "stopped" });
      }
      return;
    }

    if (message.type === "file-complete") {
      const meta = incomingMetaRef.current;
      if (!meta || meta.id !== message.id) return;
      const blob = new Blob(incomingChunksRef.current, { type: meta.mimeType || "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      patchIncoming({ done: meta.size, status: "done", completedAt: performance.now(), url });
      incomingMetaRef.current = null;
      incomingChunksRef.current = [];
    }
  }

  async function transmitFile(channel: RTCDataChannel, file: File, fileId: string) {
    patchOutgoing({ status: "transferring", startedAt: performance.now(), done: 0 });
    let offset = 0;

    try {
      while (offset < file.size) {
        await waitWhilePaused();
        if (isOutgoingStopped(fileId)) break;
        await waitForBuffer(channel);
        await waitWhilePaused();
        if (isOutgoingStopped(fileId)) break;
        const nextOffset = Math.min(offset + chunkSize, file.size);
        const buffer = await file.slice(offset, nextOffset).arrayBuffer();
        channel.send(buffer);
        offset = nextOffset;
        patchOutgoing({ done: offset });
      }
      if (!isOutgoingStopped(fileId)) {
        sendControl(channel, { type: "file-complete", id: fileId });
        patchOutgoing({ status: "done", done: file.size, completedAt: performance.now() });
      }
    } catch (error) {
      console.error(error);
      patchOutgoing({ status: "failed" });
    }
  }

  function pauseOutgoing() {
    if (outgoing?.status !== "transferring") {
      return;
    }

    patchOutgoing({ status: "paused" });
    const peerId = outgoingPeerIdRef.current;
    const channel = peerId ? channelsRef.current.get(peerId) : undefined;
    if (channel && outgoing) {
      sendControl(channel, { type: "file-paused", id: outgoing.id });
    }
  }

  function resumeOutgoing() {
    if (outgoing?.status !== "paused") {
      return;
    }

    patchOutgoing({ status: "transferring" });
    const peerId = outgoingPeerIdRef.current;
    const channel = peerId ? channelsRef.current.get(peerId) : undefined;
    if (channel && outgoing) {
      sendControl(channel, { type: "file-resumed", id: outgoing.id });
    }
  }

  function stopOutgoing() {
    if (outgoing?.status !== "paused") {
      return;
    }

    patchOutgoing({ status: "stopped" });
    const peerId = outgoingPeerIdRef.current;
    const channel = peerId ? channelsRef.current.get(peerId) : undefined;
    if (channel && outgoing) {
      sendControl(channel, { type: "file-stopped", id: outgoing.id });
    }
    outgoingFileRef.current = null;
    outgoingPeerIdRef.current = null;
  }

  return (
    <main className="room-shell">
      <header className="room-topbar">
        <a className="mini-brand" href="/" aria-label="回到首页">
          <span className="brand-mark">邻</span>
          <span>邻渡</span>
        </a>
        <button className="ghost-button" onClick={() => (window.location.href = "/")}>
          <LogOut size={18} aria-hidden />
          退出
        </button>
      </header>

      <section className="room-grid">
        <aside className="side-panel">
          <div className="room-code-block">
            <div>
              <span className="eyebrow">房间码</span>
              <strong>{roomId}</strong>
            </div>
            <button className="icon-button" onClick={copyRoomUrl} aria-label="复制房间链接" title="复制房间链接">
              <Copy size={18} aria-hidden />
            </button>
          </div>

          <div className="qr-panel">
            <QRCodeSVG value={roomUrl} size={176} level="M" includeMargin />
            <span>扫码加入这个房间</span>
          </div>

          <div className="device-name">
            <span className="eyebrow">本机设备名</span>
            {isEditingName ? (
              <div className="name-editor">
                <input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} aria-label="设备名" />
                <button className="icon-button" onClick={saveName} aria-label="保存设备名" title="保存">
                  <Check size={18} aria-hidden />
                </button>
              </div>
            ) : (
              <button className="device-name-button" onClick={() => setIsEditingName(true)}>
                <Smartphone size={18} aria-hidden />
                {deviceName}
                <Edit3 size={16} aria-hidden />
              </button>
            )}
          </div>
        </aside>

        <section className="transfer-panel" aria-labelledby="transfer-title">
          <div className="status-bar">
            <div>
              <span className="eyebrow">连接状态</span>
              <h2 id="transfer-title">{statusText}</h2>
            </div>
            <span className={`status-dot status-${connectedCount > 0 ? "ready" : signalStatus}`} />
          </div>

          <div className="peer-list" aria-label="设备列表">
            {devices.length === 0 ? (
              <div className="empty-peer">
                <QrCode size={22} aria-hidden />
                <span>等待另一台设备扫码或输入房间码</span>
              </div>
            ) : (
              devices.map((device) => (
                <article className="peer-card" key={device.id}>
                  <Smartphone size={22} aria-hidden />
                  <div>
                    <strong>{device.name}</strong>
                    <span>{translatePeerStatus(peerStatuses[device.id])}</span>
                  </div>
                </article>
              ))
            )}
          </div>

          <div className="file-drop">
            <input
              id="file-input"
              type="file"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
            />
            <label htmlFor="file-input">
              <ShieldCheck size={24} aria-hidden />
              <span>{selectedFile ? selectedFile.name : "选择要发送的文件"}</span>
              <small>{selectedFile ? formatBytes(selectedFile.size) : "文件不会先上传到服务器"}</small>
            </label>
            <button className="primary-button" onClick={sendSelectedFile} disabled={!selectedFile || !connectedPeer || isTransferBusy}>
              <Send size={20} aria-hidden />
              {isTransferBusy ? "发送中" : "发送"}
            </button>
          </div>

          <div className="progress-grid">
            <TransferCard title="发送进度" transfer={outgoing} onPause={pauseOutgoing} onResume={resumeOutgoing} onStop={stopOutgoing} />
            <TransferCard title="接收进度" transfer={incoming} />
          </div>

          <section className="relay-panel" aria-labelledby="relay-title">
            <div className="relay-header">
              <div>
                <span className="eyebrow">跨网络兜底</span>
                <h3 id="relay-title">服务器中继</h3>
              </div>
              <button className="icon-button" onClick={refreshRelayFiles} aria-label="刷新中继文件" title="刷新中继文件">
                <RefreshCw size={18} aria-hidden />
              </button>
            </div>

            {!relayEnabled ? (
              <p className="relay-note">服务器未配置管理员密码，中继上传未开启。</p>
            ) : relayToken ? (
              <div className="relay-uploader">
                <button className="relay-upload-button" onClick={uploadViaRelay} disabled={!selectedFile || relayUploading}>
                  <Upload size={18} aria-hidden />
                  {relayUploading ? `上传中 ${relayProgress}%` : "上传到服务器中继"}
                </button>
                <span>仅在不方便 P2P 直连时使用，文件会临时保存在服务器。</span>
              </div>
            ) : (
              <form className="relay-login" onSubmit={unlockRelay}>
                <Server size={18} aria-hidden />
                <input
                  type="password"
                  value={relayPassword}
                  onChange={(event) => setRelayPassword(event.target.value)}
                  placeholder="管理员密码"
                  aria-label="管理员密码"
                />
                <button type="submit">解锁</button>
              </form>
            )}

            <div className="relay-list">
              {relayFiles.length === 0 ? (
                <span className="relay-empty">暂无服务器中继文件</span>
              ) : (
                relayFiles.map((file) => (
                  <article className="relay-file" key={file.id}>
                    <div>
                      <strong>{file.name}</strong>
                      <span>{formatBytes(file.size)} · {formatExpiry(file.expiresAt)}</span>
                    </div>
                    <a href={file.downloadUrl} download={file.name}>
                      <Download size={18} aria-hidden />
                      下载
                    </a>
                  </article>
                ))
              )}
            </div>
          </section>
        </section>
      </section>

      {pendingIncoming ? (
        <div className="modal-backdrop" role="presentation">
          <div className="receive-dialog" role="dialog" aria-modal="true" aria-labelledby="receive-title">
            <h2 id="receive-title">接收文件？</h2>
            <p>
              {pendingIncoming.name}
              <span>{formatBytes(pendingIncoming.size)}</span>
            </p>
            <div className="dialog-actions">
              <button className="ghost-button" onClick={rejectIncoming}>
                <X size={18} aria-hidden />
                拒绝
              </button>
              <button className="primary-button" onClick={acceptIncoming}>
                <Check size={18} aria-hidden />
                接收
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <button className="toast" onClick={() => setToast("")}>
          {toast}
        </button>
      ) : null}
    </main>
  );
}

function TransferCard({
  title,
  transfer,
  onPause,
  onResume,
  onStop
}: {
  title: string;
  transfer?: ReturnType<typeof useTransferStore.getState>["incoming"];
  onPause?: () => void;
  onResume?: () => void;
  onStop?: () => void;
}) {
  const done = transfer?.done ?? 0;
  const size = transfer?.size ?? 0;
  const elapsedSeconds = transfer?.startedAt ? Math.max((performance.now() - transfer.startedAt) / 1000, 0.1) : 0;
  const speed = transfer?.status === "transferring" ? done / elapsedSeconds : 0;

  return (
    <article className="transfer-card">
      <div>
        <span className="eyebrow">{title}</span>
        <strong>{transfer?.name ?? "暂无文件"}</strong>
      </div>
      <div className="progress-track" aria-label={title}>
        <span style={{ width: formatPercent(done, size) }} />
      </div>
      <div className="progress-meta">
        <span>{transfer ? `${formatBytes(done)} / ${formatBytes(size)}` : "等待传输"}</span>
        <span>{transfer?.status === "transferring" ? formatSpeed(speed) : translateTransferStatus(transfer?.status)}</span>
      </div>
      {transfer?.status === "transferring" && onPause ? (
        <button className="transfer-action" onClick={onPause}>
          <Pause size={18} aria-hidden />
          暂停
        </button>
      ) : null}
      {transfer?.status === "paused" && onResume ? (
        <div className="transfer-actions">
          <button className="transfer-action" onClick={onResume}>
            <Play size={18} aria-hidden />
            继续
          </button>
          {onStop ? (
            <button className="transfer-action danger-action" onClick={onStop}>
              <Square size={16} aria-hidden />
              停止
            </button>
          ) : null}
        </div>
      ) : null}
      {transfer?.url ? (
        <a className="download-link" href={transfer.url} download={transfer.name}>
          <Download size={18} aria-hidden />
          下载文件
        </a>
      ) : null}
    </article>
  );
}

function mergeDevice(devices: Device[], next: Device) {
  return [...devices.filter((device) => device.id !== next.id), next];
}

function sendControl(channel: RTCDataChannel, message: ControlMessage) {
  channel.send(JSON.stringify(message));
}

function waitForBuffer(channel: RTCDataChannel) {
  if (channel.bufferedAmount < maxBufferedAmount) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const handleLow = () => {
      channel.removeEventListener("bufferedamountlow", handleLow);
      resolve();
    };
    channel.addEventListener("bufferedamountlow", handleLow);
  });
}

function waitWhilePaused() {
  const state = useTransferStore.getState();
  if (state.outgoing?.status !== "paused") {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const unsubscribe = useTransferStore.subscribe((next) => {
      if (next.outgoing?.status !== "paused") {
        unsubscribe();
        resolve();
      }
    });
  });
}

function isOutgoingStopped(fileId: string) {
  const outgoing = useTransferStore.getState().outgoing;
  return outgoing?.id === fileId && outgoing.status === "stopped";
}

function uploadRelayFile(roomId: string, file: File, token: string, onProgress: (progress: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("POST", `/api/relay/files?roomId=${encodeURIComponent(roomId)}`);
    request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    request.setRequestHeader("X-File-Type", file.type || "application/octet-stream");

    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
      }
    });

    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(100);
        resolve();
        return;
      }

      try {
        const payload = JSON.parse(request.responseText) as { error?: string };
        reject(new Error(payload.error ?? "中继上传失败"));
      } catch {
        reject(new Error("中继上传失败"));
      }
    });
    request.addEventListener("error", () => reject(new Error("中继上传失败")));
    request.send(file);
  });
}

function formatExpiry(expiresAt: number) {
  const minutes = Math.max(0, Math.round((expiresAt - Date.now()) / 60000));
  if (minutes >= 60) {
    return `${Math.round(minutes / 60)} 小时后过期`;
  }
  return `${minutes} 分钟后过期`;
}

function getStatusText(signalStatus: string, connectedCount: number, deviceCount: number) {
  if (signalStatus === "closed") return "信令已断开";
  if (signalStatus === "connecting") return "正在连接信令";
  if (connectedCount > 0) return "P2P 已连接";
  if (deviceCount > 0) return "正在协商 P2P";
  return "等待设备加入";
}

function translatePeerStatus(status?: PeerStatus) {
  if (status === "connected") return "P2P 已连接";
  if (status === "connecting" || status === "new") return "连接中";
  if (status === "failed") return "连接失败";
  if (status === "closed" || status === "disconnected") return "已断开";
  return "等待协商";
}

function translateTransferStatus(status?: string) {
  if (status === "waiting") return "等待确认";
  if (status === "paused") return "已暂停";
  if (status === "stopped") return "已停止";
  if (status === "done") return "完成";
  if (status === "rejected") return "已拒绝";
  if (status === "failed") return "失败";
  return "空闲";
}

function useWakeLock(enabled: boolean) {
  useEffect(() => {
    let lock: { release: () => Promise<void> } | undefined;
    if (!enabled || !("wakeLock" in navigator)) {
      return;
    }

    void (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
      ?.request("screen")
      .then((wakeLock) => {
        lock = wakeLock;
      })
      .catch(() => undefined);

    return () => {
      void lock?.release();
    };
  }, [enabled]);
}
