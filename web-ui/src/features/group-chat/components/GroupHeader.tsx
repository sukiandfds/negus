import { useState } from "react";
import { CalendarDays, MessageSquareText, PanelLeft, Share2 } from "lucide-react";
import { ViewSwitcher, type ViewSurface } from "../../../components/ViewSwitcher/ViewSwitcher";
import { ShareConversationDialog } from "../../conversation-sharing/components/ShareConversationDialog";
import { DeviceStatus } from "../../device/components/DeviceStatus";
import type { GroupAgent, GroupMember } from "../model/types";
import styles from "./GroupHeader.module.css";

export function GroupHeader({ roomName, roomId, projectId, connected, deviceName, members, agents, historyNotice, onDateSelect, onOpenSidebar, onViewChange }: {
  roomName: string;
  roomId: string;
  projectId: string;
  connected: boolean;
  deviceName?: string;
  members: GroupMember[];
  agents: GroupAgent[];
  historyNotice: string;
  onDateSelect: (date: string) => Promise<boolean>;
  onOpenSidebar: () => void;
  onViewChange?: (surface: Exclude<ViewSurface, "progress">) => void;
}) {
  const [sharing, setSharing] = useState(false);
  const workingAgents = agents.filter((agent) => agent.active && agent.phase !== "queued");
  const waitingAgents = agents.filter((agent) => agent.active && agent.phase === "queued");
  const waitingText = waitingAgents.length ? `${waitingAgents.map((agent) => agent.name).join("、")}等候` : "";
  const activityText = workingAgents.length === 1
    ? `${workingAgents[0].name} · ${workingAgents[0].label}${waitingText ? `，${waitingText}` : ""}`
    : workingAgents.length > 1
      ? `${workingAgents.length} 个员工正在工作${waitingText ? `，${waitingText}` : ""}`
      : waitingText || `${members.length} 名成员在线`;
  return (
    <>
      <header className={styles.header}>
      <div className={styles.topbar}>
        <button className={styles.iconButton} type="button" aria-label="打开侧栏" title="打开侧栏" onClick={onOpenSidebar}>
          <PanelLeft aria-hidden="true" />
        </button>
        <MessageSquareText className={styles.titleIcon} aria-hidden="true" />
        <div className={styles.heading}>
          <div className={styles.titleRow}><h1 className={styles.title}>{roomName}</h1></div>
          <span className={styles.memberCount}>{members.length} 位用户，{agents.length} 位 Agent</span>
        </div>
        <span className={styles.spacer} />
        <label className={styles.dateButton} title="按日期查看历史消息" aria-label="按日期查看历史消息">
          <CalendarDays aria-hidden="true" />
          <input
            className={styles.dateInput}
            type="date"
            aria-label="选择群聊日期"
            onChange={(event) => {
              const input = event.currentTarget;
              if (!input.value) return;
              void onDateSelect(input.value).then((moved) => {
                if (!moved) input.value = "";
              });
            }}
          />
        </label>
        <button className={styles.iconButton} type="button" aria-label="分享项目群聊" title="分享" onClick={() => setSharing(true)}>
          <Share2 aria-hidden="true" />
        </button>
        <ViewSwitcher current="group" onViewChange={onViewChange} projectId={projectId} currentSourceId={roomId ? `group:${roomId}` : ""} />
      </div>
      <div className={styles.statusbar}>
        <DeviceStatus name={deviceName} connected={connected} />
        <span className={styles.statusDivider} aria-hidden="true">·</span>
        <span className={styles.activity}>{historyNotice || activityText}</span>
      </div>
      </header>
      <ShareConversationDialog open={sharing} title={roomName} heading="分享项目群聊" onClose={() => setSharing(false)} />
    </>
  );
}
