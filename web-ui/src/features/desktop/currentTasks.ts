import type { DirectoryProject, DirectoryConversation, ProjectRuntimeStatus } from "../project-directory/model/types";
import type { ThreadGoal } from "../goals/model/types";

export interface CurrentTask {
  id: string;
  project: DirectoryProject;
  conversation: DirectoryConversation;
  title: string;
  label: string;
  category: "running" | "completed" | "other";
  attention: boolean;
  updatedAt: string;
  goal?: ThreadGoal | null;
}
const timestamp = (value?: string | null) => Date.parse(value || "") || 0;
const terminal = new Set(["failed", "interrupted", "systemError"]);
const labels: Record<string, string> = {
  submitted: "准备执行", working: "正在处理", command: "正在执行", fileChange: "正在修改文件",
  tool: "正在使用工具", responding: "正在回复", finalizing: "正在收尾", stopping: "正在停止",
  waitingOnApproval: "等待确认", waitingOnUserInput: "等待你回答", recovering: "正在恢复连接",
  unknown: "状态待确认", completed: "已完成", failed: "执行失败", interrupted: "已中断", systemError: "连接异常",
};
export function collectCurrentTasks(projects: DirectoryProject[], statuses: Record<string, ProjectRuntimeStatus>, goals: Record<string, ThreadGoal | null>): CurrentTask[] {
  const tasks = new Map<string, CurrentTask>();
  for (const project of projects) for (const conversation of project.conversations || []) {
    const id = conversation.threadId || conversation.id;
    if (!id || conversation.archived || conversation.pendingOpen || tasks.has(id)) continue;
    const status = statuses[id] || conversation.status;
    const goal = goals[id];
    const phase = status?.phase || "idle";
    const attention = ["waitingOnApproval", "waitingOnUserInput", "unknown", "recovering"].includes(phase);
    let category: CurrentTask["category"] = "other";
    let label = labels[phase] || "未运行";
    // An active goal continues between turns. A failed/interrupted turn needs attention,
    // even if its goal has not yet received a matching lifecycle update.
    if (status?.active && !terminal.has(phase)) { category = "running"; label = labels[phase] || "正在运行"; }
    else if (terminal.has(phase)) { category = "other"; }
    else if (goal?.status === "active") { category = "running"; label = "Goal 持续进行中"; }
    else if (goal?.status === "paused") label = "Goal 已暂停";
    else if (goal?.status === "budgetLimited") label = "Goal 额度已用完";
    else if (goal?.status === "complete" || phase === "completed") { category = "completed"; label = goal?.status === "complete" ? "Goal 已完成" : "已完成"; }
    else continue; // Idle is not proof of completion.
    const goalMs = Number(goal?.updatedAt || 0) * (Number(goal?.updatedAt || 0) < 1e12 ? 1000 : 1);
    const goalDate = new Date(goalMs);
    const goalAt = goalMs && Number.isFinite(goalDate.getTime()) ? goalDate.toISOString() : "";
    // Renaming a conversation must not promote an old completed task.
    const updatedAt = [status?.updatedAt, goalAt].filter((value): value is string => Boolean(value))
      .sort((a, b) => timestamp(b) - timestamp(a))[0] || conversation.updatedAt || conversation.lastActivityAt || "";
    tasks.set(id, { id, project, conversation, title: conversation.title || "未命名对话", label, category, attention, updatedAt, goal });
  }
  return [...tasks.values()].sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt) || a.id.localeCompare(b.id));
}

export function taskPreview(tasks: CurrentTask[]) {
  const running = tasks.filter((task) => task.category === "running");
  const completed = tasks.filter((task) => task.category === "completed");
  return { running, completed, items: (running.length ? running : completed).slice(0, 3) };
}
