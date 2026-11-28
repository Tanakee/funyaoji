// おじさんの部位の画像を、物理の形に合わせて置くための値。PixiJS に依存しない
import { TORSO_SIZE } from "./body.ts";

export const EXPRESSIONS = ["normal", "strain", "goal", "fell"] as const;
export type Expression = (typeof EXPRESSIONS)[number];

export type ArtSlot = "head" | "torso" | "thigh" | "shin";

interface Point {
  x: number;
  y: number;
}

interface Size {
  width: number;
  height: number;
}

/** 画像1枚の置き方 */
export interface PartImage {
  /** 画像の URL。new URL("./x.png", import.meta.url).href で書く */
  src: string;
  /** 色を掛けない線の画像の URL。src と同じ大きさ・置き方で上に重ねる */
  lines?: string;
  /** 画像の幅（m） */
  width: number;
  /** 画像の高さ（m）。省くと縦横比を保つ */
  height?: number;
  /** 画像内の基準点（0〜1、下が +y）。省略時は画像の中心 */
  anchor?: Point;
  /** 部位の座標での基準点（m、上が +y）。省略時は ART_ORIGINS */
  at?: Point;
  /** 部位の座標での糸の付け所（m、上が +y）。省略時は STRING_ANCHORS */
  stringAt?: Point;
  /** 反時計回りの角度（rad） */
  rotation?: number;
}

/** 部位ごとの画像。左右の脚は同じ画像。すねの画像は足も含む。表情の画像が無ければ normal で描く */
export interface UncleArt {
  head?: { normal: PartImage } & Partial<Record<Expression, PartImage>>;
  torso?: PartImage;
  thigh?: PartImage;
  shin?: PartImage;
}

export const ART_ORIGINS: Record<ArtSlot, Point> = {
  head: { x: 0, y: TORSO_SIZE.hh + TORSO_SIZE.headR },
  torso: { x: 0, y: 0 },
  thigh: { x: 0, y: 0 },
  shin: { x: 0, y: 0 },
};

export function imageTransform(image: PartImage, textureSize: Size, slot: ArtSlot) {
  const { x, y } = image.at ?? ART_ORIGINS[slot];
  const scaleX = image.width / textureSize.width;
  const scaleY = -(image.height ?? scaleX * textureSize.height) / textureSize.height;
  return {
    x,
    y,
    scaleX,
    scaleY,
    rotation: image.rotation ?? 0,
    anchorX: image.anchor?.x ?? 0.5,
    anchorY: image.anchor?.y ?? 0.5,
  };
}

export function imagePointInPart(
  image: PartImage,
  textureSize: Size,
  slot: ArtSlot,
  u: number,
  v: number,
): Point {
  const t = imageTransform(image, textureSize, slot);
  const x = (u - t.anchorX) * textureSize.width * t.scaleX;
  const y = (v - t.anchorY) * textureSize.height * t.scaleY;
  const cos = Math.cos(t.rotation);
  const sin = Math.sin(t.rotation);
  return { x: t.x + x * cos - y * sin, y: t.y + x * sin + y * cos };
}
