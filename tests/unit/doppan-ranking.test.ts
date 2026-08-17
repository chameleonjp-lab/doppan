import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createDoppanRankingApi,
  normalizeDoppanPlayerName,
  validateDoppanPlayerName,
} from "../../src/ranking/doppan-ranking";

describe("DOPPAN ranking boundary", () => {
  it("trims a display name and keeps the shared 20-character limit", () => {
    expect(normalizeDoppanPlayerName("  あお  ")).toBe("あお");
    expect(validateDoppanPlayerName("   ")).toBe("名前を入力してください");
    expect(validateDoppanPlayerName("あ".repeat(20))).toBeNull();
    expect(validateDoppanPlayerName("あ".repeat(21))).toBe("名前は20文字以内で入力してください");
  });

  it("maps shared submit and ranking RPC rows without exposing client details", async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: [{
          accepted: true,
          result_display_name: "あお",
          result_best_score: -20,
          result_play_count: 2,
          is_first_play: false,
          is_new_best: true,
        }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ rank_no: 1, display_name: "あお", best_score: -20, play_count: 2 }],
        error: null,
      });
    const api = createDoppanRankingApi({ rpc } as unknown as SupabaseClient);

    await expect(api.submitScore("あお", -20)).resolves.toMatchObject({
      accepted: true,
      displayName: "あお",
      bestScore: -20,
      isNewBest: true,
    });
    await expect(api.getRanking()).resolves.toEqual([
      { rank: 1, displayName: "あお", bestScore: -20, playCount: 2 },
    ]);
    expect(rpc).toHaveBeenNthCalledWith(1, "submit_score", {
      p_display_name: "あお",
      p_game_slug: "doppan",
      p_score: -20,
      p_client_version: "doppan-web-1",
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "get_game_ranking", {
      p_game_slug: "doppan",
      p_limit: 10,
    });
  });
});
