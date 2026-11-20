import { DurableObject } from "cloudflare:workers";

export class Room extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY CHECK (id = 1), count INTEGER NOT NULL)",
    );
  }

  async countCall(): Promise<number> {
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        "INSERT INTO calls (id, count) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET count = count + 1 RETURNING count",
      )
      .one().count;
  }

  override fetch(): Response {
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  override webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    ws.send(message);
  }
}
