import { negusSystemPrompt } from "./negus-system-prompt.mjs";
import { negusToolPrompt } from "./negus-tool-prompt.mjs";

export const workerInstructions = "你是临时后台任务执行者，直接执行本任务中已授权的工作并完成必要验证，不再创建或委派后台任务。最终回复包含实际结果、证据和未完成项，由系统送回来源助手；不要自行向来源对话发消息。";
export function conversationPrompt(role = "", context = "") {
  return [negusSystemPrompt, negusToolPrompt(), role, context].filter(Boolean).join("\n\n");
}

export const modelContext = model => ({ "negus.model": { kind: "application",
  value: `本轮调用模型：${model || "未取得"}。回答模型身份时以本轮请求为准，不以历史回复或全局默认配置推断。此标识不证明供应商内部实际模型。` } });

export const employeeContext = value => ({ "negus.employee": { kind: "application",
  value: value ? "当前员工补充上下文（替代之前的版本）：\n" + value : "" } });
