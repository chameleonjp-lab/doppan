export type SaveEnvironment = "development-preview" | "production" | "test";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface SaveEnvelope<T> {
  schemaVersion: 1;
  savedAt: string;
  payload: T;
}

export interface SaveResult {
  ok: boolean;
  key: string;
  error?: unknown;
}

export type PayloadValidator<T> = (payload: unknown) => payload is T;

export interface SaveStorageOptions<T> {
  validatePayload?: PayloadValidator<T>;
}

export const SAVE_KEYS: Readonly<Record<SaveEnvironment, string>> = Object.freeze({
  "development-preview": "doppan:development-preview:save:v1",
  production: "doppan:production:save:v1",
  test: "doppan:test:save:v1",
});

function browserStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    // Some privacy modes expose window.localStorage but throw on access.
    return null;
  }
}

function isEnvelope<T>(value: unknown): value is SaveEnvelope<T> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<SaveEnvelope<T>>;
  return candidate.schemaVersion === 1 && typeof candidate.savedAt === "string" && "payload" in candidate;
}

/**
 * Saves through a temporary key, verifies the write, then commits and verifies
 * the formal key. Every storage error is contained so gameplay can continue.
 */
export class SaveStorage<T> {
  public readonly environment: SaveEnvironment;

  public readonly key: string;

  private readonly storage: StorageLike | null;

  private readonly validatePayload: PayloadValidator<T> | undefined;

  public constructor(
    environment: SaveEnvironment,
    storage: StorageLike | null = browserStorage(),
    options: SaveStorageOptions<T> = {},
  ) {
    this.environment = environment;
    this.key = SAVE_KEYS[environment];
    this.storage = storage;
    this.validatePayload = options.validatePayload;
  }

  public save(payload: T): SaveResult {
    if (!this.storage) {
      return { ok: false, key: this.key, error: new Error("Storage is unavailable") };
    }

    const temporaryKey = `${this.key}:pending`;
    let serialized: string;
    let previousFormal: string | null = null;
    let formalWriteAttempted = false;
    try {
      previousFormal = this.storage.getItem(this.key);
      serialized = JSON.stringify({ schemaVersion: 1, savedAt: new Date().toISOString(), payload });
      this.storage.setItem(temporaryKey, serialized);
      const temporaryReadback = this.storage.getItem(temporaryKey);
      if (temporaryReadback !== serialized || !this.isValidSerializedEnvelope(temporaryReadback)) {
        throw new Error("Temporary save readback did not match");
      }
      formalWriteAttempted = true;
      this.storage.setItem(this.key, serialized);
      const formalReadback = this.storage.getItem(this.key);
      if (formalReadback !== serialized || !this.isValidSerializedEnvelope(formalReadback)) {
        throw new Error("Formal save readback did not match");
      }
      this.storage.removeItem(temporaryKey);
      return { ok: true, key: this.key };
    } catch (error: unknown) {
      try {
        this.storage.removeItem(temporaryKey);
      } catch {
        // A broken storage implementation must not interrupt the game.
      }
      if (formalWriteAttempted) {
        try {
          if (previousFormal === null) {
            this.storage.removeItem(this.key);
          } else {
            this.storage.setItem(this.key, previousFormal);
          }
        } catch {
          // Best-effort rollback must not replace the original storage error.
        }
      }
      return { ok: false, key: this.key, error };
    }
  }

  public load(): T | null {
    if (!this.storage) {
      return null;
    }
    try {
      const serialized = this.storage.getItem(this.key);
      if (!serialized) {
        return null;
      }
      const parsed: unknown = JSON.parse(serialized);
      if (!isEnvelope<T>(parsed) || (this.validatePayload && !this.validatePayload(parsed.payload))) {
        return null;
      }
      return parsed.payload;
    } catch {
      return null;
    }
  }

  public clear(): boolean {
    if (!this.storage) {
      return false;
    }
    try {
      this.storage.removeItem(this.key);
      this.storage.removeItem(`${this.key}:pending`);
      return true;
    } catch {
      return false;
    }
  }

  private isValidSerializedEnvelope(serialized: string | null): boolean {
    if (!serialized) {
      return false;
    }
    try {
      const parsed: unknown = JSON.parse(serialized);
      return isEnvelope<T>(parsed) && (!this.validatePayload || this.validatePayload(parsed.payload));
    } catch {
      return false;
    }
  }
}

export function createSaveStorage<T>(
  environment: SaveEnvironment,
  storage?: StorageLike | null,
  options?: SaveStorageOptions<T>,
): SaveStorage<T> {
  return new SaveStorage<T>(environment, storage, options);
}
