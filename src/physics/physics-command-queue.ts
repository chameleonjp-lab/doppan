export type PhysicsCommandType =
  | "openGate"
  | "closeGate"
  | "enableFixture"
  | "disableFixture"
  | "createBody"
  | "destroyBody"
  | "teleportBall"
  | "setCollisionFilter"
  | "resetTemporaryRoute"
  | "launchBall";

export interface PhysicsCommandPayload {
  readonly [key: string]: boolean | number | string | { readonly x: number; readonly y: number } | null;
}

export interface PhysicsCommandInput {
  readonly type: PhysicsCommandType;
  readonly targetId: string;
  readonly stepId?: number;
  readonly payload?: PhysicsCommandPayload;
}

export interface PhysicsCommand {
  readonly commandId: number;
  readonly sequenceId: number;
  readonly physicsStepId: number;
  readonly targetId: string;
  readonly type: PhysicsCommandType;
  readonly payload: PhysicsCommandPayload;
}

export class PhysicsCommandQueueError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PhysicsCommandQueueError";
  }
}

export class PhysicsCommandOverflowError extends PhysicsCommandQueueError {
  public readonly limit: number;

  public constructor(limit: number) {
    super(`Physics command queue exceeded its ${limit}-command limit`);
    this.name = "PhysicsCommandOverflowError";
    this.limit = limit;
  }
}

export class PhysicsCommandSafetyError extends PhysicsCommandQueueError {
  public readonly targetId: string;

  public constructor(targetId: string, message: string) {
    super(message);
    this.name = "PhysicsCommandSafetyError";
    this.targetId = targetId;
  }
}

const copyPayload = (payload: PhysicsCommandPayload | undefined): PhysicsCommandPayload => {
  if (payload === undefined) {
    return {};
  }
  const copy: Record<string, boolean | number | string | { readonly x: number; readonly y: number } | null> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === "object" && value !== null && "x" in value && "y" in value) {
      copy[key] = { x: value.x, y: value.y };
    } else {
      copy[key] = value;
    }
  }
  return copy;
};

/**
 * Stages all world mutations until a fixed-step boundary.  Overflow and
 * conflicting creation commands are explicit safety errors, never drops.
 */
export class PhysicsCommandQueue {
  public static readonly DEFAULT_LIMIT = 256;

  private readonly limit: number;
  private readonly commands: PhysicsCommand[] = [];
  private nextCommandId = 1;
  private nextSequenceId = 1;
  private safetyError: PhysicsCommandQueueError | null = null;

  public constructor(limit = PhysicsCommandQueue.DEFAULT_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new RangeError("PhysicsCommandQueue limit must be a positive integer");
    }
    this.limit = limit;
  }

  public get size(): number {
    return this.commands.length;
  }

  public get maxSize(): number {
    return this.limit;
  }

  public get isSafeStopped(): boolean {
    return this.safetyError !== null;
  }

  public get error(): PhysicsCommandQueueError | null {
    return this.safetyError;
  }

  public enqueue(input: PhysicsCommandInput): PhysicsCommand {
    if (this.safetyError !== null) {
      throw this.safetyError;
    }
    if (this.commands.length >= this.limit) {
      this.safetyError = new PhysicsCommandOverflowError(this.limit);
      throw this.safetyError;
    }
    const physicsStepId = input.stepId ?? 0;
    if (!Number.isInteger(physicsStepId) || physicsStepId < 0) {
      throw new RangeError("PhysicsCommand stepId must be a non-negative integer");
    }
    const command: PhysicsCommand = {
      commandId: this.nextCommandId++,
      sequenceId: this.nextSequenceId++,
      physicsStepId,
      targetId: input.targetId,
      type: input.type,
      payload: copyPayload(input.payload),
    };
    this.commands.push(command);
    return { ...command, payload: copyPayload(command.payload) };
  }

  public push(input: PhysicsCommandInput): PhysicsCommand {
    return this.enqueue(input);
  }

  /** Returns normalized commands for one step and leaves future commands queued. */
  public drainForStep(physicsStepId: number): readonly PhysicsCommand[] {
    if (!Number.isInteger(physicsStepId) || physicsStepId < 0) {
      throw new RangeError("physicsStepId must be a non-negative integer");
    }
    const selected = this.commands.filter((command) => command.physicsStepId === physicsStepId);
    if (selected.length === 0) {
      return [];
    }
    const selectedIds = new Set(selected.map((command) => command.commandId));
    for (let index = this.commands.length - 1; index >= 0; index -= 1) {
      const command = this.commands[index];
      if (command !== undefined && selectedIds.has(command.commandId)) {
        this.commands.splice(index, 1);
      }
    }
    return this.normalize(selected);
  }

  public drain(physicsStepId: number): readonly PhysicsCommand[] {
    return this.drainForStep(physicsStepId);
  }

  /** Drains every command, useful for a controlled shutdown. */
  public drainAll(): readonly PhysicsCommand[] {
    const selected = this.commands.splice(0, this.commands.length);
    return this.normalize(selected);
  }

  public clear(): void {
    this.commands.length = 0;
  }

  private normalize(commands: readonly PhysicsCommand[]): readonly PhysicsCommand[] {
    const ordered = [...commands].sort((left, right) => left.sequenceId - right.sequenceId);
    const byTarget = new Map<string, PhysicsCommand[]>();
    for (const command of ordered) {
      const existing = byTarget.get(command.targetId);
      if (existing === undefined) {
        byTarget.set(command.targetId, [command]);
      } else {
        existing.push(command);
      }
    }

    const normalized: PhysicsCommand[] = [];
    for (const [targetId, targetCommands] of byTarget) {
      const createCommands = targetCommands.filter((command) => command.type === "createBody");
      if (createCommands.length > 1) {
        const error = new PhysicsCommandSafetyError(targetId, `duplicate createBody commands for ${targetId}`);
        this.safetyError = error;
        throw error;
      }
      const destroy = targetCommands.find((command) => command.type === "destroyBody");
      if (destroy !== undefined) {
        normalized.push(destroy);
        continue;
      }

      const latestByType = new Map<PhysicsCommandType, PhysicsCommand>();
      for (const command of targetCommands) {
        if (command.type === "openGate" || command.type === "closeGate") {
          const latest = latestByType.get("openGate");
          if (latest === undefined || latest.sequenceId < command.sequenceId) {
            latestByType.set("openGate", command);
          }
        } else if (command.type === "enableFixture" || command.type === "disableFixture") {
          const latest = latestByType.get("enableFixture");
          if (latest === undefined || latest.sequenceId < command.sequenceId) {
            latestByType.set("enableFixture", command);
          }
        } else if (command.type === "teleportBall" || command.type === "resetTemporaryRoute") {
          const latest = latestByType.get(command.type);
          if (latest === undefined || latest.sequenceId < command.sequenceId) {
            latestByType.set(command.type, command);
          }
        } else {
          latestByType.set(`${command.type}-${command.commandId}` as PhysicsCommandType, command);
        }
      }
      normalized.push(...latestByType.values());
    }
    return normalized.sort((left, right) => left.sequenceId - right.sequenceId).map((command) => ({
      ...command,
      payload: copyPayload(command.payload),
    }));
  }
}
