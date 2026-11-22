import { describe, expect, test } from "vite-plus/test";
import { PhoneToServerMessage, ScreenToServerMessage } from "./messages.ts";
import { parseMessage } from "./parse.ts";

describe("parseMessage", () => {
  test("スキーマに合う JSON は値を返す", () => {
    expect(parseMessage(PhoneToServerMessage, '{"type":"tilt","seq":1,"angle":42}')).toEqual({
      type: "tilt",
      seq: 1,
      angle: 42,
    });
    expect(
      parseMessage(ScreenToServerMessage, '{"type":"ping","id":7,"joint":"rightHip"}'),
    ).toEqual({ type: "ping", id: 7, joint: "rightHip" });
  });

  test("スキーマに無いフィールドは取り除く", () => {
    // スマホが joint を付けて送っても、サーバーが付ける joint と混ざらない
    expect(parseMessage(PhoneToServerMessage, '{"type":"pong","id":7,"joint":"leftKnee"}')).toEqual(
      { type: "pong", id: 7 },
    );
  });

  test("JSON でない文字列は undefined", () => {
    expect(parseMessage(PhoneToServerMessage, "")).toBeUndefined();
    expect(parseMessage(PhoneToServerMessage, "{")).toBeUndefined();
    expect(parseMessage(PhoneToServerMessage, "tilt")).toBeUndefined();
  });

  test("文字列でないデータは undefined", () => {
    const bytes = new TextEncoder().encode('{"type":"pong","id":7}');
    expect(parseMessage(PhoneToServerMessage, bytes.buffer)).toBeUndefined();
    expect(parseMessage(PhoneToServerMessage, undefined)).toBeUndefined();
  });

  test("スキーマに合わない JSON は undefined", () => {
    expect(parseMessage(PhoneToServerMessage, "null")).toBeUndefined();
    expect(parseMessage(PhoneToServerMessage, '{"type":"tilt","seq":1}')).toBeUndefined();
    expect(
      parseMessage(PhoneToServerMessage, '{"type":"tilt","seq":1,"angle":1e999}'),
    ).toBeUndefined();
  });

  test("送信元が違うメッセージは undefined", () => {
    expect(parseMessage(PhoneToServerMessage, '{"type":"phase","phase":"lobby"}')).toBeUndefined();
    expect(parseMessage(ScreenToServerMessage, '{"type":"pong","id":7}')).toBeUndefined();
    expect(
      parseMessage(ScreenToServerMessage, '{"type":"tilt","seq":1,"angle":42}'),
    ).toBeUndefined();
  });
});
