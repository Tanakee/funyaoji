import { describe, expect, it } from "vite-plus/test";
import {
  initialState,
  parseRoom,
  reconnectRemainingSeconds,
  reduce,
  type PhoneEvent,
  type PhoneState,
} from "./model.ts";
import { JumpFilter, toAngle } from "./tilt.ts";

const run = (events: PhoneEvent[], from: PhoneState = initialState("K7Q2")) =>
  events.reduce(reduce, from);
const message = (m: Extract<PhoneEvent, { type: "message" }>["message"]): PhoneEvent => ({
  type: "message",
  message: m,
});

const connection = (
  state: Extract<PhoneEvent, { type: "connection" }>["state"],
  at = 0,
): PhoneEvent => ({ type: "connection", state, at });

/** 「参加」を押し、許可され、傾きが届いた */
const grantedEvents: PhoneEvent[] = [
  { type: "tap-join" },
  { type: "permission", granted: true },
  { type: "tilt-check", supported: true },
];

const joinedEvents: PhoneEvent[] = [
  ...grantedEvents,
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
      connection({ status: "reconnecting", attempt: 1 }),
      connection({ status: "open" }),
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
      ...grantedEvents,
      message({ type: "rejected", reason: "playing" }),
      connection({ status: "reconnecting", attempt: 1 }),
    ]);
    expect(rejected).toEqual({ kind: "rejected", reason: "playing" });
    expect(reduce(rejected, message({ type: "joined", joint: "rightHip" })).kind).toBe("joined");
    const full = run([
      ...grantedEvents,
      message({ type: "rejected", reason: "full" }),
      connection({ status: "closed", code: 4001, reason: "" }),
    ]);
    expect(full).toEqual({ kind: "rejected", reason: "full" });
  });

  it("参加中に切れたら link が reconnecting になり、関節の表示は残る", () => {
    const state = run([...joinedEvents, connection({ status: "reconnecting", attempt: 1 })]);
    expect(state).toMatchObject({ kind: "joined", joint: "leftKnee", link: "reconnecting" });
  });

  it("許可のあと、傾きが届かなければ unsupported になり、つながない", () => {
    const checking = run([{ type: "tap-join" }, { type: "permission", granted: true }]);
    expect(checking.kind).toBe("checking-tilt");
    expect(reduce(checking, { type: "tilt-check", supported: false }).kind).toBe("unsupported");
    expect(reduce(checking, { type: "tilt-check", supported: true }).kind).toBe("connecting");
  });

  it("つなぎ直しの残り秒数は、最初に切れた時刻から数え、joined のあとの room で消す", () => {
    const reconnecting = run([
      ...joinedEvents,
      connection({ status: "reconnecting", attempt: 1 }, 1_000),
      connection({ status: "reconnecting", attempt: 2 }, 3_000),
    ]);
    expect(reconnecting).toMatchObject({ link: "reconnecting", reconnectingSince: 1_000 });
    const rejoining = reduce(reconnecting, message({ type: "joined", joint: "leftKnee" }));
    expect(rejoining).toMatchObject({ link: "rejoining", reconnectingSince: 1_000 });
    const rejoined = reduce(
      rejoining,
      message({ type: "room", roomCode: "K7Q2", joints: ["leftKnee"] }),
    );
    expect(rejoined).toMatchObject({ link: "open", reconnectingSince: undefined, count: 1 });
    // 参加し直したあとにまた切れたら、その時刻から数え直す
    const again = reduce(rejoined, connection({ status: "reconnecting", attempt: 1 }, 9_000));
    expect(again).toMatchObject({ link: "reconnecting", reconnectingSince: 9_000 });
  });

  it("つなぎ直して joined のあとに届いた phase を、つなぎ直しの画面を閉じる前に反映する", () => {
    const state = run([
      ...joinedEvents,
      connection({ status: "reconnecting", attempt: 1 }, 1_000),
      message({ type: "joined", joint: "leftKnee" }),
      message({ type: "phase", phase: "playing", mode: "10m" }),
    ]);
    expect(state).toMatchObject({ link: "rejoining", phase: { kind: "playing" } });
    expect(
      reduce(state, message({ type: "room", roomCode: "K7Q2", joints: ["leftKnee"] })),
    ).toMatchObject({
      link: "open",
      phase: { kind: "playing" },
    });
  });

  it("phase を受け取っていないルームでは、joined のあとの room で、ロビーのまま閉じる", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "phase", phase: "playing", mode: "10m" }),
      connection({ status: "reconnecting", attempt: 1 }, 1_000),
      message({ type: "joined", joint: "leftKnee" }),
      message({ type: "room", roomCode: "K7Q2", joints: ["leftKnee"] }),
    ]);
    expect(state).toMatchObject({ link: "open", phase: { kind: "lobby" } });
  });

  it("joined のあと、room の前にまた切れたら、その時刻から数え直す", () => {
    const state = run([
      ...joinedEvents,
      connection({ status: "reconnecting", attempt: 1 }, 1_000),
      message({ type: "joined", joint: "leftKnee" }),
      connection({ status: "reconnecting", attempt: 1 }, 8_000),
    ]);
    expect(state).toMatchObject({ link: "reconnecting", reconnectingSince: 8_000 });
  });

  it("参加中に room が届いても、つなぎ直していなければ link は変わらない", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "room", roomCode: "K7Q2", joints: ["leftKnee"] }),
    ]);
    expect(state).toMatchObject({ link: "open", reconnectingSince: undefined });
  });

  it("トランスポートが開いただけでは、つなぎ直しを終えず、切れた時刻も数え直さない", () => {
    const state = run([
      ...joinedEvents,
      connection({ status: "reconnecting", attempt: 1 }, 1_000),
      connection({ status: "open" }, 2_000),
      connection({ status: "reconnecting", attempt: 2 }, 5_000),
    ]);
    expect(state).toMatchObject({ link: "reconnecting", reconnectingSince: 1_000 });
    expect(reduce(state, connection({ status: "open" }, 6_000))).toMatchObject({
      link: "reconnecting",
      reconnectingSince: 1_000,
    });
  });

  it("参加中に閉じたら closed。置き換えられたかは code で分かる", () => {
    const closed = (code: number) =>
      run([...joinedEvents, connection({ status: "closed", code, reason: "" })]);
    expect(closed(4000)).toEqual({ kind: "closed", replaced: true });
    expect(closed(1006)).toEqual({ kind: "closed", replaced: false });
  });
});

describe("reconnectRemainingSeconds", () => {
  it("60秒から1秒ごとに減り、切り上げる", () => {
    expect(reconnectRemainingSeconds(0, 0)).toBe(60);
    expect(reconnectRemainingSeconds(0, 1)).toBe(60);
    expect(reconnectRemainingSeconds(0, 1_000)).toBe(59);
    expect(reconnectRemainingSeconds(0, 59_001)).toBe(1);
  });
  it("60秒を過ぎたら 0 のまま", () => {
    expect(reconnectRemainingSeconds(0, 60_000)).toBe(0);
    expect(reconnectRemainingSeconds(0, 90_000)).toBe(0);
  });
});

it("ルーム終了でおわりになり、遅い通知でも参加中に戻らない", () => {
  const state = run([...joinedEvents, message({ type: "room-closed" })]);
  expect(state).toEqual({ kind: "ended", joint: "leftKnee" });
  expect(reduce(state, connection({ status: "closed", code: 4003, reason: "room-closed" }))).toBe(
    state,
  );
  expect(reduce(state, message({ type: "joined", joint: "rightHip" }))).toBe(state);
});

it("ルーム終了の通知が欠けても4003でおわりになる", () => {
  expect(
    run([...joinedEvents, connection({ status: "closed", code: 4003, reason: "room-closed" })]),
  ).toEqual({ kind: "ended", joint: "leftKnee" });
});
