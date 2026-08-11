import { describe, expect, it } from "vitest";
import { GameState } from "../../src/game";

describe("GameState", () => {
  it("keeps base state independent from suspension state", () => {
    const state = new GameState({ initialBaseState: "LaunchReady" });

    expect(state.baseState).toBe("LaunchReady");
    expect(state.suspensionState).toBe("None");
    expect(state.handleVisibilityLost()).toBe(true);
    expect(state.baseState).toBe("LaunchReady");
    expect(state.suspensionState).toBe("VisibilityLost");
    expect(state.handleVisibilityRestored()).toBe(true);
    expect(state.baseState).toBe("LaunchReady");
    expect(state.suspensionState).toBe("None");
  });

  it("restores a pre-existing manual pause after visibility loss", () => {
    const state = new GameState({ initialBaseState: "Playing" });

    expect(state.suspend("ManualPause")).toBe(true);
    expect(state.handleVisibilityLost()).toBe(true);
    expect(state.suspensionState).toBe("VisibilityLost");
    expect(state.handleVisibilityRestored()).toBe(true);
    expect(state.suspensionState).toBe("ManualPause");
    expect(state.baseState).toBe("Playing");
  });

  it("preserves terminal events through visibility loss and only drains after resume", () => {
    const state = new GameState({ initialBaseState: "Playing" });
    state.queueTerminalEvent({ id: "ball-1", type: "ballLost", physicsStepId: 42 });

    state.handleVisibilityLost();
    expect(state.pendingTerminalEvents).toHaveLength(1);
    expect(state.drainPendingTerminalEvents()).toEqual([]);
    expect(state.pendingTerminalEvents[0]?.id).toBe("ball-1");

    state.handleVisibilityRestored();
    expect(state.drainPendingTerminalEvents()).toEqual([
      { id: "ball-1", type: "ballLost", physicsStepId: 42 },
    ]);
    expect(state.pendingTerminalEvents).toHaveLength(0);
  });

  it("does not auto-resume from FatalRecovery", () => {
    const state = new GameState({ initialBaseState: "Playing" });
    state.enterFatalRecovery();

    expect(state.baseState).toBe("FatalRecovery");
    expect(state.resume()).toBe(false);
    expect(state.transitionBase("Playing")).toBe(false);
    expect(state.handleVisibilityRestored()).toBe(false);
    expect(state.baseState).toBe("FatalRecovery");

    expect(state.restart()).toBe(true);
    expect(state.baseState).toBe("Boot");
  });

  it("preserves result base state over a visibility boundary", () => {
    const state = new GameState({ initialBaseState: "Result" });

    state.handleVisibilityLost();
    state.handleVisibilityRestored();
    expect(state.baseState).toBe("Result");
    expect(state.suspensionState).toBe("None");
  });
});
