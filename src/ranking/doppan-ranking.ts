import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const DOPPAN_GAME_SLUG = "doppan" as const;
export const DOPPAN_CLIENT_VERSION = "doppan-web-1" as const;
export const DOPPAN_RANKING_LIMIT = 10 as const;

const DEFAULT_SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";

export interface DoppanRankingEntry {
  readonly rank: number;
  readonly displayName: string;
  readonly bestScore: number;
  readonly playCount: number;
}

export interface DoppanScoreSubmission {
  readonly accepted: boolean;
  readonly displayName: string;
  readonly bestScore: number;
  readonly playCount: number;
  readonly isFirstPlay: boolean;
  readonly isNewBest: boolean;
}

interface ScoreSubmissionRow {
  readonly accepted?: unknown;
  readonly result_display_name?: unknown;
  readonly result_best_score?: unknown;
  readonly result_play_count?: unknown;
  readonly is_first_play?: unknown;
  readonly is_new_best?: unknown;
}

interface RankingRow {
  readonly rank_no?: unknown;
  readonly display_name?: unknown;
  readonly best_score?: unknown;
  readonly play_count?: unknown;
}

export interface DoppanRankingApi {
  readonly submitScore: (
    displayName: string,
    score: number,
  ) => Promise<DoppanScoreSubmission>;
  readonly getRanking: (limit?: number) => Promise<readonly DoppanRankingEntry[]>;
}

function envValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function firstRow(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) {
    return asRecord(value[0]);
  }
  return asRecord(value);
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export function normalizeDoppanPlayerName(value: string): string {
  return value.trim();
}

export function validateDoppanPlayerName(value: string): string | null {
  const normalized = normalizeDoppanPlayerName(value);
  if (normalized.length === 0) {
    return "名前を入力してください";
  }
  if (normalized.length > 20) {
    return "名前は20文字以内で入力してください";
  }
  return null;
}

export function createDoppanRankingApi(
  client: SupabaseClient,
): DoppanRankingApi {
  return {
    submitScore: async (displayName, score) => {
      const response = await client.rpc("submit_score", {
        p_display_name: displayName,
        p_game_slug: DOPPAN_GAME_SLUG,
        p_score: score,
        p_client_version: DOPPAN_CLIENT_VERSION,
      }) as unknown as { data: unknown; error: Error | null };
      const { data, error } = response;
      if (error) {
        throw error;
      }
      const row = firstRow(data) as ScoreSubmissionRow;
      return {
        accepted: booleanValue(row.accepted, false),
        displayName: stringValue(row.result_display_name, displayName),
        bestScore: numberValue(row.result_best_score, score),
        playCount: numberValue(row.result_play_count, 1),
        isFirstPlay: booleanValue(row.is_first_play, false),
        isNewBest: booleanValue(row.is_new_best, false),
      };
    },
    getRanking: async (limit = DOPPAN_RANKING_LIMIT) => {
      const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const response = await client.rpc("get_game_ranking", {
        p_game_slug: DOPPAN_GAME_SLUG,
        p_limit: safeLimit,
      }) as unknown as { data: unknown; error: Error | null };
      const { data, error } = response;
      if (error) {
        throw error;
      }
      if (!Array.isArray(data)) {
        return [];
      }
      return data.map((value: unknown): DoppanRankingEntry => {
        const row = asRecord(value) as RankingRow;
        return {
          rank: numberValue(row.rank_no, 0),
          displayName: stringValue(row.display_name, "—"),
          bestScore: numberValue(row.best_score, 0),
          playCount: numberValue(row.play_count, 0),
        };
      });
    },
  };
}

const supabase = createClient(
  envValue(import.meta.env.VITE_SUPABASE_URL, DEFAULT_SUPABASE_URL),
  envValue(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, DEFAULT_SUPABASE_PUBLISHABLE_KEY),
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

export const doppanRanking: DoppanRankingApi = createDoppanRankingApi(supabase);
