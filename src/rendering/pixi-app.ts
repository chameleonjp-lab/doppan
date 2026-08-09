import {
  Container,
  Graphics,
  Text,
  TextStyle,
  WebGLRenderer,
  type WebGLOptions,
} from "pixi.js";
import { initializeWithCleanup } from "./renderer-lifecycle";

export interface PixiRuntime {
  readonly renderer: WebGLRenderer;
  readonly stage: Container;
  readonly scene: Container;
  readonly resizeObserver: ResizeObserver | null;
  readonly renderCount: number;
  resize(): void;
  step(deltaMs: number): void;
  destroy(): void;
}

export interface PixiAppOptions {
  host: HTMLElement;
  forceWebGLFailure?: boolean;
  onFatalError?: (error: unknown) => void;
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

function createScene(): Container {
  const scene = new Container();
  const panel = new Graphics()
    .roundRect(16, 16, 280, 112, 18)
    .fill({ color: 0x172033, alpha: 0.94 })
    .stroke({ color: 0x79e2c2, width: 2, alpha: 0.8 });
  const dot = new Graphics().circle(48, 72, 12).fill(0x79e2c2);
  const title = new Text({
    text: "DOPPAN G1-A",
    style: new TextStyle({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 22,
      fontWeight: "700",
      fill: 0xf5f7fb,
    }),
  });
  title.position.set(76, 42);
  const hint = new Text({
    text: "Pixi renderer ready",
    style: new TextStyle({
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 14,
      fill: 0xb9c4d9,
    }),
  });
  hint.position.set(76, 78);
  scene.addChild(panel, dot, title, hint);
  return scene;
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

    const scene = createScene();
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
      step: (deltaMs: number) => {
        // A tiny deterministic motion proves the explicit GameLoop is advancing.
        if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          dotPulse(scene, deltaMs);
        }
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

function dotPulse(scene: Container, deltaMs: number): void {
  const dot = scene.children[1];
  if (dot instanceof Graphics) {
    dot.rotation += Math.min(deltaMs, 50) / 5000;
  }
}
