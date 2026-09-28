import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { hasAccessToken, withAccessToken } from "../../../shared/api/http";
import type { ExecutionStatus } from "../../execution/model/types";
import type { ThreadGoal } from "../../goals/model/types";
import { projectDirectoryApi, projectDirectoryResource } from "../data/projectDirectoryApi";
import type { DirectoryProject, ProjectRuntimeStatus } from "../model/types";

type StatusByThread = Record<string, ProjectRuntimeStatus>;
const emptyProjects: DirectoryProject[] = [];
type DirectoryEvent = {
  type?: string;
  employeeId?: string;
  threadId?: string;
  status?: ProjectRuntimeStatus;
  phase?: string;
  label?: string;
  active?: boolean;
  turnId?: string | null;
  goal?: ThreadGoal | null;
};

const sameStatus = (left?: ProjectRuntimeStatus, right?: ProjectRuntimeStatus) => (
  String(left?.phase || "") === String(right?.phase || "")
  && Boolean(left?.active) === Boolean(right?.active)
  && String(left?.turnId || "") === String(right?.turnId || "")
  && left?.updatedAt === right?.updatedAt && left?.label === right?.label
);

export function useProjectDirectory(currentStatus?: ExecutionStatus) {
  const cached = useSyncExternalStore(projectDirectoryResource.subscribe, projectDirectoryResource.getSnapshot);
  const projects = cached.data ?? emptyProjects;
  const [statusByThread, setStatusByThread] = useState<StatusByThread>({});
  const [goalByThread, setGoalByThread] = useState<Record<string, ThreadGoal | null>>({});
  const [goalRecovery, setGoalRecovery] = useState(0);
  const loading = cached.data === null && !cached.error;
  const error = cached.error;
  const projectsRef = useRef(projects);
  const refreshVersion = useRef(0);
  projectsRef.current = projects;

  const cacheStatus = useCallback((threadId: string, status?: ProjectRuntimeStatus | null) => {
    if (!threadId || !status) return;
    setStatusByThread((current) => sameStatus(current[threadId], status)
      || (Date.parse(current[threadId]?.updatedAt || "") > Date.parse(status.updatedAt || ""))
      ? current
      : { ...current, [threadId]: status });
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal, invalidate = false) => {
    const version = ++refreshVersion.current;
    try {
      const next = await projectDirectoryApi.list(signal, invalidate);
      if (signal?.aborted || version !== refreshVersion.current) return;
      for (const entry of next) {
        if (entry.mainThreadId) cacheStatus(entry.mainThreadId, entry.status);
        for (const conversation of entry.conversations || []) {
          cacheStatus(conversation.threadId || conversation.id, conversation.status);
        }
      }
    } catch { /* Shared resource retains the last good directory and error. */ }
  }, [cacheStatus]);

  useEffect(() => {
    if (!currentStatus?.threadId || !currentStatus.updatedAt) return;
    cacheStatus(currentStatus.threadId, currentStatus);
  }, [cacheStatus, currentStatus]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    if (!hasAccessToken || typeof EventSource === "undefined") return () => controller.abort();
    const source = new EventSource(withAccessToken("/events"));
    let refreshTimer = 0;
    const scheduleActivityRefresh = () => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refresh(controller.signal, true), 180);
    };
    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as DirectoryEvent;
        if (payload.type === "goal_status" && payload.threadId) {
          setGoalByThread((current) => ({ ...current, [payload.threadId!]: payload.goal || null }));
          return;
        }
        if (payload.type === "execution_status" && payload.threadId) {
          cacheStatus(payload.threadId, payload);
          return;
        }
        if (payload.type === "employee_status") {
          const employeeProject = projectsRef.current.find((entry) => entry.employeeId === payload.employeeId);
          if (employeeProject?.mainThreadId) cacheStatus(employeeProject.mainThreadId, payload.status);
          return;
        }
        if (payload.type === "sessions_changed" || payload.type === "employee_message_completed") scheduleActivityRefresh();
      } catch { /* Existing conversation SSE remains the source of truth. */ }
    };
    let opened = false;
    source.onopen = () => { if (opened) { setGoalRecovery((value) => value + 1); void refresh(controller.signal); } opened = true; };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") { setGoalRecovery((value) => value + 1); void refresh(); }
    };
    window.addEventListener("pageshow", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      controller.abort();
      source.close();
      window.clearTimeout(refreshTimer);
      window.removeEventListener("pageshow", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [cacheStatus, refresh]);

  return { projects, statusByThread, goalByThread, goalRecovery, loading, error, refresh };
}
