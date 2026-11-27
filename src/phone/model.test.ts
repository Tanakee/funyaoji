import { describe, expect, it } from "vite-plus/test";
import { initialState, parseRoom, reduce, type PhoneEvent, type PhoneState } from "./model.ts";
import { toAngle } from "./tilt.ts";

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

describe("reduce", () => {
  it("ルームコードが無ければ invalid-room", () => {
    expect(initialState(undefined)).toEqual({ kind: "invalid-room" });
  });

  it("許可されなければ permission-denied になり、もう一度押せる", () => {
    const denied = run([{ type: "tap-join" }, { type: "permission", granted: false }]);
    expect(denied.kind).toBe("permission-denied");
    expect(reduce(denied, { type: "tap-join" }).kind).toBe("asking-permission");
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
