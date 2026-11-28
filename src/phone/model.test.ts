import { describe, expect, it } from "vite-plus/test";
import { initialState, parseRoom, reduce, type PhoneEvent, type PhoneState } from "./model.ts";
import { JumpFilter, toAngle } from "./tilt.ts";

const run = (events: PhoneEvent[], from: PhoneState = initialState("K7Q2")) =>
  events.reduce(reduce, from);
const message = (m: Extract<PhoneEvent, { type: "message" }>["message"]): PhoneEvent => ({
  type: "message",
  message: m,
});

const joinedEvents: PhoneEvent[] = [
  { type: "tap-join" },
  { type: "permission", granted: true },
  message({ type: "joined", joint: "leftKnee" }),
];

describe("parseRoom", () => {
  it("小文字を大文字にそろえる", () => expect(parseRoom("?room=k7q2")).toBe("K7Q2"));
  it("無いときと形が違うときは undefined", () => {
    expect(parseRoom("")).toBeUndefined();
    expect(parseRoom("?room=K7Q")).toBeUndefined();
    expect(parseRoom("?room=K7Q0")).toBeUndefined();
  });
});

describe("toAngle", () => {
  it("null と有限でない値は読み捨てる", () => {
    expect(toAngle(null)).toBeUndefined();
    expect(toAngle(Number.NaN)).toBeUndefined();
    expect(toAngle(Infinity)).toBeUndefined();
  });
  it("0〜90度に収める", () => {
    expect([toAngle(-20), toAngle(30), toAngle(120)]).toEqual([0, 30, 90]);
  });
});

describe("JumpFilter", () => {
  const feed = (angles: number[]) => {
    const filter = new JumpFilter();
    return angles.map((angle) => filter.accept(angle));
  };
  it("少しずつ変わる値は、そのまま使う", () => {
    expect(feed([0, 10, 30, 60, 90])).toEqual([0, 10, 30, 60, 90]);
  });
  it("1回だけ飛んだ値は捨てる", () => {
    expect(feed([10, 85, 12])).toEqual([10, undefined, 12]);
  });
  it("飛んだ先に2回続けば、本当に動いたとみなして使う", () => {
    expect(feed([0, 90, 88, 87])).toEqual([0, undefined, 88, 87]);
  });
  it("飛んだあと元の近くに戻れば、保留した値は使わない", () => {
    expect(feed([0, 90, 5, 8])).toEqual([0, undefined, 5, 8]);
  });
});

describe("reduce", () => {
  it("参加していたスマホがつなぎ直して断られたら、断られた理由を出す", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "phase", phase: "playing", mode: "10m" }),
      { type: "connection", state: { status: "reconnecting", attempt: 1 } },
      { type: "connection", state: { status: "open" } },
      message({ type: "rejected", reason: "playing" }),
    ]);
    expect(state).toEqual({ kind: "rejected", reason: "playing" });
  });
  it("ルームコードが無ければ invalid-room", () => {
    expect(initialState(undefined)).toEqual({ kind: "invalid-room" });
  });

  it("許可されなければ permission-denied になり、そのままにする（Safari を開き直してもらう）", () => {
    const denied = run([{ type: "tap-join" }, { type: "permission", granted: false }]);
    expect(denied.kind).toBe("permission-denied");
    expect(reduce(denied, { type: "tap-join" }).kind).toBe("permission-denied");
  });

  it("joined で担当の関節が決まり、room・phase・status が反映される", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "room", roomCode: "K7Q2", joints: ["rightHip", "leftKnee"] }),
      message({ type: "phase", phase: "playing", mode: "10m" }),
      message({ type: "status", active: ["leftKnee"] }),
    ]);
    expect(state).toMatchObject({
      kind: "joined",
      joint: "leftKnee",
      count: 2,
      phase: { kind: "playing" },
      active: true,
    });
  });

  it("phase が変わると、入力の状態を消す", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "status", active: ["leftKnee"] }),
      message({
        type: "phase",
        phase: "result",
        result: { outcome: "fell", distanceM: 3 },
      }),
    ]);
    expect(state).toMatchObject({ kind: "joined", active: false, phase: { kind: "result" } });
  });

  it("playing で断られたあと、つなぎ直して joined になれる。閉じても断った理由を残す", () => {
    const rejected = run([
      { type: "tap-join" },
      { type: "permission", granted: true },
      message({ type: "rejected", reason: "playing" }),
      { type: "connection", state: { status: "reconnecting", attempt: 1 } },
    ]);
    expect(rejected).toEqual({ kind: "rejected", reason: "playing" });
    expect(reduce(rejected, message({ type: "joined", joint: "rightHip" })).kind).toBe("joined");
    const full = run([
      { type: "tap-join" },
      { type: "permission", granted: true },
      message({ type: "rejected", reason: "full" }),
      { type: "connection", state: { status: "closed", code: 4001, reason: "" } },
    ]);
    expect(full).toEqual({ kind: "rejected", reason: "full" });
  });

  it("参加中に切れたら link が reconnecting になり、関節の表示は残る", () => {
    const state = run([
      ...joinedEvents,
      { type: "connection", state: { status: "reconnecting", attempt: 1 } },
    ]);
    expect(state).toMatchObject({ kind: "joined", joint: "leftKnee", link: "reconnecting" });
  });

  it("参加中に閉じたら closed。置き換えられたかは code で分かる", () => {
    const closed = (code: number) =>
      run([...joinedEvents, { type: "connection", state: { status: "closed", code, reason: "" } }]);
    expect(closed(4000)).toEqual({ kind: "closed", replaced: true });
    expect(closed(1006)).toEqual({ kind: "closed", replaced: false });
  });
});

it("ルーム終了でおわりになり、遅い通知でも参加中に戻らない", () => {
  const state = run([...joinedEvents, message({ type: "room-closed" })]);
  expect(state).toEqual({ kind: "ended", joint: "leftKnee" });
  expect(
    reduce(state, {
      type: "connection",
      state: { status: "closed", code: 4003, reason: "room-closed" },
    }),
  ).toBe(state);
  expect(reduce(state, message({ type: "joined", joint: "rightHip" }))).toBe(state);
});

it("ルーム終了の通知が欠けても4003でおわりになる", () => {
  expect(
    run([
      ...joinedEvents,
      { type: "connection", state: { status: "closed", code: 4003, reason: "room-closed" } },
    ]),
  ).toEqual({ kind: "ended", joint: "leftKnee" });
});
