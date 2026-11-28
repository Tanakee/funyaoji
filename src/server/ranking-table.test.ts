// 表の作り直しを、Node.js の SQLite で確かめる。Durable Object の中の SQLite には、前の形の表を置けないため
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";
import { setUpRankingTable, type RunSql } from "./ranking-table.ts";

function open(): { db: DatabaseSync; run: RunSql } {
  const db = new DatabaseSync(":memory:");
  return { db, run: (query) => db.prepare(query).all() };
}

describe("setUpRankingTable", () => {
  test("空から表を作る。2回呼んでもよい", () => {
    const { db, run } = open();
    setUpRankingTable(run);
    setUpRankingTable(run);
    db.prepare(
      "INSERT INTO rankings (mode, team_name, time_ms, created_at) VALUES ('hard', 'a', 1, 1)",
    ).run();
    expect(db.prepare("SELECT mode, input FROM rankings").all()).toEqual([
      { mode: "hard", input: "tilt" },
    ]);
  });

  test("「10m」と input の無かったころの記録を、ノーマルモードの傾きの記録にする", () => {
    const { db, run } = open();
    db.exec(`
      CREATE TABLE rankings (
        id INTEGER PRIMARY KEY,
        mode TEXT NOT NULL,
        team_name TEXT NOT NULL,
        time_ms INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX rankings_order ON rankings (mode, time_ms, id);
      INSERT INTO rankings (mode, team_name, time_ms, created_at) VALUES ('10m', 'a', 2000, 1);
      INSERT INTO rankings (mode, team_name, time_ms, created_at) VALUES ('10m', 'b', 1000, 2);
    `);
    setUpRankingTable(run);
    expect(
      db.prepare("SELECT mode, input, team_name FROM rankings ORDER BY time_ms, id").all(),
    ).toEqual([
      { mode: "normal", input: "tilt", team_name: "b" },
      { mode: "normal", input: "tilt", team_name: "a" },
    ]);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'rankings'")
      .all()
      .map((row) => row.name);
    expect(indexes).toEqual(["rankings_order_by_input"]);
  });

  test("input のある表の「10m」の記録は、操作方法を変えずにノーマルモードにする", () => {
    const { db, run } = open();
    setUpRankingTable(run);
    db.exec(`
      INSERT INTO rankings (mode, input, team_name, time_ms, created_at) VALUES ('10m', 'camera', 'c', 1, 1);
      INSERT INTO rankings (mode, input, team_name, time_ms, created_at) VALUES ('hard', 'tilt', 'h', 1, 2);
    `);
    setUpRankingTable(run);
    expect(db.prepare("SELECT mode, input, team_name FROM rankings ORDER BY id").all()).toEqual([
      { mode: "normal", input: "camera", team_name: "c" },
      { mode: "hard", input: "tilt", team_name: "h" },
    ]);
  });
});
