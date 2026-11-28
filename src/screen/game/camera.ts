// 画面ごとのカメラの位置（docs/screens.md の「カメラ」）。画面が変わったときは、短くなめらかに移す
export type Scene = "lobby" | "countdown" | "playing" | "result";

export const CAMERA = { followX: 0.4, lobbyStartX: 0.5, easeS: 0.4 } as const;

export class Camera {
  private scene: Scene = "lobby";
  private shownM: number | undefined;
  private transition: { fromM: number; startMs: number } | undefined;

  setScene(scene: Scene, nowMs: number): void {
    if (scene === this.scene) return;
    this.scene = scene;
    if (this.shownM !== undefined) {
      this.transition = { fromM: this.shownM, startMs: nowMs };
    }
  }

  centerM(torsoX: number, widthPx: number, pxPerM: number, nowMs: number): number {
    // 遊び方（S4）も練習モードを使うので、ロビーと同じくスタートラインを中央に置く
    const targetM =
      this.scene === "lobby" ? ((CAMERA.followX - CAMERA.lobbyStartX) * widthPx) / pxPerM : torsoX;
    if (this.transition !== undefined) {
      const { fromM, startMs } = this.transition;
      const progress = Math.max(0, (nowMs - startMs) / (CAMERA.easeS * 1000));
      if (progress < 1) {
        const eased = 1 - (1 - progress) ** 3;
        this.shownM = fromM + (targetM - fromM) * eased;
        return this.shownM;
      }
      this.transition = undefined;
    }
    this.shownM = targetM;
    return targetM;
  }
}
