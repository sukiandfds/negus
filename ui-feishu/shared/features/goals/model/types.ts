export type GoalStatus = "active" | "paused" | "blocked" | "usageLimited" | "budgetLimited" | "complete";
export type EditableGoalStatus = "active" | "paused";

export interface ThreadGoal {
  threadId: string;
  objective: string;
  displayObjective?: string;
  status: GoalStatus;
  tokenBudget: number | null;
  timeUsedSeconds: number;
  tokensUsed: number;
  createdAt: number;
  updatedAt: number;
}
export interface GoalResponse { goal: ThreadGoal | null }
export const goalStatusLabels: Record<GoalStatus, string> = {
  active: "进行中的目标", paused: "已暂停的目标", blocked: "目标已停滞",
  usageLimited: "目标使用受限", budgetLimited: "目标受限", complete: "已达成目标",
};
export const nextGoalStatus = (status: GoalStatus): EditableGoalStatus | null =>
  status === "active" ? "paused" : ["paused", "blocked", "usageLimited"].includes(status) ? "active" : null;
export const goalElapsedSeconds = (goal: ThreadGoal, now: number) => Math.max(0,
  goal.timeUsedSeconds + (goal.status === "active" ? now / 1000 - goal.updatedAt : 0));
