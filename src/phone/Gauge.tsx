import { useEffect, useRef } from "react";
import { latestAngle, MAX_ANGLE } from "./tilt.ts";

/** いまの傾き（0〜90度）を、自分の部位の色のバーで出す。スクリーンの返事は待たない */
export function Gauge() {
  const root = useRef<HTMLDivElement>(null);
  const meter = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const gauge = root.current!;
    const track = meter.current!;
    const bar = fill.current!;
    let frame = 0;
    let drawn: number | undefined;
    let drawnPercent = 0;

    // 傾きは毎秒30回以上届くので、React の描画を待たずに DOM へ反映する
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const angle = latestAngle();
      if (angle === drawn) return;
      if (angle === undefined || drawn === undefined) {
        gauge.toggleAttribute("data-empty", angle === undefined);
      }
      drawn = angle;
      const ratio = (angle ?? 0) / MAX_ANGLE;
      bar.style.transform = `scaleX(${ratio})`;
      const percent = Math.round(ratio * 100);
      if (percent !== drawnPercent) {
        track.setAttribute("aria-valuenow", String(percent));
        drawnPercent = percent;
      }
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="gauge" ref={root} data-empty="">
      <div className="gauge-scale">
        <span>寝かせる</span>
        <span>立てる</span>
      </div>
      <div
        className="gauge-track"
        ref={meter}
        role="meter"
        aria-label="いまの傾き"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
      >
        <div className="gauge-fill" ref={fill} />
      </div>
      <p className="gauge-empty">傾きが読み取れていません</p>
    </div>
  );
}
