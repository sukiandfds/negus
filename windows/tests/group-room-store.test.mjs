import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGroupRoomStore } from "../server/group-room-store.mjs";

test("deduplicates retried client messages and preserves message order", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-room-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const events = [];
  const room = await createGroupRoomStore({ stateFile, project: "negus", broadcast: (event) => events.push(event) });
  const first = await room.addMessageWithStatus({
    authorId: "member-1",
    authorName: "Hans",
    clientMessageId: "client-message-1",
    text: "第一条消息",
  });
  const retried = await room.addMessageWithStatus({
    authorId: "member-1",
    authorName: "Hans",
    clientMessageId: "client-message-1",
    text: "第一条消息",
  });
  const second = await room.addMessageWithStatus({
    authorId: "member-1",
    authorName: "Hans",
    clientMessageId: "client-message-2",
    text: "第二条消息",
  });

  assert.equal(first.created, true);
  assert.equal(retried.created, false);
  assert.equal(retried.message.id, first.message.id);
  assert.equal(second.message.sequence, first.message.sequence + 1);
  assert.equal(room.snapshot().messages.length, 2);
  assert.equal(events.filter((event) => event.type === "group_message_created").length, 2);
  await room.close();

  const restored = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  assert.deepEqual(restored.snapshot().messages.map((message) => message.text), ["第一条消息", "第二条消息"]);
  assert.deepEqual(restored.snapshot().messages.map((message) => message.sequence), [1, 2]);
  await restored.close();
});

test("restores attachment-only group messages", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-attachment-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const room = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  await room.addMessage({
    authorId: "member-1",
    authorName: "Hans",
    text: "",
    attachments: [{ id: "media-1", name: "example.png", mimeType: "image/png", url: "/api/media/media-1" }],
  });
  await room.close();

  const restored = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  assert.equal(restored.snapshot().messages.length, 1);
  assert.equal(restored.snapshot().messages[0].attachments[0].id, "media-1");
  await restored.close();
});

test("keeps full history and returns date and cursor pages", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-history-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(stateFile, JSON.stringify({
    messages: [
      { id: "m1", sequence: 1, createdAt: "2026-08-10T01:00:00.000Z", authorId: "member-1", authorName: "Hans", text: "first" },
      { id: "m2", sequence: 2, createdAt: "2026-08-11T01:00:00.000Z", authorId: "member-1", authorName: "Hans", text: "second" },
      { id: "m3", sequence: 3, createdAt: "2026-08-11T02:00:00.000Z", authorId: "member-1", authorName: "Hans", text: "third" },
      { id: "m4", sequence: 4, createdAt: "2026-08-12T01:00:00.000Z", authorId: "member-1", authorName: "Hans", text: "fourth" },
    ],
  }), "utf8");
  const restored = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  const datePage = restored.getMessagePage({ date: "2026-08-11", limit: 2 });
  assert.equal(restored.snapshot().messages.length, 4);
  assert.deepEqual(datePage.messages.map((message) => message.text), ["second", "third"]);
  assert.equal(datePage.hasOlder, true);
  assert.equal(datePage.hasNewer, true);
  const olderPage = restored.getMessagePage({ beforeSequence: datePage.oldestSequence, limit: 2 });
  assert.deepEqual(olderPage.messages.map((message) => message.text), ["first"]);
  const newerPage = restored.getMessagePage({ afterSequence: datePage.newestSequence, limit: 2 });
  assert.deepEqual(newerPage.messages.map((message) => message.text), ["fourth"]);
  assert.equal(restored.getMessagePage({ date: "2026-08-13" }).found, false);
  await restored.addMessage({ authorId: "member-1", authorName: "Hans", text: "latest" });
  await restored.close();
  const reloaded = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  assert.equal(reloaded.getMessagePage({ date: "2026-08-10" }).messages[0].text, "first");
  assert.equal(reloaded.snapshot().messages.at(-1).text, "latest");
  await reloaded.close();
});

test("bounds Agent context while keeping the full room history readable", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-context-limit-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(stateFile, JSON.stringify({
    messages: Array.from({ length: 100 }, (_, index) => ({
      id: `m-${index + 1}`,
      sequence: index + 1,
      createdAt: `2026-08-10T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`,
      authorId: "member-1",
      authorName: "Hans",
      text: `message-${index + 1}`,
    })),
  }), "utf8");
  const room = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  const context = room.getAgentContext("manager");

  assert.equal(room.snapshot().messages.length, 100);
  assert.equal(context.firstParticipation, true);
  assert.equal(context.totalMessageCount, 100);
  assert.equal(context.omittedMessageCount, 88);
  assert.deepEqual(context.messages.map((message) => message.text), Array.from({ length: 12 }, (_, index) => "message-" + (index + 89)));
  assert.equal(context.messages.at(-1).sequence, 100);
  await room.advanceAgentContext("manager", context.throughSequence);
  await room.addMessage({ authorId: "member-1", authorName: "Hans", text: "message-101" });
  const followUp = room.getAgentContext("manager");
  assert.equal(followUp.firstParticipation, false);
  assert.equal(followUp.omittedMessageCount, 0);
  assert.deepEqual(followUp.messages.map((message) => message.text), ["message-101"]);
  await room.close();
});

test("deduplicates repeated agent completions by work id", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-work-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const events = [];
  const room = await createGroupRoomStore({ stateFile, project: "negus", broadcast: (event) => events.push(event) });
  const first = await room.addMessage({
    type: "agent",
    authorId: "developer",
    authorName: "Developer Agent",
    agentId: "developer",
    workId: "work-1",
    text: "最终结果",
  });
  const repeated = await room.addMessageWithStatus({
    type: "agent",
    authorId: "developer",
    authorName: "Developer Agent",
    agentId: "developer",
    workId: "work-1",
    text: "最终结果",
  });

  assert.equal(repeated.message.id, first.id);
  assert.equal(repeated.created, false);
  assert.equal(room.snapshot().messages.length, 1);
  assert.equal(events.filter((event) => event.type === "group_message_created").length, 1);
  await room.close();
});

test("exposes active Agent work in snapshots without persisting it across restart", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-active-work-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));

  const room = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  room.beginAgentWork({
    workId: "work-active-1",
    agentId: "developer",
    agentName: "开发 Agent",
    startedAt: "2026-08-10T01:02:03.000Z",
  });

  assert.deepEqual(room.snapshot().activeWorks, [{
    workId: "work-active-1",
    agentId: "developer",
    agentName: "开发 Agent",
    startedAt: "2026-08-10T01:02:03.000Z",
    phase: "working",
  }]);
  assert.equal(room.finishAgentWork("work-active-1"), true);
  assert.deepEqual(room.snapshot().activeWorks, []);

  room.beginAgentWork({ workId: "work-not-persisted", agentId: "developer" });
  await room.close();
  const restored = await createGroupRoomStore({ stateFile, project: "negus", broadcast: () => {} });
  assert.deepEqual(restored.snapshot().activeWorks, []);
  await restored.close();
});

test("adds a configured Grok employee to an existing group without changing saved agents", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-grok-"));
  const stateFile = path.join(directory, "group-room.json");
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(stateFile, JSON.stringify({
    agents: [{ id: "developer", modelProviderId: "current", model: "gpt-existing", threadId: "existing-thread" }],
  }), "utf8");

  const room = await createGroupRoomStore({
    stateFile,
    project: "negus",
    agentDefinitions: [
      { id: "developer", name: "Developer", modelProviderId: "current", model: "gpt-default" },
      { id: "grok", name: "Grok Assistant", modelProviderId: "fusheng-grok", model: "grok-4.6" },
    ],
  });

  assert.equal(room.getAgent("developer").threadId, "existing-thread");
  assert.equal(room.getAgent("developer").model, "gpt-existing");
  assert.equal(room.getAgent("grok").modelProviderId, "fusheng-grok");
  assert.equal(room.getAgent("grok").model, "grok-4.6");
  assert.equal(room.getAgent("grok").threadId, null);
  await room.close();
});

test("stores a reply target without changing who was addressed", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-reply-"));
  const room = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
  try {
    const original = await room.addMessage({ authorId: "member-1", authorName: "Hans", text: "先看权限" });
    const reply = await room.addMessage({
      authorId: "member-2",
      authorName: "Li",
      text: "同意，先不扩大范围",
      replyTo: { id: original.id, authorName: original.authorName, text: original.text },
    });
    assert.equal(reply.replyTo.authorName, "Hans");
    assert.equal(reply.replyTo.text, "先看权限");
    await room.close();
    const restored = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
    assert.equal(restored.snapshot().messages.at(-1).replyTo.text, "先看权限");
    await restored.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("uses the stored message as the reply snapshot and ignores unknown targets", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-reply-canonical-"));
  const room = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
  try {
    const original = await room.addMessage({ type: "human", authorId: "member-1", authorName: "Hans", text: "先看权限，不要扩大范围" });
    const reply = await room.addMessage({
      type: "human",
      authorId: "member-2",
      authorName: "Li",
      text: "同意",
      replyTo: { id: original.id, authorName: "伪造", text: "伪造内容" },
    });
    const missing = await room.addMessage({
      type: "human",
      authorId: "member-2",
      authorName: "Li",
      text: "另一条",
      replyTo: { id: "missing-message", authorName: "伪造", text: "不存在" },
    });
    assert.equal(reply.replyTo.authorName, "Hans");
    assert.equal(reply.replyTo.text, "先看权限，不要扩大范围");
    assert.equal(missing.replyTo, null);
    const attachmentOnly = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      text: "",
      attachments: [{ id: "media-9", name: "spec.png", mimeType: "image/png", url: "/api/media/media-9" }],
    });
    const attachmentReply = await room.addMessage({
      type: "human",
      authorId: "member-2",
      authorName: "Li",
      text: "看这张图",
      replyTo: { id: attachmentOnly.id, authorName: "伪造", text: "伪造" },
    });
    assert.equal(attachmentReply.replyTo.text, "spec.png");
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps the addressed message and a quote that sits outside the context window", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-context-quote-"));
  const room = await createGroupRoomStore({
    stateFile: path.join(directory, "group-room.json"),
    project: "negus",
    agentDefinitions: [{ id: "manager", name: "项目经理", responsibility: "协调" }],
    broadcast: () => {},
  });
  try {
    const spec = await room.addMessage({ type: "human", authorId: "member-1", authorName: "Hans", text: "登录规格：保留旧密码，新增验证码。" });
    const ask = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 先按这个规格改",
    });
    for (let index = 0; index < 20; index += 1) {
      await room.addMessage({ type: "human", authorId: "member-1", authorName: "Hans", text: "补充-" + index });
    }
    const crowded = room.getAgentContext("manager");
    assert.equal(crowded.assignment.id, ask.id);
    assert.equal(crowded.messages[0].id, ask.id);
    assert.equal(crowded.messages.at(-1).text, "补充-19");
    assert.equal(crowded.messages.length, 12);
    assert.equal(crowded.quotedMessage, null);

    await room.advanceAgentContext("manager", crowded.throughSequence);
    const followUp = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 再核对边界",
      replyTo: { id: spec.id, authorName: "伪造", text: "伪造" },
    });
    const context = room.getAgentContext("manager");
    assert.equal(context.firstParticipation, false);
    assert.equal(context.assignment.id, followUp.id);
    assert.deepEqual(context.messages.map((message) => message.id), [followUp.id]);
    assert.equal(context.quotedMessage.id, spec.id);
    assert.equal(context.quotedMessage.text, spec.text);
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("stores the quoted message sequence and can reopen history around it", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-quote-jump-"));
  const room = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
  try {
    let original = null;
    for (let index = 1; index <= 12; index += 1) {
      const message = await room.addMessage({ type: "human", authorId: "member-1", authorName: "Hans", text: "记录-" + index });
      if (index === 3) original = message;
    }
    const reply = await room.addMessage({
      type: "human",
      authorId: "member-2",
      authorName: "Li",
      text: "按这条改",
      replyTo: { id: original.id, authorName: "伪造", text: "伪造" },
    });
    assert.equal(reply.replyTo.sequence, original.sequence);
    assert.equal(reply.replyTo.text, "记录-3");
    const page = room.getMessagePage({ aroundSequence: reply.replyTo.sequence, limit: 5 });
    assert.equal(page.found, true);
    assert.equal(page.messages.some((message) => message.id === original.id), true);
    assert.equal(page.messages.length, 5);
    assert.equal(room.getMessagePage({ aroundSequence: 999, limit: 5 }).found, false);
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("remembers that a system message can be retried", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-failure-"));
  const room = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
  try {
    const failure = await room.addMessage({
      type: "system",
      authorId: "system",
      authorName: "系统",
      agentId: "manager",
      failure: true,
      text: "运营管理等待回复超时，没有新的回复。",
    });
    const ordinary = await room.addMessage({ authorId: "member-1", authorName: "Hans", text: "普通发言" });
    assert.equal(failure.failure, true);
    assert.equal(ordinary.failure, false);
    await room.close();
    const restored = await createGroupRoomStore({ stateFile: path.join(directory, "group-room.json"), project: "negus", broadcast: () => {} });
    assert.equal(restored.snapshot().messages[0].failure, true);
    assert.equal(restored.snapshot().messages[1].failure, false);
    await restored.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a failed system message keeps a link to the unfinished request", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-failure-link-"));
  const room = await createGroupRoomStore({
    stateFile: path.join(directory, "group-room.json"),
    project: "negus",
    agentDefinitions: [{ id: "manager", name: "运营管理", responsibility: "协调" }],
    broadcast: () => {},
  });
  try {
    const original = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@运营管理 把登录改成验证码",
    });
    const failure = await room.addMessage({
      type: "system",
      authorId: "system",
      authorName: "系统",
      agentId: "manager",
      failure: true,
      replyTo: { id: original.id },
      text: "运营管理等待回复超时，没有新的回复。",
    });
    assert.equal(failure.failure, true);
    assert.equal(failure.replyTo.id, original.id);
    assert.equal(failure.replyTo.text, "@运营管理 把登录改成验证码");
    assert.equal(failure.replyTo.sequence, original.sequence);
    await room.close();
    const restored = await createGroupRoomStore({
      stateFile: path.join(directory, "group-room.json"),
      project: "negus",
      agentDefinitions: [{ id: "manager", name: "运营管理", responsibility: "协调" }],
      broadcast: () => {},
    });
    assert.equal(restored.snapshot().messages.at(-1).replyTo.sequence, original.sequence);
    await restored.close();
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("keeps queued mentions as separate tasks and does not consume the later one", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-task-boundary-"));
  const room = await createGroupRoomStore({
    stateFile: path.join(directory, "group-room.json"),
    project: "negus",
    agentDefinitions: [{ id: "manager", name: "项目经理", responsibility: "协调" }],
    broadcast: () => {},
  });
  try {
    const first = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 先做登录",
    });
    const aside = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      text: "补充用验证码",
    });
    const second = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 再做注册",
    });
    const opening = room.getAgentContext("manager", { assignmentId: first.id });
    assert.equal(opening.assignment.id, first.id);
    assert.deepEqual(opening.messages.map((message) => message.id), [first.id, aside.id]);
    assert.equal(opening.throughSequence, aside.sequence);
    assert.equal(opening.heldBackCount, 1);
    assert.equal(opening.messages.some((message) => message.id === second.id), false);
    await room.advanceAgentContext("manager", opening.throughSequence);
    const followUp = room.getAgentContext("manager", { assignmentId: second.id });
    assert.equal(followUp.assignment.id, second.id);
    assert.deepEqual(followUp.messages.map((message) => message.id), [second.id]);
    assert.equal(followUp.heldBackCount, 0);
    assert.equal(followUp.throughSequence, second.sequence);
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a colleague handoff stays separate from a later direct mention", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-handoff-boundary-"));
  const room = await createGroupRoomStore({
    stateFile: path.join(directory, "group-room.json"),
    project: "negus",
    agentDefinitions: [
      { id: "manager", name: "项目经理", responsibility: "协调" },
      { id: "developer", name: "开发", responsibility: "实现" },
    ],
    broadcast: () => {},
  });
  try {
    const ask = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 先看登录",
    });
    const handoff = await room.addMessage({
      type: "agent",
      authorId: "manager",
      authorName: "项目经理",
      agentId: "manager",
      text: "@开发 请按这个规格实现",
    });
    const direct = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["developer"],
      text: "@开发 另外把按钮改成蓝色",
    });
    const context = room.getAgentContext("developer", { assignmentId: ask.id });
    assert.equal(context.assignment.id, handoff.id);
    assert.equal(context.messages.some((message) => message.id === handoff.id), true);
    assert.equal(context.messages.some((message) => message.id === direct.id), false);
    assert.equal(context.throughSequence, handoff.sequence);
    assert.equal(context.heldBackCount, 1);
    await room.advanceAgentContext("developer", context.throughSequence);
    const next = room.getAgentContext("developer", { assignmentId: direct.id });
    assert.equal(next.assignment.id, direct.id);
    assert.deepEqual(next.messages.map((message) => message.id), [direct.id]);
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("a long message does not crowd the addressed message out of the window", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-long-message-"));
  const room = await createGroupRoomStore({
    stateFile: path.join(directory, "group-room.json"),
    project: "negus",
    agentDefinitions: [{ id: "manager", name: "项目经理", responsibility: "协调" }],
    broadcast: () => {},
  });
  try {
    const ask = await room.addMessage({
      type: "human",
      authorId: "member-1",
      authorName: "Hans",
      targetAgentIds: ["manager"],
      text: "@项目经理 看规格",
    });
    for (let index = 0; index < 4; index += 1) {
      await room.addMessage({
        type: "human",
        authorId: "member-1",
        authorName: "Hans",
        text: "细节".repeat(6000) + index,
      });
    }
    const context = room.getAgentContext("manager", { assignmentId: ask.id });
    assert.equal(context.messages.length, 5);
    assert.equal(context.messages[0].id, ask.id);
    assert.equal(context.heldBackCount, 0);
  } finally {
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  }
});
