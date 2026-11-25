// スマホのページが使う、つなぎ直しのための小さな道具（docs/api.md の「つなぎ直し」）

/** sessionStorage に ID を覚えておくキー */
const CLIENT_ID_KEY = "funyaoji.clientId";

/**
 * スマホの ID。connectPhone の clientId に渡す。
 * タブごとに sessionStorage に覚えるので、同じタブで読み込み直しても同じ ID になり、同じ関節に戻れる。
 * sessionStorage が使えない（プライベートブラウズなど）ときも、このページを開いているあいだは同じ ID を返す
 */
export function phoneClientId(storage: KeyValueStorage | undefined = session()): string {
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

/** sessionStorage のうち、使うところだけ。Node.js には無い */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function session(): KeyValueStorage | undefined {
  try {
    return (globalThis as { sessionStorage?: KeyValueStorage }).sessionStorage;
  } catch {
    // ブラウザによっては、sessionStorage を読んだだけで例外を投げる
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
