// スマホの代わりにルームにつなぎ、tilt を送り続ける。スマホのページが無くても、スクリーンを確かめられる。
// 使い方：node scripts/fake-phone.ts <ルームコード> [--url http://localhost:5173] [--phones 4]
import { parseArgs } from "node:util";
import { connectPhone } from "../src/net/client.ts";

/** tilt を送る間隔（毎秒30回。docs/api.md の設計方針） */
const TILT_INTERVAL_MS = 1000 / 30;
/** 角度を 0〜90 度で往復させる周期 */
const SWING_PERIOD_MS = 2000;

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
for (let i = 0; i < phones; i++) {
  const name = `スマホ${i + 1}`;
  let seq = 0;
  let timer: NodeJS.Timeout | undefined;
  // 台ごとに角度の動きをずらす
  const offset = (SWING_PERIOD_MS / phones) * i;
  const connection = connectPhone(
    roomCode,
    {
      onMessage(message) {
        console.log(name, JSON.stringify(message));
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
        if (state.status !== "closed") return;
        clearInterval(timer);
        open--;
        if (open === 0) process.exit(0);
      },
    },
    { baseUrl: values.url },
  );
  process.on("SIGINT", () => connection.close());
}
