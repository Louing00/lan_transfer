# 局域网网页文件传输系统开发说明文档

## 1. 项目目标

开发一个可以部署在公网服务器上的 Web 应用。用户通过访问公网 Web 页面，在手机、电脑、平板等设备之间进行文件传输。文件数据本身优先走局域网点对点传输，不经过公网服务器，从而实现：

- 手机和电脑无需安装 App，只需打开网页；
- Web 页面可以部署在互联网，方便随时访问；
- 同一局域网内的设备之间传文件时，文件内容尽量不经过公网服务器；
- 支持扫码配对、设备发现、文件发送、接收确认、传输进度展示；
- 在局域网点对点失败时，可以提供可选的中继降级方案。

本项目适合用于家庭、办公室、临时会议、跨设备快速传输文件。

---

## 2. 核心设计思路

### 2.1 架构原则

公网服务器只负责：

1. 提供 Web 页面；
2. 管理房间、设备、配对状态；
3. 交换 WebRTC 信令信息；
4. 可选提供 TURN 中继服务；
5. 可选提供短时文件中继兜底。

文件内容优先通过 WebRTC DataChannel 在局域网内点对点传输。

也就是说：

```text
浏览器 A  <====== 局域网 / P2P / WebRTC DataChannel ======>  浏览器 B
    \                                                           /
     \                                                         /
      ===== 公网 Web 服务：页面、配对、信令、状态管理 ========
```

### 2.2 为什么使用 WebRTC DataChannel

浏览器无法直接通过普通 JS 发起原生 TCP/UDP 局域网连接，也无法随意扫描局域网设备。WebRTC 是浏览器内置的点对点通信能力，适合实现网页端文件传输。

WebRTC DataChannel 的优势：

- 支持浏览器之间传输二进制数据；
- 支持 NAT 穿透；
- 同一局域网内通常可以建立局域网直连；
- 不需要安装客户端；
- 手机浏览器和桌面浏览器都支持较好。

### 2.3 重要限制

需要提前接受以下现实限制：

1. Web 页面必须使用 HTTPS，WebRTC 和现代浏览器能力基本都要求安全上下文；
2. 某些浏览器为了隐私会隐藏真实局域网 IP，不能依赖 JS 获取内网 IP；
3. 局域网直连不是 100% 成功，网络隔离、AP 隔离、企业防火墙、浏览器策略都可能导致失败；
4. iOS Safari 对后台传输、大文件、内存占用比较敏感，需要分片传输；
5. 公网 Web 页面不能直接让浏览器变成“局域网服务器”，所以不要设计成浏览器监听端口等方案。

---

## 3. 推荐技术栈

### 3.1 前端

建议使用：

- React + Vite + TypeScript；
- Zustand 或 Redux Toolkit 管理状态；
- WebRTC 原生 API；
- WebSocket 用于信令；
- qrcode.react 用于生成二维码；
- Tailwind CSS 用于界面样式；
- 可选：File System Access API，用于桌面浏览器保存文件；
- 可选：Web Workers，用于大文件分片和 hash 计算。

### 3.2 后端

建议使用：

- Node.js + TypeScript；
- Fastify 或 Express；
- ws 或 socket.io；
- Redis，可选，用于多实例部署时保存房间状态；
- PostgreSQL 可选，MVP 阶段不需要数据库；
- Nginx / Caddy 作为 HTTPS 反向代理。

### 3.3 中继服务

建议部署：

- STUN：可使用公共 STUN 或自建；
- TURN：建议使用 coturn，自建 TURN 服务作为兜底。

---

## 4. 功能范围

### 4.1 MVP 必须实现

1. 公网 Web 页面访问；
2. 创建临时房间；
3. 生成房间二维码；
4. 另一台设备扫码加入房间；
5. 两台设备通过 WebSocket 完成信令交换；
6. 建立 WebRTC DataChannel；
7. 选择文件并发送；
8. 接收端显示文件信息；
9. 接收端确认后开始接收；
10. 分片传输；
11. 进度条；
12. 传输完成后下载文件；
13. 断开连接、退出房间。

### 4.2 第二阶段功能

1. 多文件队列；
2. 文件夹传输，桌面浏览器优先支持；
3. 传输速度显示；
4. 剩余时间估算；
5. 局域网连接质量检测；
6. 连接失败时启用 TURN；
7. 传输历史，仅本地保存；
8. 剪贴板文本传输；
9. 多设备房间；
10. 端到端加密提示和密钥校验。

### 4.3 第三阶段功能

1. PWA 离线缓存；
2. 桌面快捷入口；
3. 局域网设备昵称记忆；
4. 文件断点续传；
5. 后端短时中继兜底；
6. 管理后台；
7. 限流、防滥用、防刷房间。

---

## 5. 总体架构

### 5.1 组件划分

```text
frontend/
  src/
    pages/
      HomePage.tsx
      RoomPage.tsx
    components/
      DeviceCard.tsx
      QRCodePanel.tsx
      FilePicker.tsx
      TransferProgress.tsx
      ReceiveDialog.tsx
      ConnectionStatus.tsx
    webrtc/
      PeerConnectionManager.ts
      DataChannelManager.ts
      FileSender.ts
      FileReceiver.ts
      SignalingClient.ts
    stores/
      roomStore.ts
      transferStore.ts
    utils/
      file.ts
      id.ts
      format.ts

backend/
  src/
    server.ts
    routes/
      roomRoutes.ts
      healthRoutes.ts
    ws/
      signalingServer.ts
    services/
      roomService.ts
      deviceService.ts
    types/
      signaling.ts
      room.ts
    utils/
      id.ts
      ttlMap.ts
```

### 5.2 运行流程

```text
设备 A 打开网页
  -> 点击“创建传输房间”
  -> 后端生成 roomId
  -> 前端展示二维码

设备 B 扫码打开同一个 roomId
  -> 后端通知 A 有新设备加入
  -> A 和 B 通过 WebSocket 交换 offer / answer / ice candidate
  -> 建立 WebRTC PeerConnection
  -> 创建 DataChannel
  -> B 显示已连接

A 选择文件
  -> A 发送 file-meta 消息
  -> B 弹窗确认是否接收
  -> B 确认
  -> A 分片发送文件
  -> B 组装 Blob
  -> B 下载文件
```

---

## 6. 页面设计

### 6.1 首页

路径：`/`

功能：

- 显示产品说明；
- 按钮：创建房间；
- 输入框：输入房间码加入；
- 展示使用说明：同一 Wi-Fi 下传输更快；
- 展示安全提示：文件优先不经过服务器。

### 6.2 房间页

路径：`/room/:roomId`

功能：

- 展示当前设备名称；
- 展示房间二维码；
- 展示已连接设备；
- 展示连接状态：等待加入、信令连接中、P2P 连接中、已连接、连接失败；
- 文件选择区域；
- 文件发送队列；
- 接收文件弹窗；
- 传输进度；
- 退出房间按钮。

### 6.3 移动端适配

必须适配手机浏览器：

- 页面宽度 375px 起可用；
- 文件选择按钮足够大；
- 二维码区域可折叠；
- 接收确认弹窗不要太小；
- 传输时保持屏幕唤醒，可选使用 Wake Lock API；
- 页面切到后台时提示用户不要锁屏。

---

## 7. 后端接口设计

### 7.1 创建房间

`POST /api/rooms`

请求：

```json
{
  "deviceName": "MacBook Pro",
  "deviceId": "client-generated-id"
}
```

响应：

```json
{
  "roomId": "A8K3Q2",
  "joinUrl": "https://example.com/room/A8K3Q2",
  "expiresAt": 1710000000000
}
```

说明：

- roomId 使用 6 到 8 位短码；
- 房间默认 30 分钟无活动自动过期；
- 房间不保存文件。

### 7.2 查询房间

`GET /api/rooms/:roomId`

响应：

```json
{
  "roomId": "A8K3Q2",
  "exists": true,
  "devices": [
    {
      "deviceId": "xxx",
      "deviceName": "iPhone",
      "joinedAt": 1710000000000
    }
  ]
}
```

### 7.3 健康检查

`GET /api/health`

响应：

```json
{
  "status": "ok"
}
```

---

## 8. WebSocket 信令协议

### 8.1 连接地址

`wss://example.com/ws?roomId=A8K3Q2&deviceId=xxx&deviceName=iPhone`

### 8.2 通用消息格式

```ts
interface SignalingMessage {
  type: string;
  roomId: string;
  from: string;
  to?: string;
  payload?: unknown;
  timestamp: number;
}
```

### 8.3 消息类型

#### device-joined

服务器广播，有新设备加入。

```json
{
  "type": "device-joined",
  "roomId": "A8K3Q2",
  "from": "server",
  "payload": {
    "deviceId": "device-b",
    "deviceName": "iPhone"
  },
  "timestamp": 1710000000000
}
```

#### device-left

服务器广播，设备离开。

#### webrtc-offer

设备 A 发给设备 B。

```json
{
  "type": "webrtc-offer",
  "roomId": "A8K3Q2",
  "from": "device-a",
  "to": "device-b",
  "payload": {
    "sdp": "..."
  },
  "timestamp": 1710000000000
}
```

#### webrtc-answer

设备 B 发给设备 A。

#### ice-candidate

交换 ICE candidate。

```json
{
  "type": "ice-candidate",
  "roomId": "A8K3Q2",
  "from": "device-a",
  "to": "device-b",
  "payload": {
    "candidate": "...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  },
  "timestamp": 1710000000000
}
```

#### ping / pong

维持连接。

---

## 9. WebRTC 设计

### 9.1 PeerConnection 配置

前端创建 RTCPeerConnection：

```ts
const pc = new RTCPeerConnection({
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    // 生产环境建议替换为自建 TURN
    {
      urls: 'turn:turn.example.com:3478',
      username: 'user',
      credential: 'password'
    }
  ],
  iceTransportPolicy: 'all'
});
```

说明：

- `iceTransportPolicy: 'all'`：优先直连，失败后可中继；
- 如果只想强制局域网直连，可以配置为不提供 TURN，但成功率会下降；
- 生产环境不要在前端写死 TURN 长期密码，应通过后端动态签发临时凭证。

### 9.2 DataChannel 配置

```ts
const channel = pc.createDataChannel('file-transfer', {
  ordered: true
});
```

建议：

- 文件传输使用 ordered；
- 大文件必须分片；
- 需要做背压控制，不能无限 `send`。

### 9.3 连接状态

需要监听：

```ts
pc.oniceconnectionstatechange
pc.onconnectionstatechange
channel.onopen
channel.onclose
channel.onerror
```

前端状态映射：

```text
new/checking      -> 正在连接
connected         -> 已连接
completed         -> 已连接
disconnected      -> 连接不稳定
failed            -> 连接失败
closed            -> 已关闭
```

---

## 10. 文件传输协议

DataChannel 内部使用自定义消息协议。

### 10.1 消息类型

```ts
type TransferMessage =
  | FileMetaMessage
  | FileAcceptMessage
  | FileRejectMessage
  | FileChunkMessage
  | FileProgressMessage
  | FileCompleteMessage
  | FileErrorMessage;
```

### 10.2 文件元数据

发送端先发送：

```json
{
  "type": "file-meta",
  "transferId": "uuid",
  "name": "photo.jpg",
  "size": 10485760,
  "mime": "image/jpeg",
  "lastModified": 1710000000000,
  "chunkSize": 65536,
  "totalChunks": 160
}
```

### 10.3 接收确认

接收端确认：

```json
{
  "type": "file-accept",
  "transferId": "uuid"
}
```

接收端拒绝：

```json
{
  "type": "file-reject",
  "transferId": "uuid",
  "reason": "user-rejected"
}
```

### 10.4 文件分片

推荐二进制分片，不要把文件转成 base64。

一种简单方案：

1. JSON 控制消息使用字符串发送；
2. 文件 chunk 使用 ArrayBuffer 发送；
3. 每个二进制 chunk 前先发送一个 chunk-header JSON。

chunk-header：

```json
{
  "type": "file-chunk-header",
  "transferId": "uuid",
  "index": 0,
  "size": 65536
}
```

随后立即发送对应 ArrayBuffer。

更高效的方案：

给每个二进制 chunk 增加固定长度头部，例如：

```text
前 36 字节：transferId
接着 4 字节：chunk index
接着 4 字节：payload size
剩余部分：payload
```

MVP 可以先用 JSON header + ArrayBuffer 的方式，开发更简单。

### 10.5 分片大小

建议：

- 默认 chunkSize：64KB；
- 桌面浏览器可以提升到 256KB；
- iOS Safari 建议保守使用 64KB；
- 需要控制 `dataChannel.bufferedAmount`。

### 10.6 背压控制

发送端必须实现背压控制：

```ts
const MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024;

async function waitForBufferLow(channel: RTCDataChannel) {
  if (channel.bufferedAmount < MAX_BUFFERED_AMOUNT) return;

  await new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (channel.bufferedAmount < MAX_BUFFERED_AMOUNT / 2) {
        clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}
```

发送每个 chunk 前调用：

```ts
await waitForBufferLow(channel);
channel.send(chunk);
```

### 10.7 接收端组装

MVP 方案：

```ts
const chunks: ArrayBuffer[] = [];
chunks[index] = buffer;
```

完成后：

```ts
const blob = new Blob(chunks, { type: mime });
const url = URL.createObjectURL(blob);
```

然后创建下载链接：

```ts
const a = document.createElement('a');
a.href = url;
a.download = fileName;
a.click();
URL.revokeObjectURL(url);
```

注意：

- 大文件全部放内存会有压力；
- MVP 可以限制单文件 1GB 或更低；
- 第二阶段可以使用 File System Access API 流式写入。

---

## 11. 安全设计

### 11.1 房间安全

- roomId 必须随机，不要递增；
- 房间默认短时有效，比如 30 分钟；
- 房间最多允许 2 到 4 台设备；
- 需要防止暴力枚举 roomId；
- 加入房间时可以增加 4 位确认码。

### 11.2 设备配对确认

为了避免别人误加入，建议：

- A 创建设备后显示 4 位配对码；
- B 加入后双方显示同一个配对码；
- 用户确认后才建立传输。

### 11.3 文件安全

- 后端不保存文件；
- 文件名需要在前端展示时转义；
- 不自动打开接收到的文件，只提供下载；
- 对超大文件提示风险；
- 不信任 mime type，仅作为展示信息。

### 11.4 HTTPS

生产必须启用 HTTPS：

- Web 页面使用 HTTPS；
- WebSocket 使用 WSS；
- TURN 推荐使用 TLS 或至少部署在可信网络环境中。

---

## 12. 后端详细实现要求

### 12.1 RoomService

职责：

- 创建房间；
- 查询房间；
- 加入房间；
- 离开房间；
- 清理过期房间。

类型定义：

```ts
interface Room {
  roomId: string;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  devices: Map<string, Device>;
}

interface Device {
  deviceId: string;
  deviceName: string;
  joinedAt: number;
  ws?: WebSocket;
}
```

MVP 可使用内存 Map：

```ts
const rooms = new Map<string, Room>();
```

定时清理：

```ts
setInterval(() => {
  const now = Date.now();
  for (const [roomId, room] of rooms) {
    if (room.expiresAt < now) {
      closeRoom(roomId);
    }
  }
}, 60_000);
```

### 12.2 SignalingServer

职责：

- 接收 WebSocket 连接；
- 校验 roomId；
- 维护 deviceId -> WebSocket；
- 广播设备加入/离开；
- 转发 offer / answer / ice candidate；
- 心跳检测。

必须注意：

- 不解析 SDP 内容，只转发；
- 检查 `to` 是否属于当前房间；
- 不允许跨房间发消息；
- 连接断开时清理设备。

### 12.3 多实例部署

MVP 可以单实例。

如果后续需要多实例：

- 房间状态放 Redis；
- WebSocket 信令使用 Redis Pub/Sub；
- 通过 Nginx sticky session 或统一消息总线处理。

---

## 13. 前端详细实现要求

### 13.1 SignalingClient

职责：

- 建立 WSS 连接；
- 自动重连；
- 发送信令消息；
- 分发服务端消息；
- 维护当前房间设备列表。

接口建议：

```ts
class SignalingClient {
  connect(params: ConnectParams): Promise<void>;
  send(message: SignalingMessage): void;
  on(type: string, handler: Function): void;
  off(type: string, handler: Function): void;
  close(): void;
}
```

### 13.2 PeerConnectionManager

职责：

- 创建 RTCPeerConnection；
- 创建 offer；
- 处理 answer；
- 处理 ICE candidate；
- 创建或接收 DataChannel；
- 暴露连接状态。

接口建议：

```ts
class PeerConnectionManager {
  createOfferPeer(targetDeviceId: string): Promise<void>;
  handleOffer(from: string, sdp: RTCSessionDescriptionInit): Promise<void>;
  handleAnswer(from: string, sdp: RTCSessionDescriptionInit): Promise<void>;
  handleIceCandidate(from: string, candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}
```

### 13.3 FileSender

职责：

- 读取用户选择的文件；
- 发送文件元信息；
- 等待接收方确认；
- 按 chunk 分片；
- 背压控制；
- 上报进度；
- 支持取消。

伪代码：

```ts
async function sendFile(file: File) {
  const transferId = crypto.randomUUID();
  const chunkSize = 64 * 1024;
  const totalChunks = Math.ceil(file.size / chunkSize);

  sendJson({
    type: 'file-meta',
    transferId,
    name: file.name,
    size: file.size,
    mime: file.type,
    lastModified: file.lastModified,
    chunkSize,
    totalChunks
  });

  await waitForAccept(transferId);

  for (let index = 0; index < totalChunks; index++) {
    const start = index * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = await file.slice(start, end).arrayBuffer();

    sendJson({
      type: 'file-chunk-header',
      transferId,
      index,
      size: chunk.byteLength
    });

    await waitForBufferLow(dataChannel);
    dataChannel.send(chunk);

    updateProgress({
      transferId,
      sentBytes: end,
      totalBytes: file.size
    });
  }

  sendJson({
    type: 'file-complete',
    transferId
  });
}
```

### 13.4 FileReceiver

职责：

- 接收 file-meta；
- 弹窗让用户确认；
- 接收 chunk-header；
- 接收 ArrayBuffer；
- 校验 chunk 顺序和大小；
- 更新进度；
- 组装 Blob；
- 触发下载。

注意：

- DataChannel 收到的消息可能是 string，也可能是 ArrayBuffer；
- 收到 ArrayBuffer 时，需要绑定到最近一个 chunk-header；
- 如果 header 和 buffer 顺序错乱，要报错并取消传输；
- 每个 transferId 维护独立状态。

---

## 14. UI 状态设计

### 14.1 连接状态

```ts
type ConnectionStatus =
  | 'idle'
  | 'waiting'
  | 'signaling-connected'
  | 'peer-connecting'
  | 'peer-connected'
  | 'peer-disconnected'
  | 'peer-failed'
  | 'closed';
```

### 14.2 传输状态

```ts
type TransferStatus =
  | 'pending'
  | 'waiting-accept'
  | 'transferring'
  | 'completed'
  | 'rejected'
  | 'failed'
  | 'cancelled';
```

### 14.3 传输记录

```ts
interface TransferItem {
  transferId: string;
  direction: 'send' | 'receive';
  fileName: string;
  fileSize: number;
  mime?: string;
  status: TransferStatus;
  transferredBytes: number;
  totalBytes: number;
  speedBytesPerSecond?: number;
  errorMessage?: string;
}
```

---

## 15. 局域网优先策略

### 15.1 连接优先级

WebRTC ICE 会自动选择 candidate。一般情况下，同一局域网设备会优先使用 host / srflx candidate，而不是 relay candidate。

前端可以通过 `getStats()` 检测当前 candidate pair：

- 如果 `candidateType === 'host'`，大概率是局域网直连；
- 如果 `candidateType === 'srflx'`，可能是 NAT 穿透；
- 如果 `candidateType === 'relay'`，表示走了 TURN 中继。

页面可以展示：

```text
当前连接方式：局域网直连 / NAT 直连 / 中继连接
```

### 15.2 是否强制局域网

建议不要默认强制局域网，因为会降低成功率。

可以提供一个高级选项：

```text
仅允许局域网直连
```

开启后：

- 不配置 TURN；
- 或检测到 relay candidate 后提示用户当前不是局域网直连；
- 传输前要求用户确认。

---

## 16. 降级方案

### 16.1 TURN 中继

当局域网直连失败时，WebRTC 可以通过 TURN 中继传输。此时文件数据会经过 TURN 服务器。

优点：

- 成功率高；
- 仍然使用同一套 WebRTC 代码。

缺点：

- 消耗公网服务器带宽；
- 大文件成本较高。

### 16.2 HTTP 短时中继

第二阶段可选实现：

- 发送端上传文件到服务器；
- 服务器保存 10 分钟；
- 接收端下载；
- 下载完成或过期后删除。

该方案不作为 MVP 首选，因为它违背“局域网传输优先”的目标。

---

## 17. 部署方案

### 17.1 单机部署

```text
Nginx / Caddy
  -> frontend 静态文件
  -> /api 反代到 Node.js
  -> /ws 反代到 Node.js WebSocket

coturn
  -> 3478/udp
  -> 3478/tcp
  -> 5349/tcp 可选
```

### 17.2 Docker Compose 建议

服务：

- web：Node.js 后端；
- nginx 或 caddy：反向代理和 HTTPS；
- coturn：TURN 服务；
- redis：第二阶段可选。

### 17.3 域名

假设：

- Web：`https://transfer.example.com`；
- WebSocket：`wss://transfer.example.com/ws`；
- TURN：`turn.example.com:3478`。

---

## 18. Nginx 配置要点

WebSocket 反代必须包含：

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_set_header Host $host;
```

同时建议：

```nginx
client_max_body_size 10m;
```

因为 MVP 文件不通过 HTTP 上传，所以这里不需要设置很大。

---

## 19. TURN 服务配置要点

使用 coturn。

建议配置：

```text
listening-port=3478
fingerprint
lt-cred-mech
realm=transfer.example.com
user=demo:demo-password
no-multicast-peers
no-loopback-peers
```

生产环境建议使用动态临时账号，不要固定账号长期暴露在前端。

---

## 20. 测试要求

### 20.1 单元测试

需要覆盖：

- roomId 生成；
- 房间过期清理；
- 设备加入/退出；
- 信令消息路由；
- 文件大小格式化；
- chunk 切分逻辑；
- 传输进度计算。

### 20.2 集成测试

需要覆盖：

1. 创建房间；
2. 第二设备加入；
3. 信令交换；
4. DataChannel open；
5. 小文件传输；
6. 多文件连续传输；
7. 连接断开提示。

### 20.3 手工测试场景

必须测试：

- iPhone Safari -> Mac Chrome；
- Android Chrome -> Windows Edge；
- Windows Chrome -> Mac Chrome；
- 同一 Wi-Fi；
- 手机热点；
- 公司网络；
- 开启 AP 隔离的网络；
- 大文件，例如 500MB；
- 页面切后台；
- 锁屏后恢复；
- 传输中刷新页面。

---

## 21. 性能要求

MVP 建议指标：

- 100MB 文件可稳定传输；
- 500MB 文件在桌面浏览器之间可传输；
- 传输过程中页面不卡死；
- 连接建立时间一般小于 10 秒；
- DataChannel bufferedAmount 不超过 8MB；
- 后端内存不随文件大小增长。

---

## 22. 日志要求

后端日志：

- 房间创建；
- 设备加入；
- 设备离开；
- WebSocket 断开；
- 信令转发失败；
- 房间过期清理。

前端日志：

- 信令连接状态；
- ICE 状态；
- DataChannel 状态；
- 传输开始；
- 传输完成；
- 传输失败原因。

前端日志只输出到 console，不上传文件名等敏感信息到服务器。

---

## 23. 错误处理

### 23.1 常见错误提示

| 场景 | 用户提示 |
|---|---|
| WebSocket 连接失败 | 无法连接服务器，请检查网络 |
| 房间不存在 | 房间不存在或已过期 |
| WebRTC 连接失败 | 点对点连接失败，请确认两台设备在同一 Wi-Fi，或开启中继模式 |
| 文件过大 | 当前浏览器可能无法稳定接收超大文件 |
| 接收方拒绝 | 对方已拒绝接收文件 |
| 传输中断 | 连接已断开，请重新发送 |

### 23.2 技术错误码

```ts
enum ErrorCode {
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_EXPIRED = 'ROOM_EXPIRED',
  ROOM_FULL = 'ROOM_FULL',
  SIGNALING_DISCONNECTED = 'SIGNALING_DISCONNECTED',
  PEER_CONNECTION_FAILED = 'PEER_CONNECTION_FAILED',
  DATA_CHANNEL_CLOSED = 'DATA_CHANNEL_CLOSED',
  FILE_REJECTED = 'FILE_REJECTED',
  FILE_TOO_LARGE = 'FILE_TOO_LARGE',
  TRANSFER_CANCELLED = 'TRANSFER_CANCELLED',
  TRANSFER_FAILED = 'TRANSFER_FAILED'
}
```

---

## 24. MVP 开发任务拆分

### 24.1 后端任务

1. 初始化 Node.js + TypeScript 项目；
2. 实现 HTTP 服务；
3. 实现 `POST /api/rooms`；
4. 实现 `GET /api/rooms/:roomId`；
5. 实现内存 RoomService；
6. 实现 WebSocket 服务；
7. 实现设备加入/离开广播；
8. 实现 WebRTC 信令转发；
9. 实现房间过期清理；
10. 添加基础日志和错误处理。

### 24.2 前端任务

1. 初始化 React + Vite + TypeScript；
2. 实现首页；
3. 实现创建房间；
4. 实现二维码展示；
5. 实现房间页；
6. 实现 WebSocket 信令客户端；
7. 实现 PeerConnectionManager；
8. 实现 DataChannel 管理；
9. 实现文件选择；
10. 实现文件元信息发送；
11. 实现接收确认弹窗；
12. 实现分片发送；
13. 实现接收端组装下载；
14. 实现进度条；
15. 实现错误提示和重试按钮。

### 24.3 部署任务

1. 编写 Dockerfile；
2. 编写 docker-compose.yml；
3. 配置 Nginx 或 Caddy；
4. 配置 HTTPS；
5. 可选配置 coturn；
6. 编写 README 部署文档。

---

## 25. Codex 开发提示词

可以把下面这段直接给 Codex：

```text
请根据本开发说明文档实现一个局域网优先的网页文件传输系统。

技术栈要求：
- 前端使用 React + Vite + TypeScript。
- 后端使用 Node.js + TypeScript + Fastify。
- WebSocket 使用 ws。
- 文件传输使用 WebRTC DataChannel。
- 后端只负责 Web 页面、房间管理和 WebRTC 信令，不保存文件。
- 文件内容优先通过局域网 P2P 传输。

请先完成 MVP：
1. 创建房间；
2. 二维码加入；
3. WebSocket 信令；
4. WebRTC DataChannel 建连；
5. 单文件分片传输；
6. 接收端确认；
7. 进度显示；
8. 传输完成下载；
9. 基础错误处理；
10. Docker 部署。

请注意：
- 必须使用 HTTPS/WSS 的部署假设；
- 文件不要转 base64；
- 大文件必须分片；
- 发送端必须控制 dataChannel.bufferedAmount，避免浏览器崩溃；
- 后端不能因为文件大小增加内存占用；
- 代码要模块化，前后端分目录；
- 写清楚 README，包括本地开发和生产部署方式。
```

---

## 26. 推荐目录结构

```text
lan-transfer/
  README.md
  docker-compose.yml
  .env.example
  frontend/
    package.json
    vite.config.ts
    src/
      main.tsx
      App.tsx
      pages/
      components/
      webrtc/
      stores/
      utils/
  backend/
    package.json
    tsconfig.json
    src/
      server.ts
      routes/
      ws/
      services/
      types/
      utils/
  deploy/
    nginx.conf
    coturn.conf
```

---

## 27. README 必须包含

README 至少写明：

1. 项目介绍；
2. 架构说明；
3. 本地启动方式；
4. 生产部署方式；
5. HTTPS / WSS 配置说明；
6. TURN 配置说明；
7. 浏览器兼容性；
8. 常见问题；
9. 安全说明；
10. 已知限制。

---

## 28. 本地开发说明

本地开发可以使用：

```bash
# 后端
cd backend
npm install
npm run dev

# 前端
cd frontend
npm install
npm run dev
```

前端代理：

```ts
server: {
  proxy: {
    '/api': 'http://localhost:3000',
    '/ws': {
      target: 'ws://localhost:3000',
      ws: true
    }
  }
}
```

注意：

- 本地 localhost 属于安全上下文，WebRTC 可以测试；
- 手机访问电脑本地开发服务时，可能需要 HTTPS 或使用局域网 IP；
- 移动端真实测试建议部署到 HTTPS 域名。

---

## 29. 验收标准

MVP 完成后，需要满足：

1. 电脑打开网页创建房间；
2. 手机扫码加入房间；
3. 双方显示连接成功；
4. 电脑选择图片发送到手机；
5. 手机弹出确认接收；
6. 手机显示传输进度；
7. 手机可以下载文件；
8. 手机也可以反向发送文件到电脑；
9. 后端日志中没有文件内容上传；
10. 断开 Wi-Fi 后页面能提示连接失败。

---

## 30. 开发注意事项

1. 不要实现“浏览器监听局域网端口”的方案，浏览器不支持这种模式；
2. 不要用 HTTP 上传到服务器再下载作为 MVP 主链路；
3. 不要把文件转 base64；
4. 不要一次性读取超大文件到内存；
5. 不要忽略 iOS Safari 的限制；
6. 不要把 TURN 固定密码硬编码到生产前端；
7. 不要让房间永久有效；
8. 不要在服务器日志中记录完整文件名和用户隐私信息；
9. 不要默认信任加入房间的设备；
10. 不要承诺所有网络环境都能局域网直连。

---

## 31. 最终建议

本项目最合理的技术路线是：

```text
公网 Web 页面 + WebSocket 信令 + WebRTC DataChannel 文件传输 + TURN 兜底
```

其中 MVP 应优先确保：

- 两台设备扫码配对体验顺畅；
- WebRTC 连接稳定；
- 文件分片和背压控制可靠；
- 接收端下载流程清晰；
- 后端不参与文件内容传输。

只要这条主链路跑通，就可以逐步增强多文件、文件夹、PWA、断点续传和中继兜底能力。

