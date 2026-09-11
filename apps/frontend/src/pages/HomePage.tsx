import { ArrowRight, FileUp, Laptop, LockKeyhole, QrCode, Radio, Smartphone, Wifi } from "lucide-react";
import type { FormEvent } from "react";
import { useState } from "react";

type RoomResponse = {
  id: string;
};

export function HomePage() {
  const [roomCode, setRoomCode] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState("");

  async function createRoom() {
    setError("");
    setIsCreating(true);
    try {
      const response = await fetch("/api/rooms", { method: "POST" });
      if (!response.ok) {
        throw new Error("创建房间失败");
      }
      const room = (await response.json()) as RoomResponse;
      window.location.href = `/room/${room.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建房间失败");
    } finally {
      setIsCreating(false);
    }
  }

  function joinRoom(event: FormEvent) {
    event.preventDefault();
    const cleaned = roomCode.trim().toUpperCase();
    if (!cleaned) {
      setError("请输入房间码");
      return;
    }
    window.location.href = `/room/${cleaned}`;
  }

  return (
    <main className="home-shell">
      <header className="home-topbar">
        <a className="brand-row" href="/" aria-label="邻渡首页">
          <span className="brand-mark">邻</span>
          <span>
            <strong>邻渡</strong>
            <small>Lindrop</small>
          </span>
        </a>
        <div className="home-network-state">
          <span aria-hidden />
          P2P ready
        </div>
      </header>

      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <span className="hero-kicker">Browser to browser</span>
          <h1 id="hero-title">
            文件，<span>从这里渡过去。</span>
          </h1>
          <p>创建一个房间，让附近设备直接连接。服务器只负责相遇，文件优先走局域网。</p>

          <div className="hero-actions">
            <button className="primary-button" onClick={createRoom} disabled={isCreating}>
              <QrCode size={20} aria-hidden />
              {isCreating ? "正在创建" : "创建传输房间"}
            </button>

            <form className="join-form" onSubmit={joinRoom}>
              <input
                value={roomCode}
                onChange={(event) => setRoomCode(event.target.value)}
                placeholder="输入房间码"
                aria-label="输入房间码"
                autoCapitalize="characters"
              />
              <button type="submit" aria-label="加入房间">
                <ArrowRight size={20} aria-hidden />
              </button>
            </form>
          </div>

          {error ? <p className="inline-error">{error}</p> : null}
        </div>

        <div className="transfer-stage" aria-hidden="true">
          <div className="stage-grid" />
          <div className="device-node device-node-left">
            <span><Laptop size={30} /></span>
            <small>THIS DEVICE</small>
          </div>
          <div className="transfer-line">
            <span className="line-track" />
            <span className="file-packet"><span><FileUp size={18} /></span></span>
          </div>
          <div className="device-node device-node-right">
            <span><Smartphone size={28} /></span>
            <small>NEARBY</small>
          </div>
          <div className="stage-caption">
            <span>LOCAL CHANNEL</span>
            <strong>端到端直达</strong>
          </div>
        </div>
      </section>

      <section className="trust-strip" aria-label="传输特性">
        <article>
          <Wifi size={22} aria-hidden />
          <span><small>01</small>局域网优先</span>
        </article>
        <article>
          <Radio size={22} aria-hidden />
          <span><small>02</small>DataChannel 直连</span>
        </article>
        <article>
          <LockKeyhole size={22} aria-hidden />
          <span><small>03</small>默认不存文件</span>
        </article>
        <article className="trust-wordmark">
          <span>邻渡 <small>LINDROP</small></span>
        </article>
      </section>
    </main>
  );
}
