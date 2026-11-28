// スクリーンのページの React の外側。通信・入力・ゲームをつなぎ、進行（flow.ts）の遷移に合わせて副作用を起こす。
// React には、画面を変える値（view）だけを渡す。tilt のたびに state は変えない（docs/design.md の「フロントエンド」）
import * as v from "valibot";
import { createRoom, submitRanking } from "../../net/api.ts";
import type { SubmitRankingResponse } from "../../shared/api.ts";
import { TeamName } from "../../shared/api.ts";
import {
  connectScreen,
  type Connection,
  type ConnectionState,
  type Latency,
  type ScreenReceived,
  type ScreenSent,
  type ScreenHandlers,
} from "../../net/client.ts";
import { COUNTDOWNS, countdownLeadMs, GO_DISPLAY_MS } from "../../shared/countdown.ts";
import {
  JOINTS,
  ROOM_CLOSED_CODE,
  type InputMethod,
  type Joint,
  type Mode,
  type PhaseMessage,
  type RejectedMessage,
} from "../../shared/messages.ts";
import {
  attachKeyboard,
  createGame,
  demoGait,
  KEYBOARD_KEYS,
  NEUTRAL_INPUTS,
  PLACEHOLDER_ART,
  type KeyboardHandle,
} from "../game/index.ts";
import {
  tiltToInput,
  type Game,
  type JointInputs,
  type Seats,
  type SeatView,
} from "../game/types.ts";
import { INITIAL_FLOW, isFull, reduce, type Flow, type FlowEvent } from "./flow.ts";
import { prepareScreen } from "./roomConnection.ts";
import { SynthAudio, type AudioState, type ScreenAudio } from "./audio.ts";

/** この時間のうちに tilt が届いた関節を、入力が効いている（active）とする（docs/api.md の status） */
export const ACTIVE_WINDOW_MS = 500;
/** ゴールしてから結果の画面に移るまで、FINISH を出す時間 */
export const FINISH_MS = 2_000;
/** status を送る間隔の上限。変わらなくてもこの間隔で送る */
const STATUS_INTERVAL_MS = 1_000;
/** active の集合が変わったかを調べる間隔 */
const ACTIVE_CHECK_MS = 100;
/**
 * 抜けたスマホを待つ時間。サーバーが関節を予約する60秒と同じ（docs/game.md の「切断と、つなぎ直し」）。
 * サーバーは予約が切れたことを知らせないので、スクリーンが、関節が room から抜けたときから数える
 */
export const RECONNECT_WAIT_MS = 60_000;
/** 遊び方から自動で進むまでの時間。4人そろっていなければ引き続き待つ */
export const HOWTO_AUTO_ADVANCE_MS = 30_000;
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
  /** 遊び方の残り秒数（切り上げ）。遊び方を出している間だけ持つ */
  howtoRemainingSec: number | undefined;
  /** プレイが始まった直後だけ重ねる合図 */
  startLabel?: string;
  /** 接続中のスマホの関節（room の joints） */
  joints: readonly Joint[];
  /** 直近 0.5 秒に tilt が届いた関節 */
  active: readonly Joint[];
  /** つなぎ直しを待っている関節と、待つ残り秒数（切り上げ。1秒に1回だけ変わる） */
  absent: Readonly<Partial<Record<Joint, number>>>;
  /** room の joints から抜けてから、予約が切れるまでの秒数（切り上げ） */
  reserved: Readonly<Partial<Record<Joint, number>>>;
  game: GameState;
  /** モード（docs/game.md の「モード」）。ロビーでだけ変えられ、プレイを始めるときの phase でスマホに知らせる */
  mode: Mode;
  /** 操作方法（docs/game.md の「操作方法」）。ロビーでだけ変えられ、phase でスマホに知らせる */
  input: InputMethod;
  debug: DebugState;
  audio: AudioState;
  /** 入力中のチーム名。正規化前の文字列を保ち、日本語の変換を妨げない */
  ranking:
    | { status: "idle" | "loading" | "failed" }
    | { status: "ready"; data: SubmitRankingResponse };
  teamNameInput: string;
  teamNameError: string | undefined;
  /** ランキング保存側が読める正規化済みの名前。入力が不正なら undefined */
  teamName: string | undefined;
  recreation: { status: "idle" | "creating" | "closing" } | { status: "failed"; message: string };
}

/** ゲームの用意ができていて、サーバーにつながっているときだけ、開始・やり直しを受け付ける */
export function canOperate(view: ScreenView): boolean {
  return (
    view.game === "ready" &&
    view.room.status === "ready" &&
    view.room.connection.status === "open" &&
    view.recreation.status !== "creating" &&
    view.recreation.status !== "closing"
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

/**
 * 画面の上の席の見せ方（docs/screens.md の「糸」）。カウントダウンとプレイ中は、開始したスマホのつなぎ直しを待つ
 * 残り秒数（absent）を、それ以外では room から抜けてからの残り秒数（reserved）を出す
 */
export function seatsOf(view: ScreenView): Seats {
  const { flow } = view;
  const moveName = flow.kind === "howto";
  const showName = flow.kind === "lobby" || moveName;
  const inRun = flow.kind === "countdown" || flow.kind === "playing";
  const seatOf = (joint: Joint): SeatView => {
    if (view.joints.includes(joint)) {
      return {
        showName,
        moveName,
        ready: moveName && flow.ready.includes(joint),
        state: { kind: "joined", active: view.active.includes(joint) },
      };
    }
    const remainingSec = inRun
      ? flow.players.includes(joint)
        ? view.absent[joint]
        : undefined
      : view.reserved[joint];
    if (remainingSec !== undefined) {
      return { showName, moveName, ready: false, state: { kind: "reserved", remainingSec } };
    }
    const key = keyboardDrives(view, joint) ? KEYBOARD_KEYS[joint].label : undefined;
    return { showName, moveName, ready: false, state: { kind: "empty" }, key };
  };
  return {
    leftKnee: seatOf("leftKnee"),
    leftHip: seatOf("leftHip"),
    rightKnee: seatOf("rightKnee"),
    rightHip: seatOf("rightHip"),
  };
}

function sameSeat(a: SeatView, b: SeatView): boolean {
  if (
    a.showName !== b.showName ||
    a.key !== b.key ||
    a.moveName !== b.moveName ||
    a.ready !== b.ready
  )
    return false;
  switch (a.state.kind) {
    case "empty":
      return b.state.kind === "empty";
    case "joined":
      return b.state.kind === "joined" && a.state.active === b.state.active;
    case "reserved":
      return b.state.kind === "reserved" && a.state.remainingSec === b.state.remainingSec;
  }
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
    howtoRemainingSec: undefined,
    joints: [],
    active: [],
    absent: {},
    reserved: {},
    game: "loading",
    mode: "normal",
    input: "tilt",
    audio: { ready: false, muted: false, unavailable: false },
    recreation: { status: "idle" },
    debug: { enabled: false, autoplay: false },
    ranking: { status: "idle" },
    teamNameInput: "",
    teamNameError: undefined,
    teamName: undefined,
  };
  private readonly listeners = new Set<() => void>();
  private game: Game | undefined;
  private seats: Seats | undefined;
  private connection: Connection<ScreenSent> | undefined;
  private roomGeneration = 0;
  private roomEnded = false;
  private readonly lifetime = new AbortController();
  private roomClose: { resolve: () => void; reject: (error: Error) => void } | undefined;
  /** 関節ごとに最後に tilt が届いた時刻（performance.now()） */
  private readonly lastTiltAt = new Map<Joint, number>();
  /** room の joints から抜けた関節と、抜けた時刻（performance.now()）。RECONNECT_WAIT_MS のあいだ持つ */
  private readonly left = new Map<Joint, number>();
  private howtoDeadline: number | undefined;
  /** 再接続前の参加者で遊び方を終えないよう、次の room を待つ */
  private waitingForHowtoRoom = false;
  private countdownTimer: ReturnType<typeof setTimeout> | undefined;
  /** カウントダウンの最初の表示（「3」「よーい」）を出す時刻（performance.now()） */
  private countdownStartedAt = 0;
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
  /** 操作方法を変えたが、まだサーバーに届けられていない。つながったら、ロビーの phase で送り直す */
  private inputUnsent = false;

  private readonly stage: HTMLElement;
  private readonly audio: ScreenAudio;

  constructor(
    stage: HTMLElement,
    debugEnabled = new URLSearchParams(location.search).has("debug"),
    audio?: ScreenAudio,
  ) {
    this.stage = stage;
    this.audio = audio ?? new SynthAudio((state) => this.update({ audio: state }));
    this.view = { ...this.view, debug: { enabled: debugEnabled, autoplay: false } };
  }

  // useSyncExternalStore に渡す
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly getSnapshot = (): ScreenView => this.view;

  /** 名前を編集できるのはロビーだけ。プレイ中と結果の名前は書き換えない */
  setTeamName(teamNameInput: string): void {
    if (this.view.flow.kind !== "lobby") return;
    const result = v.safeParse(TeamName, teamNameInput);
    this.update({
      teamNameInput,
      teamNameError: result.success ? undefined : result.issues[0].message,
      teamName: result.success ? result.output : undefined,
    });
  }

  /**
   * モードを変える。変えられるのはロビーだけ。スマホとサーバーには、プレイを始めるときの phase（playing）で届く。
   * ロビーの phase には載せない（スマホはロビーでモードを使わない）
   */
  setMode(mode: Mode): void {
    if (this.view.flow.kind !== "lobby" || mode === this.view.mode) return;
    this.update({ mode });
  }

  /**
   * 操作方法を変える。変えられるのはロビーだけ。参加中のスマホは、ロビーの phase を受け取るとすぐに切り替える。
   * つながっていなければ、つながったときに送り直す
   */
  setInputMethod(input: InputMethod): void {
    if (this.view.flow.kind !== "lobby" || input === this.view.input) return;
    this.update({ input });
    this.inputUnsent = !this.sendLobby();
  }

  /** ロビーの phase を、いまの操作方法で送る */
  private sendLobby(): boolean {
    return this.send({ type: "phase", phase: "lobby", input: this.view.input });
  }

  /** ルームを作ってつなぎ、ゲームを作る。ページに1回だけ呼ぶ */
  open(): void {
    this.keyboard = attachKeyboard(this.inputs, this.isKeyboardControlled);
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("click", this.unlockAudio, true);
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
    this.lifetime.abort();
    this.roomClose?.reject(new Error("画面を閉じました"));
    this.keyboard?.detach();
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("click", this.unlockAudio, true);
    this.audio.dispose();
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
      const usePlaceholder =
        this.view.debug.enabled &&
        new URLSearchParams(location.search).get("art") === "placeholder";
      const game = await createGame({
        container: this.stage,
        inputs: this.inputs,
        onEnd: (result) => this.dispatch({ type: "ended", result }),
        ...(usePlaceholder ? { art: PLACEHOLDER_ART } : {}),
      });
      if (this.disposed) return game.destroy();
      this.game = game;
      if (this.view.flow.kind === "lobby") game.practice();
      this.update({ game: "ready" });
    } catch (error) {
      console.error("ゲームを作れませんでした", error);
      this.update({ game: "failed" });
    }
  }

  private async openRoom(): Promise<void> {
    let roomCode: string;
    try {
      roomCode = await createRoom(this.lifetime.signal);
    } catch (error) {
      if (this.disposed) return;
      this.update({
        room: { status: "failed", message: error instanceof Error ? error.message : String(error) },
      });
      return;
    }
    if (this.disposed) return;
    this.update({ room: { status: "ready", roomCode, connection: { status: "connecting" } } });
    const generation = ++this.roomGeneration;
    this.connection = connectScreen(roomCode, this.roomHandlers(generation), {
      baseUrl: location.href,
    });
  }

  /** 古い接続の遅い通知が、新ルームの状態を上書きしないようにする。 */
  private roomHandlers(generation: number): ScreenHandlers {
    const current = () => !this.disposed && generation === this.roomGeneration;
    return {
      onStateChange: (connection) => {
        if (!current()) return;
        if (connection.status !== "open" && this.view.flow.kind === "howto")
          this.waitingForHowtoRoom = true;
        if (connection.status === "closed" && connection.code === ROOM_CLOSED_CODE)
          this.onRoomClosed();
        this.updateRoom(
          connection.status === "open" ? { connection, rejected: undefined } : { connection },
        );
        if (connection.status === "open") {
          this.flushInput();
          // 切れている間に席に入った新しい人へ、前の人の準備OK を渡さないよう、空にして送り直す。
          // 押していたスマホは、自分の関節が無い howto を受けて ready を送り直す（docs/api.md の「ready」）
          if (this.view.flow.kind === "howto") this.dispatch({ type: "howto", ready: [] });
        }
      },
      onLatency: (latency) => {
        if (current()) this.debug.latency = latency;
      },
      onMessage: (message) => {
        if (current()) this.onMessage(message);
      },
    };
  }

  /** 作成・接続に失敗したら旧ルームを続ける。終了の受け付けを確かめてから切り替える。 */
  async recreateRoom(): Promise<void> {
    if (
      this.disposed ||
      this.view.room.status !== "ready" ||
      this.view.room.connection.status !== "open" ||
      this.view.recreation.status === "creating" ||
      this.view.recreation.status === "closing"
    )
      return;
    this.update({ recreation: { status: "creating" } });
    let prepared: Awaited<ReturnType<typeof prepareScreen>> | undefined;
    try {
      const roomCode = await createRoom(this.lifetime.signal);
      if (this.disposed) return;
      prepared = await prepareScreen(roomCode, this.lifetime.signal);
      if (this.disposed) {
        prepared.discard();
        return;
      }
      if (prepared.connection.state.status !== "open")
        throw new Error("新しいルームとの接続が切れました。もう一度操作してください");
      this.update({ recreation: { status: "closing" } });
      await this.closeCurrentRoom();
      if (this.disposed) {
        prepared.discard();
        return;
      }
      const generation = ++this.roomGeneration;
      this.roomEnded = false;
      this.connection?.close();
      this.connection = prepared.connection;
      clearTimeout(this.countdownTimer);
      this.howtoDeadline = undefined;
      this.waitingForHowtoRoom = false;
      this.clearAbsent();
      this.left.clear();
      this.lastTiltAt.clear();
      this.debug.tilts = {};
      this.debug.latency = {};
      this.grabbed.clear();
      Object.assign(this.inputs, NEUTRAL_INPUTS);
      this.keyboard?.reset();
      this.game?.practice();
      this.audio.setPlaying(false);
      this.lastStatus = { key: "", at: -Infinity };
      this.update({
        room: { status: "ready", roomCode, connection: prepared.connection.state },
        flow: INITIAL_FLOW,
        howtoRemainingSec: undefined,
        joints: [],
        active: [],
        absent: {},
        reserved: {},
        debug: { ...this.view.debug, autoplay: false },
        recreation: { status: "idle" },
      });
      prepared.activate(this.roomHandlers(generation));
      // 新しいルームのスマホは傾きから始める。カメラを選んでいれば知らせる
      this.inputUnsent = this.view.input !== "tilt";
      this.flushInput();
    } catch (error) {
      prepared?.discard();
      if (!this.disposed)
        this.update({
          recreation: {
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
          },
        });
    }
  }

  /** 届けられていない操作方法を、ロビーのあいだだけ送り直す */
  private flushInput(): void {
    if (this.inputUnsent && this.view.flow.kind === "lobby") this.inputUnsent = !this.sendLobby();
  }

  private onRoomClosed(): void {
    if (!this.roomEnded) {
      this.roomEnded = true;
      clearTimeout(this.countdownTimer);
      this.clearAbsent();
      this.game?.stop();
      this.audio.setPlaying(false);
    }
    this.roomClose?.resolve();
  }

  private async closeCurrentRoom(): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        this.roomClose = { resolve, reject };
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "旧ルームの終了を確認できませんでした。接続を確認して、もう一度操作してください",
              ),
            ),
          10_000,
        );
        if (!this.connection?.send({ type: "close-room" }))
          reject(new Error("旧ルームにつながっていません。接続を待って、もう一度操作してください"));
      });
    } finally {
      clearTimeout(timer);
      this.roomClose = undefined;
    }
  }

  // 受信。tilt の順番の整理（TiltSequencer）は connectScreen がしてから渡す
  private onMessage(message: ScreenReceived): void {
    switch (message.type) {
      case "room-closed":
        this.onRoomClosed();
        break;
      case "room":
        this.onRoom(message.joints, message.vacated);
        break;
      case "phase":
        this.onPhase(message);
        break;
      case "rejected":
        // 終了通知の前に回線が切れても、再接続で no-room になれば終了済みと分かる。
        if (message.reason === "no-room") this.roomClose?.resolve();
        this.updateRoom({ rejected: message.reason });
        break;
      case "start":
        if (this.view.flow.kind === "lobby" && isFull(this.view.joints)) this.start();
        break;
      case "ready":
        this.dispatch({ type: "ready", joint: message.joint });
        this.checkHowto(performance.now());
        break;
      case "howto":
        this.dispatch({ type: "howto", ready: message.ready });
        this.checkHowto(performance.now());
        break;
      case "retry":
        if (this.view.flow.kind === "result" && isFull(this.view.joints)) this.restart();
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

  private onRoom(joints: readonly Joint[], vacated?: Joint): void {
    this.waitingForHowtoRoom = false;
    const now = performance.now();
    for (const joint of joints) {
      this.left.delete(joint);
      if (!this.view.joints.includes(joint)) this.audio.play("join");
    }
    // 抜けたスマホの入力と角度を残さない。次に同じ関節に入ったスマホに、前の値を見せない。
    // 抜けた関節だけを戻す。もともとスマホのいない関節はキーボードが動かしているので、触らない
    for (const joint of this.view.joints) {
      if (joints.includes(joint)) continue;
      // 「抜ける」で空いた席（vacated）は予約されないので、すぐ空きにする。切れた席だけ60秒を数える
      if (joint !== vacated) this.left.set(joint, now);
      this.inputs[joint] = NEUTRAL_INPUTS[joint];
      this.lastTiltAt.delete(joint);
      delete this.debug.tilts[joint];
    }
    this.syncAbsent(joints);
    this.update({
      joints,
      reserved: this.reservedSeconds(now),
      absent: this.absentSeconds(performance.now()),
    });
    const { flow } = this.view;
    // 「抜ける」で空いた席の準備OK は、次に入る人に渡さない
    if (flow.kind === "howto" && vacated !== undefined && flow.ready.includes(vacated)) {
      this.dispatch({ type: "howto", ready: flow.ready.filter((joint) => joint !== vacated) });
    }
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
    // FINISH の間は、まだ result を送っていない。出し終えたら送る
    if (flow.kind === "finish") return;
    // 終わったときに切れていて、result を送れなかった。結果の画面は残し、送り直す
    if (flow.kind === "result") {
      this.send({ type: "phase", phase: "result", result: flow.result });
      return;
    }
    const wasLobby = this.view.flow.kind === "lobby";
    this.dispatch({ type: "toLobby" });
    // ロビーのままだと遷移の副作用が無いので、サーバーが持つ playing を直すために送る
    if (wasLobby) this.sendLobby();
  }

  // 操作。スペースで開始・やり直し、Enter でデバッグの開始、R でやり直し。画面のボタンも同じメソッドを呼ぶ
  private readonly onKeyDown = (event: KeyboardEvent): void => {
    this.unlockAudio();
    if (event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey)
      return;
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("input, textarea, select, dialog, [role=menu]")
    ) {
      return;
    }
    // ボタンの Space / Enter はブラウザのクリックに任せ、開始・やり直しを二重に起こさない。
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button") &&
      (event.code === "Space" || event.code === "Enter")
    )
      return;
    const { flow } = this.view;
    if (event.code === "KeyM") {
      this.toggleMute();
    } else if (event.code === "Space") {
      event.preventDefault();
      if (flow.kind === "lobby") this.start();
      else if (flow.kind === "howto") this.skipHowto();
      else this.restart();
    } else if (event.code === "Enter" && flow.kind === "lobby") {
      this.startDebug();
    } else if (event.code === "KeyR") {
      this.restart();
    }
  };

  private readonly unlockAudio = (): void => {
    this.audio.unlock();
  };

  /** M キーと画面のボタンで、効果音・BGM をまとめて切り替える。 */
  toggleMute(): void {
    this.unlockAudio();
    const muted = !this.view.audio.muted;
    this.audio.setMuted(muted);
    this.update({ audio: { ...this.view.audio, muted } });
  }

  /** 4人そろっているときの開始 */
  start(): void {
    this.operate({
      type: "start",
      joints: this.view.joints,
      debug: false,
    });
  }

  private skipHowto(): void {
    if (this.waitingForHowtoRoom) return;
    this.operate({ type: "begin", joints: this.view.joints, delayMs: this.measuredDelays() });
  }

  private sendHowto(ready: readonly Joint[]): void {
    this.send({ type: "howto", ready: [...ready] });
  }

  private checkHowto(now: number): void {
    const { flow, joints, reserved, howtoRemainingSec } = this.view;
    if (flow.kind !== "howto" || this.howtoDeadline === undefined) return;
    if (joints.length === 0 && Object.keys(reserved).length === 0) {
      this.dispatch({ type: "toLobby" });
      return;
    }
    const remainingSec = Math.max(0, Math.ceil((this.howtoDeadline - now) / 1000));
    if (remainingSec !== howtoRemainingSec) this.update({ howtoRemainingSec: remainingSec });
    if (
      isFull(joints) &&
      (remainingSec === 0 || JOINTS.every((joint) => flow.ready.includes(joint)))
    ) {
      this.skipHowto();
    }
  }

  /** いるスマホだけで始める。いない関節は、キーボードか画面のつまみで動かす */
  startDebug(): void {
    this.operate({
      type: "start",
      joints: this.view.joints,
      debug: true,
      delayMs: this.measuredDelays(),
    });
  }

  /** 同じ担当でもう一度。結果の画面からも、動けなくなったプレイ中・カウントダウン中からも */
  restart(): void {
    this.operate({ type: "restart", delayMs: this.measuredDelays() });
  }

  /** 関節ごとの、いま分かっている片道の遅延（整数のミリ秒）。中央値、無ければ直近の値。計測できていない関節は含めない */
  private measuredDelays(): Partial<Record<Joint, number>> {
    const delayMs: Partial<Record<Joint, number>> = {};
    for (const joint of JOINTS) {
      const latency = this.debug.latency[joint];
      const delay = latency?.median ?? latency?.latest;
      if (delay != null) delayMs[joint] = Math.round(delay);
    }
    return delayMs;
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
    return flow.kind !== "lobby" && flow.kind !== "howto" && !flow.players.includes(joint);
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
    if (event.type === "start" && this.view.flow.kind === "lobby") {
      // キーとボタン、デバッグ開始のどの経路でも、未入力・不正な名前では始めない。
      this.setTeamName(this.view.teamNameInput);
      if (this.view.teamName === undefined) return;
    }
    this.dispatch(event);
  }

  private dispatch(event: FlowEvent): void {
    const prev = this.view.flow;
    const next = reduce(prev, event);
    if (next === prev) return;
    const startLabel =
      prev.kind === "countdown" && next.kind === "playing"
        ? COUNTDOWNS[prev.countdownKind].startLabel
        : undefined;
    if (prev.kind === "howto" && next.kind !== "howto") this.howtoDeadline = undefined;
    const howtoRemainingSec =
      next.kind === "howto"
        ? event.type === "start"
          ? HOWTO_AUTO_ADVANCE_MS / 1000
          : this.view.howtoRemainingSec
        : undefined;
    this.update({ flow: next, startLabel, howtoRemainingSec });
    this.runEffects(next, event);
    this.syncAbsent();
    this.checkSeatTimers(performance.now());
  }

  /**
   * room に合わせて、つなぎ直しの待ちを増やす・減らす。待つのはカウントダウンとプレイ中だけで、
   * それ以外では待ちを持たない
   */
  private syncAbsent(joints = this.view.joints): void {
    const { flow } = this.view;
    if (flow.kind !== "countdown" && flow.kind !== "playing") {
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
  }

  private clearAbsent(): void {
    for (const { timer } of this.absent.values()) clearTimeout(timer);
    this.absent.clear();
  }

  private absentSeconds(now: number): ScreenView["absent"] {
    const next: Partial<Record<Joint, number>> = {};
    for (const [joint, { since }] of this.absent) {
      next[joint] = Math.max(0, Math.ceil((since + RECONNECT_WAIT_MS - now) / 1000));
    }
    const prev = this.view.absent;
    return JOINTS.every((joint) => prev[joint] === next[joint]) ? prev : next;
  }

  private reservedSeconds(now: number): ScreenView["reserved"] {
    const next: Partial<Record<Joint, number>> = {};
    for (const [joint, since] of this.left) {
      const seconds = Math.ceil((since + RECONNECT_WAIT_MS - now) / 1000);
      if (seconds > 0) next[joint] = seconds;
      else this.left.delete(joint);
    }
    const prev = this.view.reserved;
    return JOINTS.every((joint) => prev[joint] === next[joint]) ? prev : next;
  }

  private checkSeatTimers(now: number): void {
    const absent = this.absentSeconds(now);
    const reserved = this.reservedSeconds(now);
    if (absent !== this.view.absent || reserved !== this.view.reserved) {
      this.update({ absent, reserved });
    }
  }

  /** 待ちきれなかった。ゲームを今の場所で止め、距離だけの結果を出す */
  private giveUp(): void {
    if (this.view.flow.kind !== "playing" || this.game === undefined) return;
    const distanceM = this.game.stop({ showResult: true });
    this.dispatch({ type: "ended", result: { outcome: "disconnected", distanceM } });
  }

  /** 遷移に合わせた副作用 */
  private runEffects(next: Flow, event: FlowEvent): void {
    this.audio.setPlaying(next.kind === "playing");
    switch (next.kind) {
      case "howto":
        if (event.type === "start") {
          this.howtoDeadline = performance.now() + HOWTO_AUTO_ADVANCE_MS;
          this.waitingForHowtoRoom = false;
        }
        // サーバーから届いた howto も送り返す。行き違いで、サーバーがスクリーンと違う一覧を持ったままにならないように
        if (event.type === "start" || event.type === "ready" || event.type === "howto")
          this.sendHowto(next.ready);
        break;
      case "countdown":
        // 最初の表示の前（遅いスマホに届くのを待つあいだ）は鳴らさない
        if (next.step.label !== "") this.audio.play("countdown");
        if (event.type === "start" || event.type === "restart" || event.type === "begin") {
          // 始めに phase を送り、スマホの画面を切り替えて、途中参加を断る
          // 前の走りのキーボードの入力を持ち越さない。スマホの関節は、次の tilt で上書きされる
          clearTimeout(this.countdownTimer);
          // 待ちは数え直す。いま抜けている関節は、syncAbsent が改めて待ち始める
          this.clearAbsent();
          Object.assign(this.inputs, NEUTRAL_INPUTS);
          // 前の走りで離したキーの戻りも持ち越さない。押したままのキーは、次のフレームからまた効く
          this.keyboard?.reset();
          this.game?.reset(this.view.mode);
          const kind = next.countdownKind;
          const { durationMs } = COUNTDOWNS[kind];
          const delayMs = event.delayMs ?? {};
          // いちばん遅いスマホに phase が届くまで、最初の表示を待つ。スマホは遅延を引くので、同じ時に出る
          const leadMs = countdownLeadMs(delayMs);
          this.countdownStartedAt = performance.now() + leadMs;
          this.send({
            type: "phase",
            phase: "playing",
            mode: this.view.mode,
            input: this.view.input,
            countdown: { kind, durationMs, remainingMs: leadMs + durationMs, delayMs },
          });
          this.scheduleCountdown();
        }
        break;
      case "playing":
        this.audio.play("start");
        this.playStartedAt = performance.now();
        this.countdownTimer = setTimeout(
          () => this.update({ startLabel: undefined }),
          GO_DISPLAY_MS,
        );
        this.game?.start();
        break;
      case "finish":
        // ゴールの音は FINISH と一緒に鳴らす
        clearTimeout(this.countdownTimer);
        this.audio.play("goal");
        this.countdownTimer = setTimeout(() => {
          this.game?.stop({ showResult: true });
          this.dispatch({ type: "finished" });
        }, FINISH_MS);
        break;
      case "result":
        if (next.result.outcome === "goal" && this.view.teamName) {
          this.update({ ranking: { status: "loading" } });
          void submitRanking({
            mode: this.view.mode,
            input: this.view.input,
            teamName: this.view.teamName,
            timeMs: next.result.timeMs,
          })
            .then((data) => {
              if (this.view.flow === next) this.update({ ranking: { status: "ready", data } });
            })
            .catch(() => {
              if (this.view.flow === next) this.update({ ranking: { status: "failed" } });
            });
        } else {
          this.update({ ranking: { status: "idle" } });
        }
        clearTimeout(this.countdownTimer);
        if (next.result.outcome === "fell") {
          this.audio.play(next.result.outcome);
        }
        this.send({ type: "phase", phase: "result", result: next.result });
        break;
      case "lobby":
        clearTimeout(this.countdownTimer);
        // ロビーではつまみが消え、つかんだまま消えると離したことが届かない。次のプレイに持ち越さない
        this.grabbed.clear();
        // 待ちが残ると、checkActive がその関節の入力を 0 に戻し、吊った脚が後ろに振れたままになる
        this.clearAbsent();
        for (const joint of JOINTS) {
          if (!this.view.joints.includes(joint)) this.inputs[joint] = NEUTRAL_INPUTS[joint];
        }
        this.keyboard?.reset();
        this.game?.practice();
        this.inputUnsent = !this.sendLobby();
        break;
    }
  }

  private scheduleCountdown(): void {
    const { flow } = this.view;
    if (flow.kind !== "countdown") return;
    const untilMs = flow.step.untilMs ?? COUNTDOWNS[flow.countdownKind].durationMs;
    // タイマーが遅れても、次の表示は最初の表示の時刻から数える
    const delay = Math.ceil(this.countdownStartedAt + untilMs - performance.now());
    this.countdownTimer = setTimeout(
      () => {
        this.dispatch({ type: "tick", elapsedMs: performance.now() - this.countdownStartedAt });
        this.scheduleCountdown();
      },
      Math.max(0, delay),
    );
  }

  // 入力の状態。変わったとき、または1秒に1回、status を送る
  private readonly checkActive = (): void => {
    const now = performance.now();
    // 待っている関節は、キーボードで動かされても 0 に戻す
    for (const joint of this.absent.keys()) this.inputs[joint] = ABSENT_INPUT;
    this.checkSeatTimers(now);
    this.checkHowto(now);
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
    if (this.game) {
      const seats = seatsOf(this.view);
      const previous = this.seats;
      if (!previous || !JOINTS.every((joint) => sameSeat(previous[joint], seats[joint]))) {
        this.seats = seats;
        this.game.setSeats(seats);
      }
    }
    for (const listener of this.listeners) listener();
  }
}
