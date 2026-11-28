import { useEffect, useState } from "react";
import type { ConnectionState, Latency } from "../../net/client.ts";
import { JOINT_DISPLAY } from "../../shared/joints.ts";
import { JOINTS } from "../../shared/messages.ts";
import type { ScreenSession, ScreenView } from "./session.ts";

/** 開いているあいだ、読み直す間隔。tilt のたびには読まない */
const REFRESH_MS = 250;
/** 返事の来ない ping がこの数だけ続いたら「応答なし」と出す */
const UNRESPONSIVE_MISSES = 2;

/** 確かめるための折りたたみ。普段は閉じていて、開くまで何もしない */
export function DebugPanel({ session, view }: { session: ScreenSession; view: ScreenView }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="debug" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>デバッグ</summary>
      {open && <DebugBody session={session} view={view} />}
    </details>
  );
}

function DebugBody({ session, view }: { session: ScreenSession; view: ScreenView }) {
  // session.debug は tilt のたびに書き換わる。state にはせず、間引いて描き直す
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh((n) => n + 1), REFRESH_MS);
    return () => clearInterval(timer);
  }, []);
  const { tilts, latency } = session.debug;
  return (
    <div className="debug-body">
      <p>
        接続：
        {view.room.status === "ready" ? connectionText(view.room.connection) : view.room.status}
        　進行：{view.flow.kind}
      </p>
      <table>
        <thead>
          <tr>
            <th>関節</th>
            <th>スマホ</th>
            <th>角度</th>
            <th>シーケンス番号</th>
            <th>遅延（最新 / 中央値）</th>
          </tr>
        </thead>
        <tbody>
          {JOINTS.map((joint) => (
            <tr key={joint}>
              <td>{JOINT_DISPLAY[joint].name}</td>
              <td>{view.joints.includes(joint) ? "接続中" : "-"}</td>
              <td>{tilts[joint]?.angle ?? "-"}</td>
              <td>{tilts[joint]?.seq ?? "-"}</td>
              <td>{latencyText(latency[joint])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function latencyText(latency: Latency | undefined): string {
  if (latency === undefined) return "-";
  if (latency.missed >= UNRESPONSIVE_MISSES) return "応答なし";
  if (latency.latest === null || latency.median === null) return "-";
  return `${Math.round(latency.latest)}ms / ${Math.round(latency.median)}ms`;
}

function connectionText(state: ConnectionState): string {
  switch (state.status) {
    case "connecting":
      return "接続中";
    case "open":
      return "接続済み";
    case "reconnecting":
      return `再接続中（${state.attempt}回目）`;
    case "closed":
      return `切断（close コード ${state.code}）`;
  }
}
