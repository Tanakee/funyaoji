import { useRef, useState, type FormEvent } from "react";
import { isRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "../shared/room.ts";

/** 参加する前に存在だけを確認する。関節は確保しない */
export function RoomCodeEntry() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<"idle" | "checking" | "missing" | "error">("idle");
  const pending = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isRoomCode(code) || pending.current) return;
    pending.current = true;
    setStatus("checking");
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`, { cache: "no-store" });
      if (response.status === 404) setStatus("missing");
      else if (!response.ok) setStatus("error");
      else {
        const url = new URL("/play", location.href);
        url.searchParams.set("room", code);
        location.assign(url.href);
      }
    } catch {
      setStatus("error");
    } finally {
      pending.current = false;
    }
  }

  return (
    <form className="phone-content room-entry" onSubmit={submit}>
      <h1>ルームコードを入力</h1>
      <label htmlFor="room-code">スクリーンに表示された4文字</label>
      <input
        id="room-code"
        value={code}
        maxLength={ROOM_CODE_LENGTH}
        autoCapitalize="characters"
        autoComplete="off"
        spellCheck={false}
        disabled={status === "checking"}
        aria-invalid={status === "missing"}
        aria-describedby={
          status === "missing" || status === "error" ? "room-entry-error" : undefined
        }
        onChange={(event) => {
          setCode(normalizeRoomCode(event.target.value));
          setStatus("idle");
        }}
      />
      {(status === "missing" || status === "error") && (
        <p id="room-entry-error" role="alert">
          {status === "missing"
            ? "このルームは見つかりません"
            : "確認できませんでした。もう一度お試しください"}
        </p>
      )}
      <button
        className={`room-entry-submit ${status === "checking" ? "is-checking" : ""}`}
        type="submit"
        disabled={!isRoomCode(code) || status === "checking"}
      >
        {status === "checking" ? "確認中…" : "進む"}
      </button>
    </form>
  );
}
