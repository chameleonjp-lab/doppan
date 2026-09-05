import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanPlayerName, readHistoricalRanking } from "../../src/ui/pachi-platform";

describe("pachi platform ranking read", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("removes control characters from display names and ignores invalid scores", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify([
          { display_name: '<img>x</img>\u0001', best_score: 1234, is_active: false },
          { display_name: "壊れた点数", best_score: "not-a-number" },
          { display_name: "無効な行", best_score: Number.NaN },
          null,
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readHistoricalRanking(new AbortController().signal)).resolves.toEqual([
      { name: "<img>x</img>", score: 1234 },
    ]);
    expect(cleanPlayerName("  A\u0000B\u001f  ")).toBe("AB");
  });

  it("only reads the historical RPC and sends no score payload", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(readHistoricalRanking(new AbortController().signal)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toEqual(expect.stringContaining("/rest/v1/rpc/get_best_score_ranking"));
    expect(init).toMatchObject({ method: "POST" });
    const body = init?.body;
    if (typeof body !== "string") throw new Error("ranking request body is not JSON text");
    expect(JSON.parse(body)).toEqual({ p_game_slug: "doppan", p_limit: 10 });
    expect(body).not.toContain("is_active");
    expect(url).not.toEqual(expect.stringMatching(/upsert|insert|submit/i));
  });
});
