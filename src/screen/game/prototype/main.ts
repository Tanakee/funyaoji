// 試作（あとで捨てる）：操作の方式を切り替えて、キーボードとスライダーで触る
import {
  DEFAULT_PARAMS,
  GOAL_M,
  JOINTS,
  Sim,
  neutralInput,
  type JointName,
  type Mode,
  type Params,
} from "./sim.ts";
import { gaitInput, type Gait } from "./bot.ts";

const MODES: { id: Mode; label: string; hint: string }[] = [
  {
    id: "angle",
    label: "A1 目標角度",
    hint: "入力の値が、そのまま関節の角度になる。0 で後ろ（ひざは伸びる）、1 で前（ひざは曲がる）",
  },
  {
    id: "velocity",
    label: "A2 目標速度",
    hint: "入力 0.5 で止まる。0.5 より上で前に回り続け、下で後ろに回り続ける（QWOP に近い）",
  },
  {
    id: "string",
    label: "B 物理の糸",
    hint: "モーターなし。胴は糸で吊られている。入力を上げると糸が短くなり、ひざ・足首を引き上げる",
  },
  {
    id: "both",
    label: "C 併用",
    hint: "A1 のモーターに、弱い糸の力を足す",
  },
];

const LABEL: Record<JointName, string> = {
  rightHip: "右もも",
  leftHip: "左もも",
  rightKnee: "右ひざ",
  leftKnee: "左ひざ",
};
// [上げるキー, 下げるキー]
const KEYS: Record<JointName, [string, string]> = {
  rightHip: ["q", "a"],
  leftHip: ["w", "s"],
  rightKnee: ["o", "l"],
  leftKnee: ["p", ";"],
};
const COLOR: Record<JointName, string> = {
  rightHip: "#e4572e",
  leftHip: "#2e86ab",
  rightKnee: "#f3a712",
  leftKnee: "#4caf7d",
};

const SLIDERS: { key: keyof Params; label: string; min: number; max: number; step: number }[] = [
  { key: "stiffness", label: "モーターの強さ", min: 0, max: 1500, step: 10 },
  { key: "damping", label: "モーターの減衰", min: 0, max: 200, step: 1 },
  { key: "maxSpeed", label: "A2 の最大の速さ (rad/s)", min: 0.5, max: 8, step: 0.1 },
  { key: "stringK", label: "糸の強さ", min: 0, max: 20, step: 0.5 },
  { key: "stringPull", label: "糸を引く長さ (m)", min: 0.1, max: 1.2, step: 0.05 },
  { key: "support", label: "B：胴を吊る力（体重の割合）", min: 0, max: 1, step: 0.05 },
  { key: "stringOffset", label: "B：吊る点の前後のずれ (m)", min: 0, max: 0.5, step: 0.05 },
  { key: "assist", label: "胴を起こす補助", min: 0, max: 12, step: 0.5 },
  { key: "kneeAuto", label: "ひざの半自動（ももを前に振ると曲がる）", min: 0, max: 1, step: 0.1 },
  { key: "footFriction", label: "足の摩擦（変えるとリセット）", min: 0, max: 3, step: 0.1 },
];

const params: Params = { ...DEFAULT_PARAMS, assist: 2 };
// お手本：機械的に探した歩き方（A1 目標角度、補助 2 で 10m を約18秒）
const DEMO: Gait = { T: 1.43, h0: 0.23, A: 0.4, K: 0.85, kp: 0.09 };
let demo = false;
/** お手本の再生中に、自分で動かす関節。空ならお手本が全部動かす */
let solo: JointName | "" = "";
let guide: Record<JointName, number> | undefined;
let input = neutralInput(params.mode);
let mirror = false;
let paused = false;
let timeScale = 1;
let sim: Sim;
const held = new Set<string>();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("view");
const ctx = canvas.getContext("2d")!;

function reset(): void {
  sim = new Sim(params);
  input = neutralInput(params.mode);
  syncInputSliders();
}

// ---- 操作のパネル ----
function buildUi(): void {
  const modes = $("modes");
  for (const m of MODES) {
    const b = document.createElement("button");
    b.textContent = m.label;
    b.dataset.mode = m.id;
    b.onclick = () => {
      demo = false;
      params.mode = m.id;
      reset();
      renderModes();
    };
    modes.append(b);
  }
  renderModes();

  const inputs = $("inputs");
  for (const j of JOINTS) {
    const row = document.createElement("label");
    row.innerHTML = `<span style="color:${COLOR[j]}">${LABEL[j]}　<kbd>${KEYS[j][0].toUpperCase()}</kbd>↑ <kbd>${KEYS[j][1].toUpperCase()}</kbd>↓</span><input type="range" min="0" max="1" step="0.01" id="in-${j}"><output id="out-${j}"></output>`;
    inputs.append(row);
    $<HTMLInputElement>(`in-${j}`).oninput = (e) => {
      input[j] = Number((e.target as HTMLInputElement).value);
    };
  }

  const tune = $("tune");
  for (const s of SLIDERS) {
    const row = document.createElement("label");
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${params[s.key]}"><output>${params[s.key]}</output>`;
    const el = row.querySelector("input")!;
    const out = row.querySelector("output")!;
    el.oninput = () => {
      (params[s.key] as number) = Number(el.value);
      out.textContent = el.value;
      if (s.key === "footFriction") reset();
    };
    tune.append(row);
  }

  $<HTMLInputElement>("upper").onchange = (e) => {
    params.upperBody = (e.target as HTMLInputElement).checked;
    reset();
  };
  $<HTMLInputElement>("mirror").onchange = (e) => {
    mirror = (e.target as HTMLInputElement).checked;
  };
  $<HTMLInputElement>("slow").oninput = (e) => {
    timeScale = Number((e.target as HTMLInputElement).value);
    $("slow-out").textContent = `${timeScale}倍`;
  };
  $("reset").onclick = () => {
    demo = false;
    reset();
  };
  $<HTMLSelectElement>("solo").onchange = (e) => {
    solo = (e.target as HTMLSelectElement).value as JointName | "";
    (e.target as HTMLSelectElement).blur();
  };
  $("demo").onclick = () => {
    params.mode = "angle";
    params.assist = 2;
    params.kneeAuto = 0;
    reset();
    renderModes();
    demo = true;
  };
  $("pause").onclick = () => {
    paused = !paused;
    $("pause").textContent = paused ? "再開 (Space)" : "一時停止 (Space)";
  };
  $("step").onclick = () => {
    paused = true;
    $("pause").textContent = "再開 (Space)";
    sim.step(input);
  };

  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "r") $("reset").click();
    else if (k === " ") {
      e.preventDefault();
      $("pause").click();
    } else held.add(k);
  });
  addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
}

function renderModes(): void {
  for (const b of $("modes").querySelectorAll("button")) {
    b.classList.toggle("on", b.dataset.mode === params.mode);
  }
  $("hint").textContent = MODES.find((m) => m.id === params.mode)!.hint;
}

function syncInputSliders(): void {
  for (const j of JOINTS) {
    const el = document.getElementById(`in-${j}`) as HTMLInputElement | null;
    if (!el) continue;
    el.value = String(input[j]);
    $(`out-${j}`).textContent =
      `入力 ${input[j].toFixed(2)}　角度 ${((sim.jointAngle(j) * 180) / Math.PI).toFixed(0)}°` +
      (guide && j === solo ? `　← 自分で動かす（お手本は ${guide[j].toFixed(2)}）` : "");
  }
}

function applyKeys(dt: number): void {
  if (demo) {
    guide = gaitInput(DEMO, sim.time);
    for (const j of JOINTS) if (j !== solo) input[j] = guide[j];
    if (solo) {
      const [up, down] = KEYS[solo];
      if (held.has(up)) input[solo] = Math.min(1, input[solo] + 3 * dt);
      if (held.has(down)) input[solo] = Math.max(0, input[solo] - 3 * dt);
    }
    return;
  }
  guide = undefined;
  const rate = 3;
  for (const j of JOINTS) {
    const [up, down] = KEYS[j];
    if (held.has(up)) input[j] = Math.min(1, input[j] + rate * dt);
    if (held.has(down)) input[j] = Math.max(0, input[j] - rate * dt);
  }
  if (mirror) {
    // 左は、右の逆向きに連動する（中立の値をはさんで反対側）
    const n = neutralInput(params.mode);
    input.leftHip = Math.min(1, Math.max(0, 2 * n.rightHip - input.rightHip));
    input.leftKnee = Math.min(1, Math.max(0, 2 * n.rightKnee - input.rightKnee));
  }
}

// ---- 描画 ----
const SCALE = 150; // 1m が何 px か
function draw(): void {
  const w = canvas.width;
  const h = canvas.height;
  const camX = sim.torso.translation().x;
  const groundY = h - 90;
  const X = (x: number) => w / 2 + (x - camX) * SCALE;
  const Y = (y: number) => groundY - y * SCALE;

  ctx.fillStyle = "#f6f1e7";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#d9cfbd";
  ctx.fillRect(0, groundY, w, h - groundY);

  // 1m ごとの目盛り、スタートとゴール
  ctx.font = "13px sans-serif";
  for (let m = Math.floor(camX - 5); m <= camX + 5; m++) {
    const x = X(m);
    ctx.strokeStyle = m === 0 || m === GOAL_M ? "#c0392b" : "#b5a98f";
    ctx.lineWidth = m === 0 || m === GOAL_M ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(x, groundY);
    ctx.lineTo(x, groundY + (m === 0 || m === GOAL_M ? 40 : 12));
    ctx.stroke();
    ctx.fillStyle = "#6b6252";
    ctx.fillText(m === 0 ? "スタート" : m === GOAL_M ? "ゴール" : `${m}m`, x + 4, groundY + 28);
  }

  // 糸
  for (const s of sim.strings) {
    ctx.strokeStyle = s.taut ? COLOR[s.joint] : "#b9b2a3";
    ctx.lineWidth = s.taut ? 2.5 : 1;
    ctx.beginPath();
    ctx.moveTo(X(s.from.x), Y(s.from.y));
    if (s.taut) ctx.lineTo(X(s.to.x), Y(s.to.y));
    else
      ctx.quadraticCurveTo(
        X((s.from.x + s.to.x) / 2) + 14,
        Y((s.from.y + s.to.y) / 2) + 24,
        X(s.to.x),
        Y(s.to.y),
      );
    ctx.stroke();
  }

  // 体。左（奥）→ 胴 → 右（手前）の順に描く
  const order = { left: 0, center: 1, right: 2 };
  const parts = [...sim.parts].sort((a, b) => order[a.side] - order[b.side]);
  for (const part of parts) {
    const t = part.body.translation();
    const rot = part.body.rotation();
    ctx.save();
    ctx.translate(X(t.x), Y(t.y));
    ctx.rotate(-rot);
    ctx.fillStyle =
      part.side === "center"
        ? "#e9d8b4"
        : part.name === "thigh"
          ? COLOR[`${part.side}Hip`]
          : part.name === "shin"
            ? COLOR[`${part.side}Knee`]
            : "#cbbf9f";
    // 左（奥）の脚は少し薄く描く
    ctx.globalAlpha = part.side === "left" ? 0.75 : 1;
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 1.5;
    for (const s of part.shapes) {
      ctx.beginPath();
      if (s.kind === "box") {
        ctx.roundRect((s.ox - s.hw) * SCALE, (-s.oy - s.hh) * SCALE, s.hw * 2 * SCALE, s.hh * 2 * SCALE, 6);
      } else {
        ctx.arc(s.ox * SCALE, -s.oy * SCALE, s.r * SCALE, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
    if (part.name === "torso") {
      // 顔。進む向き（右）を向いている
      const hy = -(0.32 + 0.12) * SCALE;
      ctx.fillStyle = "#2b2b2b";
      ctx.beginPath();
      ctx.arc(0.06 * SCALE, hy - 3, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(0.11 * SCALE, hy);
      ctx.lineTo(0.17 * SCALE, hy + 4);
      ctx.lineTo(0.11 * SCALE, hy + 8);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // 部位の名前。ももとすねの横に、動かすキーと一緒に出す
  ctx.font = "bold 13px sans-serif";
  for (const part of sim.parts) {
    if (part.side === "center" || part.name === "arm") continue;
    const j: JointName = `${part.side}${part.name === "thigh" ? "Hip" : "Knee"}`;
    const t = part.body.translation();
    const dx = part.side === "right" ? 0.14 : -0.14;
    ctx.fillStyle = COLOR[j];
    ctx.textAlign = part.side === "right" ? "left" : "right";
    ctx.fillText(`${LABEL[j]} ${KEYS[j][0].toUpperCase()}/${KEYS[j][1].toUpperCase()}`, X(t.x + dx), Y(t.y));
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#6b6252";
  ctx.font = "14px sans-serif";
  ctx.fillText("進む向き →", w - 110, 40);
  if (demo && solo && guide) {
    // 自分の入力（太い棒）と、お手本の入力（線）を並べて見せる
    const gx = 40;
    const gy = 150;
    const gh = 260;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 1.5;
    ctx.fillRect(gx, gy, 46, gh);
    ctx.strokeRect(gx, gy, 46, gh);
    ctx.fillStyle = COLOR[solo];
    ctx.fillRect(gx, gy + gh * (1 - input[solo]), 46, gh * input[solo]);
    const ty = gy + gh * (1 - guide[solo]);
    ctx.strokeStyle = "#2b2b2b";
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(gx - 10, ty);
    ctx.lineTo(gx + 56, ty);
    ctx.stroke();
    ctx.fillStyle = "#2b2b2b";
    ctx.font = "13px sans-serif";
    ctx.fillText("← お手本", gx + 60, ty + 4);
    ctx.fillText(`${LABEL[solo]}：色の棒を、黒い線に合わせる`, gx, gy + gh + 20);
  }
  if (demo) {
    ctx.fillStyle = "#1e8449";
    ctx.font = "bold 16px sans-serif";
    ctx.fillText("お手本を再生中（R で自分の操作に戻る）", 20, 104);
  }

  // 距離とタイム
  ctx.fillStyle = "#2b2b2b";
  ctx.font = "bold 26px sans-serif";
  ctx.fillText(`${sim.distance.toFixed(1)} m / ${GOAL_M} m`, 20, 40);
  ctx.fillText(`${sim.time.toFixed(1)} 秒`, 20, 74);
  if (sim.ended) {
    ctx.fillStyle = sim.ended === "goal" ? "#1e8449" : "#c0392b";
    ctx.font = "bold 44px sans-serif";
    ctx.fillText(sim.ended === "goal" ? "ゴール！" : "転倒", w / 2 - 80, 190);
    ctx.font = "18px sans-serif";
    ctx.fillText("R でやり直し", w / 2 - 55, 220);
  }
}

// ---- ループ ----
let last = performance.now();
let acc = 0;
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  applyKeys(dt);
  if (!paused) {
    acc += dt * timeScale;
    const step = sim.world.timestep;
    while (acc >= step) {
      sim.step(input);
      acc -= step;
    }
  }
  syncInputSliders();
  draw();
  requestAnimationFrame(frame);
}

// 動作確認のために、画面が隠れていても n コマ進められるようにする
(globalThis as unknown as { __tick: (n: number) => void }).__tick = (n) => {
  for (let i = 0; i < n; i++) {
    applyKeys(1 / 60);
    for (let k = 0; k < 4; k++) sim.step(input);
  }
  syncInputSliders();
  draw();
};
await Sim.init();
// 動作確認のために、状態を外から読めるようにする
(globalThis as unknown as { __proto: () => unknown }).__proto = () => ({
  distance: sim.distance,
  time: sim.time,
  ended: sim.ended,
  demo,
  mode: params.mode,
});
reset();
buildUi();
syncInputSliders();
requestAnimationFrame(frame);
