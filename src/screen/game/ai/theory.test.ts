import { beforeAll, expect, test } from "vite-plus/test";
import { JOINTS } from "../../../shared/messages.ts";
import { SIM_MODES, modeSimOptions } from "../modes.ts";
import { initPhysics } from "../sim.ts";
import { ACTION_HZ } from "./observe.ts";
import { replay } from "./record.ts";

/** 理論値の記録（theory/<モード>.json）。ml/funyaoji_rl/registry.py が書き出す */
interface TheoryRecord {
  timeMs: number;
  inputs: number[][];
}

const records = import.meta.glob<TheoryRecord>("./theory/*.json", {
  eager: true,
  import: "default",
});

beforeAll(initPhysics);

// docs/ml.md の「再生の一致を守る」。物理（sim.ts・body.ts・Rapier）を変えて、ここが落ちたら、
// 学習をやり直して記録を作り直す（ml/README.md）。すぐにできないときだけ、理由を書いてこのテストを飛ばす。
// モードの一覧（modes.ts）を回る。記録がまだ無いモード（足したばかりで、CI が作っている）は飛ばす。
// 名前は「<モード>：」で始める（CI が -t でモードを選ぶ）
for (const mode of SIM_MODES) {
  const theory = records[`./theory/${mode}.json`];
  test.skipIf(!theory)(`${mode}：理論値の記録を再生すると、記録したタイムでゴールする`, () => {
    const end = replay(
      { hz: ACTION_HZ, joints: JOINTS, inputs: theory!.inputs },
      modeSimOptions(mode),
    );
    expect(end.result).toMatchObject({ outcome: "goal", timeMs: theory!.timeMs });
  });
}

test("理論値の記録は、どれもモードの一覧にあるモードのもの", () => {
  const names = Object.keys(records).map((path) => path.replace(/^\.\/theory\/|\.json$/g, ""));
  for (const name of names) expect(SIM_MODES as string[]).toContain(name);
});
