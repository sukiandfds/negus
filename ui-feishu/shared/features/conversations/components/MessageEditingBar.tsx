import { X } from "lucide-react";
import styles from "./ConversationComposer.module.css";

export function MessageEditingBar({ preview, onCancel }: { preview: string; onCancel: () => void }) {
  return <div className={styles.editingBar}>
    <span><strong>重新编辑</strong><span className={styles.editingPreview}>{preview}</span></span>
    <button type="button" aria-label="取消重新编辑" title="取消重新编辑" onClick={onCancel}><X aria-hidden="true" /></button>
  </div>;
}
