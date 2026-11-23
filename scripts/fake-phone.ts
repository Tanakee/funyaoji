// スマホの代わりにルームにつなぎ、tilt を送り続ける。スマホのページが無くても、スクリーンを確かめられる。
// 使い方：node scripts/fake-phone.ts <ルームコード> [--url http://localhost:5173] [--phones 4]
// どれかの台が断られた（rejected）か、一度もつながらなかったときは、終了コード 1 で終わる
import { parseArgs } from "node:util";
import { connectPhone } from "../src/net/client.ts";

/** tilt を送る間隔（毎秒30回。docs/api.md の設計方針） */
const TILT_INTERVAL_MS = 1000 / 30;
/** 角度を 0〜90 度で往復させる周期 */
const SWING_PERIOD_MS = 2000;
/** 全部の台が閉じてから終わるまでに待つ時間。close フレームを送り終える前に終わらないようにする */
const EXIT_DELAY_MS = 200;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string", default: "http://localhost:5173" },
    phones: { type: "string", default: "1" },
  },
});
const roomCode = positionals[0];
const phones = Number(values.phones);
if (roomCode === undefined || !Number.isInteger(phones) || phones < 1) {
  console.error(
    "使い方：node scripts/fake-phone.ts <ルームコード> [--url <URL>] [--phones <台数>]",
  );
  process.exit(1);
}

let open = phones;
let failed = false;
const connections: { close(): void }[] = [];

function exitAfterAllClosed(): void {
  // 待つあいだにソケットがすべて片付けば、タイマーを待たずに終わる
  process.exitCode = failed ? 1 : 0;
  setTimeout(() => process.exit(), EXIT_DELAY_MS).unref();
}

for (let i = 0; i < phones; i++) {
  const name = `スマホ${i + 1}`;
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  let opened = false;
  let rejected = false;
  // 台ごとに角度の動きをずらす
  const offset = (SWING_PERIOD_MS / phones) * i;
  const connection = connectPhone(
    roomCode,
    {
      onMessage(message) {
        console.log(name, JSON.stringify(message));
        if (message.type === "rejected") rejected = true;
        if (message.type === "joined") {
          timer = setInterval(() => {
            const t = ((Date.now() + offset) % SWING_PERIOD_MS) / SWING_PERIOD_MS;
            const angle = Math.round(45 - 45 * Math.cos(2 * Math.PI * t));
            connection.send({ type: "tilt", seq: seq++, angle });
          }, TILT_INTERVAL_MS);
        }
        if (message.type === "ping") connection.send({ type: "pong", id: message.id });
      },
      onStateChange(state) {
        console.log(name, JSON.stringify(state));
        if (state.status === "open") opened = true;
        if (state.status !== "closed") return;
        clearInterval(timer);
        if (rejected || !opened) failed = true;
        open--;
        if (open === 0) exitAfterAllClosed();
      },
    },
    { baseUrl: values.url },
  );
  connections.push(connection);
}
// Ctrl+C で、すべての台を閉じる。最後の台が閉じたら終わる
process.on("SIGINT", () => {
  for (const connection of connections) connection.close();
});
