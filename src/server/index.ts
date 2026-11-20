import { Hono } from "hono";
import type { PingResponse } from "../shared/api.ts";

export { Room } from "./room.ts";

const app = new Hono<{ Bindings: Env }>();

app.get("/api/ping", async (c) => {
  const count = await c.env.ROOMS.getByName("ping").countCall();
  return c.json<PingResponse>({ count });
});

app.get("/api/rooms/:roomCode/ws", async (c) => {
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("WebSocket の接続が必要です", 426);
  }
  return c.env.ROOMS.getByName(c.req.param("roomCode")).fetch(c.req.raw);
});

export default app;
