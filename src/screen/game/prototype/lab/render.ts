/// <reference types="node" />
// 試作（あとで捨てる）：記録（record.ts）を、SVG のコマにして ffmpeg で動画にする。ブラウザも開発サーバーも使わない
//
// 使い方：node src/screen/game/prototype/lab/render.ts --out <出力の名前（拡張子なし）> [--gif] [--sheet] [--cols 2] <記録.json> ...
//   <名前>.mp4 を作る。--gif で <名前>.gif（小さめ）、--sheet で <名前>-sheet.png（12コマを並べた1枚）も作る
//   記録を複数渡すと、並べて同時に再生する
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { load, type Recording } from "./record.ts";

const COLOR = ["#e4572e", "#2e86ab", "#f3a712", "#4caf7d"]; // rightHip, leftHip, rightKnee, leftKnee
const LABEL = ["右もも", "左もも", "右ひざ", "左ひざ"];
const GOAL_M = 10;

const W = 720;
const H = 330;
const SCALE = 105;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function frameAt(rec: Recording, t: number): { f: Recording["frames"][number]; done: boolean } {
  const i = Math.min(rec.frames.length - 1, Math.floor(t * rec.fps));
  return { f: rec.frames[i]!, done: i >= rec.frames.length - 1 };
}

function panel(rec: Recording, t: number): string {
  const { f, done } = frameAt(rec, t);
  const torsoIdx = rec.parts.findIndex((p) => p.name === "torso");
  const camX = f.p[torsoIdx]![0];
  const groundY = H - 58;
  const X = (x: number) => W * 0.42 + (x - camX) * SCALE;
  const Y = (y: number) => groundY - y * SCALE;
  const out: string[] = [];
  out.push(`<rect width="${W}" height="${H}" fill="#f6f1e7"/>`);
  out.push(`<rect y="${groundY}" width="${W}" height="${H - groundY}" fill="#d9cfbd"/>`);
  for (let m = Math.floor(camX - 5); m <= camX + 6; m++) {
    const x = X(m);
    const key = m === 0 || m === GOAL_M;
    out.push(
      `<line x1="${x}" y1="${groundY}" x2="${x}" y2="${groundY + (key ? 34 : 10)}" stroke="${key ? "#c0392b" : "#b5a98f"}" stroke-width="${key ? 3 : 1}"/>`,
    );
    out.push(
      `<text x="${x + 4}" y="${groundY + 26}" font-size="12" fill="#6b6252">${m === 0 ? "スタート" : m === GOAL_M ? "ゴール" : `${m}m`}</text>`,
    );
  }
  for (const s of f.s) {
    const [fx, fy, tx, ty, taut, j] = s;
    out.push(
      `<line x1="${X(fx)}" y1="${Y(fy)}" x2="${X(tx)}" y2="${Y(ty)}" stroke="${taut ? COLOR[j] : "#b9b2a3"}" stroke-width="${taut ? 2.5 : 1}" stroke-dasharray="${taut ? "" : "4 3"}"/>`,
    );
  }
  const order = { left: 0, center: 1, right: 2 };
  const idx = rec.parts
    .map((_, i) => i)
    .sort((a, b) => order[rec.parts[a]!.side] - order[rec.parts[b]!.side]);
  for (const i of idx) {
    const part = rec.parts[i]!;
    const [x, y, rot] = f.p[i]!;
    const side = part.side === "right" ? 0 : 1;
    const fill =
      part.side === "center"
        ? "#e9d8b4"
        : part.name === "thigh"
          ? COLOR[side]
          : part.name === "shin"
            ? COLOR[side + 2]
            : "#cbbf9f";
    out.push(
      `<g transform="translate(${X(x).toFixed(1)},${Y(y).toFixed(1)}) rotate(${((-rot * 180) / Math.PI).toFixed(2)})" opacity="${part.side === "left" ? 0.75 : 1}">`,
    );
    for (const s of part.shapes) {
      if (s.kind === "box") {
        out.push(
          `<rect x="${(s.ox - s.hw) * SCALE}" y="${(-s.oy - s.hh) * SCALE}" width="${s.hw * 2 * SCALE}" height="${s.hh * 2 * SCALE}" rx="5" fill="${fill}" stroke="#2b2b2b" stroke-width="1.5"/>`,
        );
      } else {
        out.push(
          `<circle cx="${s.ox * SCALE}" cy="${-s.oy * SCALE}" r="${s.r * SCALE}" fill="${fill}" stroke="#2b2b2b" stroke-width="1.5"/>`,
        );
        // 顔。進む向き（右）を向いている
        const hy = -s.oy * SCALE;
        out.push(`<circle cx="${0.06 * SCALE}" cy="${hy - 3}" r="2.2" fill="#2b2b2b"/>`);
      }
    }
    out.push(`</g>`);
  }
  // 足が着いているか
  for (const k of [0, 1]) {
    out.push(
      `<circle cx="${W - 196 + k * 16}" cy="${H - 20}" r="6" fill="${f.c[k] ? COLOR[k + 2] : "none"}" stroke="${COLOR[k + 2]}" stroke-width="2"/>`,
    );
  }
  out.push(
    `<text x="${W - 172}" y="${H - 16}" font-size="11" fill="#6b6252">足が地面に着いている（右・左）</text>`,
  );
  // 入力（棒）と実際の角度（黒い線）
  const bx = W - 150;
  const by = 46;
  const bh = 92;
  for (let j = 0; j < 4; j++) {
    const x = bx + j * 34;
    const u = f.in[j]!;
    const a = Math.min(1.1, Math.max(-0.1, f.ang[j]!));
    out.push(`<rect x="${x}" y="${by}" width="22" height="${bh}" fill="#fff" stroke="#2b2b2b"/>`);
    out.push(
      `<rect x="${x}" y="${by + bh * (1 - u)}" width="22" height="${bh * u}" fill="${COLOR[j]}"/>`,
    );
    out.push(
      `<line x1="${x - 4}" y1="${by + bh * (1 - a)}" x2="${x + 26}" y2="${by + bh * (1 - a)}" stroke="#2b2b2b" stroke-width="3"/>`,
    );
    out.push(
      `<text x="${x + 11}" y="${by + bh + 14}" font-size="10" text-anchor="middle" fill="${COLOR[j]}">${LABEL[j]}</text>`,
    );
  }
  out.push(
    `<text x="${W - 176}" y="${by - 8}" font-size="10" fill="#6b6252">色の棒：入力　黒い線：実際の角度</text>`,
  );
  // 名前・距離・時間
  const dist = camX;
  out.push(
    `<text x="14" y="26" font-size="17" font-weight="bold" fill="#2b2b2b">${esc(rec.label)}</text>`,
  );
  if (rec.note)
    out.push(`<text x="14" y="46" font-size="12" fill="#6b6252">${esc(rec.note)}</text>`);
  out.push(
    `<text x="14" y="72" font-size="20" font-weight="bold" fill="#2b2b2b">${dist.toFixed(1)} m　${f.t.toFixed(1)} 秒</text>`,
  );
  if (done) {
    const r = rec.result;
    const msg =
      r.ended === "goal"
        ? `ゴール ${r.time.toFixed(1)}秒`
        : r.ended === "fell"
          ? "転倒"
          : r.ended === "stuck"
            ? "止まった"
            : "時間切れ";
    out.push(
      `<text x="${W * 0.42}" y="120" font-size="34" font-weight="bold" text-anchor="middle" fill="${r.ended === "goal" ? "#1e8449" : "#c0392b"}">${msg}</text>`,
    );
    if (r.problems.length)
      out.push(
        `<text x="${W * 0.42}" y="146" font-size="13" text-anchor="middle" fill="#c0392b">異常：${esc(r.problems.join("、"))}</text>`,
      );
  }
  return out.join("");
}

function frameSvg(recs: Recording[], t: number, cols: number): string {
  const rows = Math.ceil(recs.length / cols);
  const w = W * cols;
  const h = H * rows;
  const body = recs
    .map((r, i) => {
      const x = (i % cols) * W;
      const y = Math.floor(i / cols) * H;
      return `<g transform="translate(${x},${y})"><clipPath id="c${i}"><rect width="${W}" height="${H}"/></clipPath><g clip-path="url(#c${i})">${panel(r, t)}</g><rect width="${W}" height="${H}" fill="none" stroke="#a89f8c"/></g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="sans-serif">${body}</svg>`;
}

function main(): void {
  const args = process.argv.slice(2);
  let out = "";
  let gif = false;
  let sheet = false;
  let cols = 1;
  let fps = 30;
  const files: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--out") out = args[++i]!;
    else if (a === "--gif") gif = true;
    else if (a === "--sheet") sheet = true;
    else if (a === "--cols") cols = Number(args[++i]);
    else if (a === "--fps") fps = Number(args[++i]);
    else files.push(a);
  }
  if (!out || !files.length) {
    console.error("使い方：render.ts --out <名前> [--gif] [--sheet] [--cols 2] <記録.json> ...");
    process.exit(1);
  }
  const recs = files.map(load);
  // いちばん長い記録に合わせ、終わったあと1秒止めて見せる
  const dur = Math.max(...recs.map((r) => r.frames.at(-1)!.t)) + 1;
  const dir = `${out}.frames`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const n = Math.ceil(dur * fps);
  for (let k = 0; k < n; k++) {
    writeFileSync(`${dir}/${String(k).padStart(5, "0")}.svg`, frameSvg(recs, k / fps, cols));
  }
  const ff = (a: string[]) =>
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...a], {
      stdio: "inherit",
    });
  ff([
    "-framerate",
    String(fps),
    "-i",
    `${dir}/%05d.svg`,
    "-pix_fmt",
    "yuv420p",
    "-vf",
    "pad=ceil(iw/2)*2:ceil(ih/2)*2",
    `${out}.mp4`,
  ]);
  if (gif) {
    const width = Math.min(W * cols, 600);
    ff([
      "-i",
      `${out}.mp4`,
      "-vf",
      `fps=10,scale=${width}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=32[p];[b][p]paletteuse=dither=bayer`,
      `${out}.gif`,
    ]);
  }
  if (sheet) {
    // 12コマを等間隔に抜いて、3列4行の1枚にする
    const picks = Array.from({ length: 12 }, (_, i) =>
      Math.min(n - 1, Math.round((i * (n - 1)) / 11)),
    );
    const sel = picks.map((p) => `eq(n\\,${p})`).join("+");
    ff([
      "-i",
      `${out}.mp4`,
      "-vf",
      `select='${sel}',scale=iw/2:-1,tile=3x4`,
      "-frames:v",
      "1",
      "-fps_mode",
      "vfr",
      `${out}-sheet.png`,
    ]);
  }
  rmSync(dir, { recursive: true, force: true });
  console.log(
    `作成：${out}.mp4${gif ? `, ${out}.gif` : ""}${sheet ? `, ${out}-sheet.png` : ""}（${dur.toFixed(1)}秒）`,
  );
}

main();
