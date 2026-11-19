import type { CodexModel } from "../model/types";
import { formatModelDisplayName } from "../model/modelDisplayName";
import styles from "./ModelSelect.module.css";

interface ModelSelectProps {
  currentModel: string;
  models: CodexModel[];
  disabled: boolean;
  loading: boolean;
  changing: boolean;
  error: string;
  onChange: (model: string) => Promise<boolean>;
}

export function ModelSelect({
  currentModel, models, disabled, loading, changing, error, onChange,
}: ModelSelectProps) {
  return (
    <select
      className={styles.select}
      aria-label="切换模型"
      title={error || "当前模型"}
      value={models.some((entry) => entry.model === currentModel) ? currentModel : ""}
      disabled={disabled || loading || changing || !models.length}
      onChange={(event) => void onChange(event.target.value)}
    >
      {!currentModel ? <option value="">选择模型</option> : null}
      {currentModel && !models.some((entry) => entry.model === currentModel) ? <option value="">选择模型</option> : null}
      {models.map((entry) => (
        <option key={entry.id} value={entry.model}>{formatModelDisplayName(entry.model, entry.displayName)}</option>
      ))}
    </select>
  );
}
