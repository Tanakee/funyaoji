import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { ScreenReceived, ScreenSent } from "../../net/client.ts";
import type { Joint } from "../../shared/messages.ts";
import type { GameOptions, JointInputs } from "../game/types.ts";

const sent: ScreenSent[] = [];
let connectionOpen = true;
let handlers: { onMessage: (m: ScreenReceived) => void; onStateChange?: (s: unknown) => void };
let game: GameOptions;
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
      return { reset() {}, start() {}, destroy() {} };
    },
  };
});

beforeEach(() => {
  vi.useFakeTimers();
  sent.length = 0;
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
});
