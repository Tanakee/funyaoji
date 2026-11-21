import { DurableObject } from "cloudflare:workers";
import {
  JOINTS,
  PhoneToServerMessage,
  ScreenToServerMessage,
  type Joint,
  type JoinedMessage,
  type PhaseMessage,
  type RejectedMessage,
  type RelayedPongMessage,
  type RelayedTiltMessage,
  type RoomMessage,
  type ServerToPhoneMessage,
  type ServerToScreenMessage,
} from "../shared/messages.ts";
import { parseMessage } from "../shared/parse.ts";

/** WebSocket に付けておく情報。休止（Hibernation）から戻っても残る */
type Attachment = { role: "screen" } | { role: "phone"; joint: Joint };

/** スクリーンを新しい接続で置き換えたときの close コード */
const CLOSE_REPLACED = 4000;
/** 参加を断ったときの close コード */
const CLOSE_REJECTED = 4001;

/** ストレージのキー。休止から戻っても残るように、メモリではなくストレージに置く */
const ROOM_CODE_KEY = "roomCode";
/** スクリーンから最後に受信した phase */
const PHASE_KEY = "phase";

/** ルームごとに1つ。WebSocket の接続を持ち、スマホとスクリーンの間でメッセージを中継する */
export class Room extends DurableObject<Env> {
  /** 切断を処理し終えた接続 */
  private readonly departed = new WeakSet<WebSocket>();

  /** ルームを作る。同じコードのルームがすでにあれば false */
  async create(roomCode: string): Promise<boolean> {
    if ((await this.ctx.storage.get<string>(ROOM_CODE_KEY)) !== undefined) return false;
    await this.ctx.storage.put(ROOM_CODE_KEY, roomCode);
    return true;
  }

  /** 呼ばれた回数を数える（/api/ping 用） */
  async countCall(): Promise<number> {
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS calls (id INTEGER PRIMARY KEY CHECK (id = 1), count INTEGER NOT NULL)",
    );
    return this.ctx.storage.sql
      .exec<{ count: number }>(
        "INSERT INTO calls (id, count) VALUES (1, 1) ON CONFLICT (id) DO UPDATE SET count = count + 1 RETURNING count",
      )
      .one().count;
  }

  override async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get("role");
    if (role !== "screen" && role !== "phone") {
      return new Response("role には screen か phone を指定してください", { status: 400 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    const roomCode = await this.ctx.storage.get<string>(ROOM_CODE_KEY);

    // 断る理由は no-room → playing → full の順に調べる
    if (roomCode === undefined) {
      this.reject(server, "no-room");
    } else if (role === "screen") {
      this.acceptScreen(server, roomCode);
    } else {
      const phase = await this.ctx.storage.get<PhaseMessage>(PHASE_KEY);
      if (phase?.phase === "playing") {
        this.reject(server, "playing");
      } else {
        this.acceptPhone(server, roomCode, phase);
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 送信元が送れないメッセージ・形の違うメッセージは、何も返さずに捨てる
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.role === "phone") {
      this.receiveFromPhone(attachment.joint, message);
    } else if (attachment?.role === "screen") {
      await this.receiveFromScreen(message);
    }
  }

  private receiveFromPhone(joint: Joint, message: string | ArrayBuffer): void {
    const received = parseMessage(PhoneToServerMessage, message);
    if (received === undefined) return;
    // joint はサーバーが付ける。スマホは担当を偽れない
    switch (received.type) {
      case "tilt":
        this.sendToScreens({ ...received, joint } satisfies RelayedTiltMessage);
        break;
      case "pong":
        this.sendToScreens({ ...received, joint } satisfies RelayedPongMessage);
        break;
    }
  }

  private async receiveFromScreen(message: string | ArrayBuffer): Promise<void> {
    const received = parseMessage(ScreenToServerMessage, message);
    if (received === undefined) return;
    switch (received.type) {
      case "phase":
        // プレイ中の参加を断るためと、あとから参加したスマホに送るために保持する
        await this.ctx.storage.put(PHASE_KEY, received);
        this.sendToPhones(received);
        break;
      case "status":
        this.sendToPhones(received);
        break;
      case "ping": {
        // 宛先の関節のスマホがいなければ捨てる
        const target = this.openPhones().find((ws) => phoneJoint(ws) === received.joint);
        if (target !== undefined) send(target, received);
        break;
      }
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    // エラーと close の両方が届いても、room を2回送らない
    if (this.departed.has(ws)) return;
    this.departed.add(ws);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.role !== "phone") return;
    const roomCode = await this.ctx.storage.get<string>(ROOM_CODE_KEY);
    if (roomCode !== undefined) this.broadcastRoom(roomCode, ws);
  }

  override webSocketError(ws: WebSocket): Promise<void> {
    return this.webSocketClose(ws);
  }

  private acceptScreen(ws: WebSocket, roomCode: string): void {
    // スクリーンは1つだけ。ページを開き直したときのために、古い接続を閉じて置き換える
    for (const old of this.ctx.getWebSockets("screen")) {
      try {
        old.close(CLOSE_REPLACED, "replaced");
      } catch {
        // すでに閉じかけの接続は閉じられない。そのまま置き換える
      }
    }
    this.ctx.acceptWebSocket(ws, ["screen"]);
    ws.serializeAttachment({ role: "screen" } satisfies Attachment);
    send(ws, this.roomMessage(roomCode));
  }

  /** phase は保持している最後の phase。あれば joined のあとに送り、スマホの表示をルームの状態に合わせる */
  private acceptPhone(ws: WebSocket, roomCode: string, phase: PhaseMessage | undefined): void {
    const taken = new Set(this.phoneJoints());
    const joint = JOINTS.find((j) => !taken.has(j));
    if (joint === undefined) {
      this.reject(ws, "full");
      return;
    }
    this.ctx.acceptWebSocket(ws, ["phone"]);
    ws.serializeAttachment({ role: "phone", joint } satisfies Attachment);
    send(ws, { type: "joined", joint } satisfies JoinedMessage);
    if (phase !== undefined) send(ws, phase);
    this.broadcastRoom(roomCode);
  }

  /** 受け付けずに、理由を送って閉じる */
  private reject(ws: WebSocket, reason: RejectedMessage["reason"]): void {
    ws.accept();
    send(ws, { type: "rejected", reason } satisfies RejectedMessage);
    ws.close(CLOSE_REJECTED, reason);
  }

  /** 参加者が変わったことを、スクリーンとすべてのスマホに知らせる */
  private broadcastRoom(roomCode: string, closing?: WebSocket): void {
    const message = this.roomMessage(roomCode, closing);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws !== closing) send(ws, message);
    }
  }

  private roomMessage(roomCode: string, closing?: WebSocket): RoomMessage {
    const joints = this.phoneJoints(closing);
    return { type: "room", roomCode, joints: JOINTS.filter((j) => joints.includes(j)) };
  }

  /** 接続中のスマホが担当する関節。閉じかけ・閉じた接続は除く */
  private phoneJoints(closing?: WebSocket): Joint[] {
    return this.openPhones(closing).map(phoneJoint);
  }

  /** 接続中のスマホ。閉じかけ・閉じた接続は除く */
  private openPhones(closing?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets("phone")
      .filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN);
  }

  private sendToScreens(message: ServerToScreenMessage): void {
    for (const ws of this.ctx.getWebSockets("screen")) send(ws, message);
  }

  private sendToPhones(message: ServerToPhoneMessage): void {
    for (const ws of this.openPhones()) send(ws, message);
  }
}

function phoneJoint(ws: WebSocket): Joint {
  return (ws.deserializeAttachment() as Attachment & { role: "phone" }).joint;
}

function send(ws: WebSocket, message: object): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // 閉じかけの接続には送れない。次の room で状態がそろうので無視する
  }
}
