import { GameLoop, type FrameUpdate } from "./loop/game-loop";

export { GameLoop } from "./loop/game-loop";
export type { FrameUpdate } from "./loop/game-loop";

export interface HmrContext {
  dispose(callback: () => void): void;
}

export interface GameLoopRegistrationOptions {
  onDispose?: () => void;
  onError?: (error: unknown) => void;
}

export function registerGameLoopHmrDispose(
  update: FrameUpdate,
  hot: HmrContext | undefined,
  options: GameLoopRegistrationOptions = {},
): GameLoop {
  const loop = options.onError
    ? new GameLoop(update, { onError: options.onError })
    : new GameLoop(update);
  hot?.dispose(() => {
    loop.dispose();
    options.onDispose?.();
  });
  return loop;
}
