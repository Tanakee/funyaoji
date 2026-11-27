import { useEffect, useRef } from "react";
import { JOINTS, type Joint } from "../../shared/messages.ts";
import { GAME_COLORS, KEYBOARD_KEYS } from "../game/index.ts";
import { JOINT_LABELS } from "./labels.ts";
import type { ScreenSession, ScreenView } from "./session.ts";

/** つまみの上端・下端が、その関節の何にあたるか（docs/game.md の「関節の入力」） */
const ENDS: Record<Joint, { top: string; bottom: string }> = {
  rightHip: { top: "前", bottom: "後ろ" },
  leftHip: { top: "前", bottom: "後ろ" },
  rightKnee: { top: "曲げる", bottom: "伸ばす" },
  leftKnee: { top: "曲げる", bottom: "伸ばす" },
};

const jointColor = (joint: Joint) => `#${GAME_COLORS.joint[joint].toString(16).padStart(6, "0")}`;

/**
 * 1人で確かめるための操作。?debug のとき、ゲームの下に出す。
 * 関節ごとのつまみは、指（マウス）の高さがそのまま入力。スマホのいる関節は、読むだけ
 */
export function DebugControls({ session, view }: { session: ScreenSession; view: ScreenView }) {
  if (!view.debug.enabled || view.flow.kind === "lobby") return null;
  const { players } = view.flow;
  return (
    <section className="debug-controls" aria-label="デバッグ操作">
      <div className="debug-actions">
        <button
          type="button"
          className="debug-button"
          aria-pressed={view.debug.autoplay}
          onClick={() => session.setAutoplay(!view.debug.autoplay)}
        >
          お手本 {view.debug.autoplay ? "ON" : "OFF"}
        </button>
        <p className="debug-actions-note">
          お手本の間も、つまみをつかんだ関節は指に従う。白い線がお手本の位置
        </p>
      </div>
      <Strips session={session} players={players} showGuide={view.debug.autoplay} />
    </section>
  );
}

type Refs = Record<
  Joint,
  { fill: HTMLElement | null; guide: HTMLElement | null; out: HTMLElement | null }
>;

function Strips({
  session,
  players,
  showGuide,
}: {
  session: ScreenSession;
  players: readonly Joint[];
  showGuide: boolean;
}) {
  const refs = useRef<Refs>({
    rightHip: { fill: null, guide: null, out: null },
    leftHip: { fill: null, guide: null, out: null },
    rightKnee: { fill: null, guide: null, out: null },
    leftKnee: { fill: null, guide: null, out: null },
  });

  // つまみの位置は毎フレーム、ゲームの入力（キーボード・お手本・スマホも含む）に合わせる。state にはしない
  useEffect(() => {
    let frame = requestAnimationFrame(function tick() {
      for (const joint of JOINTS) {
        const el = refs.current[joint];
        const value = session.readInput(joint);
        el.fill?.style.setProperty("--value", String(value));
        el.guide?.style.setProperty("--value", String(session.readDemo(joint)));
        if (el.out) el.out.textContent = value.toFixed(2);
      }
      frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [session]);

  return (
    <div className="debug-strips">
      {JOINTS.map((joint) => (
        <Strip
          key={joint}
          session={session}
          joint={joint}
          phone={players.includes(joint)}
          showGuide={showGuide}
          refs={refs}
        />
      ))}
    </div>
  );
}

function Strip({
  session,
  joint,
  phone,
  showGuide,
  refs,
}: {
  session: ScreenSession;
  joint: Joint;
  phone: boolean;
  showGuide: boolean;
  refs: React.RefObject<Refs>;
}) {
  const slot = refs.current[joint];
  const { up, down } = KEYBOARD_KEYS[joint];
  // 指の高さ（0 が下端、1 が上端）をそのまま入力にする。1人で何本も触るので、押した場所に飛ぶ
  const setFrom = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    session.setInput(joint, 1 - (event.clientY - rect.top) / rect.height);
  };
  const handlers = phone
    ? {}
    : {
        onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          session.grab(joint, true);
          setFrom(event);
        },
        onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) setFrom(event);
        },
        onPointerUp() {
          session.grab(joint, false);
        },
        onPointerCancel() {
          session.grab(joint, false);
        },
        onContextMenu(event: React.MouseEvent) {
          event.preventDefault();
        },
      };
  return (
    <div
      className={phone ? "strip strip--phone" : "strip"}
      style={{ "--joint-color": jointColor(joint) } as React.CSSProperties}
    >
      <div className="strip-name">
        {JOINT_LABELS[joint]}
        <small>{phone ? "スマホ" : `${up.label}/${down.label}`}</small>
      </div>
      <div
        className="strip-track"
        role="slider"
        aria-label={`${JOINT_LABELS[joint]}の入力`}
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-readonly={phone}
        data-joint={joint}
        {...handlers}
      >
        <div className="strip-fill" ref={(el) => void (slot.fill = el)} />
        {showGuide && <div className="strip-guide" ref={(el) => void (slot.guide = el)} />}
        <span className="strip-end strip-end--top">{ENDS[joint].top}</span>
        <span className="strip-end strip-end--bottom">{ENDS[joint].bottom}</span>
      </div>
      <output className="strip-value" ref={(el) => void (slot.out = el)} />
    </div>
  );
}
