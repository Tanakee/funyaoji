import { Suspense, use, useEffect, useState } from "react";
import { connectScreen, type ConnectionState } from "../../net/client.ts";
import {
  JOINTS,
  type Joint,
  type PhaseMessage,
  type RejectedMessage,
} from "../../shared/messages.ts";

export type CreateRoomResult = { ok: true; roomCode: string } | { ok: false; message: string };

export function ScreenApp({ room }: { room: Promise<CreateRoomResult> }) {
  return (
    <>
      <h1>スクリーンのページ</h1>
      <Suspense fallback={<p>ルームを作成中</p>}>
        <RoomView room={room} />
      </Suspense>
    </>
  );
}

function RoomView({ room }: { room: Promise<CreateRoomResult> }) {
  const result = use(room);
  if (!result.ok) return <p>ルームを作成できません（{result.message}）</p>;
  return <Lobby roomCode={result.roomCode} />;
}

/** 関節ごとに最後に受信した tilt */
type LastTilt = { seq: number; angle: number };

function Lobby({ roomCode }: { roomCode: string }) {
  const [connection, setConnection] = useState<ConnectionState>({ status: "connecting" });
  const [joints, setJoints] = useState<readonly Joint[]>([]);
  const [phase, setPhase] = useState<PhaseMessage | undefined>();
  const [rejected, setRejected] = useState<RejectedMessage["reason"] | undefined>();
  const [tilts, setTilts] = useState<Partial<Record<Joint, LastTilt>>>({});

  useEffect(() => {
    // StrictMode では effect が2回走る。1回目の close() が「切れた」を表示しないように、片付けたあとの状態は捨てる
    let active = true;
    const conn = connectScreen(
      roomCode,
      {
        onStateChange: (state) => {
          if (active) setConnection(state);
        },
        onMessage(message) {
          switch (message.type) {
            case "room":
              setJoints(message.joints);
              // 抜けたスマホの角度を残さない。次に同じ関節に入ったスマホの行に、前の値を出さない
              setTilts((prev) =>
                Object.fromEntries(
                  Object.entries(prev).filter(([joint]) => message.joints.includes(joint as Joint)),
                ),
              );
              break;
            case "phase":
              setPhase(message);
              break;
            case "rejected":
              setRejected(message.reason);
              break;
            case "tilt":
              // 確かめるための一時的な表示。tilt のたびに React の state を変え、描画し直している。
              // docs/design.md の「フレームごとの描画と通信は React の外に置く」に合わないので、
              // ロビー（#44）やプレイの画面では、この形をまねしない
              setTilts((prev) => ({
                ...prev,
                [message.joint]: { seq: message.seq, angle: message.angle },
              }));
              break;
            case "pong":
              break;
          }
        },
      },
      { baseUrl: location.href },
    );
    return () => {
      active = false;
      conn.close();
    };
  }, [roomCode]);

  const playUrl = new URL("/play", location.href);
  playUrl.searchParams.set("room", roomCode);
  const phoneUrl = playUrl.href;

  return (
    <>
      <p>ルームコード：{roomCode}</p>
      <p>
        スマホ用の URL：<a href={phoneUrl}>{phoneUrl}</a>
      </p>
      <p>接続：{connectionText(connection, rejected)}</p>
      {phase && <p>状態：{phase.phase}</p>}
      <table>
        <thead>
          <tr>
            <th>関節</th>
            <th>スマホ</th>
            <th>角度</th>
            <th>シーケンス番号</th>
          </tr>
        </thead>
        <tbody>
          {JOINTS.map((joint) => (
            <tr key={joint}>
              <td>{joint}</td>
              <td>{joints.includes(joint) ? "接続中" : "-"}</td>
              <td>{tilts[joint]?.angle ?? "-"}</td>
              <td>{tilts[joint]?.seq ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function connectionText(
  state: ConnectionState,
  rejected: RejectedMessage["reason"] | undefined,
): string {
  switch (state.status) {
    case "connecting":
      return "つないでいます";
    case "open":
      return "つながっている";
    case "closed": {
      const reason = rejected ? `、${rejected} で断られた` : "";
      return `切れた（close コード ${state.code}${reason}）`;
    }
  }
}
