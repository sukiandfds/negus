import { COLUMNS, ROW, clampRect, type DesktopRect } from "./desktopLayout";

export type Point = { x: number; y: number };
export type RegionShape = "rectangle" | "circle";
export type StrokeResult = { rect: DesktopRect; shape: RegionShape };

// Uniform arc-length samples make recognition independent of drawing speed.
export function recognizeStroke(points: Point[], width: number): StrokeResult | null {
  if (points.length < 8 || width <= 0) return null;
  const left = Math.min(...points.map((p) => p.x)), top = Math.min(...points.map((p) => p.y));
  const w = Math.max(...points.map((p) => p.x)) - left, h = Math.max(...points.map((p) => p.y)) - top;
  if (w < 36 || h < 36) return null;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y));
  const length = lengths.at(-1)!;
  if (length < 2 * (w + h) * .65 || length > 2 * (w + h) * 1.8) return null;
  if (Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) > Math.hypot(w, h) * .32) return null;
  let circleError = 0, rectangleError = 0, segment = 1;
  const sectors = new Set<number>();
  for (let i = 0; i < 64; i++) {
    const distance = length * i / 64;
    while (segment < lengths.length - 1 && lengths[segment] < distance) segment++;
    const ratio = (distance - lengths[segment - 1]) / (lengths[segment] - lengths[segment - 1] || 1);
    const x = ((points[segment - 1].x + (points[segment].x - points[segment - 1].x) * ratio - left) / w - .5) * 2;
    const y = ((points[segment - 1].y + (points[segment].y - points[segment - 1].y) * ratio - top) / h - .5) * 2;
    circleError += Math.abs(Math.hypot(x, y) - 1) / 64;
    rectangleError += Math.min(Math.abs(Math.abs(x) - 1), Math.abs(Math.abs(y) - 1)) / 64;
    sectors.add(Math.floor((Math.atan2(y, x) + Math.PI) / (Math.PI * 2) * 8) % 8);
  }
  if (sectors.size < 7) return null;
  const shape = circleError < rectangleError ? "circle" : "rectangle";
  return { shape, rect: clampRect({ x: left / width * COLUMNS, y: top / ROW, w: w / width * COLUMNS, h: h / ROW }) };
}

export function shapeRect(rect: DesktopRect, shape: RegionShape, width: number): DesktopRect {
  if (shape !== "circle") return rect;
  const diameter = Math.max(rect.w * width / COLUMNS, rect.h * ROW);
  return clampRect({ ...rect, w: Math.ceil(diameter / (width / COLUMNS)), h: Math.ceil(diameter / ROW) });
}
