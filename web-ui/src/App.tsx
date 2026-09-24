import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, MessageSquare } from "lucide-react";
import { AppShell } from "./components/AppShell/AppShell";
import { BottomNav } from "./components/BottomNav/BottomNav";
import type { ViewSurface } from "./components/ViewSwitcher/ViewSwitcher";
import { WindowBar } from "./components/WindowBar/WindowBar";
import { ConversationComposer } from "./features/conversations/components/ConversationComposer";
import { ConversationHeader } from "./features/conversations/components/ConversationHeader";
import { ConversationSidebar } from "./features/conversations/components/ConversationSidebar";
import { ConversationView } from "./features/conversations/components/ConversationView";
import { UserInputDialog } from "./features/conversations/components/UserInputDialog";
import { useProjectConversations } from "./features/conversations/hooks/useProjectConversations";
import { useDeviceInfo } from "./features/device/hooks/useDeviceInfo";
import { GroupApp } from "./features/group-chat/GroupApp";
import { IntelligenceEfficiencyControl } from "./features/intelligence-efficiency/components/IntelligenceEfficiencyControl";
import { UsageSummaryControl } from "./features/usage-monitor/components/UsageSummaryControl";
import { useUsageMonitor } from "./features/usage-monitor/hooks/useUsageMonitor";
import { Desktop } from "./features/desktop/Desktop";
import desktopStyles from "./features/desktop/Desktop.module.css";
import { useProjectDirectory } from "./features/project-directory/hooks/useProjectDirectory";
import { useDesktopWorkspace } from "./features/desktop/useDesktopWorkspace";

type InteractiveSurface = Exclude<ViewSurface, "progress">;
const surfaceStorageKey = "negus:last-surface";

const readSurface = (): InteractiveSurface => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "desktop") return "desktop";
  if (window.location.pathname === "/group.html" || params.get("view") === "group") return "group";
  if (params.has("thread") || params.has("archived") || params.get("view") === "conversation") return "conversation";
  return "desktop";
};

function ConversationApp({ active, desktop, onViewChange }: { active: boolean; desktop: boolean; onViewChange: (surface: InteractiveSurface) => void }) {
  const conversations = useProjectConversations();
  const desktopWorkspace = useDesktopWorkspace(conversations.session, conversations.executionStatus);
  const directory = useProjectDirectory(conversations.executionStatus);
  const device = useDeviceInfo(conversations.connected);
  const usage = useUsageMonitor(conversations.executionStatus);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [answerOpen, setAnswerOpen] = useState(false);
  const [desktopReady, setDesktopReady] = useState(false);
  const [desktopEditing, setDesktopEditing] = useState(false);
  const [desktopError, setDesktopError] = useState(false);
  const desktopEntered = useRef(false);
  const composerSlot = useRef<HTMLDivElement>(null);
  const responseSlot = useRef<HTMLDivElement>(null);
  const personalProject = directory.projects.find((entry) => entry.kind === "personal");
  useEffect(() => {
    if (!desktop) { desktopEntered.current = false; setDesktopReady(false); setAnswerOpen(false); return; }
    if (!active || desktopEntered.current || !conversations.initialSyncReady || conversations.loadingList || !personalProject?.root) return;
    desktopEntered.current = true;
    setDesktopError(false);
    void conversations.prepareDesktopConversation(personalProject.root).then((ready) => {
      setDesktopReady(ready);
      setDesktopError(!ready);
    });
  }, [desktop, active, conversations.initialSyncReady, conversations.loadingList, personalProject?.root, conversations.prepareDesktopConversation]);
  useEffect(() => {
    const element = composerSlot.current?.firstElementChild;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      responseSlot.current?.style.setProperty("--desktop-composer-height", `${element.getBoundingClientRect().height}px`);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [desktopReady, conversations.selectedId, desktop]);
  useEffect(() => {
    if (!desktop || !answerOpen) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setAnswerOpen(false); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [desktop, answerOpen]);
  useEffect(() => {
    if (!active) return;
    if (
      !conversations.initialSyncReady
      || conversations.loadingSession
      || conversations.syncing
    ) return;
    window.dispatchEvent(new Event("negus:app-ready"));
  }, [
    conversations.initialSyncReady,
    conversations.loadingSession,
    conversations.syncing,
    active,
  ]);
  const selectSession = useCallback((threadId: string) => {
    conversations.selectSession(threadId);
    onViewChange("conversation");
    setSidebarOpen(false);
  }, [conversations.selectSession, onViewChange]);
  const createSession = (root?: string, model?: string, providerId?: string) => {
    const opened = conversations.openNewSession(root || "", model || "", providerId || "");
    if (opened) { onViewChange("conversation"); setSidebarOpen(false); }
    return Promise.resolve(opened);
  };
  useEffect(() => {
    const openLatest = () => {
      conversations.selectLatestSession(personalProject?.root || "");
      setSidebarOpen(false);
      setAnswerOpen(false);
    };
    window.addEventListener("negus:open-latest-conversation", openLatest);
    return () => window.removeEventListener("negus:open-latest-conversation", openLatest);
  }, [conversations.selectLatestSession, personalProject?.root]);

  return (
    <>
    <AppShell
      chrome={<WindowBar />}
      sidebarOpen={sidebarOpen}
      onCloseSidebar={() => setSidebarOpen(false)}
      sidebar={
        <ConversationSidebar
          directory={directory}
          project={conversations.project}
          sessions={conversations.sessions}
          selectedId={conversations.selectedId}
          loading={conversations.loadingList}
          connected={conversations.connected}
          creating={conversations.creating}
          archivedView={conversations.archivedView}
          archiveBusyIds={conversations.archiveBusyIds}
          error={conversations.listError}
          onSelect={selectSession}
           onCreate={createSession}
          onRefresh={conversations.refresh}
          onArchiveViewChange={async (archived) => { await conversations.setArchiveViewMode(archived); onViewChange("conversation"); }}
          onArchive={conversations.archiveSession}
          onUnarchive={conversations.unarchiveSession}
          currentStatus={conversations.executionStatus}
          onCloseSidebar={() => setSidebarOpen(false)}
        />
      }
      header={
        <ConversationHeader
          desktopEditing={desktopEditing}
          onToggleDesktopEditing={() => setDesktopEditing((value) => !value)}
          desktop={desktop}
          project={conversations.project}
          session={desktop ? null : conversations.session}
          deviceName={device?.name}
          connected={conversations.connected}
          onOpenSidebar={() => setSidebarOpen(true)}
          onRename={conversations.renameSession}
          renaming={conversations.renaming}
          usage={
            <>
              <UsageSummaryControl
                currentModel={conversations.contextStatus.model}
                snapshot={usage.snapshot}
                loading={usage.loading}
                error={usage.error}
                onRefresh={() => void usage.refresh(true)}
              />
              <IntelligenceEfficiencyControl />
            </>
          }
          onViewChange={onViewChange}
        />
      }
      conversation={
        <div ref={responseSlot} className={desktopStyles.workspace}><div style={{ height: "100%", minHeight: 0, display: desktop ? "block" : "none" }}><Desktop editing={desktopEditing} onEditingChange={setDesktopEditing} workspace={desktopWorkspace} onDiscuss={() => { setAnswerOpen(false); requestAnimationFrame(() => composerSlot.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus()); }} directory={directory} active={active && desktop} connected={conversations.connected} onSelect={selectSession} /></div>
        {desktop && desktopReady && !answerOpen && <button className={desktopStyles.reopen} type="button" onClick={() => setAnswerOpen(true)}><MessageSquare size={16} />{conversations.executionStatus.active ? "查看正在进行的回复" : "打开助手对话"}</button>}
        {desktop && !desktopReady && <div className={desktopStyles.reopen} role="status">{desktopError ? <button type="button" onClick={() => { desktopEntered.current = false; setDesktopError(false); void conversations.prepareDesktopConversation(personalProject?.root || "").then((ready) => { setDesktopReady(ready); setDesktopError(!ready); }); }}>连接助手失败，点击重试</button> : "正在连接桌面助手…"}</div>}
        <div className={desktop ? `${desktopStyles.answer} ${answerOpen ? desktopStyles.answerOpen : ""}` : desktopStyles.conversation}
          role={desktop ? "region" : undefined} aria-label={desktop ? "桌面助手回复" : undefined} aria-hidden={desktop && !answerOpen} inert={desktop && !answerOpen}>
        {desktop && <div className={desktopStyles.answerHeader}><strong>{conversations.session?.title || "桌面助手"}</strong><button type="button" aria-label="收起回复" onClick={() => setAnswerOpen(false)}><ChevronDown size={18} /></button></div>}
        <div className={desktopStyles.answerBody}><ConversationView
          key={conversations.selectedId || "conversation"}
          active={active && (!desktop || answerOpen)}
          session={conversations.session}
          loading={conversations.loadingSession}
          contentSyncState={conversations.contentSyncState}
          loadingOlder={conversations.loadingOlder}
          error={conversations.sessionError}
          listAvailable={!conversations.listError}
          streamingText={conversations.streamingText}
          executionStatus={conversations.executionStatus}
          contextStatus={conversations.contextStatus}
          onLoadOlder={conversations.loadOlder}
          onForkMessage={conversations.forkFromMessage}
          forkingMessageId={conversations.forkingMessageId}
          onEditMessage={conversations.beginEditMessage}
          editingMessageId={conversations.editingMessageId}
          onRetryMessage={conversations.retryPendingMessage}
          retryingMessageId={conversations.retryingMessageId}
          localSendVersion={conversations.localSendVersion}
        /></div></div></div>
      }
      composer={<div ref={composerSlot} style={{ display: "contents" }}>{conversations.session?.readOnly ? null : (
        <ConversationComposer
          desktopContext={desktop && desktopWorkspace.selected ? <div className={desktopStyles.selectionContext}><span>针对「{desktopWorkspace.selected.title}」对话</span><button type="button" onClick={() => desktopWorkspace.setSelectedId(null)}>取消选区</button></div> : undefined}
          key={conversations.composerKey}
          connected={conversations.connected}
          selected={Boolean(conversations.selectedId) && (!desktop || desktopReady)}
          archived={Boolean(conversations.session?.archived)}
          sending={conversations.sending}
          sendingSlow={conversations.sendingSlow}
          status={conversations.executionStatus}
          commentary={conversations.commentaryText}
          contextStatus={conversations.contextStatus}
          shownModel={conversations.visibleModel}
          shownEffort={conversations.visibleEffort}
          models={conversations.models}
          modelsLoading={conversations.modelsLoading}
          modelChanging={conversations.modelChanging}
          modelError={conversations.modelError}
          onSend={async (text, attachments) => {
            if (desktop && !attachments?.length && desktopWorkspace.executeLocal(text)) return true;
            const request = desktop ? desktopWorkspace.prepareRequest(text) : { text, rollback: () => {} };
            if (desktop) setAnswerOpen(true);
            try { const accepted = await conversations.sendMessage(request.text, attachments); if (!accepted) request.rollback(); return accepted; }
            catch (error) { request.rollback(); throw error; }
          }}
          onQueue={async (text, attachments) => {
            if (desktop && !attachments?.length && desktopWorkspace.executeLocal(text)) return true;
            const request = desktop ? desktopWorkspace.prepareRequest(text) : { text, rollback: () => {} };
            if (desktop) setAnswerOpen(true);
            try { const accepted = await conversations.queueMessage(request.text, attachments); if (!accepted) request.rollback(); return accepted; }
            catch (error) { request.rollback(); throw error; }
          }}
          queueing={conversations.queueBusy}
          queueItems={conversations.queueItems}
          queueError={conversations.queueError}
          onEditQueueItem={conversations.editQueueItem}
          onRemoveQueueItem={conversations.removeQueueItem}
          onMoveQueueItem={conversations.moveQueueItem}
          onRetryQueueItem={conversations.retryQueueItem}
          onSendQueueItem={conversations.sendQueueItem}
          editingMessage={conversations.editingMessage}
          onCancelEdit={conversations.cancelEditMessage}
          onInterrupt={conversations.interrupt}
          onReview={() => { if (desktop) setAnswerOpen(true); return conversations.review(); }}
          goal={conversations.goal}
          goalBusy={conversations.goalBusy}
          goalError={conversations.goalError}
          onStartGoal={(objective) => { if (desktop) setAnswerOpen(true); return conversations.startGoal(objective); }}
          onChangeGoalStatus={conversations.changeGoalStatus}
          onClearGoal={conversations.clearGoal}
          onCompactContext={conversations.compactContext}
          onAutoCompactThresholdChange={conversations.setAutoCompactThreshold}
          onModelChange={conversations.changeModel}
          onReasoningEffortChange={conversations.changeReasoningEffort}
        />
      )}</div>}
      dock={<BottomNav current={desktop ? "desktop" : "conversation"} onViewChange={onViewChange} />}
    />
    {active && (!desktop || desktopReady) ? <UserInputDialog
      request={conversations.userInputRequest}
      busy={conversations.userInputBusy}
      error={conversations.userInputError}
      onSubmit={conversations.answerUserInput}
    /> : null}
    </>
  );
}

export function App() {
  const [surface, setSurface] = useState<InteractiveSurface>(readSurface);
  const [groupMounted, setGroupMounted] = useState(() => readSurface() === "group");

  const showSurface = useCallback((next: InteractiveSurface, pushHistory = true) => {
    if (next === surface) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (next === "group") setGroupMounted(true);
    setSurface(next);
    try { window.localStorage.setItem(surfaceStorageKey, next); } catch {}
    if (!pushHistory) return;
    const params = new URLSearchParams(window.location.search);
    params.delete("view");
    params.set("view", next);
    const query = params.toString();
    window.history.pushState({ surface: next }, "", `/${query ? `?${query}` : ""}`);
  }, [surface]);

  useEffect(() => {
    const handlePopState = () => {
      const next = readSurface();
      if (next === "group") setGroupMounted(true);
      setSurface(next);
      try { window.localStorage.setItem(surfaceStorageKey, next); } catch {}
    };
    const handleInternalNavigation = () => {
      const next = readSurface();
      if (next === "group") setGroupMounted(true);
      setSurface(next);
      try { window.localStorage.setItem(surfaceStorageKey, next); } catch {}
    };
    window.addEventListener("popstate", handlePopState);
    window.addEventListener("negus:navigate", handleInternalNavigation);
    return () => {
      window.removeEventListener("popstate", handlePopState);
      window.removeEventListener("negus:navigate", handleInternalNavigation);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <div
        aria-hidden={surface === "group"}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          visibility: surface !== "group" ? "visible" : "hidden",
          pointerEvents: surface !== "group" ? "auto" : "none",
          zIndex: surface !== "group" ? 1 : 0,
        }}
      >
        <ConversationApp active={surface !== "group"} desktop={surface === "desktop"} onViewChange={showSurface} />
      </div>
      {groupMounted ? (
        <div
          aria-hidden={surface !== "group"}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            visibility: surface === "group" ? "visible" : "hidden",
            pointerEvents: surface === "group" ? "auto" : "none",
            zIndex: surface === "group" ? 1 : 0,
          }}
        >
          <GroupApp active={surface === "group"} onViewChange={showSurface} />
        </div>
      ) : null}
    </div>
  );
}
