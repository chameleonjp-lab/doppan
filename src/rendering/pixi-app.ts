import {
  Container,
  WebGLRenderer,
  type WebGLOptions,
} from "pixi.js";
import type { GrayboxAlphaSnapshot } from "../graybox";
import { createGrayboxScene, type GrayboxSceneMode } from "./graybox-scene";
import { initializeWithCleanup } from "./renderer-lifecycle";

export interface PixiRuntime {
  readonly renderer: WebGLRenderer;
  readonly stage: Container;
  readonly scene: Container;
  readonly resizeObserver: ResizeObserver | null;
  readonly renderCount: number;
  resize(): void;
  updatePrototype(snapshot: GrayboxAlphaSnapshot): void;
  step(deltaMs: number): void;
  destroy(): void;
}

export interface PixiAppOptions {
  host: HTMLElement;
  forceWebGLFailure?: boolean;
  onFatalError?: (error: unknown) => void;
  renderMode?: GrayboxSceneMode;
}

function viewportSize(host: HTMLElement): { width: number; height: number } {
  return {
    width: Math.max(
      1,
      Math.floor(host.clientWidth || host.getBoundingClientRect().width || 1),
    ),
    height: Math.max(
      1,
      Math.floor(host.clientHeight || host.getBoundingClientRect().height || 1),
    ),
  };
}

export async function createPixiRuntime(
  options: PixiAppOptions,
): Promise<PixiRuntime> {
  if (options.forceWebGLFailure) {
    throw new Error(
      "WebGL was intentionally disabled for the failure-path check",
    );
  }

  // Retain direct ownership before initialization. Application.init assigns
  // its renderer only after init succeeds, so it cannot clean up a renderer
  // that fails after creating a WebGL context.
  const renderer = new WebGLRenderer();
  const rendererOptions: Partial<WebGLOptions> = {
    antialias: true,
    backgroundAlpha: 0,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
  };
  await initializeWithCleanup(
    () => renderer.init(rendererOptions),
    () => renderer.destroy(true),
  );

  const stage = new Container();
  const rendererController = new AbortController();
  const resizeController = new AbortController();
  let resizeObserver: ResizeObserver | null = null;
  let destroyed = false;
  let renderCount = 0;
  let lastWidth = -1;
  let lastHeight = -1;

  const destroy = (): void => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    rendererController.abort();
    resizeController.abort();
    resizeObserver?.disconnect();

    let stageError: unknown;
    let rendererError: unknown;
    try {
      stage.destroy({
        children: true,
        texture: true,
        textureSource: true,
        context: true,
        style: true,
      });
    } catch (error: unknown) {
      stageError = error;
    }
    try {
      renderer.destroy(true);
    } catch (error: unknown) {
      rendererError = error;
    }
    if (stageError !== undefined || rendererError !== undefined) {
      throw new AggregateError(
        [stageError, rendererError].filter((error) => error !== undefined),
        "Pixi runtime cleanup failed",
      );
    }
  };

  try {
    if (renderer.name !== "webgl") {
      throw new Error(`Unexpected renderer selected: ${renderer.name}`);
    }

    const canvas = renderer.canvas;
    canvas.dataset.renderer = "pixi";
    canvas.dataset.testid = "pixi-canvas";
    options.host.replaceChildren(canvas);

    const renderMode = options.renderMode ?? "player";
    options.host.dataset.renderMode = renderMode;
    const prototypeScene = createGrayboxScene({ mode: renderMode });
    const scene = prototypeScene.container;
    stage.addChild(scene);

    const reportFatalError = (error: unknown): void => {
      try {
        options.onFatalError?.(error);
      } catch {
        // Error reporting must not create a second unhandled renderer failure.
      }
    };

    const performResize = (): void => {
      if (destroyed) {
        return;
      }
      const size = viewportSize(options.host);
      if (size.width === lastWidth && size.height === lastHeight) {
        return;
      }
      lastWidth = size.width;
      lastHeight = size.height;
      renderer.resize(size.width, size.height);
      prototypeScene.resize(size.width, size.height);
      renderer.render(stage);
      renderCount += 1;
    };

    const resize = (): void => {
      try {
        performResize();
      } catch (error: unknown) {
        reportFatalError(error);
      }
    };

    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        event.preventDefault();
        reportFatalError(
          new Error(
            "WebGL context was lost; reload or reinitialize the renderer.",
          ),
        );
      },
      { signal: rendererController.signal },
    );

    resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    if (!resizeObserver) {
      window.addEventListener("resize", resize, {
        signal: resizeController.signal,
      });
    }
    resizeObserver?.observe(options.host);
    performResize();

    return {
      renderer,
      stage,
      scene,
      resizeObserver,
      get renderCount() {
        return renderCount;
      },
      resize,
      updatePrototype: (snapshot: GrayboxAlphaSnapshot) => {
        prototypeScene.update(snapshot);
      },
      step: (deltaMs: number) => {
        void deltaMs;
        renderer.render(stage);
        renderCount += 1;
      },
      destroy,
    };
  } catch (error: unknown) {
    try {
      destroy();
    } catch {
      // Preserve the initialization failure while cleanup remains best-effort.
    }
    throw error;
  }
}
