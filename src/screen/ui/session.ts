// スクリーンのページの React の外側。通信・入力・ゲームをつなぎ、進行（flow.ts）の遷移に合わせて副作用を起こす。
// React には、画面を変える値（view）だけを渡す。tilt のたびに state は変えない（docs/design.md の「フロントエンド」）
import { createRoom } from "../../net/api.ts";
import {
  connectScreen,
  type Connection,
  type ConnectionState,
  type Latency,
  type ScreenReceived,
  type ScreenSent,
} from "../../net/client.ts";
import {
  JOINTS,
  type Joint,
  type PhaseMessage,
  type RejectedMessage,
} from "../../shared/messages.ts";
import { attachKeyboard, createGame, NEUTRAL_INPUTS } from "../game/index.ts";
import { tiltToInput, type Game, type JointInputs } from "../game/types.ts";
import { INITIAL_FLOW, reduce, type Flow, type FlowEvent } from "./flow.ts";

/** この時間のうちに tilt が届いた関節を、入力が効いている（active）とする（docs/api.md の status） */
export const ACTIVE_WINDOW_MS = 500;
/** status を送る間隔の上限。変わらなくてもこの間隔で送る */
const STATUS_INTERVAL_MS = 1_000;
/** active の集合が変わったかを調べる間隔 */
const ACTIVE_CHECK_MS = 100;
/** カウントダウンの1つぶん */
const COUNT_MS = 1_000;

export type RoomState =
  | { status: "creating" }
  | { status: "failed"; message: string }
  | {
      status: "ready";
      roomCode: string;
      connection: ConnectionState;
      /** 断られた理由。断られたときだけ */
      rejected?: RejectedMessage["reason"];
    };

export type GameState = "loading" | "ready" | "failed";

/** 画面に出す値。変わったときだけ新しいオブジェクトにする */
export interface ScreenView {
  room: RoomState;
  flow: Flow;
  /** 接続中のスマホの関節（room の joints） */
  joints: readonly Joint[];
  /** 直近 0.5 秒に tilt が届いた関節 */
  active: readonly Joint[];
  game: GameState;
}

/** 確かめるための情報。tilt のたびに書き換える。React の state ではないので、読む側が間引いて読む */
export interface DebugInfo {
  tilts: Partial<Record<Joint, { seq: number; angle: number }>>;
  latency: Partial<Record<Joint, Latency>>;
}

export class ScreenSession {
  readonly debug: DebugInfo = { tilts: {}, latency: {} };
  /** 毎フレーム、ゲームが読む入力。tilt とキーボードが書く */
  private readonly inputs: JointInputs = { ...NEUTRAL_INPUTS };
  private view: ScreenView = {
    room: { status: "creating" },
    flow: INITIAL_FLOW,
    joints: [],
    active: [],
    game: "loading",
  };
  private readonly listeners = new Set<() => void>();
  private game: Game | undefined;
  private connection: Connection<ScreenSent> | undefined;
  /** 関節ごとに最後に tilt が届いた時刻（performance.now()） */
  private readonly lastTiltAt = new Map<Joint, number>();
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private lastStatus = { key: "", at: -Infinity };
  private detachKeyboard: (() => void) | undefined;
  private disposed = false;

  private readonly stage: HTMLElement;

  constructor(stage: HTMLElement) {
    this.stage = stage;
  }

  // useSyncExternalStore に渡す
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): ScreenView => this.view;

  /** ルームを作ってつなぎ、ゲームを作る。ページに1回だけ呼ぶ */
  open(): void {
    this.detachKeyboard = attachKeyboard(this.inputs);
    window.addEventListener("keydown", this.onKeyDown);
    this.statusTimer = setInterval(this.checkActive, ACTIVE_CHECK_MS);
    void this.openGame();
    void this.openRoom();
  }

  dispose(): void {
    this.disposed = true;
    this.detachKeyboard?.();
    window.removeEventListener("keydown", this.onKeyDown);
    clearInterval(this.statusTimer);
    clearTimeout(this.countdownTimer);
    this.connection?.close();
    this.game?.destroy();
  }

  private async openGame(): Promise<void> {
    try {
      const game = await createGame({
        container: this.stage,
        inputs: this.inputs,
        onEnd: (result) => this.dispatch({ type: "ended", result }),
      });
      if (this.disposed) return game.destroy();
      this.game = game;
      this.update({ game: "ready" });
    } catch (error) {
      console.error("ゲームを作れませんでした", error);
      this.update({ game: "failed" });
    }
  }

  private async openRoom(): Promise<void> {
    let roomCode: string;
    try {
      roomCode = await createRoom();
    } catch (error) {
      this.update({
        room: { status: "failed", message: error instanceof Error ? error.message : String(error) },
      });
      return;
    }
    if (this.disposed) return;
    this.update({ room: { status: "ready", roomCode, connection: { status: "connecting" } } });
    this.connection = connectScreen(
      roomCode,
      {
        onStateChange: (connection) =>
          // つなぎ直したら、前に断られた理由は消す
          this.updateRoom(
            connection.status === "open" ? { connection, rejected: undefined } : { connection },
          ),
        onLatency: (latency) => (this.debug.latency = latency),
        onMessage: (message) => this.onMessage(message),
      },
      { baseUrl: location.href },
    );
  }

  // 受信。tilt の順番の整理（TiltSequencer）は connectScreen がしてから渡す
  private onMessage(message: ScreenReceived): void {
    switch (message.type) {
      case "room":
        this.onRoom(message.joints);
        break;
      case "phase":
        this.onPhase(message);
        break;
      case "rejected":
        this.updateRoom({ rejected: message.reason });
        break;
      case "tilt":
        this.inputs[message.joint] = tiltToInput(message.angle);
        this.lastTiltAt.set(message.joint, performance.now());
        this.debug.tilts[message.joint] = { seq: message.seq, angle: message.angle };
        break;
    }
  }

  private onRoom(joints: readonly Joint[]): void {
    // 抜けたスマホの入力と角度を残さない。次に同じ関節に入ったスマホに、前の値を見せない。
    // 抜けた関節だけを戻す。もともとスマホのいない関節はキーボードが動かしているので、触らない
    for (const joint of this.view.joints) {
      if (joints.includes(joint)) continue;
      this.inputs[joint] = NEUTRAL_INPUTS[joint];
      this.lastTiltAt.delete(joint);
      delete this.debug.tilts[joint];
    }
    this.update({ joints });
    this.dispatch({ type: "room", joints });
    this.checkActive();
  }

  /**
   * スクリーンが phase を受け取るのは、つないだときだけ。新しいルームは playing にならないので、
   * playing が届いたら、プレイ中に切れてつなぎ直したということ。プレイは続けず、ロビーに戻す（docs/api.md の「つなぎ直し」）
   */
  private onPhase(message: PhaseMessage): void {
    if (message.phase !== "playing") return;
    const flow = this.view.flow;
    // 終わったときに切れていて、result を送れなかった。結果の画面は残し、送り直す
    if (flow.kind === "result") {
      this.send({ type: "phase", phase: "result", result: flow.result });
      return;
    }
    const wasLobby = this.view.flow.kind === "lobby";
    this.dispatch({ type: "toLobby" });
    // ロビーのままだと遷移の副作用が無いので、サーバーが持つ playing を直すために送る
    if (wasLobby) this.send({ type: "phase", phase: "lobby" });
  }

  // 操作。スペースで開始・やり直し、Enter でデバッグの開始、R でやり直し
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) {
      return;
    }
    const { flow } = this.view;
    if (event.code === "Space") {
      event.preventDefault();
      if (flow.kind === "lobby")
        this.operate({ type: "start", joints: this.view.joints, debug: false });
      else if (flow.kind === "result") this.operate({ type: "restart" });
    } else if (event.code === "Enter" && flow.kind === "lobby") {
      this.operate({ type: "start", joints: this.view.joints, debug: true });
    } else if (event.code === "KeyR" && flow.kind === "result") {
      this.operate({ type: "restart" });
    }
  };

  /** ゲームの用意ができていて、サーバーにつながっているときだけ、開始・やり直しを受け付ける */
  private operate(event: FlowEvent): void {
    const { room } = this.view;
    if (this.game === undefined) return;
    if (room.status !== "ready" || room.connection.status !== "open") return;
    this.dispatch(event);
  }

  private dispatch(event: FlowEvent): void {
    const prev = this.view.flow;
    const next = reduce(prev, event);
    if (next === prev) return;
    this.update({ flow: next });
    this.runEffects(prev, next);
  }

  /** 遷移（prev → next）に合わせた副作用 */
  private runEffects(prev: Flow, next: Flow): void {
    switch (next.kind) {
      case "countdown":
        if (prev.kind !== "countdown") {
          // 始めに phase を送り、スマホの画面を切り替えて、途中参加を断る
          // 前の走りのキーボードの入力を持ち越さない。スマホの関節は、次の tilt で上書きされる
          Object.assign(this.inputs, NEUTRAL_INPUTS);
          this.game?.reset();
          this.send({ type: "phase", phase: "playing", mode: "10m" });
        }
        this.countdownTimer = setTimeout(() => this.dispatch({ type: "tick" }), COUNT_MS);
        break;
      case "playing":
        this.game?.start();
        break;
      case "result":
        this.send({ type: "phase", phase: "result", result: next.result });
        break;
      case "lobby":
        clearTimeout(this.countdownTimer);
        this.game?.reset();
        this.send({ type: "phase", phase: "lobby" });
        break;
    }
  }

  // 入力の状態。変わったとき、または1秒に1回、status を送る
  private readonly checkActive = (): void => {
    const now = performance.now();
    const active = JOINTS.filter(
      (joint) =>
        this.view.joints.includes(joint) &&
        now - (this.lastTiltAt.get(joint) ?? -Infinity) <= ACTIVE_WINDOW_MS,
    );
    if (active.join() !== this.view.active.join()) this.update({ active });
    // 結果の画面では、スマホが入力の色を出さないので送らない
    if (this.view.flow.kind === "result") return;
    const key = active.join();
    if (key === this.lastStatus.key && now - this.lastStatus.at < STATUS_INTERVAL_MS) return;
    // 送れなかったら、記録せずに次の確認でもう一度送る
    if (this.send({ type: "status", active })) this.lastStatus = { key, at: now };
  };

  private send(message: ScreenSent): boolean {
    const sent = this.connection?.send(message) ?? false;
    // スマホは phase を受け取ると入力の色を消す。1秒待たせず、すぐに status を送り直す
    if (sent && message.type === "phase") {
      this.lastStatus = { key: "", at: -Infinity };
      this.checkActive();
    }
    return sent;
  }

  private updateRoom(patch: Partial<Extract<RoomState, { status: "ready" }>>): void {
    if (this.view.room.status !== "ready") return;
    this.update({ room: { ...this.view.room, ...patch } });
  }

  private update(patch: Partial<ScreenView>): void {
    this.view = { ...this.view, ...patch };
    for (const listener of this.listeners) listener();
  }
}
