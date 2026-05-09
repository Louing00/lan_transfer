import { HomePage } from "./pages/HomePage";
import { RoomPage } from "./pages/RoomPage";

export function App() {
  const roomMatch = window.location.pathname.match(/^\/room\/([A-Z0-9]+)$/i);
  if (roomMatch) {
    return <RoomPage roomId={roomMatch[1].toUpperCase()} />;
  }
  return <HomePage />;
}
