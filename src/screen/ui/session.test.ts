import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ScreenReceived, ScreenSent } from "../../net/client.ts";
import type { Joint } from "../../shared/messages.ts";
import type { GameOptions, JointInputs } from "../game/types.ts";

const sent: ScreenSent[] = [];
let connectionOpen = true;
let handlers: { onMessage: (m: ScreenReceived) => void; onStateChange?: (s: unknown) => void };
let game: GameOptions;
const calls: string[] = [];
let stopDistance = 3.2;
const keydown: { listener?: (e: Partial<KeyboardEvent>) => void } = {};

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
  return {
    NEUTRAL_INPUTS,
    demoGait,
    attachKeyboard: () => () => {},
    createGame: async (options: GameOptions) => {
      game = options;
      return {
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
  connectionOpen = true;
  vi.stubGlobal("window", {
    addEventListener: (type: string, f: (e: Partial<KeyboardEvent>) => void) => {
      if (type === "keydown") keydown.listener = f;
    },
    removeEventListener() {},
  });
  vi.stubGlobal("location", { href: "http://localhost/screen" });
  vi.stubGlobal("HTMLElement", class {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const press = (code: string) =>
  keydown.listener?.({ code, repeat: false, preventDefault() {}, target: null });
const room = (joints: Joint[]) => handlers.onMessage({ type: "room", roomCode: "ABCD", joints });
const inputs = (): JointInputs => game.inputs;

async function open() {
  const { ScreenSession } = await import("./session.ts");
  const session = new ScreenSession({} as HTMLElement);
  session.open();
  await vi.advanceTimersByTimeAsync(10);
  handlers.onStateChange?.({ status: "open" });
  return session;
}

describe("ScreenSession", () => {
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
