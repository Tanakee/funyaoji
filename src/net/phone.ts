// スマホのページが使う、つなぎ直しのための小さな道具（docs/api.md の「つなぎ直し」）

/** localStorage に ID を覚えておくキー */
const CLIENT_ID_KEY = "funyaoji.clientId";

/**
 * スマホの ID。connectPhone の clientId に渡す。
 * ブラウザごとに localStorage に覚えるので、読み込み直しても、QR コードを読み直して別のタブで開いても同じ ID になる。
 * 同じ ID のあとからつないだタブが前のタブを置き換える（4000）ので、1台のスマホで2つの関節を持てない。
 * localStorage が使えない（プライベートブラウズなど）ときも、このページを開いているあいだは同じ ID を返す
 */
export function phoneClientId(storage: KeyValueStorage | undefined = local()): string {
  if (clientId !== undefined) return clientId;
  try {
    const saved = storage?.getItem(CLIENT_ID_KEY);
    if (saved) return (clientId = saved);
  } catch {
    // 読めなくても、新しい ID でつなぐ
  }
  clientId = crypto.randomUUID();
  try {
    storage?.setItem(CLIENT_ID_KEY, clientId);
  } catch {
    // 覚えられなくても、このページを開いているあいだは、モジュールに覚えた ID を使う
  }
  return clientId;
}

/** このページで一度決めた ID */
let clientId: string | undefined;

/** localStorage のうち、使うところだけ。Node.js には無い */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function local(): KeyValueStorage | undefined {
  try {
    return (globalThis as { localStorage?: KeyValueStorage }).localStorage;
  } catch {
    // ブラウザによっては、localStorage を読んだだけで例外を投げる
    return undefined;
  }
}

/**
 * tilt のシーケンス番号を数える。ページを開いた時刻（ミリ秒）から数え始める。
 * 読み込み直して数え直しても、前の番号より大きくなる。毎秒30しか増えないので、時計を追い越さない
 */
export function createTiltSeq(start: number = Date.now()): () => number {
  let seq = start;
  return () => seq++;
}
