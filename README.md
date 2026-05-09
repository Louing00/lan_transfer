# 邻渡 Lindrop

邻渡是一个可以部署在公网服务器上的局域网优先文件传输 Web 应用。服务器只提供页面、房间管理和 WebRTC 信令转发；文件内容通过浏览器之间的 WebRTC DataChannel 点对点传输，不走“先上传服务器再下载”的路径。

## 功能

- 创建临时传输房间和房间码
- 二维码扫码加入
- WebSocket 信令交换
- WebRTC DataChannel 点对点连接
- 接收方确认后再开始传输
- 文件分片发送、进度、速度、完成后下载
- 移动端可用的响应式界面

## 本地开发

```bash
npm install
npm run dev
```

访问 `http://localhost:5173`。前端开发服务会把 `/api` 和 `/ws` 代理到后端 `http://localhost:8080`。

## 生产运行

```bash
npm install
npm run build
npm start
```

默认监听 `8080`：

```bash
PORT=8080 npm start
```

## 一键部署

服务器需要已安装 Git、Docker 和 Docker Compose。

```bash
curl -fsSL https://raw.githubusercontent.com/Louing00/lan_transfer/main/scripts/deploy.sh | bash
```

可选参数：

```bash
APP_DIR=/opt/lindrop PORT=8080 BRANCH=main bash scripts/deploy.sh
```

公网域名建议使用 Nginx 或 Caddy 反向代理到 `127.0.0.1:8080`，并启用 HTTPS。现代浏览器在公网环境下使用 WebRTC、剪贴板等能力时通常要求安全上下文。

## 一键部署 Nginx

先部署应用，再部署 Nginx 反向代理：

```bash
curl -fsSL https://raw.githubusercontent.com/Louing00/lan_transfer/main/scripts/deploy.sh | bash
curl -fsSL https://raw.githubusercontent.com/Louing00/lan_transfer/main/scripts/deploy-nginx.sh | bash
```

如果你有域名并且已经把 DNS 解析到服务器，可以自动申请 HTTPS：

```bash
DOMAIN=send.example.com EMAIL=you@example.com \
  bash scripts/deploy-nginx.sh
```

远程一键执行：

```bash
curl -fsSL https://raw.githubusercontent.com/Louing00/lan_transfer/main/scripts/deploy-nginx.sh | \
  DOMAIN=send.example.com EMAIL=you@example.com bash
```

可选参数：

```bash
DOMAIN=send.example.com UPSTREAM_PORT=8080 SITE_NAME=lindrop ENABLE_SSL=auto bash scripts/deploy-nginx.sh
```

## Nginx 反向代理示例

```nginx
server {
  server_name your-domain.example;

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location /ws {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
  }
}
```

## TURN 配置

默认使用公共 STUN：

```ts
[{ urls: "stun:stun.l.google.com:19302" }]
```

如果需要自建 TURN，可在构建前设置：

```bash
VITE_ICE_SERVERS='[{"urls":"turn:turn.example.com:3478","username":"user","credential":"pass"}]' npm run build
```

## 传输路径说明

邻渡没有文件上传 API，也不会把文件写入服务器磁盘。服务端的 WebSocket 只转发 WebRTC 信令：

```text
浏览器 A <==== WebRTC DataChannel / P2P / LAN 优先 ====> 浏览器 B
    \                                                    /
     \==== 公网服务器：页面、房间、信令，不接收文件 ====/
```

如果两端网络策略阻止点对点连接，需要配置 TURN 中继。TURN 仍属于 WebRTC 传输层兜底，不是本应用后端“先收文件再提供下载”。
