import { Assets, Texture } from "pixi.js";
import { EXPRESSIONS, type Expression, type PartImage, type UncleArt } from "./art.ts";

export interface LoadedImage {
  image: PartImage;
  texture: Texture;
}

export interface LoadedArt {
  head?: Record<Expression, LoadedImage>;
  torso?: LoadedImage;
  thigh?: LoadedImage;
  shin?: LoadedImage;
}

/**
 * 部位の画像を読み込む。onProgress は 0〜1 で、画像が1枚終わるたびに呼ぶ（読めなかった画像も数える）。
 * 読めなかった画像の部位は、戻り値に入れない（描画は Graphics になる）。
 * 読めた画像は Assets が URL ごとに覚えるので、2回目に呼んだときは読み直さない
 */
export async function loadUncleArt(
  art: UncleArt,
  onProgress?: (progress: number) => void,
): Promise<LoadedArt> {
  const images = [art.torso, art.thigh, art.shin, ...EXPRESSIONS.map((e) => art.head?.[e])];
  const urls = [...new Set(images.flatMap((image) => (image ? [image.src] : [])))];
  if (urls.length === 0) {
    onProgress?.(1);
    return {};
  }

  const textures = await Assets.load<unknown>(urls, {
    onProgress,
    strategy: "skip",
    onError(error, asset) {
      console.warn(
        "おじさんの部位画像を読み込めませんでした",
        typeof asset === "string" ? asset : asset.src,
        error,
      );
    },
  });

  const loadedImage = (image?: PartImage): LoadedImage | undefined => {
    if (!image) return undefined;
    const texture = textures[image.src];
    return texture instanceof Texture ? { image, texture } : undefined;
  };

  const normal = loadedImage(art.head?.normal);
  const head = normal
    ? (Object.fromEntries(
        EXPRESSIONS.map((e) => [e, loadedImage(art.head?.[e]) ?? normal]),
      ) as Record<Expression, LoadedImage>)
    : undefined;
  return {
    head,
    torso: loadedImage(art.torso),
    thigh: loadedImage(art.thigh),
    shin: loadedImage(art.shin),
  };
}
