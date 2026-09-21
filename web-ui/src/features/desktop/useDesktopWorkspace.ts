import { useEffect, useState } from "react";
import { readLocalCache, writeLocalCache } from "../../shared/state/localCache";
import type { SessionDetail } from "../conversations/model/types";
import type { ExecutionStatus } from "../execution/model/types";
import { automationTile, circleImage, regionImageCommand, defaultTiles, migrateDesktopTiles, placeTile, validTiles, type DesktopTile } from "./desktopLayout";

const key = "negus:desktop-workspace:v1";
export function useDesktopWorkspace(session: SessionDetail | null, status: ExecutionStatus) {
  const [tiles, setTiles] = useState<DesktopTile[]>(() => migrateDesktopTiles(readLocalCache(key, validTiles) || [...defaultTiles, automationTile]));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/desktop-operations.json", { cache: "no-store", signal: controller.signal });
        if (!response.ok) return;
        const operations = await response.json() as { id: string; regionId: string; action: string; image: DesktopTile["image"] }[];
        if (!Array.isArray(operations)) return;
        setTiles((current) => current.map((tile) => {
          const operation = operations.find((entry) => entry.regionId === tile.id && entry.action === "set-image" && !tile.appliedOperations?.includes(entry.id));
          if (!operation?.image || !operation.image.src.startsWith("/desktop-assets/") || !["circle", "rectangle"].includes(operation.image.shape)) return tile;
          return { ...tile, image: operation.image, request: undefined, appliedOperations: [...(tile.appliedOperations || []), operation.id] };
        }));
      } catch { /* A missing operation feed does not change existing content. */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  useEffect(() => {
    const target = "e856f588-92f2-4965-899a-39ac68ebfdaa";
    const marker = `negus:desktop-applied-circle:${target}`;
    try {
      if (localStorage.getItem(marker)) return;
      if (!tiles.some((tile) => tile.id === target && tile.kind === "content")) return;
      setTiles((current) => current.map((tile) => tile.id === target ? { ...tile, image: circleImage, request: undefined } : tile));
      localStorage.setItem(marker, "1");
    } catch { setStorageError(true); }
  }, []);
  useEffect(() => {
    writeLocalCache(key, tiles);
    setStorageError(JSON.stringify(readLocalCache(key, validTiles)) !== JSON.stringify(tiles));
  }, [tiles]);
  const selected = tiles.find((tile) => tile.id === selectedId) || null;
  const update = (tile: DesktopTile) => { setTiles((current) => placeTile(current, tile)); };
  const remove = (id: string) => { setTiles((current) => current.filter((tile) => tile.id !== id)); if (id === selectedId) setSelectedId(null); };
  const executeLocal = (text: string) => {
    if (!selected || selected.kind !== "content" || !regionImageCommand(text)) return false;
    update({ ...selected, image: circleImage, request: undefined });
    return true;
  };
  const prepareRequest = (text: string) => {
    if (!selected || !session) return { text, rollback: () => {} };
    const suffix = `\n\n区域执行上下文：针对桌面组件「${selected.title}」（ID: ${selected.id}，类型: ${selected.kind}）：位于第 ${selected.x + 1} 至 ${selected.x + selected.w} 列、第 ${selected.y + 1} 至 ${selected.y + selected.h} 行（共12列）。当前内容：${selected.image ? `图片 ${selected.image.src}，${selected.image.shape}` : selected.content?.text?.slice(0, 1200) || "空白"}。这是操作需求，默认直接完成可撤销的展示修改；未指定素材时自行选用合适的已有素材，不追问非必要偏好。仅在缺少执行必需信息或涉及付费、删除业务数据、对外发布时询问。实际结果必须更新此组件，不能把解释文字当成功能；回复留在助手对话里。`;
    const request = { threadId: session.threadId, text: text + suffix, after: session.messages.map((message) => message.id), state: "waiting" as const };
    setTiles((current) => current.map((tile) => tile.id === selected.id ? { ...tile, request } : tile));
    return { text: request.text, rollback: () => setTiles((current) => current.map((tile) => tile.id === selected.id && tile.request === request ? { ...tile, request: selected.request } : tile)) };
  };
  const requestLabel = (tile: DesktopTile) => {
    const request = tile.request;
    if (!request) return "";
    if (!session || session.threadId !== request.threadId) return "已提交需求";
    const message = session.messages.find((entry) => entry.role === "user" && entry.text === request.text && !request.after.includes(entry.id));
    if (!message) return "等待处理";
    if (message.turnId && message.turnId === status.turnId && status.threadId === request.threadId) {
      if (status.active) return status.label || "正在处理需求";
      if (["failed", "systemError", "interrupted"].includes(status.phase)) return "处理未完成，点此继续";
    }
    if (message.turnId && session.messages.some((entry) => entry.role === "assistant" && entry.turnId === message.turnId && !entry.superseded)) return "助手已回复，点此继续修改";
    return "需求已提交";
  };
  return { tiles, selected, selectedId, setSelectedId, update, remove, storageError, prepareRequest, executeLocal, requestLabel };
}
