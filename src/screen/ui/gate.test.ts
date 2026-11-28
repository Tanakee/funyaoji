import { describe, expect, it } from "vite-plus/test";
import { screenGate } from "./gate.ts";
import type { ScreenView } from "./session.ts";

const open: ScreenView["room"] = {
  status: "ready",
  roomCode: "ABCD",
  connection: { status: "open" },
};
const closed = (code: number): ScreenView["room"] => ({
  status: "ready",
  roomCode: "ABCD",
  connection: { status: "closed", code, reason: "" },
});

const view = (patch: Partial<ScreenView>): ScreenView => ({
  room: open,
  flow: { kind: "lobby" },
  joints: [],
  active: [],
  absent: {},
  reserved: {},
  game: "ready",
  loadProgress: 1,
  started: true,
  mode: "normal",
  input: "tilt",
  debug: { enabled: false, autoplay: false },
  audio: { ready: false, muted: false, unavailable: false },
  recreation: { status: "idle" },
  ranking: { status: "idle" },
  teamNameInput: "",
  teamNameError: undefined,
  teamName: undefined,
  ...patch,
});

describe("screenGate", () => {
  it("読み込み中は進みを出し、終わると「はじめる」を出す。ルームの用意は待たない", () => {
    const room: ScreenView["room"] = { status: "creating" };
    expect(screenGate(view({ started: false, game: "loading", loadProgress: 0.5, room }))).toEqual({
      kind: "loading",
      progress: 0.5,
    });
    expect(screenGate(view({ started: false, room }))).toEqual({ kind: "start" });
  });

  it("始めたあとは、ルームを作っている間とつなぎ直しの間に待つ型を出し、つながると何も出さない", () => {
    expect(screenGate(view({ room: { status: "creating" } }))).toMatchObject({
      kind: "waiting",
      title: "準備しています",
    });
    const reconnecting: ScreenView["room"] = {
      status: "ready",
      roomCode: "ABCD",
      connection: { status: "reconnecting", attempt: 9 },
    };
    expect(screenGate(view({ room: reconnecting }))).toMatchObject({
      kind: "waiting",
      title: "サーバーにつなぎ直しています",
    });
    expect(screenGate(view({}))).toBeUndefined();
  });

  it("「はじめる」の前でも、読み込みとルームの失敗はお知らせ型にする", () => {
    expect(screenGate(view({ started: false, game: "failed" }))).toMatchObject({
      kind: "notice",
      reload: true,
    });
    expect(screenGate(view({ started: false, room: closed(1000) }))).toMatchObject({
      kind: "notice",
      title: "サーバーとの接続が切れました",
    });
  });

  it("1日の上限では「読み込み直す」を置かず、短い時間の作りすぎでは置く", () => {
    const failed = (reason: "daily-limit" | "too-many-requests") =>
      screenGate(view({ room: { status: "failed", message: "", reason } }));
    expect(failed("daily-limit")).toMatchObject({ kind: "notice", reload: false });
    expect(failed("too-many-requests")).toMatchObject({ kind: "notice", reload: true });
  });

  it("作り直しで旧ルームを閉じている間は出さず、失敗して閉じたままなら理由を出す", () => {
    const room = closed(4003);
    expect(screenGate(view({ room, recreation: { status: "closing" } }))).toBeUndefined();
    expect(
      screenGate(view({ room, recreation: { status: "failed", message: "理由" } })),
    ).toMatchObject({ kind: "notice", reason: "理由" });
  });
});
