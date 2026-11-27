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
import {
  attachKeyboard,
  createGame,
  demoGait,
  NEUTRAL_INPUTS,
  type KeyboardHandle,
} from "../game/index.ts";
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
/**
 * プレイ中に切れたスマホを待つ時間。サーバーが関節を取っておく60秒と同じ（docs/game.md の「切断と、つなぎ直し」）。
 * サーバーは予約が切れたことを知らせないので、スクリーンが、関節が room から抜けたときから数える
 */
export const RECONNECT_WAIT_MS = 60_000;
/** つなぎ直しを待つあいだ、その関節に書く入力。傾き 0 と同じ */
const ABSENT_INPUT = tiltToInput(0);

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

/**
 * 1人で確かめるためのデバッグ操作の状態（docs/game.md の「操作」）。
 * enabled は URL に ?debug があるとき。autoplay はお手本の歩き方で、スマホのいない関節を動かす
 */
export interface DebugState {
  enabled: boolean;
  autoplay: boolean;
}

/** 画面に出す値。変わったときだけ新しいオブジェクトにする */
export interface ScreenView {
  room: RoomState;
  flow: Flow;
  /** 接続中のスマホの関節（room の joints） */
  joints: readonly Joint[];
  /** 直近 0.5 秒に tilt が届いた関節 */
  active: readonly Joint[];
  /** つなぎ直しを待っている関節と、待つ残り秒数（切り上げ。1秒に1回だけ変わる） */
  absent: Readonly<Partial<Record<Joint, number>>>;
  game: GameState;
  debug: DebugState;
}

/** ゲームの用意ができていて、サーバーにつながっているときだけ、開始・やり直しを受け付ける */
export function canOperate(view: ScreenView): boolean {
  return (
    view.game === "ready" && view.room.status === "ready" && view.room.connection.status === "open"
  );
}

/**
 * キーボードで動かす関節か（docs/game.md の「関節の入力」）。カウントダウンとプレイ中の、スマホのいない関節だけ。
 * プレイを始めたスマホの関節（つなぎ直しを待っているものも）と、いまスマホがつながっている関節は動かさない。
 * お手本を入れている間は、お手本に任せる。画面のキーの案内も、これに合わせて出す
 */
export function keyboardDrives(view: ScreenView, joint: Joint): boolean {
  const { flow, joints, debug } = view;
  return (
    (flow.kind === "countdown" || flow.kind === "playing") &&
    !flow.players.includes(joint) &&
    !joints.includes(joint) &&
    !debug.autoplay
  );
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
    absent: {},
    game: "loading",
    debug: { enabled: false, autoplay: false },
  };
  private readonly listeners = new Set<() => void>();
  private game: Game | undefined;
  private connection: Connection<ScreenSent> | undefined;
  /** 関節ごとに最後に tilt が届いた時刻（performance.now()） */
  private readonly lastTiltAt = new Map<Joint, number>();
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * プレイを始めた関節のうち、room から抜けて、つなぎ直しを待っているもの。
   * since は抜けたとき（performance.now()）、timer は RECONNECT_WAIT_MS 後に結果を出す予約
   */
  private readonly absent = new Map<
    Joint,
    { since: number; timer: ReturnType<typeof setTimeout> }
  >();
  private statusTimer: ReturnType<typeof setInterval> | undefined;
  private lastStatus = { key: "", at: -Infinity };
  private keyboard: KeyboardHandle | undefined;
  private disposed = false;
  /** お手本の今の値。デバッグのときだけ、毎フレーム更新する */
  private demo: JointInputs = { ...NEUTRAL_INPUTS };
  /** プレイが始まった時刻（performance.now()）。お手本の時間はここから数える */
  private playStartedAt = 0;
  /** 指やマウスでつかまれている関節。お手本より、つかんでいる手を優先する */
  private readonly grabbed = new Set<Joint>();
  private frame = 0;

  private readonly stage: HTMLElement;

  constructor(
    stage: HTMLElement,
    debugEnabled = new URLSearchParams(location.search).has("debug"),
  ) {
    this.stage = stage;
    this.view = { ...this.view, debug: { enabled: debugEnabled, autoplay: false } };
  }

  // useSyncExternalStore に渡す
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): ScreenView => this.view;

  /** ルームを作ってつなぎ、ゲームを作る。ページに1回だけ呼ぶ */
  open(): void {
    this.keyboard = attachKeyboard(this.inputs, this.isKeyboardControlled);
    window.addEventListener("keydown", this.onKeyDown);
    this.statusTimer = setInterval(this.checkActive, ACTIVE_CHECK_MS);
    if (this.view.debug.enabled) {
      // CSS が、ゲームの下にデバッグの操作の場所を空ける
      document.documentElement.dataset.debug = "";
      this.frame = requestAnimationFrame(this.onFrame);
    }
    void this.openGame();
    void this.openRoom();
  }

  dispose(): void {
    this.disposed = true;
    this.keyboard?.detach();
    window.removeEventListener("keydown", this.onKeyDown);
    clearInterval(this.statusTimer);
    clearTimeout(this.countdownTimer);
    this.clearAbsent();
    cancelAnimationFrame(this.frame);
    if (this.view.debug.enabled) delete document.documentElement.dataset.debug;
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
        // 待っている関節に古い tilt が遅れて届いても、入力は 0 のまま
        if (this.absent.has(message.joint)) break;
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
    this.syncAbsent();
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

  // 操作。スペースで開始・やり直し、Enter でデバッグの開始、R でやり直し。画面のボタンも同じメソッドを呼ぶ
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) {
      return;
    }
    const { flow } = this.view;
    if (event.code === "Space") {
      event.preventDefault();
      if (flow.kind === "lobby") this.start();
      else this.restart();
    } else if (event.code === "Enter" && flow.kind === "lobby") {
      this.startDebug();
    } else if (event.code === "KeyR") {
      this.restart();
    }
  };

  /** 4人そろっているときの開始 */
  start(): void {
    this.operate({ type: "start", joints: this.view.joints, debug: false });
  }

  /** いるスマホだけで始める。いない関節は、キーボードか画面のつまみで動かす */
  startDebug(): void {
    this.operate({ type: "start", joints: this.view.joints, debug: true });
  }

  /** 同じ担当でもう一度。結果の画面からも、動けなくなったプレイ中・カウントダウン中からも */
  restart(): void {
    this.operate({ type: "restart" });
  }

  /** お手本の自動操作を入れる・切る。スマホのいない関節だけが動く */
  setAutoplay(autoplay: boolean): void {
    this.update({ debug: { ...this.view.debug, autoplay } });
  }

  /** 画面のつまみで、スマホのいない関節を動かす。スマホのいる関節は受け付けない */
  setInput(joint: Joint, value: number): void {
    if (!this.isDebugControlled(joint)) return;
    this.inputs[joint] = Math.min(1, Math.max(0, value));
  }

  /** つまみをつかんだ・離した。つかんでいる間は、お手本が値を上書きしない */
  grab(joint: Joint, grabbed: boolean): void {
    if (grabbed) {
      this.grabbed.add(joint);
      // キーボードが離したキーで戻している途中でも、すぐに手を放させる。
      // 次のフレームまでに離されると、キーボードはつかんだことに気づかず、つまみの値を戻してしまう
      this.keyboard?.release(joint);
    } else {
      this.grabbed.delete(joint);
    }
  }

  /** 画面のつまみが毎フレーム読む、関節の今の入力 */
  readInput(joint: Joint): number {
    return this.inputs[joint];
  }

  /** 画面のつまみが毎フレーム読む、お手本の今の値 */
  readDemo(joint: Joint): number {
    return this.demo[joint];
  }

  /** つまみで動かせる関節か。スマホがいる関節は動かせない */
  private isDebugControlled(joint: Joint): boolean {
    const { flow } = this.view;
    return flow.kind !== "lobby" && !flow.players.includes(joint);
  }

  /** キーボードで動かしてよい関節か（keyboardDrives）。つまみでつかんでいる関節は、つまみに任せる */
  private readonly isKeyboardControlled = (joint: Joint): boolean =>
    keyboardDrives(this.view, joint) && !this.grabbed.has(joint);

  // デバッグのときだけ回す。お手本の値を計算し、入れているなら、プレイ中の関節に書く
  private readonly onFrame = (now: number): void => {
    this.frame = requestAnimationFrame(this.onFrame);
    const { flow, debug } = this.view;
    const playing = flow.kind === "playing";
    this.demo = demoGait(playing ? Math.max(0, now - this.playStartedAt) / 1000 : 0);
    if (!playing || !debug.autoplay) return;
    for (const joint of JOINTS) {
      if (!flow.players.includes(joint) && !this.grabbed.has(joint)) {
        this.inputs[joint] = this.demo[joint];
      }
    }
  };

  private operate(event: FlowEvent): void {
    if (this.game === undefined || !canOperate(this.view)) return;
    this.dispatch(event);
  }

  private dispatch(event: FlowEvent): void {
    const prev = this.view.flow;
    const next = reduce(prev, event);
    if (next === prev) return;
    this.update({ flow: next });
    this.runEffects(prev, next);
    this.syncAbsent();
  }

  /**
   * room に合わせて、つなぎ直しの待ちを増やす・減らす。待つのはカウントダウンとプレイ中だけで、
   * 結果とロビーでは待ちを持たない
   */
  private syncAbsent(): void {
    const { flow, joints } = this.view;
    if (flow.kind === "lobby" || flow.kind === "result") {
      this.clearAbsent();
      return;
    }
    for (const joint of flow.players) {
      const waiting = this.absent.get(joint);
      if (joints.includes(joint)) {
        // 戻った。次の tilt から入力が効く
        if (waiting) clearTimeout(waiting.timer);
        this.absent.delete(joint);
      } else if (!waiting) {
        this.inputs[joint] = ABSENT_INPUT;
        this.lastTiltAt.delete(joint);
        this.absent.set(joint, {
          since: performance.now(),
          timer: setTimeout(() => this.giveUp(), RECONNECT_WAIT_MS),
        });
      }
    }
    this.refreshAbsent();
  }

  private clearAbsent(): void {
    for (const { timer } of this.absent.values()) clearTimeout(timer);
    this.absent.clear();
    this.refreshAbsent();
  }

  /** view の absent を、いまの残り秒数に合わせる。変わったときだけ描き直す */
  private refreshAbsent(): void {
    const now = performance.now();
    const next: Partial<Record<Joint, number>> = {};
    for (const [joint, { since }] of this.absent) {
      next[joint] = Math.max(0, Math.ceil((since + RECONNECT_WAIT_MS - now) / 1000));
    }
    const prev = this.view.absent;
    if (JOINTS.every((joint) => prev[joint] === next[joint])) return;
    this.update({ absent: next });
  }

  /** 待ちきれなかった。ゲームを今の場所で止め、距離だけの結果を出す */
  private giveUp(): void {
    if (this.view.flow.kind !== "playing" || this.game === undefined) return;
    const distanceM = this.game.stop();
    this.dispatch({ type: "ended", result: { outcome: "disconnected", distanceM } });
  }

  /** 遷移（prev → next）に合わせた副作用 */
  private runEffects(prev: Flow, next: Flow): void {
    switch (next.kind) {
      case "countdown":
        // 始まりは、ロビー・結果・やり直し（count が 3 に戻る）。tick は 2・1 にしか進まない
        if (prev.kind !== "countdown" || next.count === 3) {
          // 始めに phase を送り、スマホの画面を切り替えて、途中参加を断る
          // 前の走りのキーボードの入力を持ち越さない。スマホの関節は、次の tilt で上書きされる
          clearTimeout(this.countdownTimer);
          // 待ちは数え直す。いま抜けている関節は、syncAbsent が改めて待ち始める
          this.clearAbsent();
          Object.assign(this.inputs, NEUTRAL_INPUTS);
          // 前の走りで離したキーの戻りも持ち越さない。押したままのキーは、次のフレームからまた効く
          this.keyboard?.reset();
          this.game?.reset();
          this.send({ type: "phase", phase: "playing", mode: "10m" });
        }
        this.countdownTimer = setTimeout(() => this.dispatch({ type: "tick" }), COUNT_MS);
        break;
      case "playing":
        this.playStartedAt = performance.now();
        this.game?.start();
        break;
      case "result":
        this.send({ type: "phase", phase: "result", result: next.result });
        break;
      case "lobby":
        clearTimeout(this.countdownTimer);
        // ロビーではつまみが消え、つかんだまま消えると離したことが届かない。次のプレイに持ち越さない
        this.grabbed.clear();
        this.game?.reset();
        this.send({ type: "phase", phase: "lobby" });
        break;
    }
  }

  // 入力の状態。変わったとき、または1秒に1回、status を送る
  private readonly checkActive = (): void => {
    const now = performance.now();
    // 待っている関節は、キーボードで動かされても 0 に戻す
    for (const joint of this.absent.keys()) this.inputs[joint] = ABSENT_INPUT;
    this.refreshAbsent();
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
