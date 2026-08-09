import { describe, expect, it } from "vitest";
import { SAVE_KEYS, SaveStorage, type StorageLike } from "../../src/storage/save-storage";

class MemoryStorage implements StorageLike {
  public values = new Map<string, string>();

  public failOnSet = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.failOnSet) {
      throw new Error("quota exceeded");
    }
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class CorruptFormalReadbackStorage extends MemoryStorage {
  public corruptNextFormalReadback = false;

  private formalWritePendingCorruption = false;

  override getItem(key: string): string | null {
    if (key === SAVE_KEYS.test && this.formalWritePendingCorruption) {
      this.formalWritePendingCorruption = false;
      this.corruptNextFormalReadback = false;
      return "corrupt-readback";
    }
    return super.getItem(key);
  }

  override setItem(key: string, value: string): void {
    super.setItem(key, value);
    if (key === SAVE_KEYS.test && this.corruptNextFormalReadback) {
      this.formalWritePendingCorruption = true;
    }
  }
}

describe("SaveStorage", () => {
  it("keeps test, preview, and production keys separated", () => {
    expect(new Set(Object.values(SAVE_KEYS)).size).toBe(3);
    expect(SAVE_KEYS.test).not.toBe(SAVE_KEYS.production);
    const storage = new MemoryStorage();
    const preview = new SaveStorage("development-preview", storage);
    const production = new SaveStorage("production", storage);

    expect(preview.save({ score: 10 }).ok).toBe(true);
    expect(production.load()).toBeNull();
    expect(preview.load()).toEqual({ score: 10 });
  });

  it("uses temporary write, readback, formal commit, and cleanup", () => {
    const storage = new MemoryStorage();
    const saves = new SaveStorage("test", storage);
    const result = saves.save({ level: 2 });

    expect(result.ok).toBe(true);
    expect(storage.getItem(`${SAVE_KEYS.test}:pending`)).toBeNull();
    expect(saves.load()).toEqual({ level: 2 });
  });

  it("contains a storage failure so the game can continue", () => {
    const storage = new MemoryStorage();
    storage.failOnSet = true;
    const saves = new SaveStorage("test", storage);

    expect(saves.save({ level: 4 }).ok).toBe(false);
    expect(saves.load()).toBeNull();
    expect(saves.clear()).toBe(true);
  });

  it("contains an unavailable storage backend", () => {
    const saves = new SaveStorage<{ level: number }>("test", null);

    expect(saves.save({ level: 4 }).ok).toBe(false);
    expect(saves.load()).toBeNull();
    expect(saves.clear()).toBe(false);
  });

  it("returns null for malformed data", () => {
    const storage = new MemoryStorage();
    storage.values.set(SAVE_KEYS.test, "not-json");
    expect(new SaveStorage("test", storage).load()).toBeNull();
  });

  it("rolls back to the previous formal save after a bad formal readback", () => {
    const storage = new CorruptFormalReadbackStorage();
    const saves = new SaveStorage<{ level: number }>("test", storage);
    expect(saves.save({ level: 1 }).ok).toBe(true);

    storage.corruptNextFormalReadback = true;
    expect(saves.save({ level: 2 }).ok).toBe(false);
    expect(saves.load()).toEqual({ level: 1 });
    expect(storage.getItem(`${SAVE_KEYS.test}:pending`)).toBeNull();
  });

  it("applies the payload validator to save and load", () => {
    const storage = new MemoryStorage();
    const saves = new SaveStorage<unknown>("test", storage, {
      validatePayload: (payload): payload is { level: number } =>
        typeof payload === "object" &&
        payload !== null &&
        "level" in payload &&
        typeof payload.level === "number",
    });

    expect(saves.save({ level: 3 }).ok).toBe(true);
    expect(saves.load()).toEqual({ level: 3 });
    expect(saves.save({ level: "invalid" }).ok).toBe(false);
    expect(saves.load()).toEqual({ level: 3 });
  });
});
