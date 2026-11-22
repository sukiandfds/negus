// Keep mutable information at the end of the native transcript. Commit its revision
// only after Codex accepts the turn; a failed submission must be able to retry.
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";

export function conversationContext(root) {
  const revisions = new Map();
  return {
    reset(id) { if (id) revisions.delete(id); else revisions.clear(); },
    async send(method, params, submit) {
      const id = params.threadId;
      if (method !== "turn/start" || !id || !params.developerInstructions) return submit(method, params);
      const profile = await fs.readFile(path.join(root, "USER_PROFILE.md"), "utf8")
        .catch(error => { if (error.code === "ENOENT") return ""; throw error; });
      const content = profile.trim().slice(0, 12000);
      const version = createHash("sha256").update(content).digest("hex");
      const previous = revisions.get(id);
      const additionalContext = { ...params.additionalContext };
      if (previous?.profile !== version && (content || previous?.hasProfile)) {
        additionalContext["negus.profile"] = { kind: "application",
          value: content ? "当前用户偏好（替代本会话先前的用户画像）：\n" + content : "用户画像已清空，不再沿用此前的画像。" };
      }
      const employee = additionalContext["negus.employee"]?.value;
      if (employee !== undefined) {
        if ((previous?.employee || "") === employee) delete additionalContext["negus.employee"];
        else if (!employee) additionalContext["negus.employee"] = { kind:"application", value:"此前的员工补充上下文已清空。" };
      }
      const model = additionalContext["negus.model"]?.value;
      if (model && previous?.model === model) delete additionalContext["negus.model"];
      const { additionalContext: _, ...rest } = params;
      const result = await submit(method, Object.keys(additionalContext).length ? { ...rest, additionalContext } : rest);
      revisions.delete(id);
      revisions.set(id, { profile: version, hasProfile: Boolean(content), employee, model });
      if (revisions.size > 4096) revisions.delete(revisions.keys().next().value);
      return result;
    },
  };
}
