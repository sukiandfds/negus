import { useEffect, useState } from "react";
import { Desktop } from "../desktop/Desktop";
import { useDesktopWorkspace } from "../desktop/useDesktopWorkspace";
import { useProjectConversations } from "../conversations/hooks/useProjectConversations";
import { useProjectDirectory } from "../project-directory/hooks/useProjectDirectory";
import { ProjectProgressApp } from "../project-progress/ProjectProgressApp";
import { ProjectManagementApp } from "../project-management/ProjectManagementApp";
import { AppUpdateNotice } from "../app-update/components/AppUpdateNotice";
import { DeviceStatus } from "../device/components/DeviceStatus";
import { ProjectStatusControl } from "../project-status/ProjectStatusControl";
import type { DeviceInfo } from "../device/model/types";
import styles from "./SettingsPage.module.css";

type Feature = "workspace" | "progress" | "management" | "system";

function WorkspacePanel({ onClose }: { onClose: () => void }) {
  const conversations = useProjectConversations();
  const directory = useProjectDirectory(conversations.executionStatus);
  const workspace = useDesktopWorkspace(conversations.session, conversations.executionStatus);
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);
  const personal = directory.projects.find((entry) => entry.kind === "personal");

  useEffect(() => {
    if (!conversations.initialSyncReady || conversations.loadingList || !personal?.root) return;
    let alive = true;
    void conversations.prepareDesktopConversation(personal.root).then((value) => { if (alive) setReady(value); });
    return () => { alive = false; };
  }, [conversations.initialSyncReady, conversations.loadingList, personal?.root, conversations.prepareDesktopConversation]);

  return <div className={styles.featurePanel}>
    <header className={styles.featureHeader}>
      <div><h1>工作台</h1><p>管理桌面组件、当前任务和定期任务。数据与原工作台共用。</p></div>
      <div className={styles.featureActions}>
        <button type="button" onClick={() => setEditing((value) => !value)} disabled={!ready}>{editing ? "完成编辑" : "编辑布局"}</button>
        <button type="button" onClick={onClose}>返回消息</button>
      </div>
    </header>
    {!ready ? <p className={styles.featureState}>{conversations.connected ? "正在连接工作台…" : "正在连接 Negus…"}</p> : <div className={styles.desktopFeature}>
      <Desktop
        editing={editing}
        onEditingChange={setEditing}
        workspace={workspace}
        active={ready}
        connected={conversations.connected}
        directory={directory}
        onSelect={(threadId) => { conversations.selectSession(threadId); onClose(); }}
        onDiscuss={() => onClose()}
      />
    </div>}
  </div>;
}

function SystemPanel({ onClose, connected, device, projectId, projectRoot }: { onClose: () => void; connected: boolean; device: DeviceInfo | null; projectId: string; projectRoot: string }) {
  return <div className={styles.featurePanel}>
    <header className={styles.featureHeader}>
      <div><h1>设备与更新</h1><p>查看原电脑服务连接状态、项目状态和网页更新。</p></div>
      <button type="button" onClick={onClose}>返回消息</button>
    </header>
    <section className={styles.legacySection} aria-label="设备状态">
      <h2>设备连接</h2>
      <DeviceStatus name={device?.name} connected={connected} />
    </section>
    <section className={styles.legacySection} aria-label="项目状态">
      <h2>项目状态</h2>
      <ProjectStatusControl projectId={projectId} projectRoot={projectRoot} />
    </section>
    <AppUpdateNotice surface="conversation" />
  </div>;
}

export function LegacyFeaturePanel({ feature, onClose, connected = false, device = null, projectId = "", projectRoot = "" }: { feature: Feature; onClose: () => void; connected?: boolean; device?: DeviceInfo | null; projectId?: string; projectRoot?: string }) {
  if (feature === "workspace") return <WorkspacePanel onClose={onClose} />;
  if (feature === "progress") return <div className={styles.featurePanel}><ProjectProgressApp /></div>;
  if (feature === "system") return <SystemPanel onClose={onClose} connected={connected} device={device} projectId={projectId} projectRoot={projectRoot} />;
  return <div className={styles.featurePanel}><ProjectManagementApp /></div>;
}
