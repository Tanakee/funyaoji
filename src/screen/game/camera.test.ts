import { expect, test } from "vite-plus/test";
import { Camera } from "./camera.ts";

test("ロビーでは胴が動いてもスタートラインを中央に置く", () => {
  const camera = new Camera();
  camera.setScene("lobby", 0);
  expect(camera.centerM(2, 1000, 100, 0)).toBeCloseTo(-1);
  expect(camera.centerM(3, 1000, 100, 100)).toBeCloseTo(-1);
});

test.each(["countdown", "playing", "result"] as const)(
  "%s では胴を追い、最初の描画は補間なしで位置を決める",
  (scene) => {
    const camera = new Camera();
    camera.setScene(scene, 100);
    expect(camera.centerM(3, 1000, 100, 100)).toBe(3);
    expect(camera.centerM(4, 1000, 100, 200)).toBe(4);
  },
);

test("画面が切り替わると、直前に描いた位置から 0.4 秒かけて移る", () => {
  const camera = new Camera();
  camera.centerM(0, 1000, 100, 0);
  camera.setScene("countdown", 100);
  expect(camera.centerM(3, 1000, 100, 100)).toBeCloseTo(-1);
  expect(camera.centerM(3, 1000, 100, 300)).toBeCloseTo(2.5);
  expect(camera.centerM(3, 1000, 100, 500)).toBe(3);
});

test("補間の途中で胴が動くと、そのフレームの位置に向かって移る", () => {
  const camera = new Camera();
  camera.centerM(0, 1000, 100, 0);
  camera.setScene("playing", 100);
  camera.centerM(3, 1000, 100, 100);
  expect(camera.centerM(7, 1000, 100, 300)).toBeCloseTo(6);
  expect(camera.centerM(8, 1000, 100, 500)).toBe(8);
});
