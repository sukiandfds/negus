import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { AppShell } from "../../components/AppShell/AppShell";
import { BottomNav } from "../../components/BottomNav/BottomNav";
import { SidebarHeader } from "../../components/Sidebar/SidebarHeader";
import { WindowBar } from "../../components/WindowBar/WindowBar";
import type { ViewSurface } from "../../components/ViewSwitcher/ViewSwitcher";
import { GroupComposer } from "./components/GroupComposer";
import { GroupHeader } from "./components/GroupHeader";
import { MemberDialog } from "./components/MemberDialog";
import { MemberProfileDrawer } from "./components/MemberProfileDrawer";
import { MessageTimeline } from "./components/MessageTimeline";
import { useGroupRoom } from "./hooks/useGroupRoom";
import type { GroupMessage, GroupProfile } from "./model/types";
import type { MediaFile } from "../../shared/model/media";
import { useDeviceInfo } from "../device/hooks/useDeviceInfo";
import { useArtifacts } from "../artifacts/hooks/useArtifacts";
import { projectDirectoryApi } from "../project-directory/data/projectDirectoryApi";
import type { DirectoryProject } from "../project-directory/model/types";
import { ProjectNavigationDirectory } from "../project-directory/components/ProjectDirectory";
import { readLocalCache, writeLocalCache } from "../../shared/state/localCache";
import { RefreshNotice } from "../app-update/components/AppUpdateNotice";
import styles from "./GroupApp.module.css";

const projectDirectoryCacheKey = "negus-project-directory-v1";
const validProjects = (value: unknown): value is DirectoryProject[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry) && typeof entry === "object" && typeof entry.id === "string");
const quoteExcerpt = (message: GroupMessage) => {
  const text = message.text.trim();
  if (text) return text.slice(0, 160);
  return (message.attachments || []).map((file) => file.name).filter(Boolean).join("、").slice(0, 160);
};

export function GroupApp({ active = true, onViewChange }: { active?: boolean; onViewChange?: (surface: Exclude<ViewSurface, "progress">) => void }) {
  const group = useGroupRoom();
  const device = useDeviceInfo(group.connected);
  const [profile, setProfile] = useState<GroupProfile | null>(null);
  const [projects, setProjects] = useState<DirectoryProject[]>(() => (
    readLocalCache(projectDirectoryCacheKey, validProjects) || []
  ));
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [localSendVersion, setLocalSendVersion] = useState(0);
  const [quote, setQuote] = useState<GroupMessage["replyTo"]>(null);
  const [mentionRequest, setMentionRequest] = useState<{ nonce: number; name: string } | null>(null);
  const snapshot = group.snapshot;
  const artifactIds = useMemo(() => snapshot?.messages.flatMap((message) => message.artifactIds || []) || [], [snapshot?.messages]);
  const artifactState = useArtifacts(artifactIds, group.artifactEvent);
  const join = async (name: string) => {
    await group.join(name);
  };
  useEffect(() => {
    setQuote(null);
  }, [group.roomId]);
  useEffect(() => {
    if (!quote?.id.startsWith("optimistic-")) return;
    const clientMessageId = quote.id.slice("optimistic-".length);
    const confirmed = snapshot?.messages.find((message) => message.clientMessageId === clientMessageId
      && !message.pending
      && !message.id.startsWith("optimistic-"));
    if (!confirmed) return;
    setQuote({
      id: confirmed.id,
      authorName: confirmed.authorName,
      text: confirmed.text.trim().slice(0, 160),
      sequence: confirmed.sequence,
    });
  }, [quote?.id, snapshot]);
  const sendMessage = useCallback(async (text: string, attachments: MediaFile[] = [], replyTo: GroupMessage["replyTo"] = null) => {
    const accepted = await group.send(text, attachments, replyTo);
    if (accepted) {
      setLocalSendVersion((version) => version + 1);
      setQuote(null);
    }
    return accepted;
  }, [group.send]);

  useEffect(() => {
    if (!active || !group.initialSyncReady) return;
    window.dispatchEvent(new Event("negus:app-ready"));
  }, [active, group.initialSyncReady]);

  const agents = snapshot?.agents || [];
  const members = snapshot?.members || [];
  const sidebarProjects = useMemo<DirectoryProject[]>(() => projects.length ? projects : group.rooms.map((room) => ({
    id: room.projectId,
    projectId: room.projectId,
    name: room.name.replace(/\s*项目群$/u, ""),
    kind: "personal",
  })), [group.rooms, projects]);
  const activeProjectId = sidebarProjects.find((entry) => entry.kind !== "employee"
    && (entry.projectId || entry.id) === snapshot?.projectId)?.id || "";
  const activeProject = sidebarProjects.find((entry) => entry.id === activeProjectId);
  const sidebarWorkspaceName = activeProject?.root?.split(/[\\/]/u).filter(Boolean).slice(-1)[0]
    || activeProject?.name
    || snapshot?.project
    || "Negus";

  useEffect(() => {
    const controller = new AbortController();
    void projectDirectoryApi.list(controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) {
          setProjects(next);
          writeLocalCache(projectDirectoryCacheKey, next);
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  return (
    <>
      <AppShell
        chrome={<WindowBar />}
        sidebarOpen={sidebarOpen}
        onCloseSidebar={() => setSidebarOpen(false)}
        sidebar={
          <div className={styles.sidebarContent}>
            <SidebarHeader />
            <ProjectNavigationDirectory
              workspaceName={sidebarWorkspaceName}
              projects={sidebarProjects}
              activeProjectId={activeProjectId}
              onProjectOpen={(project) => {
                const projectId = project.projectId || project.id;
                const room = group.rooms.find((entry) => entry.projectId === projectId)
                  || (snapshot?.projectId === projectId ? snapshot.room : null);
                if (room) group.selectRoom(room.id);
              }}
              onEmployeeOpen={(project) => {
                const agent = agents.find((entry) => entry.id === project.employeeId);
                if (agent) setProfile({ kind: "agent", profile: agent });
              }}
              onOpened={() => setSidebarOpen(false)}
            />
          </div>
        }
        header={
          <GroupHeader
            roomName={snapshot?.room.name || "Negus 项目群"}
            roomId={snapshot?.room.id || ""}
            projectId={snapshot?.projectId || ""}
            connected={group.connected}
            deviceName={device?.name}
            members={members}
            agents={agents}
            historyNotice={group.historyNotice}
            onDateSelect={group.jumpToDate}
            onOpenSidebar={() => setSidebarOpen(true)}
            onViewChange={onViewChange}
          />
        }
        conversation={snapshot ? (
          <MessageTimeline
            active={active}
            roomId={snapshot.room.id}
            messages={snapshot.messages}
            agents={agents}
            members={members}
            currentMemberId={group.member?.id || ""}
            streaming={group.streaming}
            artifacts={artifactState.artifacts}
            artifactLoadErrors={artifactState.loadErrors}
            reviewingArtifactIds={artifactState.reviewingIds}
            reviewerName={group.member?.name || "当前成员"}
            onRetryArtifact={artifactState.loadOne}
            onReviewArtifact={artifactState.review}
            onOpenProfile={setProfile}
            localSendVersion={localSendVersion}
            history={snapshot.history}
            historyLoading={group.historyLoading}
            historyNavigation={group.historyNavigation}
            focusRequest={group.focusRequest}
            onLoadOlder={group.loadOlder}
            onLoadNewer={group.loadNewer}
            onReturnToLatest={group.returnToLatest}
            onQuote={(message) => setQuote({
              id: message.id,
              authorName: message.authorName,
              text: quoteExcerpt(message),
              sequence: message.sequence,
            })}
            onMentionAgent={(agent) => setMentionRequest((current) => ({ nonce: (current?.nonce || 0) + 1, name: agent.name }))}
            onRevealReply={(reply) => { void group.revealMessage(reply); }}
            onRetryAgent={(agentId, replyTo) => {
              const agent = agents.find((item) => item.id === agentId);
              if (agent) void group.send(`@${agent.name} 请重试刚才没有完成的任务。`, [], replyTo || null);
            }}
            onRetrySend={(message) => { void group.retrySend(message); }}
            retryDisabled={group.sending}
            unseenLiveCount={group.unseenLiveCount}
          />
        ) : group.error ? (
          <main className={styles.loading}>
            <RefreshNotice
              surface="group"
              title="项目群暂时未连接"
              detail="连接没有响应，请刷新网页后重试。"
              actionLabel="刷新网页"
              onAction={() => window.location.reload()}
            />
          </main>
        ) : <main className={styles.loading} role="status" aria-label="正在连接项目群"><LoaderCircle className={styles.spinner} aria-hidden="true" /></main>}
        composer={snapshot ? (
        <GroupComposer
          agents={agents}
          members={members}
          disabled={!group.member || group.sending}
          busy={agents.some((agent) => agent.active)}
          error={group.error}
          notice={group.notice}
          quote={quote}
          mentionRequest={mentionRequest}
          onClearQuote={() => setQuote(null)}
          onSend={sendMessage}
          onInterrupt={group.interrupt}
        />
        ) : <div className={styles.composerPlaceholder} />}
        dock={<BottomNav current="group" onViewChange={onViewChange} />}
      />
      {/* Do not cover the connection recovery state with a join dialog. If the
          first snapshot failed and there is no cached room, the user needs the
          refresh action to recover before choosing a member name. */}
      <MemberDialog initialName={group.member?.name || ""} open={!group.member && Boolean(snapshot)} onSubmit={join} />
      <MemberProfileDrawer
        profile={profile}
        roomId={group.roomId}
        onClose={() => setProfile(null)}
        onAgentUpdated={(agent) => setProfile({ kind: "agent", profile: agent })}
      />
    </>
  );
}
