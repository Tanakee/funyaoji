// ランキングの表を作り、前の形の表を今の形に直す。
// Durable Object の SQLite（ctx.storage.sql）のほか、テストでは Node.js の SQLite にもかけられるように、
// SQL の文を1つずつ流して結果の行を返す関数だけを受け取る

/** SQL の文を1つ流し、結果の行を返す */
export type RunSql = (query: string) => Record<string, unknown>[];

/**
 * 表と索引を用意する。何度呼んでもよい。
 * 同じタイムは先に保存したもの（id が小さいもの）を上にする。並べる順と同じ索引を張る。
 * id は残っている行のいちばん大きい id ＋ 1 になり、残っている行の中では保存した順に並ぶ。
 * AUTOINCREMENT は、保存のたびに sqlite_sequence にも1行書くので使わない
 */
export function setUpRankingTable(run: RunSql): void {
  run(`
    CREATE TABLE IF NOT EXISTS rankings (
      id INTEGER PRIMARY KEY,
      mode TEXT NOT NULL,
      input TEXT NOT NULL DEFAULT 'tilt',
      team_name TEXT NOT NULL,
      time_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  // ランキングは、モードと操作方法（input）の組ごとに分かれる。
  // input が無かったころの表には列を足す。それまでの記録は、すべて傾きで遊んだもの
  const hasInput = run("PRAGMA table_info(rankings)").some((column) => column.name === "input");
  if (!hasInput) run("ALTER TABLE rankings ADD COLUMN input TEXT NOT NULL DEFAULT 'tilt'");
  // モードが「10m」だけだったころの記録は、ノーマルモードの記録として扱う（docs/game.md の「ランキング」）
  run("UPDATE rankings SET mode = 'normal' WHERE mode = '10m'");
  run("DROP INDEX IF EXISTS rankings_order");
  run("CREATE INDEX IF NOT EXISTS rankings_order_by_input ON rankings (mode, input, time_ms, id)");
}
