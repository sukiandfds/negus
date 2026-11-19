import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { postJson } from "../../../shared/api/http";
import type { CatalogResult } from "../data/modelCatalogRefresh";
import styles from "./ChannelManager.module.css";

export function ModelCatalogFeedback({ results, onClose, onDeleted }: {
  results: CatalogResult[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [outcomes, setOutcomes] = useState<Record<string, string> | null>(null);
  const deletable = results.filter(entry => entry.ticket);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const remove = async () => {
    setBusy(true);
    try {
      const { results: deleted } = await postJson<{ results: Array<{ ticket: string; deleted?: boolean; error?: string }> }>(
        "/api/model-channels/catalog", { action: "delete-empty", tickets: deletable.map(entry => entry.ticket) });
      setOutcomes(Object.fromEntries(deleted.map(entry => [entry.ticket, entry.deleted ? "已删除" : entry.error || "删除失败"])));
      if (deleted.some(entry => entry.deleted)) onDeleted();
    } catch (error) {
      setOutcomes(Object.fromEntries(deletable.map(entry => [entry.ticket, error instanceof Error ? error.message : "删除失败"])));
    } finally { setBusy(false); }
  };
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-label="无可用模型的配置"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><strong>无可用模型的配置</strong></header>
    <ul>{results.map(entry => <li key={entry.id}>{entry.name} · {entry.owner === "shared" ? "CC Switch 共享" : entry.owner === "builtin" ? "Negus 内建" : "原生 Codex"}
      {entry.protected ? " · " + entry.protected : null}{entry.ticket && outcomes ? " · " + (outcomes[entry.ticket] || "未返回结果") : null}</li>)}</ul>
    <div className={styles.toolbar}>
      {!outcomes && deletable.length ? <button type="button" disabled={busy} onClick={() => void remove()}>确认删除 {deletable.length} 个配置</button> : null}
      <button type="button" disabled={busy} onClick={onClose}>{outcomes || !deletable.length ? "关闭" : "取消"}</button>
    </div>
  </dialog>, document.body);
}
