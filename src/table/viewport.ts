import type { TableBounds, TablePoint } from "./types";

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/** Fits the complete physical table while keeping physics independent of CSS pixels. */
export class PhysicsViewport {
  private readonly bounds: TableBounds;
  private size: ViewportSize;

  public constructor(bounds: TableBounds, size: ViewportSize) {
    if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) || bounds.width <= 0 || bounds.height <= 0) {
      throw new RangeError("PhysicsViewport bounds must be finite and positive");
    }
    this.assertSize(size);
    this.bounds = { width: bounds.width, height: bounds.height };
    this.size = { width: size.width, height: size.height };
  }

  public resize(size: ViewportSize): void {
    this.assertSize(size);
    this.size = { width: size.width, height: size.height };
  }

  public get worldBounds(): TableBounds {
    return { ...this.bounds };
  }

  public get screenSize(): ViewportSize {
    return { ...this.size };
  }

  public get scale(): number {
    return Math.min(this.size.width / this.bounds.width, this.size.height / this.bounds.height);
  }

  public get boardPixelSize(): ViewportSize {
    return { width: this.bounds.width * this.scale, height: this.bounds.height * this.scale };
  }

  public get boardOffset(): ScreenPoint {
    const board = this.boardPixelSize;
    return { x: (this.size.width - board.width) / 2, y: (this.size.height - board.height) / 2 };
  }

  public worldToScreen(position: TablePoint): ScreenPoint {
    const offset = this.boardOffset;
    const scale = this.scale;
    return {
      x: offset.x + position.x * scale,
      y: offset.y + (this.bounds.height - position.y) * scale,
    };
  }

  public screenToWorld(position: ScreenPoint): TablePoint {
    const offset = this.boardOffset;
    const scale = this.scale;
    return {
      x: (position.x - offset.x) / scale,
      y: this.bounds.height - (position.y - offset.y) / scale,
    };
  }

  public tryScreenToWorld(position: ScreenPoint): TablePoint | null {
    return this.containsScreenPoint(position) ? this.screenToWorld(position) : null;
  }

  public containsScreenPoint(position: ScreenPoint, marginPixels = 0): boolean {
    const offset = this.boardOffset;
    const board = this.boardPixelSize;
    return (
      position.x >= offset.x - marginPixels &&
      position.x <= offset.x + board.width + marginPixels &&
      position.y >= offset.y - marginPixels &&
      position.y <= offset.y + board.height + marginPixels
    );
  }

  public worldAngleToScreen(angleRadians: number): number {
    return -angleRadians;
  }

  public screenAngleToWorld(angleRadians: number): number {
    return -angleRadians;
  }

  private assertSize(size: ViewportSize): void {
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
      throw new RangeError("PhysicsViewport size must be finite and positive");
    }
  }
}
