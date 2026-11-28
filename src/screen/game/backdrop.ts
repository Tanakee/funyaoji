// 紙に刷った運動会の校庭（背景と地面）を描く
import { Container, Graphics, Rectangle, TilingSprite, type Renderer } from "pixi.js";
import { GOAL_M } from "./sim.ts";

export const BACKDROP_COLORS = {
  paper: 0xf3ead7,
  paperGrainA: 0xd9c9a6,
  paperGrainB: 0xe2d4b4,
  face: 0xfbf8f0,
  ink: 0x1f3a68,
  beni: 0xa8282e,
  soil: 0xc99f6a,
  soilGrain: 0x8f6a3e,
} as const;

export type BackdropFrame = {
  width: number;
  height: number;
  ui: number;
  groundY: number;
  pxPerM: number;
  /** 世界の x=0 m が画面のどこにあるか（px） */
  worldOriginX: number;
};

export type Backdrop = {
  back: Container;
  ground: Container;
  update(frame: BackdropFrame): void;
  setBuntingVisible(visible: boolean): void;
  destroy(): void;
};

const GRAIN_SIZE = 7;
const BUNTING_WIDTH = 400;
const BUNTING_HEIGHT = 56;
const BUNTING_PARALLAX = 0.35;
/** 左上のタイムの下に張る */
const BUNTING_Y = 172;
const FLAG_WIDTH = 24;
const FLAG_HEIGHT = 18;
const LINE_LEAN = 0.3;
const GOAL_POST_M = 1.2;
const TRACK_FAR = 9;
const TRACK_NEAR = 106;

function bakeTile(renderer: Renderer, target: Graphics, width: number, height: number) {
  const texture = renderer.generateTexture({
    target,
    frame: new Rectangle(0, 0, width, height),
    resolution: 3,
  });
  target.destroy();
  return texture;
}

function drawFlag(g: Graphics, x: number, y: number, pattern: number): void {
  const { face, ink } = BACKDROP_COLORS;
  const left = x - FLAG_WIDTH / 2;
  const right = x + FLAG_WIDTH / 2;
  const bottom = y + FLAG_HEIGHT;
  g.rect(left, y, FLAG_WIDTH, FLAG_HEIGHT).fill(face);
  switch (pattern) {
    case 0:
      // 刷りが旗の外に出ないように、角から線幅の半分だけ内側に寄せる。
      g.moveTo(left + 1.5, y + 1.5)
        .lineTo(right - 1.5, bottom - 1.5)
        .moveTo(right - 1.5, y + 1.5)
        .lineTo(left + 1.5, bottom - 1.5)
        .stroke({ color: ink, alpha: 0.32, width: 3 });
      break;
    case 1:
      g.rect(left, y, FLAG_WIDTH, FLAG_HEIGHT).fill({ color: ink, alpha: 0.22 });
      break;
    case 2:
      g.circle(x, y + FLAG_HEIGHT / 2, 5).fill({ color: ink, alpha: 0.35 });
      break;
    case 3:
      g.rect(left, y, 8, FLAG_HEIGHT).fill({ color: ink, alpha: 0.3 });
      g.rect(right - 8, y, 8, FLAG_HEIGHT).fill({ color: ink, alpha: 0.15 });
      break;
    case 4:
      g.rect(left, y + (FLAG_HEIGHT - 6) / 2, FLAG_WIDTH, 6).fill({ color: ink, alpha: 0.3 });
      break;
  }
  g.rect(left, y, FLAG_WIDTH, FLAG_HEIGHT).stroke({ color: ink, alpha: 0.45, width: 1.5 });
}

function drawBunting(): Graphics {
  const g = new Graphics();
  g.moveTo(0, 4)
    .quadraticCurveTo(BUNTING_WIDTH / 2, 64, BUNTING_WIDTH, 4)
    .stroke({ color: BACKDROP_COLORS.ink, alpha: 0.5, width: 2, cap: "round" });
  for (let i = 0; i < 12; i++) {
    const x = 17 + 34 * i;
    const t = x / BUNTING_WIDTH;
    const y = 4 + 120 * t * (1 - t);
    drawFlag(g, x, y, i % 5);
    // 右端をまたぐ旗は、次のタイルの左端で続く。
    if (x + FLAG_WIDTH / 2 > BUNTING_WIDTH) drawFlag(g, x - BUNTING_WIDTH, y, i % 5);
  }
  return g;
}

function drawChalkMark(g: Graphics, x: number, y: number, width: number, height: number): void {
  const left = x - width / 2;
  const right = x + width / 2;
  const lean = height * LINE_LEAN;
  g.poly([left, y, right, y, right + lean, y + height, left + lean, y + height]).fill({
    color: BACKDROP_COLORS.face,
    alpha: 0.95,
  });
}

function drawGoal(g: Graphics, goalX: number, groundY: number, ui: number, pxPerM: number): void {
  const { ink, beni, face } = BACKDROP_COLORS;
  const farY = groundY + TRACK_FAR * ui;
  const nearY = groundY + TRACK_NEAR * ui;
  const farX = goalX + TRACK_FAR * ui * LINE_LEAN;
  const nearX = goalX + TRACK_NEAR * ui * LINE_LEAN;
  const postHeight = GOAL_POST_M * pxPerM;
  const farTop = farY - postHeight;
  const nearTop = nearY - postHeight;
  g.moveTo(farX, farY)
    .lineTo(farX, farTop)
    .moveTo(nearX, nearY)
    .lineTo(nearX, nearTop)
    .stroke({ color: ink, width: 6 * ui, cap: "round" });

  const midX = (farX + nearX) / 2;
  const midY = (farTop + nearTop) / 2 + 8 * ui;
  g.moveTo(farX, farTop)
    .quadraticCurveTo(midX, midY, nearX, nearTop)
    .stroke({ color: ink, width: 13 * ui, cap: "round" });
  g.moveTo(farX, farTop)
    .quadraticCurveTo(midX, midY, nearX, nearTop)
    .stroke({ color: beni, width: 8 * ui, cap: "round" });

  g.rect(farX, farTop, 43 * ui, 15 * ui)
    .fill(ink)
    .stroke({ color: ink, width: 2 * ui });
  g.rect(farX, farTop + 15 * ui, 43 * ui, 15 * ui)
    .fill(face)
    .stroke({ color: ink, width: 2 * ui });
  g.circle(farX, farTop, 5 * ui)
    .fill(face)
    .stroke({ color: ink, width: 2 * ui });
}

export function createBackdrop(renderer: Renderer): Backdrop {
  const { paper, paperGrainA, paperGrainB, soil, soilGrain, face, ink } = BACKDROP_COLORS;
  // 地の色ごとタイルに焼き、画面いっぱいを塗るのを1回で済ませる
  const paperTexture = bakeTile(
    renderer,
    new Graphics()
      .rect(0, 0, GRAIN_SIZE, GRAIN_SIZE)
      .fill(paper)
      .circle(1.5, 2, 0.8)
      .fill({ color: paperGrainA, alpha: 0.7 })
      .circle(5, 5.5, 0.6)
      .fill({ color: paperGrainB, alpha: 0.7 }),
    GRAIN_SIZE,
    GRAIN_SIZE,
  );
  const buntingTexture = bakeTile(renderer, drawBunting(), BUNTING_WIDTH, BUNTING_HEIGHT);
  const soilTexture = bakeTile(
    renderer,
    new Graphics()
      .rect(0, 0, GRAIN_SIZE, GRAIN_SIZE)
      .fill(soil)
      .circle(3.5, 3.5, 1.2)
      .fill({ color: soilGrain, alpha: 0.28 }),
    GRAIN_SIZE,
    GRAIN_SIZE,
  );

  const back = new Container();
  const paperDots = new TilingSprite({ texture: paperTexture });
  const bunting = new TilingSprite({ texture: buntingTexture, alpha: 0.55 });
  back.addChild(paperDots, bunting);

  const ground = new Container();
  const soilDots = new TilingSprite({ texture: soilTexture });
  const lines = new Graphics();
  ground.addChild(soilDots, lines);

  return {
    back,
    ground,
    update({ width, height, ui, groundY, pxPerM, worldOriginX }) {
      paperDots.setSize(width, height);
      paperDots.tileScale.set(ui);
      bunting.y = BUNTING_Y * ui;
      bunting.setSize(width, buntingTexture.height * ui);
      bunting.tileScale.set(ui);
      // tilePosition は tileScale に関係なく、画面上の px でずらせる。
      bunting.tilePosition.x = worldOriginX * BUNTING_PARALLAX;

      const groundHeight = height - groundY;
      soilDots.y = groundY;
      soilDots.setSize(width, groundHeight);
      soilDots.tileScale.set(ui);
      soilDots.tilePosition.x = worldOriginX;

      lines.clear();
      const edgeY = groundY + 1.5 * ui;
      const farY = groundY + TRACK_FAR * ui;
      const nearY = groundY + TRACK_NEAR * ui;
      lines
        .moveTo(0, edgeY)
        .lineTo(width, edgeY)
        .stroke({ color: ink, width: 3 * ui });
      lines
        .moveTo(0, farY)
        .lineTo(width, farY)
        .moveTo(0, nearY)
        .lineTo(width, nearY)
        .stroke({ color: face, alpha: 0.95, width: 5 * ui });

      const goalX = worldOriginX + GOAL_M * pxPerM;
      drawChalkMark(lines, worldOriginX, groundY, 12 * ui, groundHeight);
      drawChalkMark(lines, goalX, groundY, 24 * ui, groundHeight);
      const first = Math.floor(-worldOriginX / pxPerM) - 1;
      const last = Math.ceil((width - worldOriginX) / pxPerM) + 1;
      for (let m = first; m <= last; m++) {
        const x = worldOriginX + m * pxPerM;
        drawChalkMark(lines, x, groundY, 8 * ui, (m % 5 === 0 ? 26 : 16) * ui);
      }
      drawGoal(lines, goalX, groundY, ui, pxPerM);
    },
    setBuntingVisible(visible) {
      bunting.visible = visible;
    },
    destroy() {
      back.destroy({ children: true });
      ground.destroy({ children: true });
      paperTexture.destroy(true);
      buntingTexture.destroy(true);
      soilTexture.destroy(true);
    },
  };
}
