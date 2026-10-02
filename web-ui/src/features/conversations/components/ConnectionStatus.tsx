import { Settings } from "lucide-react";
import styles from "./ConnectionStatus.module.css";

export function ConnectionStatus({ connected, onOpenSettings }: { connected: boolean; onOpenSettings?: () => void }) {
  return (
    <div className={styles.root}>
      <span className={`${styles.dot} ${connected ? styles.connected : ""}`} aria-hidden="true" />
      <span className={styles.name}>{connected ? "原电脑实时连接" : "正在连接原电脑服务"}</span>
      <button type="button" className={styles.info} aria-label="设置" title="设置" onClick={onOpenSettings}><Settings aria-hidden="true" /></button>
    </div>
  );
}
