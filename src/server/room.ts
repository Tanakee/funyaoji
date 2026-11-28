import { DurableObject } from "cloudflare:workers";
import {
  HEARTBEAT,
  ROOM_CLOSED_CODE,
  JOINTS,
  PhoneToServerMessage,
  ScreenToServerMessage,
  type HowtoMessage,
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

/**
 * WebSocket に付けておく情報。休止（Hibernation）から戻っても残る。connectedAt は接続した時刻（ミリ秒）。
 * clientId は、スマホが接続の URL の client に付けてきた ID。付けていなければ無い。
 * departed は、切断を処理し終えたか、置き換えた（切断を処理しない）接続のとき true
 */
type Attachment = { connectedAt: number; departed?: true } & (
  | { role: "screen" }
  | { role: "phone"; joint: Joint; clientId?: string }
);

/** 切れたスマホのためにとっておく関節。expiresAt（ミリ秒）を過ぎたら無いものとして扱う */
type Reservation = { clientId: string; joint: Joint; expiresAt: number };

/** スクリーン・スマホを、同じ相手の新しい接続で置き換えたときの close コード */
const CLOSE_REPLACED = 4000;
/** 参加を断ったときの close コード */
const CLOSE_REJECTED = 4001;
/** ハートビートもメッセージも届かなくなった接続を閉じたときの close コード */
const CLOSE_TIMEOUT = 4002;

/** この時間、ハートビートもメッセージも届かない接続を、切れたとみなして閉じる */
const HEARTBEAT_TIMEOUT_MS = 15_000;
/** 切れた接続を調べるアラームを、これより短い間隔では置かない */
const MIN_STALE_CHECK_INTERVAL_MS = 1_000;
/** 誰もいなくなってから（作ってから誰も接続しないときは、作ってから）ルームを消すまでの時間 */
const ROOM_TTL_MS = 10 * 60_000;
/** 切れたスマホの関節を、同じ ID のスマホのためにとっておく時間 */
const RESERVATION_TTL_MS = 60_000;
/** スマホの ID の形。合わないものは、付いていないものとして扱う */
const CLIENT_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** ストレージのキー。休止から戻っても残るように、メモリではなくストレージに置く */
const ROOM_CODE_KEY = "roomCode";
/** 閉じたコードは再利用しない。休止から戻っても新しい参加を断る。 */
const CLOSED_KEY = "closed";
/** スクリーンから最後に受信した phase */
const PHASE_KEY = "phase";
/** 遊び方の間にスクリーンから最後に受信した howto */
const HOWTO_KEY = "howto";
/** サーバーの時計でカウントダウンが終わる時刻（ミリ秒） */
const COUNTDOWN_ENDS_AT_KEY = "countdownEndsAt";
/** 誰もいないルームを消す時刻（ミリ秒）。誰かが接続しているあいだは無い */
const DELETE_AT_KEY = "deleteAt";
/** 関節の予約（Reservation[]）。期限を過ぎたものは、読むときに消す */
const RESERVATIONS_KEY = "reservations";

/** ルームごとに1つ。WebSocket の接続を持ち、スマホとスクリーンの間でメッセージを中継する */
export class Room extends DurableObject<Env> {
  /**
   * 接続ごとに、最後にメッセージ（ハートビート以外）を受信した時刻。
   * ストレージに書くと受信のたびに書き込みが増えるので、メモリだけに置く。休止から戻ると空になる
   */
  private readonly lastMessageAt = new WeakMap<WebSocket, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // ハートビートにはランタイムが返す。ハートビートのたびには Durable Object を起こさない
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(HEARTBEAT, HEARTBEAT));
  }

  /** ルームを作る。同じコードのルームがすでにあれば false */
  async create(roomCode: string): Promise<boolean> {
    if ((await this.ctx.storage.get<string>(ROOM_CODE_KEY)) !== undefined) return false;
    await this.ctx.storage.put(ROOM_CODE_KEY, roomCode);
    this.log({ event: "created" });
    // 誰も接続しないまま放っておかれたルームも消す
    await this.scheduleDeletion(Date.now());
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
    const params = new URL(request.url).searchParams;
    const role = params.get("role");
    if (role !== "screen" && role !== "phone") {
      return new Response("role には screen か phone を指定してください", { status: 400 });
    }
    const { 0: client, 1: server } = new WebSocketPair();
    const roomCode = await this.ctx.storage.get<string>(ROOM_CODE_KEY);
    const [phase, countdownEndsAt, howto] = await Promise.all([
      this.ctx.storage.get<PhaseMessage>(PHASE_KEY),
      role === "phone" ? this.ctx.storage.get<number>(COUNTDOWN_ENDS_AT_KEY) : undefined,
      role === "phone" ? this.ctx.storage.get<HowtoMessage>(HOWTO_KEY) : undefined,
    ]);

    // 断る理由は no-room → playing → full の順に調べる。戻ってきたスマホは playing・full では断らない
    if (roomCode === undefined || (await this.ctx.storage.get<boolean>(CLOSED_KEY))) {
      this.reject(server, "no-room");
    } else if (role === "screen") {
      this.acceptScreen(server, roomCode, phase);
      await this.cancelDeletion();
    } else {
      const clientId = parseClientId(params.get("client"));
      const reservations = await this.liveReservations(Date.now());
      const returning = this.findReturning(clientId, reservations);
      if (returning === undefined && phase?.phase === "playing") {
        this.reject(server, "playing");
      } else {
        const joint = returning?.joint ?? this.freeJoint(reservations);
        if (joint === undefined) {
          this.reject(server, "full");
        } else {
          if (returning?.old !== undefined) this.replacePhone(returning.old);
          if (returning?.reservation !== undefined) {
            await this.saveReservations(reservations.filter((r) => r !== returning.reservation));
          }
          this.acceptPhone(
            server,
            roomCode,
            phase,
            countdownEndsAt,
            howto,
            joint,
            clientId,
            returning !== undefined,
          );
          await this.cancelDeletion();
        }
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * clientId のスマホが戻ってきたのなら、渡す関節を返す。新しく参加するスマホなら undefined。
   * 古い接続がまだ開いていれば（サーバーがまだ古い接続を閉じていなければ）、その関節を渡し、古い接続を置き換える。
   * 古い接続が無く、期限内の予約があれば、予約していた関節を渡す。
   * ただし、その関節をほかのスマホの開いた接続が持っていれば、予約は無いものとして扱う。
   * 予約も無く、古い接続が閉じかけで、まだ切断を処理していなければ（close がまだ webSocketClose に届いていない）、
   * その関節を渡し、古い接続を置き換える。切断を処理する前なので、予約がまだ無いため
   */
  private findReturning(
    clientId: string | undefined,
    reservations: Reservation[],
  ): { joint: Joint; old?: WebSocket; reservation?: Reservation } | undefined {
    if (clientId === undefined) return undefined;
    const old = this.openPhones().find((ws) => phoneAttachment(ws).clientId === clientId);
    if (old !== undefined) return { joint: phoneJoint(old), old };
    const held = this.phoneJoints();
    const reservation = reservations.find(
      (r) => r.clientId === clientId && !held.includes(r.joint),
    );
    if (reservation !== undefined) return { joint: reservation.joint, reservation };
    // ほかのスマホの開いた接続が持つ関節と、予約されている関節は渡さない
    const reserved = reservations.map((r) => r.joint);
    const closing = this.ctx
      .getWebSockets("phone")
      .filter(
        (ws) =>
          !isDeparted(ws) &&
          phoneAttachment(ws).clientId === clientId &&
          !held.includes(phoneJoint(ws)) &&
          !reserved.includes(phoneJoint(ws)),
      )
      // 同じ ID の閉じかけの接続が2つあれば、新しいほう
      .reduce<WebSocket | undefined>(
        (latest, ws) =>
          latest === undefined ||
          phoneAttachment(ws).connectedAt > phoneAttachment(latest).connectedAt
            ? ws
            : latest,
        undefined,
      );
    if (closing !== undefined) return { joint: phoneJoint(closing), old: closing };
    return undefined;
  }

  /** 新しく参加するスマホに渡す関節。接続中のスマホが持つ関節と、予約されている関節は渡さない */
  private freeJoint(reservations: Reservation[]): Joint | undefined {
    const taken = new Set([...this.phoneJoints(), ...reservations.map((r) => r.joint)]);
    return JOINTS.find((j) => !taken.has(j));
  }

  /**
   * 同じ ID のスマホが新しくつないできたので、古い接続を閉じる。関節は新しい接続にそのまま渡すので、
   * 古い接続の切断は処理しない（予約を作らず、関節の抜けた room も送らない）
   */
  private replacePhone(old: WebSocket): void {
    // 閉じかけの接続は置き換えとして書かない（スクリーンの置き換えと同じ）
    if (old.readyState === WebSocket.OPEN) {
      this.log({ event: "replaced", role: "phone", joint: phoneJoint(old) });
    }
    markDeparted(old);
    try {
      old.close(CLOSE_REPLACED, "replaced");
    } catch {
      // すでに閉じかけの接続は閉じられない。そのまま置き換える
    }
  }

  /** 期限内の予約。期限を過ぎた予約があれば、ストレージから消す */
  private async liveReservations(now: number): Promise<Reservation[]> {
    const all = (await this.ctx.storage.get<Reservation[]>(RESERVATIONS_KEY)) ?? [];
    const live = all.filter((r) => now < r.expiresAt);
    if (live.length !== all.length) await this.saveReservations(live);
    return live;
  }

  private async saveReservations(reservations: Reservation[]): Promise<void> {
    if (reservations.length === 0) {
      await this.ctx.storage.delete(RESERVATIONS_KEY);
    } else {
      await this.ctx.storage.put(RESERVATIONS_KEY, reservations);
    }
  }

  /**
   * 切れたスマホの関節を、同じ ID のスマホのために RESERVATION_TTL_MS のあいだとっておく。
   * 同じ ID の別の接続が開いていれば、とっておかない。
   * 置き換えた古い接続は、attachment の departed で depart が止めるので、ここには来ないはずだが、念のため。
   * ほかの開いた接続がその関節を持っていても、とっておかない（切断の処理が遅れ、先に別のスマホが入ったとき）
   */
  private async reserve(ws: WebSocket, clientId: string, joint: Joint): Promise<void> {
    const others = this.openPhones(ws);
    if (others.some((other) => phoneAttachment(other).clientId === clientId)) return;
    if (others.some((other) => phoneJoint(other) === joint)) return;
    const now = Date.now();
    const reservations = (await this.liveReservations(now)).filter((r) => r.clientId !== clientId);
    reservations.push({ clientId, joint, expiresAt: now + RESERVATION_TTL_MS });
    await this.saveReservations(reservations);
    this.log({ event: "reserved", joint });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // 形の違うメッセージでも、届いたなら接続は生きている
    this.lastMessageAt.set(ws, Date.now());
    // 閉じかけの接続から届いたものは捨てる。置き換えた古いスクリーンが新しいスクリーンの状態を上書きしたり、
    // タイムアウトで関節を空けたスマホの入力が、その関節に入った別のスマホの入力と重なったりしないように
    if (ws.readyState !== WebSocket.OPEN || isDeparted(ws)) return;
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
      case "start":
      case "retry":
      case "ready":
        this.sendToScreens({ type: received.type, joint });
        break;
      case "heartbeat":
        // HEARTBEAT と1文字でも違う形はランタイムが返さず、ここに届く。受信した時刻は上で記録した
        break;
    }
  }

  private async receiveFromScreen(message: string | ArrayBuffer): Promise<void> {
    const received = parseMessage(ScreenToServerMessage, message);
    if (received === undefined) return;
    switch (received.type) {
      case "close-room":
        await this.closeRoom();
        break;
      case "phase":
        // プレイ中の参加を断るためと、あとから接続した人に送るために保持する。
        // put を待たずに送る。送信は書き込みが確定するまで止められ（output gate）、次のメッセージより先に中継される
        void this.ctx.storage.put(PHASE_KEY, received);
        void this.ctx.storage.delete(HOWTO_KEY);
        if (received.phase === "playing" && received.countdown !== undefined) {
          void this.ctx.storage.put(
            COUNTDOWN_ENDS_AT_KEY,
            Date.now() + received.countdown.remainingMs,
          );
        } else {
          void this.ctx.storage.delete(COUNTDOWN_ENDS_AT_KEY);
        }
        this.log({ event: "phase", phase: received.phase });
        this.sendToPhones(received);
        break;
      case "howto":
        void this.ctx.storage.put(HOWTO_KEY, received);
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
      case "heartbeat":
        break;
    }
  }

  /** 終了を永続化してから通知する。切断の処理で席の予約を作らせない。 */
  private async closeRoom(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      await this.ctx.storage.put(CLOSED_KEY, true);
      await this.ctx.storage.delete([PHASE_KEY, HOWTO_KEY, RESERVATIONS_KEY, DELETE_AT_KEY]);
      await this.ctx.storage.deleteAlarm();
      for (const ws of this.ctx.getWebSockets()) {
        markDeparted(ws);
        send(ws, { type: "room-closed" });
        try {
          ws.close(ROOM_CLOSED_CODE, "room-closed");
        } catch {
          /* 閉じかけの接続 */
        }
      }
      this.log({ event: "room-closed" });
    });
  }

  override async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ): Promise<void> {
    this.log({ event: "closed", ...socketFields(ws), code, reason, wasClean });
    await this.handleClose(ws);
  }

  override webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error({
      event: "error",
      roomCode: this.ctx.id.name,
      ...socketFields(ws),
      error: String(error),
    });
    return this.handleClose(ws);
  }

  private async handleClose(ws: WebSocket): Promise<void> {
    if (!(await this.depart(ws))) return;
    if (this.openSockets(ws).length === 0) await this.scheduleDeletion(Date.now());
  }

  /**
   * 1つのアラームで、2つの仕事をする。
   * 接続があるあいだは、いちばん古い接続が期限を迎える時刻に起きて、切れた接続を閉じる。
   * ハートビートが5秒ごとに届くので、起きるのはおよそ10〜15秒ごと。5秒ごとに調べるより、リクエストと起きている時間が減る。
   * 誰もいなくなったら、DELETE_AT_KEY の時刻にルームを消す
   */
  override async alarm(): Promise<void> {
    if (await this.ctx.storage.get<boolean>(CLOSED_KEY)) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const now = Date.now();
    const nextCheckAt = await this.closeStaleSockets(now);
    if (nextCheckAt !== undefined) {
      await this.ctx.storage.setAlarm(Math.max(nextCheckAt, now + MIN_STALE_CHECK_INTERVAL_MS));
      return;
    }
    const deleteAt = await this.ctx.storage.get<number>(DELETE_AT_KEY);
    if (deleteAt !== undefined && deleteAt <= now) {
      // ルームコードと phase も消え、同じコードでまたルームを作れるようになる。
      // deleteAll がアラームも消すかは互換性の日付で変わるので、先に消しておく
      this.log({ event: "deleted" });
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
    // 消す時刻の前に起きたときは、その時刻にアラームを置き直す。
    // 切れた接続を閉じて誰もいなくなったときは、ここから ROOM_TTL_MS 後に消す
    await this.scheduleDeletion(now);
  }

  /**
   * ハートビートもメッセージも HEARTBEAT_TIMEOUT_MS のあいだ届いていない接続を閉じ、切断として扱う。
   *
   * 最後に届いた時刻は、次の3つのうち最も新しいもの。
   * - ハートビート：ランタイムが接続ごとに覚えている。休止から戻っても残る
   * - メッセージ：メモリだけに置いている。休止から戻ると分からない
   * - 接続した時刻：attachment に置いている。接続した直後の接続を閉じないための猶予
   *
   * メモリの時刻が消えるのは、休止や追い出しで Durable Object が作り直されたとき。
   * そのときも、決まりどおりにハートビートを送っているクライアントは、ハートビートの時刻で生きていると分かる。
   * 休止から戻った時刻を猶予の起点にすることもできるが、それはしない。
   * 休止と復帰が繰り返されると、切れた接続をいつまでも閉じられなくなるため
   *
   * @returns 残った接続のうち、いちばん早く期限を迎える時刻。接続が残らなければ undefined
   */
  private async closeStaleSockets(now: number): Promise<number | undefined> {
    let nextCheckAt: number | undefined;
    for (const ws of this.openSockets()) {
      const attachment = ws.deserializeAttachment() as Attachment | null;
      const lastSeenAt = Math.max(
        this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? 0,
        this.lastMessageAt.get(ws) ?? 0,
        attachment?.connectedAt ?? 0,
      );
      const expiresAt = lastSeenAt + HEARTBEAT_TIMEOUT_MS;
      if (now < expiresAt) {
        nextCheckAt = Math.min(nextCheckAt ?? expiresAt, expiresAt);
        continue;
      }
      this.log({ event: "timeout", ...socketFields(ws), idleMs: now - lastSeenAt });
      try {
        ws.close(CLOSE_TIMEOUT, "timeout");
      } catch {
        // すでに閉じかけの接続は閉じられない。切断の処理だけをする
      }
      // 切れた接続からは close が返ってこないことがあるので、webSocketClose を待たずに切断として扱う
      await this.depart(ws);
    }
    return nextCheckAt;
  }

  /**
   * 切断を処理する。スマホなら関節を空け、参加者が変わったことを知らせる。
   * ID のあるスマホなら、関節を予約しておく。すでに処理していれば false
   */
  private async depart(ws: WebSocket): Promise<boolean> {
    // エラーと close の両方が届いても、room を2回送らない
    if (isDeparted(ws)) return false;
    markDeparted(ws);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (attachment?.role === "phone") {
      if (attachment.clientId !== undefined) {
        await this.reserve(ws, attachment.clientId, attachment.joint);
      }
      const roomCode = await this.ctx.storage.get<string>(ROOM_CODE_KEY);
      if (roomCode !== undefined) this.broadcastRoom(roomCode, ws);
    }
    return true;
  }

  /**
   * 誰もいないルームを、now から ROOM_TTL_MS 後に消す。すでに予定があれば、その時刻のまま変えない。
   * 消したあとのルームには、アラームを置かない
   */
  private async scheduleDeletion(now: number): Promise<void> {
    if ((await this.ctx.storage.get<string>(ROOM_CODE_KEY)) === undefined) return;
    let deleteAt = await this.ctx.storage.get<number>(DELETE_AT_KEY);
    if (deleteAt === undefined) {
      deleteAt = now + ROOM_TTL_MS;
      await this.ctx.storage.put(DELETE_AT_KEY, deleteAt);
    }
    await this.ctx.storage.setAlarm(deleteAt);
  }

  /** 接続を受け付けたときに呼ぶ。ルームを消す予定を取り消し、切れた接続を調べ始める */
  private async cancelDeletion(): Promise<void> {
    if ((await this.ctx.storage.get<number>(DELETE_AT_KEY)) !== undefined) {
      await this.ctx.storage.delete(DELETE_AT_KEY);
    }
    // 接続があるあいだのアラームは、alarm() が次を決める。それより遅いアラーム（消す予定）だけを早める
    // 新しい接続は、接続してから HEARTBEAT_TIMEOUT_MS は閉じないので、そのときに調べればよい
    const next = Date.now() + HEARTBEAT_TIMEOUT_MS;
    const alarm = await this.ctx.storage.getAlarm();
    if (alarm === null || alarm > next) await this.ctx.storage.setAlarm(next);
  }

  /** phase は保持している最後の phase。あれば room のあとに送り、開き直したスクリーンがルームの状態を知れるようにする */
  private acceptScreen(ws: WebSocket, roomCode: string, phase: PhaseMessage | undefined): void {
    // スクリーンは1つだけ。ページを開き直したときのために、古い接続を閉じて置き換える
    for (const old of this.ctx.getWebSockets("screen")) {
      // 閉じかけの接続も返るので、開いているものを置き換えたときだけ書く
      if (old.readyState === WebSocket.OPEN) this.log({ event: "replaced", role: "screen" });
      try {
        old.close(CLOSE_REPLACED, "replaced");
      } catch {
        // すでに閉じかけの接続は閉じられない。そのまま置き換える
      }
    }
    this.ctx.acceptWebSocket(ws, ["screen"]);
    ws.serializeAttachment({ role: "screen", connectedAt: Date.now() } satisfies Attachment);
    this.log({ event: "connected", role: "screen" });
    send(ws, this.roomMessage(roomCode));
    if (phase !== undefined) send(ws, phase);
  }

  /**
   * 保存済みの phase と howto があれば、joined のあとにこの順で送る。
   * returning は、予約か置き換えで、同じ ID のスマホに関節を返したとき true
   */
  private acceptPhone(
    ws: WebSocket,
    roomCode: string,
    phase: PhaseMessage | undefined,
    countdownEndsAt: number | undefined,
    howto: HowtoMessage | undefined,
    joint: Joint,
    clientId: string | undefined,
    returning: boolean,
  ): void {
    this.ctx.acceptWebSocket(ws, ["phone"]);
    ws.serializeAttachment({
      role: "phone",
      joint,
      ...(clientId !== undefined && { clientId }),
      connectedAt: Date.now(),
    } satisfies Attachment);
    // ID そのものは書かない。付いていたかと、予約か置き換えで関節を取り戻したかだけを書く
    this.log({
      event: "connected",
      role: "phone",
      joint,
      hasClientId: clientId !== undefined,
      returning,
    });
    send(ws, { type: "joined", joint } satisfies JoinedMessage);
    if (phase?.phase === "playing" && phase.countdown !== undefined) {
      const remaining = (countdownEndsAt ?? 0) - Date.now();
      send(
        ws,
        remaining > 0
          ? { ...phase, countdown: { ...phase.countdown, remainingMs: Math.round(remaining) } }
          : { type: "phase", phase: "playing", mode: phase.mode },
      );
    } else if (phase !== undefined) {
      send(ws, phase);
    }
    if (howto !== undefined) {
      // 前の人が押した準備OK を、新しく席に入った人に引き継がない。スクリーンは、席に入ったのが同じスマホか分からない
      if (!returning && howto.ready.includes(joint)) {
        const ready = howto.ready.filter((j) => j !== joint);
        const updated = { ...howto, ready } satisfies HowtoMessage;
        void this.ctx.storage.put(HOWTO_KEY, updated);
        this.sendToScreens(updated);
        send(ws, updated);
      } else {
        send(ws, howto);
      }
    }
    // 置き換えのときは関節が変わらないが、新しい接続に room を届けるために送る
    this.broadcastRoom(roomCode);
  }

  /** 受け付けずに、理由を送って閉じる */
  private reject(ws: WebSocket, reason: RejectedMessage["reason"]): void {
    this.log({ event: "rejected", reason });
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
    return this.openSockets(closing, "phone");
  }

  /** 接続中のスクリーンとスマホ。閉じかけ・閉じた接続は除く */
  private openSockets(closing?: WebSocket, tag?: Attachment["role"]): WebSocket[] {
    return this.ctx
      .getWebSockets(tag)
      .filter((ws) => ws !== closing && ws.readyState === WebSocket.OPEN);
  }

  /**
   * 出来事を1件、ログに書く。項目で絞り込めるように、オブジェクトで書く（設計の「ログ」）。
   * tilt と pong の中継では呼ばない。毎秒100件を超え、ログの1日の上限に響く
   */
  private log(fields: { event: string } & Record<string, unknown>): void {
    // getByName で作ったので、名前はルームコード
    console.log({ roomCode: this.ctx.id.name, ...fields });
  }

  private sendToScreens(message: ServerToScreenMessage): void {
    for (const ws of this.ctx.getWebSockets("screen")) send(ws, message);
  }

  private sendToPhones(message: ServerToPhoneMessage): void {
    for (const ws of this.openPhones()) send(ws, message);
  }
}

/** 切断を処理し終えたか、置き換えた接続か。attachment に書くので、休止から戻っても分かる */
function isDeparted(ws: WebSocket): boolean {
  return (ws.deserializeAttachment() as Attachment | null)?.departed === true;
}

function markDeparted(ws: WebSocket): void {
  const attachment = ws.deserializeAttachment() as Attachment | null;
  if (attachment !== null) ws.serializeAttachment({ ...attachment, departed: true });
}

function phoneAttachment(ws: WebSocket): Attachment & { role: "phone" } {
  return ws.deserializeAttachment() as Attachment & { role: "phone" };
}

/** ログに書く、接続の役割と関節 */
function socketFields(ws: WebSocket): { role?: Attachment["role"]; joint?: Joint } {
  const attachment = ws.deserializeAttachment() as Attachment | null;
  if (attachment === null) return {};
  return attachment.role === "phone"
    ? { role: "phone", joint: attachment.joint }
    : { role: "screen" };
}

function phoneJoint(ws: WebSocket): Joint {
  return phoneAttachment(ws).joint;
}

/** 接続の URL の client。形が合わなければ、付いていないものとして扱う */
function parseClientId(value: string | null): string | undefined {
  return value !== null && CLIENT_ID_PATTERN.test(value) ? value : undefined;
}

function send(ws: WebSocket, message: object): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // 閉じかけの接続には送れない。次の room で状態がそろうので無視する
  }
}
