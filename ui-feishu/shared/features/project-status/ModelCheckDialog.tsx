import { useEffect, useRef, useState } from "react";
import { postJson } from "../../shared/api/http";
import styles from "./ProjectStatusControl.module.css";

export function ModelCheckDialog() {
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => () => request.current?.abort(), []);
  const close = () => {
    request.current?.abort();
    request.current = null;
    setApiKey("");
    setBusy(false);
    dialog.current?.close();
  };
  const check = async () => {
    if (busy || !apiKey.trim()) return;
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError("");
    setModels(null);
    const key = apiKey.trim();
    setApiKey("");
    try {
      const result = await postJson<{ models: string[] }>("/api/fusheng/models/check", { apiKey: key }, controller.signal);
      if (!controller.signal.aborted) setModels(result.models);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "查询失败");
    } finally {
      if (request.current === controller) { setBusy(false); request.current = null; }
    }
  };
  return <>
    <button type="button" onClick={() => { setError(""); setModels(null); dialog.current?.showModal(); }}>检查模型</button>
    <dialog ref={dialog} className={styles.modelDialog} onCancel={(event) => { event.preventDefault(); close(); }} onKeyDown={(event) => event.stopPropagation()}>
      <form onSubmit={(event) => { event.preventDefault(); void check(); }}>
        <h2>检查 Fusheng 可用模型</h2>
        <p>渠道：fushengyunsuan.cn。Key 仅用于本次查询，不保存。</p>
        <label htmlFor="fusheng-check-key">API Key</label>
        <input id="fusheng-check-key" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy} />
        <div className={styles.modelActions}>
          <button type="button" onClick={close}>关闭</button>
          <button type="submit" disabled={busy || !apiKey.trim()}>{busy ? "查询中…" : "查询模型"}</button>
        </div>
        <div aria-live="polite">
          {error ? <p role="alert">{error}</p> : null}
          {models ? <><p>查询到 {models.length} 个模型。列表不代表调用测试通过，也不包含价格。</p><ul>{models.map((model) => <li key={model}>{model}</li>)}</ul></> : null}
        </div>
      </form>
    </dialog>
  </>;
}
