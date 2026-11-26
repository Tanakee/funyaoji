// 試作（あとで捨てる）：おじさんの体と操作を、PC（キー・マウス）でもスマホ（指）でも触る
import {
  DEFAULT_BODY,
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

// 体の候補。検証（lab/）で選んだ設定と、その設定で 10m に着く歩き方（お手本）
const BODIES: { id: string; label: string; params: Partial<Params>; demo: Gait }[] = [
  {
    id: "B",
    label: "B 太く長い胴・大きな足（検証で一番良かった）",
    params: {
      assist: 1.006,
      stiffness: 780,
      damping: 108,
      footFriction: 1.845,
      motorMaxForce: 0.185,
      body: {
        ...DEFAULT_BODY,
        torso: { hw: 0.24, hh: 0.373, density: 33 },
        head: { r: 0.12, density: 34 },
        thigh: { hw: 0.07, hh: 0.241, density: 143 },
        shin: { hw: 0.06, hh: 0.194, density: 66 },
        foot: { hw: 0.22, hh: 0.04, density: 300, offset: -0.1 },
        kneeRange: [0, -1.649],
      },
    },
    demo: { T: 2.16, h0: 0.34, A: 0.38, K: 0.76, kp: 0.21 },
  },
  {
    id: "old",
    label: "今までのお手本の体（比べるため）",
    params: {
      assist: 2,
      stiffness: 600,
      damping: 60,
      footFriction: 1.5,
      motorMaxForce: 0,
      body: DEFAULT_BODY,
    },
    demo: { T: 1.43, h0: 0.23, A: 0.4, K: 0.85, kp: 0.09 },
  },
];
let bodyChoice = BODIES[0]!;
const params: Params = { ...DEFAULT_PARAMS, ...bodyChoice.params };
let DEMO: Gait = bodyChoice.demo;
const sliderEls: { key: keyof Params; el: HTMLInputElement; out: HTMLOutputElement }[] = [];
let demo = false;
/** お手本の再生中に、自分で動かす関節。空ならお手本が全部動かす */
let solo: JointName | "" = "";
let guide: Record<JointName, number> | undefined;
/** 操作のガイド：お手本の入力に近づくには、どのボタンを押せばよいかを見せる */
let guideOn = true;
const GUIDE_DEADBAND = 0.06;
const padStrips = {} as Record<
  JointName,
  { fill: HTMLDivElement; target: HTMLDivElement; arrow: HTMLDivElement }
>;
let input = neutralInput(params.mode);
let mirror = false;
let paused = false;
let timeScale = 1;
let sim: Sim;
const held = new Set<string>();

const $ = <T = HTMLElement>(id: string) => document.getElementById(id) as unknown as T;
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
    modes.appendChild(b);
  }
  renderModes();

  const inputs = $("inputs");
  for (const j of JOINTS) {
    const row = document.createElement("label");
    row.innerHTML = `<span style="color:${COLOR[j]}">${LABEL[j]}　<kbd>${KEYS[j][0].toUpperCase()}</kbd>↑ <kbd>${KEYS[j][1].toUpperCase()}</kbd>↓</span><input type="range" min="0" max="1" step="0.01" id="in-${j}"><output id="out-${j}"></output>`;
    inputs.appendChild(row);
    $<HTMLInputElement>(`in-${j}`).oninput = (e) => {
      input[j] = Number((e.target as HTMLInputElement).value);
    };
  }

  // 関節ごとのつまみ。指（またはマウス）の高さが、そのまま入力の値になる。
  // 本番のスマホの傾きと同じく位置で決めるので、反応が遅れても行き過ぎにくい
  const pad = $("pad");
  for (const j of JOINTS) {
    const col = document.createElement("div");
    col.className = "strip";
    col.innerHTML = `<span style="color:${COLOR[j]}">${LABEL[j]}<kbd class="key">${KEYS[j][0].toUpperCase()}/${KEYS[j][1].toUpperCase()}</kbd></span><div class="track"><div class="fill" style="background:${COLOR[j]}"></div><div class="target"></div><div class="arrow"></div></div>`;
    const track = col.querySelector<HTMLDivElement>(".track")!;
    const setFrom = (e: PointerEvent) => {
      const r = track.getBoundingClientRect();
      input[j] = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    };
    let dragging = false;
    track.onpointerdown = (e) => {
      e.preventDefault();
      track.setPointerCapture(e.pointerId);
      dragging = true;
      setFrom(e);
    };
    track.onpointermove = (e) => {
      if (dragging) setFrom(e);
    };
    track.onpointerup = () => (dragging = false);
    track.onpointercancel = () => (dragging = false);
    track.oncontextmenu = (e) => e.preventDefault();
    padStrips[j] = {
      fill: col.querySelector<HTMLDivElement>(".fill")!,
      target: col.querySelector<HTMLDivElement>(".target")!,
      arrow: col.querySelector<HTMLDivElement>(".arrow")!,
    };
    pad.appendChild(col);
  }

  // よく使うボタン。PC とスマホで同じボタンを使い、キーも同じ処理を呼ぶ
  $("m-reset").onclick = doReset;
  $("m-pause").onclick = togglePause;
  $("m-demo").onclick = () => (demo ? doReset() : startDemo());
  const SPEEDS = [1, 0.6, 0.3];
  $("m-slow").onclick = () => {
    const el = $<HTMLInputElement>("slow");
    const next = SPEEDS[(SPEEDS.indexOf(timeScale) + 1) % SPEEDS.length] ?? 1;
    el.value = String(next);
    el.dispatchEvent(new Event("input"));
  };
  $("m-guide").onclick = () => {
    const el = $<HTMLInputElement>("guide");
    el.checked = !el.checked;
    el.dispatchEvent(new Event("change"));
  };
  $("m-settings").onclick = () => document.body.classList.add("settings-open");
  $("m-close").onclick = () => document.body.classList.remove("settings-open");

  const tune = $("tune");
  for (const s of SLIDERS) {
    const row = document.createElement("label");
    row.innerHTML = `<span>${s.label}</span><input type="range" min="${s.min}" max="${s.max}" step="${s.step}" value="${params[s.key] as number}"><output>${params[s.key] as number}</output>`;
    const el = row.querySelector("input")!;
    const out = row.querySelector("output")!;
    el.oninput = () => {
      (params[s.key] as number) = Number(el.value);
      out.textContent = el.value;
      if (s.key === "footFriction") reset();
    };
    tune.appendChild(row);
    sliderEls.push({ key: s.key, el, out });
  }

  const bodySel = $<HTMLSelectElement>("body");
  for (const b of BODIES) {
    const o = document.createElement("option");
    o.value = b.id;
    o.textContent = b.label;
    bodySel.appendChild(o);
  }
  bodySel.onchange = () => {
    bodyChoice = BODIES.find((b) => b.id === bodySel.value)!;
    Object.assign(params, bodyChoice.params);
    DEMO = bodyChoice.demo;
    for (const s of sliderEls) {
      s.el.value = String(params[s.key] as number);
      s.out.textContent = String(params[s.key] as number);
    }
    demo = false;
    reset();
    bodySel.blur();
  };

  $<HTMLInputElement>("upper").onchange = (e) => {
    params.upperBody = (e.target as HTMLInputElement).checked;
    reset();
  };
  $<HTMLInputElement>("guide").onchange = (e) => {
    guideOn = (e.target as HTMLInputElement).checked;
  };
  $<HTMLInputElement>("mirror").onchange = (e) => {
    mirror = (e.target as HTMLInputElement).checked;
  };
  $<HTMLInputElement>("slow").oninput = (e) => {
    timeScale = Number((e.target as HTMLInputElement).value);
    $("slow-out").textContent = `${timeScale}倍`;
  };
  $<HTMLSelectElement>("solo").onchange = (e) => {
    solo = (e.target as HTMLSelectElement).value as JointName | "";
    (e.target as HTMLSelectElement).blur();
  };
  $("step").onclick = () => {
    paused = true;
    sim.step(input);
  };

  addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (k === "r") doReset();
    else if (k === "d") $("m-demo").click();
    else if (k === " ") {
      e.preventDefault();
      togglePause();
    } else held.add(k);
  });
  addEventListener("keyup", (e) => held.delete(e.key.toLowerCase()));
}

function doReset(): void {
  demo = false;
  reset();
}

function startDemo(): void {
  params.mode = "angle";
  params.assist = bodyChoice.params.assist ?? 2;
  params.kneeAuto = 0;
  reset();
  renderModes();
  demo = true;
}

function togglePause(): void {
  paused = !paused;
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
  guide = guideOn && params.mode === "angle" ? gaitInput(DEMO, sim.time) : undefined;
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
const SCALE = 210; // 1m が何 px か
function draw(): void {
  const w = canvas.width;
  const h = canvas.height;
  const camX = sim.torso.translation().x;
  const groundY = h - 80;
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
        ctx.roundRect(
          (s.ox - s.hw) * SCALE,
          (-s.oy - s.hh) * SCALE,
          s.hw * 2 * SCALE,
          s.hh * 2 * SCALE,
          6,
        );
      } else {
        ctx.arc(s.ox * SCALE, -s.oy * SCALE, s.r * SCALE, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.stroke();
    }
    if (part.name === "torso") {
      // 顔。進む向き（右）を向いている
      const head = part.shapes.find((sh) => sh.kind === "ball");
      const hy = -(head?.oy ?? 0.44) * SCALE;
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
    ctx.fillText(
      `${LABEL[j]} ${KEYS[j][0].toUpperCase()}/${KEYS[j][1].toUpperCase()}`,
      X(t.x + dx),
      Y(t.y),
    );
  }
  ctx.textAlign = "left";
  ctx.fillStyle = "#6b6252";
  ctx.font = "14px sans-serif";
  ctx.fillText("進む向き →", w - 110, 40);
  if (demo && solo && guide && !guideOn) {
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

  drawGuide();

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

/** つまみと、よく使うボタンの表示を、今の状態に合わせる */
function syncPadHints(): void {
  for (const j of JOINTS) {
    const st = padStrips[j];
    if (!st) continue;
    st.fill.style.height = `${input[j] * 100}%`;
    const show = guideOn && guide && (!demo || j === solo);
    st.target.style.display = show ? "block" : "none";
    if (show) st.target.style.bottom = `${guide![j] * 100}%`;
    const d = show ? guide![j] - input[j] : 0;
    st.arrow.textContent = d > GUIDE_DEADBAND ? "↑" : d < -GUIDE_DEADBAND ? "↓" : "";
  }
  $("m-pause").querySelector("span")!.textContent = paused ? "再開" : "停止";
  $("m-demo").classList.toggle("on", demo);
  $("m-slow").textContent = `速さ ${timeScale}倍`;
  $("m-guide").classList.toggle("on", guideOn);
}

/** 関節ごとに、今から2秒先までのお手本の入力（線）と、今の自分の入力（丸）を描く */
function drawGuide(): void {
  if (!guide || !guideOn) return;
  const joints = demo ? (solo ? [solo] : []) : [...JOINTS];
  if (!joints.length) return;
  const x0 = 20;
  const lw = 300;
  const lh = 44;
  const y0 = 128;
  const ahead = 2;
  ctx.font = "13px sans-serif";
  ctx.fillStyle = "#2b2b2b";
  ctx.fillText(
    "ガイド：線がお手本（右が先）、丸が今の入力。つまみの黒い線に指を合わせる",
    x0,
    y0 - 8,
  );
  joints.forEach((j, i) => {
    const y = y0 + i * (lh + 8);
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.fillRect(x0, y, lw, lh);
    ctx.strokeStyle = "#a89f8c";
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y, lw, lh);
    // お手本の線
    ctx.strokeStyle = COLOR[j];
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k <= 40; k++) {
      const t = (k / 40) * ahead;
      const g = gaitInput(DEMO, sim.time + t)[j];
      const px = x0 + 30 + (t / ahead) * (lw - 40);
      const py = y + lh - 4 - g * (lh - 8);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
    // 今の入力
    ctx.fillStyle = "#2b2b2b";
    ctx.beginPath();
    ctx.arc(x0 + 30, y + lh - 4 - input[j] * (lh - 8), 6, 0, Math.PI * 2);
    ctx.fill();
    // 押すボタン
    const d = guide![j] - input[j];
    ctx.font = "bold 16px sans-serif";
    ctx.fillStyle = COLOR[j];
    ctx.fillText(
      d > GUIDE_DEADBAND ? "↑" : d < -GUIDE_DEADBAND ? "↓" : "・",
      x0 + 8,
      y + lh / 2 + 6,
    );
    ctx.font = "11px sans-serif";
    ctx.fillText(LABEL[j], x0 + lw + 6, y + lh / 2 + 4);
  });
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
  syncPadHints();
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
  syncPadHints();
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
