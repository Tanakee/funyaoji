import { describe, expect, it } from "vite-plus/test";
import {
  initialState,
  isHowtoReady,
  parseRoom,
  reconnectRemainingSeconds,
  reduce,
  type PhoneEvent,
  type PhoneState,
} from "./model.ts";
import { JumpFilter, toAngle } from "./tilt.ts";

const run = (events: PhoneEvent[], from: PhoneState = initialState("K7Q2")) =>
  events.reduce(reduce, from);
const message = (m: Extract<PhoneEvent, { type: "message" }>["message"], at = 0): PhoneEvent => ({
  type: "message",
  message: m,
  at,
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
  const playing = { type: "phase", phase: "playing", mode: "normal", input: "tilt" } as const;
  const countdown = { kind: "count", durationMs: 3_000, remainingMs: 2_000 } as const;

  it("遊び方の間だけ準備OKを押せる。howto を受け取っても active は変わらない", () => {
    const tap = { type: "tap-ready" } as const;
    const initial = initialState("K7Q2");
    expect(reduce(initial, tap)).toBe(initial);
    const lobby = run(joinedEvents);
    expect(lobby).toMatchObject({ readyPressed: false });
    expect(reduce(lobby, tap)).toBe(lobby);
    const howto = run(
      [
        message({ type: "status", active: ["leftKnee"] }),
        message({ type: "howto", ready: ["rightHip"] }),
      ],
      lobby,
    );
    expect(howto).toMatchObject({
      phase: { kind: "lobby", howto: { ready: ["rightHip"] } },
      active: true,
    });
    expect(howto.kind === "joined" && isHowtoReady(howto)).toBe(false);
    const confirmed = reduce(howto, message({ type: "howto", ready: ["leftKnee"] }));
    expect(confirmed).toMatchObject({ readyPressed: false });
    expect(confirmed.kind === "joined" && isHowtoReady(confirmed)).toBe(true);

    const pressed = reduce(howto, tap);
    expect(pressed).toMatchObject({ readyPressed: true });
    expect(pressed.kind === "joined" && isHowtoReady(pressed)).toBe(true);
    const next = reduce(pressed, message({ ...playing, countdown: { ...countdown, delayMs: {} } }));
    expect(next).toMatchObject({
      readyPressed: false,
      phase: { kind: "playing", countdown: { kind: "count", durationMs: 3_000, endsAt: 2_000 } },
    });
  });

  it("カウントダウンや結果のあとに届いた howto では、遊び方の画面に戻らない", () => {
    const counting = run([
      ...joinedEvents,
      message({ ...playing, countdown: { ...countdown, delayMs: {} } }),
    ]);
    expect(reduce(counting, message({ type: "howto", ready: [] }))).toBe(counting);
    const result = run([
      ...joinedEvents,
      message({ type: "phase", phase: "result", result: { outcome: "fell", distanceM: 1 } }),
    ]);
    expect(reduce(result, message({ type: "howto", ready: [] }))).toBe(result);
  });

  it("同じ関節に戻り howto が届けばタップを残す。関節が変わるか howto がなければ消す", () => {
    const disconnected = run([
      ...joinedEvents,
      message({ type: "howto", ready: [] }),
      { type: "tap-ready" },
      connection({ status: "reconnecting", attempt: 1 }),
    ]);
    const rejoining = reduce(disconnected, message({ type: "joined", joint: "leftKnee" }));
    expect(rejoining).toMatchObject({
      link: "rejoining",
      phase: { kind: "lobby" },
      readyPressed: true,
    });
    const room = message({ type: "room", roomCode: "K7Q2", joints: ["leftKnee"] });
    expect(reduce(rejoining, room)).toMatchObject({ link: "open", readyPressed: false });
    expect(run([message({ type: "howto", ready: [] }), room], rejoining)).toMatchObject({
      link: "open",
      readyPressed: true,
    });
    // つなぎ直したときにサーバーが送り直す lobby では消さず、そのあとの howto で残す
    expect(
      run(
        [
          message({ type: "phase", phase: "lobby", input: "tilt" }),
          message({ type: "howto", ready: [] }),
          room,
        ],
        rejoining,
      ),
    ).toMatchObject({ link: "open", readyPressed: true });
    expect(
      run([message({ type: "phase", phase: "lobby", input: "tilt" }), room], rejoining),
    ).toMatchObject({
      readyPressed: false,
    });
    // つながっているときの lobby は、遊び方の終わり
    const open = run([message({ type: "howto", ready: [] }), room], rejoining);
    expect(reduce(open, message({ type: "phase", phase: "lobby", input: "tilt" }))).toMatchObject({
      readyPressed: false,
    });
    expect(reduce(disconnected, message({ type: "joined", joint: "rightHip" }))).toMatchObject({
      readyPressed: false,
    });
  });

  it("自分の関節の遅延だけを引き、新しい countdown が来たら開始時刻を置き換える", () => {
    const state = run([
      ...joinedEvents,
      message(
        { ...playing, countdown: { ...countdown, delayMs: { rightHip: 42, leftKnee: 130 } } },
        500,
      ),
    ]);
    expect(state).toMatchObject({
      phase: { kind: "playing", countdown: { kind: "count", durationMs: 3_000, endsAt: 2_370 } },
    });
    expect(
      run(
        [
          message(
            {
              ...playing,
              countdown: {
                kind: "readyGo",
                durationMs: 1_500,
                remainingMs: 1_500,
                delayMs: { rightHip: 42 },
              },
            },
            1_000,
          ),
        ],
        state,
      ),
    ).toMatchObject({
      phase: { kind: "playing", countdown: { kind: "readyGo", durationMs: 1_500, endsAt: 2_500 } },
    });
  });

  it("片道の遅延は1000msまで引き、受信した時点で開始の時刻に達していればプレイを表示する", () => {
    const delayMs = { leftKnee: 1_300 };
    const state = run([
      ...joinedEvents,
      message({ ...playing, countdown: { ...countdown, delayMs } }, 500),
    ]);
    expect(state).toMatchObject({ phase: { countdown: { endsAt: 1_500 } } });
    for (const remainingMs of [999, 1_000]) {
      const next = reduce(
        state,
        message({ ...playing, countdown: { ...countdown, remainingMs, delayMs } }, 600),
      );
      expect(next.kind === "joined" && next.phase).toEqual({ kind: "playing" });
    }
    const next = reduce(state, message(playing, 600));
    expect(next.kind === "joined" && next.phase).toEqual({ kind: "playing" });
  });

  it("操作方法は傾きから始め、ロビーとプレイの phase で変わり、結果の phase では残す", () => {
    const joined = run(joinedEvents);
    expect(joined).toMatchObject({ kind: "joined", input: "tilt" });
    const camera = run([message({ type: "phase", phase: "lobby", input: "camera" })], joined);
    expect(camera).toMatchObject({ input: "camera" });
    const result = run(
      [message({ type: "phase", phase: "result", result: { outcome: "fell", distanceM: 1 } })],
      camera,
    );
    expect(result).toMatchObject({ input: "camera", phase: { kind: "result" } });
    expect(run([message(playing)], result)).toMatchObject({ input: "tilt" });
  });

  it("参加していたスマホがつなぎ直して playing で断られたら、順番待ちになる", () => {
    const state = run([
      ...joinedEvents,
      message({ type: "phase", phase: "playing", mode: "normal", input: "tilt" }),
      connection({ status: "reconnecting", attempt: 1 }),
      connection({ status: "open" }),
      message({ type: "rejected", reason: "playing" }),
    ]);
    expect(state).toEqual({ kind: "waiting" });
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
      message({ type: "phase", phase: "playing", mode: "normal", input: "tilt" }),
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

  it.each(["full", "playing"] as const)(
    "%s で順番待ちになり、参加できたら phase を反映する",
    (reason) => {
      const rejection = message({ type: "rejected", reason });
      const waiting = run([
        ...grantedEvents,
        rejection,
        connection({ status: "reconnecting", attempt: 1 }),
      ]);
      expect(waiting).toEqual({ kind: "waiting" });
      expect(reduce(waiting, rejection)).toBe(waiting);
      const joined = reduce(waiting, message({ type: "joined", joint: "rightHip" }));
      expect(joined).toMatchObject({ kind: "joined", joint: "rightHip", phase: { kind: "lobby" } });
      const result = { outcome: "fell", distanceM: 3 } as const;
      const next = reduce(joined, message({ type: "phase", phase: "result", result }));
      expect(next).toMatchObject({ kind: "joined", phase: { kind: "result", result } });
    },
  );

  it("順番待ちをやめると、接続終了の通知が来ても参加前の画面に戻り、もう一度参加できる", () => {
    const ready = run([
      ...grantedEvents,
      message({ type: "rejected", reason: "full" }),
      { type: "cancel-wait" },
      connection({ status: "closed", code: 1000, reason: "" }),
    ]);
    expect(ready).toEqual({ kind: "ready" });
    expect(reduce(ready, { type: "cancel-wait" })).toBe(ready);
    expect(reduce(ready, { type: "tap-join" })).toEqual({ kind: "asking-permission" });
  });

  it("やめるを押したのと同時に joined が届いても、参加前の画面に戻る", () => {
    const ready = run([
      ...grantedEvents,
      message({ type: "rejected", reason: "full" }),
      message({ type: "joined", joint: "rightHip" }),
      { type: "cancel-wait" },
      connection({ status: "closed", code: 1000, reason: "" }),
    ]);
    expect(ready).toEqual({ kind: "ready" });
  });

  it("順番待ちのあと、接続を終了した理由に合う画面に進む", () => {
    const waiting = run([...grantedEvents, message({ type: "rejected", reason: "full" })]);
    const close = (code: number) => connection({ status: "closed", code, reason: "" });
    expect(reduce(waiting, close(4000))).toEqual({ kind: "closed", replaced: true });
    expect(reduce(waiting, close(1000))).toEqual({ kind: "closed", replaced: false });
    expect(reduce(waiting, close(4003))).toMatchObject({ kind: "ended" });

    const rejected = reduce(waiting, message({ type: "rejected", reason: "no-room" }));
    expect(reduce(rejected, close(4001))).toEqual({ kind: "rejected", reason: "no-room" });
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
      message({ type: "phase", phase: "playing", mode: "normal", input: "tilt" }),
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
      message({ type: "phase", phase: "playing", mode: "normal", input: "tilt" }),
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
  expect(state).toEqual({ kind: "ended", reason: "room-closed", joint: "leftKnee" });
  expect(reduce(state, connection({ status: "closed", code: 4003, reason: "room-closed" }))).toBe(
    state,
  );
  expect(reduce(state, message({ type: "joined", joint: "rightHip" }))).toBe(state);
});

it("ルーム終了の通知が欠けても4003でおわりになる", () => {
  expect(
    run([...joinedEvents, connection({ status: "closed", code: 4003, reason: "room-closed" })]),
  ).toEqual({ kind: "ended", reason: "room-closed", joint: "leftKnee" });
});

describe("抜ける", () => {
  const tap = { type: "tap-leave" } as const;

  it("参加しているときだけ受け付けを待つ状態にする", () => {
    const lobby = run(joinedEvents);
    const result = reduce(
      lobby,
      message({ type: "phase", phase: "result", result: { outcome: "fell", distanceM: 1 } }),
    );
    for (const state of [lobby, result]) {
      expect(state).toMatchObject({ kind: "joined", leaving: false });
      const leaving = reduce(state, tap);
      expect(leaving).toEqual({ ...state, leaving: true });
      expect(reduce(leaving, tap)).toBe(leaving);
    }
    const playing = reduce(
      lobby,
      message({ type: "phase", phase: "playing", mode: "normal", input: "tilt" }),
    );
    expect(reduce(playing, tap)).toEqual({ ...playing, leaving: true });
    const ready = initialState("K7Q2");
    expect(reduce(ready, tap)).toBe(ready);
  });

  it.each([
    message({ type: "left" }),
    connection({ status: "closed", code: 4004, reason: "left" }),
    message({ type: "rejected", reason: "playing" }),
    connection({ status: "closed", code: 1000, reason: "" }),
  ])("$type を受け取ったら担当の関節を残しておわりにする", (event) => {
    expect(run([...joinedEvents, tap, event])).toEqual({
      kind: "ended",
      reason: "left",
      joint: "leftKnee",
    });
  });

  it("つなぎ直して joined を受け取っても leaving を残す", () => {
    expect(
      run([
        ...joinedEvents,
        tap,
        connection({ status: "reconnecting", attempt: 1 }, 1_000),
        message({ type: "joined", joint: "leftKnee" }),
      ]),
    ).toMatchObject({ kind: "joined", link: "rejoining", leaving: true });
  });
});
