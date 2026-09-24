import type { ReactNode } from "react";
import styles from "./AppShell.module.css";

interface AppShellProps {
  chrome: ReactNode;
  sidebar: ReactNode;
  sidebarVisible?: boolean;
  sidebarOpen: boolean;
  onCloseSidebar: () => void;
  header: ReactNode;
  conversation: ReactNode;
  composer: ReactNode;
  dock?: ReactNode;
}

export function AppShell({ chrome, sidebar, sidebarVisible = true, sidebarOpen, onCloseSidebar, header, conversation, composer, dock = null }: AppShellProps) {
  return (
    <div className={`${styles.shell} ${sidebarVisible ? "" : styles.sidebarHidden}`}>
      <div className={styles.chrome}>{chrome}</div>
      <button
        className={`${styles.backdrop} ${sidebarOpen ? styles.backdropOpen : ""}`}
        type="button"
        aria-label="关闭侧栏"
        onClick={onCloseSidebar}
      />
      <div className={`${styles.sidebarSlot} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        {sidebar}
      </div>
      <section className={styles.workspace}>
        {header}
        <main className={styles.main}>
          {conversation}
          {composer}
          {dock}
        </main>
      </section>
    </div>
  );
}
