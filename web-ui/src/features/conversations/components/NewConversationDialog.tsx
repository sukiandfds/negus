import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useModelDefaults } from "../../models/model/modelDefaults";
import type { CodexModel } from "../../models/model/types";
import { formatModelDisplayName } from "../../models/model/modelDisplayName";
import styles from "./NewConversationDialog.module.css";

interface NewConversationDialogProps {
  projectRoot: string;
  currentModel: string;
  models: CodexModel[];
  modelsLoading: boolean;
  creating: boolean;
  error: string;
  onCreate: (projectRoot: string, model: string) => Promise<boolean>;
  onClose: () => void;
}

const providerOf = (entry: CodexModel) => entry.modelProviderId || (entry.model.includes("::") ? entry.model.split("::")[0] : "current");
const providerLabel = (entry: CodexModel) => entry.providerDisplayName || (providerOf(entry) === "current" ? "当前运行渠道" : providerOf(entry));

export function NewConversationDialog({
  projectRoot, currentModel, models, modelsLoading, creating, error, onCreate, onClose,
}: NewConversationDialogProps) {
  const defaults = useModelDefaults();
  const availableModels = models.filter((entry) => entry.available !== false && !defaults.archivedProviderIds.includes(providerOf(entry)));
  const providers = [...new Map(availableModels.map((entry) => [providerOf(entry), entry])).values()];
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    const currentEntry = availableModels.find((entry) => entry.model === currentModel);
    const defaultEntry = availableModels.find((entry) => entry.model === defaults.model && (!defaults.providerId || providerOf(entry) === defaults.providerId));
    const provider = currentEntry
      ? providerOf(currentEntry)
      : defaultEntry
        ? providerOf(defaultEntry)
        : defaults.providerId && availableModels.some((entry) => providerOf(entry) === defaults.providerId)
          ? defaults.providerId
          : providers[0] ? providerOf(providers[0]) : "";
    const providerModels = availableModels.filter((entry) => providerOf(entry) === provider);
    setSelectedProvider(provider);
    setSelectedModel(currentEntry?.model || (defaultEntry && providerOf(defaultEntry) === provider ? defaultEntry.model : "") || providerModels.find((entry) => entry.isDefault)?.model || providerModels[0]?.model || "");
  }, [currentModel, defaults, models]);

  const providerModels = availableModels.filter((entry) => providerOf(entry) === selectedProvider);
  const canCreate = Boolean(projectRoot && (selectedModel || currentModel) && !creating);
  const submit = async () => {
    if (!canCreate) return;
    setLocalError("");
    try {
      if (await onCreate(projectRoot, selectedModel || currentModel)) onClose();
    } catch (reason) {
      setLocalError(reason instanceof Error ? reason.message : "新对话创建失败，请重试");
    }
  };

  return createPortal(
    <div className={styles.backdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !creating) onClose(); }}>
      <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="new-conversation-title">
        <header className={styles.header}>
          <h2 id="new-conversation-title">新建对话</h2>
          <button type="button" aria-label="关闭" title="关闭" disabled={creating} onClick={onClose}><X size={18} /></button>
        </header>
        <div className={styles.body}>
          <label>
            <span>渠道 / 分组</span>
            <select aria-label="新对话渠道" value={selectedProvider} disabled={creating || modelsLoading && !providers.length} onChange={(event) => {
              const provider = event.target.value;
              const nextModels = availableModels.filter((entry) => providerOf(entry) === provider);
              setSelectedProvider(provider);
              setSelectedModel(nextModels.find((entry) => entry.isDefault)?.model || nextModels[0]?.model || "");
            }}>
              {!providers.length ? <option value="">{modelsLoading ? "正在读取渠道" : "暂无可用渠道"}</option> : null}
              {providers.map((entry) => <option key={providerOf(entry)} value={providerOf(entry)}>{providerLabel(entry)}</option>)}
            </select>
          </label>
          <label>
            <span>模型</span>
            <select aria-label="新对话模型" value={selectedModel} disabled={creating || !providerModels.length} onChange={(event) => setSelectedModel(event.target.value)}>
              {!providerModels.length ? <option value="">{modelsLoading ? "正在读取模型" : "暂无可用模型"}</option> : null}
              {providerModels.map((entry) => <option key={entry.id} value={entry.model}>{formatModelDisplayName(entry.model, entry.displayName)}</option>)}
            </select>
          </label>
          {modelsLoading && providers.length ? <p className={styles.hint}>正在后台更新模型目录，当前列表可以直接使用。</p> : null}
          {localError || error ? <p className={styles.error} role="alert">{localError || error}</p> : null}
        </div>
        <footer className={styles.footer}>
          <button type="button" className={styles.secondary} disabled={creating} onClick={onClose}>取消</button>
          <button type="button" className={styles.primary} disabled={!canCreate} onClick={() => void submit()}>{creating ? "正在创建" : "创建对话"}</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
