// ルームコードは英数字4文字。読み間違えやすい 0・O・1・I・L を使わない
export const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** 小文字で入力されても受け付けるように、大文字にそろえる */
export function normalizeRoomCode(code: string): string {
  return code.toUpperCase();
}

export function isRoomCode(code: string): boolean {
  return ROOM_CODE_PATTERN.test(code);
}
