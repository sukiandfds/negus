import type { SessionMessage } from "../conversations/model/types";

export const COLUMNS = 12;
export const ROW = 32;
export interface DesktopRect { x: number; y: number; w: number; h: number }
export interface DesktopTile extends DesktopRect {
  id: string; kind: "tasks" | "content" | "automations"; title: string; pinned?: boolean;
  content?: SessionMessage;
  shape?: "rectangle" | "circle";
  image?: { src: string; alt: string; shape: "circle" | "rectangle" };
  appliedOperations?: string[];
  preview?: SessionMessage;
  request?: { threadId: string; text: string; after: string[]; state: "waiting" | "failed" };
}
export const defaultTiles: DesktopTile[] = [{ id: "current-tasks", kind: "tasks", title: "当前任务", x: 0, y: 0, w: 6, h: 8 }];
export const automationTile: DesktopTile = { id: "automations", kind: "automations", title: "自动化任务", x: 6, y: 0, w: 6, h: 8 };
export function migrateDesktopTiles(tiles: DesktopTile[]): DesktopTile[] {
  return tiles.map((tile) => tile.kind === "content" && tile.title === "选区 1" && tile.x === 6 && tile.y === 0 && tile.w === 6
    && /自动化|定时任务|周期任务/.test([tile.request?.text, tile.preview?.text, tile.content?.text].join("\n"))
    ? { ...tile, kind: "automations", title: "自动化任务", request: undefined, preview: undefined } : tile);
}
export const circleImage = { src: "/icons/negus-icon-512-v2.png", alt: "Negus 圆形图片", shape: "circle" as const };
export function regionImageCommand(text: string): boolean {
  return /^(请|帮我|这里|在这里|给我|直接|先|再|\s)*(放|放上|放一张|添加|添加一张|显示|展示)(一张|个|一个|张|\s)*(圆形|圆)(的)?(图片|图|照片)[。！!\s]*$/.test(text.trim());
}
export function clampRect(rect: DesktopRect): DesktopRect {
  const w = Math.max(2, Math.min(COLUMNS, Math.round(rect.w)));
  return { x: Math.max(0, Math.min(COLUMNS - w, Math.round(rect.x))), y: Math.max(0, Math.min(500, Math.round(rect.y))), w, h: Math.max(2, Math.min(24, Math.round(rect.h))) };
}
export const overlaps = (a: DesktopRect, b: DesktopRect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
export function placeTile(tiles: DesktopTile[], tile: DesktopTile): DesktopTile[] {
  const previous = tiles.find((entry) => entry.id === tile.id);
  if (previous?.pinned && (tile.x !== previous.x || tile.y !== previous.y || tile.w !== previous.w || tile.h !== previous.h)) return tiles;
  const nextTile = { ...tile, ...clampRect(tile), h: tile.kind !== "content" ? Math.max(8, clampRect(tile).h) : clampRect(tile).h };
  const fixed = tiles.filter((entry) => entry.id !== tile.id && entry.pinned);
  if (fixed.some((entry) => overlaps(entry, nextTile))) return tiles;
  const placed = [nextTile, ...fixed];
  for (const other of tiles.filter((entry) => entry.id !== tile.id && !entry.pinned).sort((a, b) => a.y - b.y || a.x - b.x)) {
    let next = { ...other };
    while (placed.some((entry) => overlaps(entry, next))) next = { ...next, y: Math.max(...placed.filter((entry) => overlaps(entry, next)).map((entry) => entry.y + entry.h)) };
    placed.push(next);
  }
  return placed;
}
export function rectFromPoints(start: { x: number; y: number }, end: { x: number; y: number }, width: number): DesktopRect {
  const cell = width / COLUMNS;
  return clampRect({ x: Math.floor(Math.min(start.x, end.x) / cell), y: Math.floor(Math.min(start.y, end.y) / ROW), w: Math.ceil(Math.abs(end.x - start.x) / cell), h: Math.ceil(Math.abs(end.y - start.y) / ROW) });
}
export const validTiles = (value: unknown): value is DesktopTile[] => Array.isArray(value) && value.length <= 60
  && new Set(value.map((entry) => entry?.id)).size === value.length
  && value.every((entry) => entry && typeof entry.id === "string" && typeof entry.title === "string" && ["tasks", "content", "automations"].includes(entry.kind)
    && (entry.pinned === undefined || typeof entry.pinned === "boolean")
    && (entry.shape === undefined || ["rectangle", "circle"].includes(entry.shape))
    && [entry.x, entry.y, entry.w, entry.h].every(Number.isFinite) && entry.x >= 0 && entry.w >= 2 && entry.x + entry.w <= COLUMNS && entry.y >= 0 && entry.h >= 2 && entry.h <= 24
    && (!entry.content || (entry.content.role === "assistant" && typeof entry.content.text === "string"))
    && (!entry.preview || (entry.preview.role === "assistant" && typeof entry.preview.text === "string"))
    && (!entry.request || (typeof entry.request.threadId === "string" && typeof entry.request.text === "string" && Array.isArray(entry.request.after))));

export function replyForTile(tile: DesktopTile, threadId: string, messages: SessionMessage[]): SessionMessage | null {
  const request = tile.request;
  if (!request || request.threadId !== threadId || request.state !== "waiting") return null;
  const userIndex = messages.findIndex((message) => message.role === "user" && message.text === request.text && !request.after.includes(message.id));
  if (userIndex < 0) return null;
  const replies: SessionMessage[] = [];
  for (const message of messages.slice(userIndex + 1)) {
    if (message.role === "user") break;
    if (message.role === "assistant" && !message.superseded && !request.after.includes(message.id)) replies.push(message);
  }
  return replies.at(-1) || null;
}
