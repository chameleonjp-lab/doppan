export const PACHI_RULE_VERSION = "doppan-pachi-v1";
const SUPABASE_URL = "https://mlpnjgezrnhdxsxolyzj.supabase.co";
const PUBLIC_KEY = "sb_publishable_drzcy0v97knU6FgjqSgBHw_0A9XPdFM";

export function cleanPlayerName(value: string): string {
  return Array.from(value.replace(/[\u0000-\u001f\u007f]/g, "").trim()).slice(0, 20).join("");
}

export function readPreference(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function savePreference(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Nonessential preference only. */ }
}

export function gameUrl(): string {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function shareGame(text: string): Promise<"shared" | "copied" | "cancelled" | "manual"> {
  if (navigator.share) {
    try { await navigator.share({ title: "ドッパン", text }); return "shared"; }
    catch (error) { if (error instanceof DOMException && error.name === "AbortError") return "cancelled"; }
  }
  try { await navigator.clipboard.writeText(text); return "copied"; }
  catch { return "manual"; }
}

export interface RankingRow { readonly name: string; readonly score: number; }

/** Historical scores stay readable; v1 scores are never posted into the old rules. */
export async function readHistoricalRanking(signal: AbortSignal): Promise<readonly RankingRow[]> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_best_score_ranking`, {
    method: "POST",
    headers: { apikey: PUBLIC_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ p_game_slug: "doppan", p_limit: 10 }),
    signal,
  });
  if (!response.ok) throw new Error(`Ranking failed (${response.status})`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error("Invalid ranking response");
  const rows: RankingRow[] = [];
  for (const value of data.slice(0, 10)) {
    if (typeof value !== "object" || value === null) continue;
    const row = value as Record<string, unknown>;
    const score = row.best_score ?? row.score;
    if (typeof score !== "number" || !Number.isSafeInteger(score)) continue;
    const name = typeof row.display_name === "string" ? cleanPlayerName(row.display_name) : "";
    rows.push({ name: name || "ななし", score });
  }
  return rows;
}
