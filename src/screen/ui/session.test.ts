import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ScreenReceived, ScreenSent } from "../../net/client.ts";
import type { Joint } from "../../shared/messages.ts";
import type { Game, GameOptions, JointInputs } from "../game/types.ts";
import type { ScreenAudio } from "./audio.ts";
import { ScreenSession, seatsOf, type ScreenView } from "./session.ts";

const sent: ScreenSent[] = [];
let connectionOpen = true;
let handlers: { onMessage: (m: ScreenReceived) => void; onStateChange?: (s: unknown) => void };
let game: GameOptions;
const calls: string[] = [];
const setSeats = vi.fn<Game["setSeats"]>();
let stopDistance = 3.2;
type Listener = (e: Partial<KeyboardEvent>) => void;
/** window に付いたリスナー。セッションのキー操作と、キーボード操作（keyboard.ts）の両方が付く */
const listeners: Record<string, Listener[]> = {};
let keyboardControls: (joint: Joint) => boolean = () => false;
/** キーボード操作の次のフレーム */
let nextFrame: FrameRequestCallback | undefined;
let frameTime = 0;

vi.mock("../../net/api.ts", () => ({ createRoom: async () => "ABCD" }));
vi.mock("../../net/client.ts", () => ({
  connectScreen: (_room: string, h: typeof handlers) => {
    handlers = h;
    return {
      send: (m: ScreenSent) => connectionOpen && sent.push(m) > 0,
      close() {},
    };
  },
}));
vi.mock("../game/index.ts", async () => {
  const { NEUTRAL_INPUTS } = await import("../game/body.ts");
  const { demoGait } = await import("../game/demo.ts");
  const { attachKeyboard, KEYBOARD_KEYS } = await import("../game/keyboard.ts");
  return {
    NEUTRAL_INPUTS,
    demoGait,
    KEYBOARD_KEYS,
    // キーボード操作は本物を使い、フレームはテストが進める
    attachKeyboard: (inputs: JointInputs, controls: (joint: Joint) => boolean) => {
      keyboardControls = controls;
      return attachKeyboard(inputs, controls);
    },
    createGame: async (options: GameOptions) => {
      game = options;
      return {
        setSeats,
        reset: () => calls.push("reset"),
        start() {},
        stop: () => {
          calls.push("stop");
          return stopDistance;
        },
        destroy() {},
      };
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
  calls.length = 0;
  setSeats.mockClear();
  connectionOpen = true;
  for (const type of Object.keys(listeners)) delete listeners[type];
  vi.stubGlobal("window", {
    addEventListener: (type: string, f: Listener) => (listeners[type] ??= []).push(f),
    removeEventListener() {},
  });
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    nextFrame = f;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("location", { href: "http://localhost/screen" });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const fire = (type: string, code = "", patch: Partial<KeyboardEvent> = {}) => {
  for (const f of listeners[type] ?? [])
    f({ code, repeat: false, preventDefault() {}, target: null, ...patch });
};
/** キーを押して、すぐ離す */
const press = (code: string) => {
  fire("keydown", code);
  fire("keyup", code);
};
/** キーボード操作を n フレーム（1フレーム 0.1 秒）進める */
const frames = (n: number) => {
  for (let i = 0; i < n; i++) {
    frameTime = Math.max(frameTime, performance.now()) + 100;
    nextFrame?.(frameTime);
  }
};
const room = (joints: Joint[]) => handlers.onMessage({ type: "room", roomCode: "ABCD", joints });
const inputs = (): JointInputs => game.inputs;

async function open(audio?: ScreenAudio) {
  const session = new ScreenSession({} as HTMLElement, false, audio);
  session.open();
  await vi.advanceTimersByTimeAsync(10);
  handlers.onStateChange?.({ status: "open" });
  return session;
}

describe("seatsOf", () => {
  const lobby: ScreenView = {
    room: { status: "creating" },
    flow: { kind: "lobby" },
    joints: [],
    active: [],
    absent: {},
    reserved: {},
    game: "ready",
    debug: { enabled: false, autoplay: false },
    audio: { ready: false, muted: false, unavailable: false },
  };

  it("ロビーでは空席・入力中・入力なし・予約中の各席に部位名を出す", () => {
    expect(
      seatsOf({
        ...lobby,
        joints: ["leftHip", "rightKnee"],
        active: ["leftHip"],
        reserved: { rightHip: 52 },
      }),
    ).toEqual({
      leftKnee: { showName: true, state: { kind: "empty" } },
      leftHip: { showName: true, state: { kind: "joined", active: true } },
      rightKnee: { showName: true, state: { kind: "joined", active: false } },
      rightHip: { showName: true, state: { kind: "reserved", remainingSec: 52 } },
    });
  });

  it("プレイ中は開始時の担当の待ち時間を使い、空いている関節にはキーを出す", () => {
    expect(
      seatsOf({
        ...lobby,
        flow: { kind: "playing", players: ["leftHip", "rightHip"] },
        joints: ["rightHip", "rightKnee"],
        active: ["rightHip"],
        absent: { leftHip: 58 },
        reserved: { leftHip: 18, leftKnee: 40 },
      }),
    ).toEqual({
      leftKnee: { showName: false, state: { kind: "empty" }, key: "P" },
      leftHip: { showName: false, state: { kind: "reserved", remainingSec: 58 } },
      rightKnee: { showName: false, state: { kind: "joined", active: false } },
      rightHip: { showName: false, state: { kind: "joined", active: true } },
    });
  });

  it("結果では予約の残り時間を出し、部位名とキーを隠す", () => {
    const seats = seatsOf({
      ...lobby,
      flow: { kind: "result", players: ["leftKnee"], result: { outcome: "fell", distanceM: 1 } },
      reserved: { leftKnee: 20 },
    });
    expect(seats.leftKnee).toEqual({
      showName: false,
      state: { kind: "reserved", remainingSec: 20 },
    });
    expect(seats.leftHip).toEqual({ showName: false, state: { kind: "empty" } });
  });
});

describe("ScreenSession", () => {
  it("ロビーで抜けた席は予約中になり、60秒で空席に戻る", async () => {
    const session = await open();
    await vi.advanceTimersByTimeAsync(90);
    room(["leftKnee"]);
    room([]);
    expect(session.getSnapshot().reserved).toEqual({ leftKnee: 60 });
    expect(setSeats.mock.lastCall?.[0].leftKnee.state).toEqual({
      kind: "reserved",
      remainingSec: 60,
    });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(session.getSnapshot().reserved).toEqual({ leftKnee: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(session.getSnapshot().reserved).toEqual({});
    expect(setSeats.mock.lastCall?.[0].leftKnee.state).toEqual({ kind: "empty" });
    session.dispose();
  });

  it("席はゲームの作成時に渡し、接続状態や入力状態が変わったときだけ更新する", async () => {
    const session = await open();
    expect(setSeats).toHaveBeenCalledOnce();
    room(["leftKnee"]);
    room(["leftKnee"]);
    expect(setSeats).toHaveBeenCalledTimes(2);
    handlers.onMessage({ type: "tilt", joint: "leftKnee", seq: 1, angle: 45 });
    expect(setSeats).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(setSeats.mock.lastCall?.[0].leftKnee.state).toEqual({ kind: "joined", active: true });
    session.dispose();
  });

  it("M キーで全音を切り替え、キーの長押しでは切り替えを繰り返さない", async () => {
    const audio = {
      unlock: vi.fn(),
      play: vi.fn(),
      setPlaying: vi.fn(),
      setMuted: vi.fn(),
      dispose: vi.fn(),
    };
    const session = await open(audio);
    press("KeyM");
    expect(session.getSnapshot().audio.muted).toBe(true);
    fire("keydown", "KeyM", { repeat: true });
    expect(audio.setMuted.mock.calls).toEqual([[true]]);
    press("KeyM");
    expect(audio.setMuted.mock.calls).toEqual([[true], [false]]);
    expect(session.getSnapshot().flow.kind).toBe("lobby");
    session.dispose();
  });

  it("参加状態の再通知で参加音を重複させず、戻った関節では鳴らす", async () => {
    const audio = {
      unlock: vi.fn(),
      play: vi.fn(),
      setPlaying: vi.fn(),
      setMuted: vi.fn(),
      dispose: vi.fn(),
    };
    const session = await open(audio);
    room(["rightHip"]);
    room(["rightHip"]);
    room(["rightHip", "leftHip"]);
    room(["leftHip"]);
    room(["rightHip", "leftHip"]);
    expect(audio.play.mock.calls).toEqual([["join"], ["join"], ["join"]]);
    session.dispose();
    expect(audio.dispose).toHaveBeenCalledOnce();
  });

  it("キーで音を有効にし、カウントダウン・開始・終了と BGM を進行に合わせる", async () => {
    const audio = {
      unlock: vi.fn(),
      play: vi.fn(),
      setPlaying: vi.fn(),
      setMuted: vi.fn(),
      dispose: vi.fn(),
    };
    const session = await open(audio);
    press("Enter");
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(audio.play.mock.calls).toEqual([["countdown"]]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(audio.play.mock.calls).toEqual([["countdown"], ["countdown"], ["countdown"], ["start"]]);
    expect(audio.setPlaying).toHaveBeenLastCalledWith(true);
    press("KeyR");
    expect(audio.setPlaying).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(3000);
    game.onEnd({ outcome: "goal", distanceM: 10, timeMs: 4000 });
    expect(audio.play).toHaveBeenLastCalledWith("goal");
    expect(audio.setPlaying).toHaveBeenLastCalledWith(false);
    press("KeyR");
    await vi.advanceTimersByTimeAsync(3000);
    game.onEnd({ outcome: "fell", distanceM: 1 });
    expect(audio.play).toHaveBeenLastCalledWith("fell");
    session.dispose();
  });

  it("ロビーのクリックでも音を有効にでき、切断の結果で BGM を止める", async () => {
    const audio = {
      unlock: vi.fn(),
      play: vi.fn(),
      setPlaying: vi.fn(),
      setMuted: vi.fn(),
      dispose: vi.fn(),
    };
    const session = await open(audio);
    fire("click");
    expect(audio.unlock).toHaveBeenCalledOnce();
    expect(session.getSnapshot().flow.kind).toBe("lobby");
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    audio.play.mockClear();
    room([]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(audio.play).not.toHaveBeenCalled();
    expect(audio.setPlaying).toHaveBeenLastCalledWith(false);
    session.dispose();
  });

  it("終わったときに切れていたら、つなぎ直したときに結果を送り直し、結果の画面を残す", async () => {
    const session = await open();
    room(["rightHip", "leftHip", "rightKnee", "leftKnee"]);
    press("Space");
    await vi.advanceTimersByTimeAsync(3000);
    connectionOpen = false;
    game.onEnd({ outcome: "fell", distanceM: 1 });
    connectionOpen = true;
    // つなぎ直すと、サーバーは持っている phase（playing のまま）を送ってくる
    handlers.onMessage({ type: "phase", phase: "playing", mode: "10m" });

    expect(session.getSnapshot().flow.kind).toBe("result");
    expect(sent).toContainEqual({
      type: "phase",
      phase: "result",
      result: { outcome: "fell", distanceM: 1 },
    });
  });

  it("phase を送ったら、続けて status を送る", async () => {
    await open();
    room(["rightHip", "leftHip", "rightKnee", "leftKnee"]);
    await vi.advanceTimersByTimeAsync(2000);
    sent.length = 0;
    press("Space");

    expect(sent.map((m) => m.type)).toEqual(["phase", "status"]);
  });

  it("キーボードで動かしている関節の入力を、room が届いても戻さない", async () => {
    await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    inputs().leftHip = 0.9;
    room(["rightHip"]);

    expect(inputs().leftHip).toBe(0.9);
  });

  it("キーボードが動かすのは、カウントダウンとプレイ中の、スマホのいない関節だけ", async () => {
    const session = await open();
    room(["rightHip"]);
    expect(keyboardControls("leftHip")).toBe(false); // ロビー
    press("Enter");
    expect(keyboardControls("leftHip")).toBe(true); // カウントダウン
    await vi.advanceTimersByTimeAsync(3000);
    expect(keyboardControls("rightHip")).toBe(false);
    expect(keyboardControls("leftHip")).toBe(true);
    // つまみでつかんでいる関節と、お手本の間は、そちらに任せる
    session.grab("leftHip", true);
    expect(keyboardControls("leftHip")).toBe(false);
    session.grab("leftHip", false);
    expect(keyboardControls("leftHip")).toBe(true);
    session.setAutoplay(true);
    expect(keyboardControls("leftHip")).toBe(false);
    session.setAutoplay(false);
    game.onEnd({ outcome: "fell", distanceM: 1 });
    expect(keyboardControls("leftHip")).toBe(false); // 結果
  });

  it("やり直したあと、前の走りで離したキーの関節を、キーボードが動かさない", async () => {
    const { NEUTRAL_INPUTS } = await import("../game/body.ts");
    const { RELEASED_INPUT } = await import("../game/keyboard.ts");
    await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    fire("keydown", "KeyW");
    frames(2);
    fire("keyup", "KeyW");
    frames(1);
    // 離したときの値へ戻っている途中
    expect(inputs().leftHip).toBeGreaterThan(RELEASED_INPUT.hip);
    press("KeyR");
    frames(10);

    expect(inputs().leftHip).toBe(NEUTRAL_INPUTS.leftHip);
  });

  it("結果の画面のあとに入ったスマホの関節は、やり直してもキーボードが動かさない", async () => {
    await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    game.onEnd({ outcome: "fell", distanceM: 1 });
    room(["rightHip", "leftHip"]);
    press("KeyR");
    handlers.onMessage({ type: "tilt", joint: "leftHip", seq: 1, angle: 45 });
    fire("keydown", "KeyW");
    frames(5);

    expect(keyboardControls("leftHip")).toBe(false);
    expect(inputs().leftHip).toBe(0.5);
  });

  it("キーで戻している途中に、つまみを短くつかんで離しても、つまみの値を戻さない", async () => {
    const session = await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    fire("keydown", "KeyW");
    frames(2);
    fire("keyup", "KeyW");
    frames(1);
    // フレームの間に、つかんで離す
    session.grab("leftHip", true);
    session.setInput("leftHip", 0.9);
    session.grab("leftHip", false);
    frames(10);

    expect(inputs().leftHip).toBe(0.9);
  });

  it("つまみをつかんだままロビーに戻っても、次のプレイではキーボードが効く", async () => {
    const session = await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    session.grab("leftHip", true);
    // つなぎ直すと、サーバーが持つ playing が届き、ロビーに戻る。つまみは消え、離したことは届かない
    handlers.onMessage({ type: "phase", phase: "playing", mode: "10m" });
    expect(session.getSnapshot().flow.kind).toBe("lobby");
    press("Enter");

    expect(keyboardControls("leftHip")).toBe(true);
  });

  it("やり直すと、前の走りのキーボードの入力を持ち越さない", async () => {
    const { NEUTRAL_INPUTS } = await import("../game/body.ts");
    await open();
    room(["rightHip"]);
    press("Enter");
    await vi.advanceTimersByTimeAsync(3000);
    inputs().leftKnee = 1;
    game.onEnd({ outcome: "fell", distanceM: 1 });
    press("Space");

    expect(inputs().leftKnee).toBe(NEUTRAL_INPUTS.leftKnee);
  });

  describe("プレイ中に切れたスマホ", () => {
    const FOUR: Joint[] = ["rightHip", "leftHip", "rightKnee", "leftKnee"];
    async function startPlaying() {
      const session = await open();
      room(FOUR);
      press("Space");
      await vi.advanceTimersByTimeAsync(3000);
      expect(session.getSnapshot().flow.kind).toBe("playing");
      return session;
    }

    it("ロビーに戻さず、その関節の入力を 0 にして、届く古い tilt は無視する", async () => {
      const session = await startPlaying();
      handlers.onMessage({ type: "tilt", joint: "leftKnee", seq: 1, angle: 80 });
      expect(inputs().leftKnee).toBeCloseTo(80 / 90);
      room(FOUR.filter((j) => j !== "leftKnee"));
      handlers.onMessage({ type: "tilt", joint: "leftKnee", seq: 2, angle: 80 });

      expect(session.getSnapshot().flow.kind).toBe("playing");
      expect(inputs().leftKnee).toBe(0);
      expect(session.getSnapshot().absent).toEqual({ leftKnee: 60 });
    });

    it("60秒のうちに戻れば、プレイを続け、tilt が効く", async () => {
      const session = await startPlaying();
      room(FOUR.filter((j) => j !== "leftKnee"));
      await vi.advanceTimersByTimeAsync(59_000);
      room(FOUR);
      await vi.advanceTimersByTimeAsync(5_000);
      handlers.onMessage({ type: "tilt", joint: "leftKnee", seq: 3, angle: 45 });

      expect(session.getSnapshot().flow.kind).toBe("playing");
      expect(session.getSnapshot().absent).toEqual({});
      expect(inputs().leftKnee).toBe(0.5);
      expect(calls).not.toContain("stop");
    });

    it("60秒たっても戻らなければ、ゲームを止め、距離だけの切断の結果を出す", async () => {
      stopDistance = 4.5;
      const session = await startPlaying();
      room(FOUR.filter((j) => j !== "leftKnee"));
      await vi.advanceTimersByTimeAsync(59_000);
      expect(session.getSnapshot().flow.kind).toBe("playing");
      // 残り秒数は 100ms ごとに数え直すので、1秒ぶん以内のずれは許す
      expect(session.getSnapshot().absent.leftKnee).toBeLessThanOrEqual(2);
      sent.length = 0;
      await vi.advanceTimersByTimeAsync(1_000);

      expect(calls).toContain("stop");
      expect(session.getSnapshot().flow).toMatchObject({
        kind: "result",
        result: { outcome: "disconnected", distanceM: 4.5 },
      });
      expect(sent).toContainEqual({
        type: "phase",
        phase: "result",
        result: { outcome: "disconnected", distanceM: 4.5 },
      });
      expect(session.getSnapshot().absent).toEqual({});
    });

    it("待つあいだにゴール・転倒で終わったら、待ちは消え、切断の結果にならない", async () => {
      const session = await startPlaying();
      room(FOUR.filter((j) => j !== "leftKnee"));
      game.onEnd({ outcome: "fell", distanceM: 2 });
      await vi.advanceTimersByTimeAsync(61_000);

      expect(session.getSnapshot().flow).toMatchObject({
        kind: "result",
        result: { outcome: "fell" },
      });
    });

    it("プレイ中にやり直すと、同じ4人でカウントダウンになり、待ちは数え直す", async () => {
      const session = await startPlaying();
      room(FOUR.filter((j) => j !== "leftKnee"));
      await vi.advanceTimersByTimeAsync(40_000);
      calls.length = 0;
      press("KeyR");

      expect(session.getSnapshot().flow).toEqual({ kind: "countdown", count: 3, players: FOUR });
      expect(calls).toEqual(["reset"]);
      expect(session.getSnapshot().absent).toEqual({ leftKnee: 60 });
      await vi.advanceTimersByTimeAsync(3_000 + 30_000);
      expect(session.getSnapshot().flow.kind).toBe("playing");
    });

    it("カウントダウン中のやり直しも、カウントを 3 からやり直す", async () => {
      const session = await open();
      room(FOUR);
      press("Space");
      await vi.advanceTimersByTimeAsync(2_000);
      expect(session.getSnapshot().flow).toMatchObject({ kind: "countdown", count: 1 });
      press("Space");
      expect(session.getSnapshot().flow).toMatchObject({ kind: "countdown", count: 3 });
      await vi.advanceTimersByTimeAsync(2_500);
      expect(session.getSnapshot().flow).toMatchObject({ kind: "countdown", count: 1 });
    });
  });
});
