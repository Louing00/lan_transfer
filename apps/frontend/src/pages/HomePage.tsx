import { ArrowRight, Cable, LockKeyhole, QrCode, Radar, Wifi } from "lucide-react";
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
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="brand-row">
          <span className="brand-mark">邻</span>
          <span>
            <strong>邻渡</strong>
            <small>Lindrop</small>
          </span>
        </div>

        <div className="hero-copy">
          <h1 id="hero-title">邻渡</h1>
          <p>打开网页，扫码配对，同一局域网里的文件优先通过 WebRTC 点对点送达。</p>
        </div>

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
      </section>

      <section className="trust-strip" aria-label="传输特性">
        <article>
          <Wifi size={22} aria-hidden />
          <span>局域网优先</span>
        </article>
        <article>
          <Cable size={22} aria-hidden />
          <span>DataChannel 传输</span>
        </article>
        <article>
          <LockKeyhole size={22} aria-hidden />
          <span>服务器不存文件</span>
        </article>
        <article>
          <Radar size={22} aria-hidden />
          <span>公网只做信令</span>
        </article>
      </section>
    </main>
  );
}
