import { DurableObject } from "cloudflare:workers";
import {
  RANKING_TOP_COUNT,
  type RankingEntry,
  type SubmitRankingRequest,
  type SubmitRankingResponse,
} from "../shared/api.ts";
import type { InputMethod, Mode } from "../shared/messages.ts";
import { setUpRankingTable } from "./ranking-table.ts";

/** モードと操作方法の組ごとに残す件数。超えたら遅いものから消す */
const MAX_ENTRIES_PER_MODE = 1000;

type Row = { id: number; team_name: string; time_ms: number; created_at: number };

/**
 * ランキングを持つ Durable Object。全体で1つ（index.ts の RANKING_OBJECT_NAME）。
 * 入力の検査は呼ぶ側（index.ts）で済ませてある
 */
export class Ranking extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    setUpRankingTable((query) => sql.exec(query).toArray());
  }

  /** 1件保存し、その順位と、保存したあとの上位を返す */
  async submit(request: SubmitRankingRequest): Promise<SubmitRankingResponse> {
    const { mode, input, teamName, timeMs } = request;
    const createdAt = Date.now();
    const sql = this.ctx.storage.sql;
    const { id } = sql
      .exec<{ id: number }>(
        "INSERT INTO rankings (mode, input, team_name, time_ms, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id",
        mode,
        input,
        teamName,
        timeMs,
        createdAt,
      )
      .one();
    const { ahead } = sql
      .exec<{ ahead: number }>(
        "SELECT COUNT(*) AS ahead FROM rankings WHERE mode = ? AND input = ? AND (time_ms < ? OR (time_ms = ? AND id < ?))",
        mode,
        input,
        timeMs,
        timeMs,
        id,
      )
      .one();
    // 件数を抑え、順位を数えるときに読む行が増え続けないようにする
    sql.exec(
      `DELETE FROM rankings WHERE id IN (
        SELECT id FROM rankings WHERE mode = ? AND input = ? ORDER BY time_ms, id LIMIT -1 OFFSET ?
      )`,
      mode,
      input,
      MAX_ENTRIES_PER_MODE,
    );
    const entry: RankingEntry = { rank: ahead + 1, teamName, timeMs, createdAt };
    return { entry, rankings: this.top(mode, input) };
  }

  /** 速い順に上位を返す */
  async getTop(mode: Mode, input: InputMethod): Promise<RankingEntry[]> {
    return this.top(mode, input);
  }

  private top(mode: Mode, input: InputMethod): RankingEntry[] {
    return this.ctx.storage.sql
      .exec<Row>(
        "SELECT id, team_name, time_ms, created_at FROM rankings WHERE mode = ? AND input = ? ORDER BY time_ms, id LIMIT ?",
        mode,
        input,
        RANKING_TOP_COUNT,
      )
      .toArray()
      .map((row, i) => ({
        rank: i + 1,
        teamName: row.team_name,
        timeMs: row.time_ms,
        createdAt: row.created_at,
      }));
  }
}
