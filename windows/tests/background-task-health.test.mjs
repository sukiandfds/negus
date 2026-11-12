import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createBackgroundTaskService } from "../server/background-tasks/service.mjs";

const fixture = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "negus-background-health-"));
  const notices = [];
  const employee = { id: "employee", name: "employee", projectRoot: root, mainThreadId: "parent", model: "model", modelProviderId: "provider" };
  const service = await createBackgroundTaskService({
    stateFile: path.join(root, "tasks.json"),
    registry: { list: () => [employee], require: () => employee },
    modelProviders: {
      providers: () => [{ id: "ccswitch_deepseek", displayName: "DeepSeek", models: [{ model: "deepseek-flash" }] }],
      isProviderConfigured: async () => true,
      resolveRoute: ({ model, modelProviderId }) => ({ model, modelProviderId }),
    },
    conversations: {
      createSession: async () => ({ threadId: "task-thread" }),
      renameSession: async () => {},
      sendMessage: async () => {},
    },
    bindings: { bindRuntime: async (binding) => binding },
    queue: { enqueue: async (notice) => { notices.push(notice); return {}; } },
    execution: { getStatus: () => ({ active: true, turnId: "task-turn" }) },
  });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  await service.create("employee", { title: "task", instructions: "work" });
  for (let attempt = 0; attempt < 200 && service.list("employee")[0]?.state !== "running"; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  await service.onProtocolMessage({ method: "turn/started", params: { threadId: "task-thread", turn: { id: "task-turn" } } });
  assert.equal(service.list("employee")[0].state, "running");
  return { service, notices };
};

test("a background task is interrupted when its Codex process exits", async (t) => {
  const { service, notices } = await fixture(t);
  await service.onHealthState({ phase: "exited", threadId: "task-thread", error: new Error("gone") });

  const task = service.list("employee")[0];
  assert.equal(task.state, "interrupted");
  assert.equal(task.error, "Codex 进程已退出");
  assert.equal(service.hasPendingWork(), false, "an exited task must not keep the service busy");
  assert.match(notices.at(-1).text, /状态：interrupted/u);
});

test("transient health phases leave a background task running", async (t) => {
  const { service } = await fixture(t);
  for (const phase of ["checking", "recovering", "healthy"]) {
    await service.onHealthState({ phase, threadId: "task-thread" });
  }
  assert.equal(service.list("employee")[0].state, "running");
  assert.equal(service.hasPendingWork(), true);
});
