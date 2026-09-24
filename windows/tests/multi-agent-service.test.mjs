import assert from "node:assert/strict";
import test from "node:test";
import { buildDiscussionPrompt, createMultiAgentService, mentionedAgentIds, newMentionedAgentIds } from "../server/multi-agent-service.mjs";
import { resolveAgentRouting } from "../server/multi-agent/agent-routing.mjs";

const agents = [
  { id: "manager", name: "Manager Agent", aliases: ["Manager"], responsibility: "coordination" },
  { id: "reviewer", name: "Reviewer Agent", aliases: ["Reviewer"], responsibility: "risk review" },
];

test("finds every mentioned Agent in message order", () => {
  assert.deepEqual(
    mentionedAgentIds("Ask @Reviewer Agent, then @Manager Agent", agents),
    ["reviewer", "manager"],
  );
  assert.deepEqual(mentionedAgentIds("@Reviewer Agent then @Reviewer Agent", agents), ["reviewer"]);
});

test("an empty explicit Agent list still resolves mentions from text", () => {
  assert.deepEqual(resolveAgentRouting({
    text: "Please continue, @Reviewer Agent",
    requestedAgentIds: ["manager"],
    explicitAgentIds: [],
    agents,
  }).targetAgentIds, ["reviewer"]);
});

test("ordinary room chat does not wake an employee", () => {
  assert.deepEqual(resolveAgentRouting({
    text: "周末要不要先缓一天",
    agents,
  }).targetAgentIds, []);
});

test("an explicit requested employee still routes without an @ mention", () => {
  assert.deepEqual(resolveAgentRouting({
    text: "请分析当前问题",
    requestedAgentIds: ["manager"],
    agents,
  }).targetAgentIds, ["manager"]);
});

test("matches aliases and ignores incomplete or longer names", () => {
  assert.deepEqual(mentionedAgentIds("Ask @Reviewer, then @Manager Agent", agents), ["reviewer", "manager"]);
  assert.deepEqual(mentionedAgentIds("@ReviewerAgent should not match", agents), []);
  assert.deepEqual(mentionedAgentIds("@Manager Agent", [{ ...agents[0], name: "Manager", aliases: [] }, agents[1]]), ["manager"]);
});

test("returns only newly mentioned employees for the current round", () => {
  assert.deepEqual(
    newMentionedAgentIds("Please continue, @Reviewer Agent", agents, new Set(["manager"])),
    ["reviewer"],
  );
  assert.deepEqual(
    newMentionedAgentIds("No handoff needed", agents, new Set(["manager"])),
    [],
  );
});

test("does not awaken an employee twice in the same round", () => {
  assert.deepEqual(
    newMentionedAgentIds("@Manager Agent please revisit this", agents, new Set(["manager", "reviewer"])),
    [],
  );
});

test("discussion prompt contains only the new public room context", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [{ type: "human", authorName: "Hans", text: "Check the current plan" }],
  });

  assert.match(prompt, /Check the current plan/u);
  assert.match(prompt, /\[成员 Hans\] Check the current plan/u);
  assert.match(prompt, /消息标记：成员是真人/u);
  assert.match(prompt, /@Manager Agent/u);
  assert.doesNotMatch(prompt, /@Reviewer Agent/u);
  assert.match(prompt, /只能以自己的身份回复/u);
  assert.match(prompt, /不得代替其他员工发言/u);
  assert.match(prompt, /系统会在你回复后调用被提及的员工/u);
  assert.match(prompt, /按发生顺序/u);
  assert.doesNotMatch(prompt, /Your public role|hidden thinking|private reasoning/u);
});

test("reuses one persistent Runtime thread for an employee in a group", async () => {
  const requests = [];
  let agent = {
    ...agents[0],
    threadId: null,
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
  };
  const client = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "group-thread-manager" } };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: [agent] }),
    getAgent: () => agent,
    updateAgent: async (_agentId, patch) => { agent = { ...agent, ...patch }; return agent; },
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: client,
  });

  const first = await service.ensureAgentThread("manager");
  const second = await service.ensureAgentThread("manager");
  service.close();

  assert.equal(first, "group-thread-manager");
  assert.equal(second, first);
  assert.equal(requests.filter((item) => item.method === "thread/start").length, 1);
  assert.equal(requests.find((item) => item.method === "thread/start").params.ephemeral, false);
  assert.equal(requests.filter((item) => item.method === "thread/resume").length, 1);
});

test("interrupts the active group Turn and cancels the remaining employees", async () => {
  const requests = [];
  let protocolHandler = () => {};
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: null,
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
  }));
  const messages = [];
  const deliveredContexts = [];
  const client = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: `group-thread-${params.cwd.endsWith("manager") ? "manager" : "reviewer"}` } };
      if (method === "turn/start") return { turn: { id: "turn-manager" } };
      return {};
    },
    subscribe: (handler) => { protocolHandler = handler; return () => {}; },
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      return roomAgents[index];
    },
    getAgentContext: () => ({ messages: [{ type: "human", authorName: "Hans", text: "检查问题" }], throughSequence: 1 }),
    addMessage: async (message) => { messages.push(message); return { ...message, id: `message-${messages.length}` }; },
    advanceAgentContext: async () => {},
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager", reviewer: "D:\\employees\\reviewer" },
    room,
    broadcast: () => {},
    appServerClient: client,
    onContextDelivered: async (delivery) => deliveredContexts.push(delivery),
  });

  await service.enqueueDiscussion({ agentIds: ["manager", "reviewer"], requestText: "检查问题" });
  while (!requests.some((request) => request.method === "turn/start")) await new Promise((resolve) => setImmediate(resolve));
  const stopped = await service.interruptDiscussion();
  protocolHandler({ method: "turn/completed", params: { threadId: "group-thread-manager", turn: { id: "turn-manager", status: "interrupted" } } });
  await new Promise((resolve) => setImmediate(resolve));
  service.close();

  assert.deepEqual(requests.find((request) => request.method === "turn/interrupt"), {
    method: "turn/interrupt",
    params: { threadId: "group-thread-manager", turnId: "turn-manager" },
  });
  assert.equal(requests.filter((request) => request.method === "thread/start").length, 1);
  assert.equal(stopped.cancelledDiscussionCount, 1);
  assert.equal(messages.some((message) => message.text === "您终止了本次任务。"), true);
  assert.deepEqual(deliveredContexts[0].messages.map((message) => message.text), ["检查问题"]);
});

test("a new group Agent Thread uses its provider and rejects a later cross-provider switch", async () => {
  const currentRequests = [];
  const grokRequests = [];
  const client = (requests, threadId) => ({
    subscribe: () => () => {},
    close: () => {},
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: threadId } };
      if (method === "thread/resume") return { thread: { id: params.threadId } };
      return {};
    },
  });
  const currentClient = client(currentRequests, "group-current-thread");
  const grokClient = client(grokRequests, "group-grok-thread");
  let agent = {
    ...agents[0],
    threadId: null,
    instructions: "stable employee rules",
    modelProviderId: "fusheng-grok",
    model: "grok-4.6",
    reasoningEffort: "",
  };
  const room = {
    snapshot: () => ({ agents: [agent] }),
    getAgent: () => agent,
    updateAgent: async (_agentId, patch) => { agent = { ...agent, ...patch }; return agent; },
  };
  const modelProviders = {
    resolveRoute: ({ modelProviderId = "", model = "" }) => ({
      modelProviderId: modelProviderId || (model === "grok-4.6" ? "fusheng-grok" : "current"),
      model,
    }),
    getClient: async (route) => route.modelProviderId === "fusheng-grok" ? grokClient : currentClient,
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: currentClient,
    modelProviders,
  });

  assert.equal(await service.ensureAgentThread("manager"), "group-grok-thread");
  assert.equal(currentRequests.some((request) => request.method === "thread/start"), false);
  assert.equal(grokRequests.find((request) => request.method === "thread/start").params.model, "grok-4.6");
  await assert.rejects(
    () => service.updateAgentSettings("manager", {
      modelProviderId: "current",
      model: "gpt-5.6-terra",
      reasoningEffort: "low",
    }),
    /跨供应商/u,
  );
  assert.equal(agent.modelProviderId, "fusheng-grok");
  service.close();
});

test("discussion prompt singles out the assignment and an outside quote", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [
      { id: "m1", type: "human", authorName: "Hans", text: "earlier note" },
      { id: "m2", type: "human", authorName: "Hans", text: "@Reviewer Agent please review" },
    ],
    assignment: { id: "m2", type: "human", authorName: "Hans", text: "@Reviewer Agent please review" },
    quotedMessage: { id: "q1", type: "human", authorName: "Hans", text: "the original spec" },
    omittedMessageCount: 4,
  });

  assert.match(prompt, /你要回复的是上面最后一次点到你的那条消息/u);
  assert.match(prompt, /the original spec/u);
  assert.match(prompt, /earlier note/u);
  assert.match(prompt, /较早的 4 条/u);
  assert.ok(prompt.indexOf("earlier note") < prompt.indexOf("@Reviewer Agent please review"));
  assert.equal(prompt.split("@Reviewer Agent please review").length - 1, 1);
});

test("does not ask an employee to hand off people the user already named", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [
      { id: "m1", sequence: 1, type: "agent", agentId: "manager", authorName: "Manager Agent", text: "上一版不够热烈" },
      { id: "m2", sequence: 2, type: "human", authorName: "Hans", text: "再热烈一点", targetAgentIds: ["reviewer", "manager"] },
    ],
    assignment: { id: "m2", sequence: 2, type: "human", authorName: "Hans", text: "再热烈一点", targetAgentIds: ["reviewer", "manager"] },
  });
  assert.match(prompt, /这条消息已经点了@Manager Agent/u);
  assert.match(prompt, /不要为了交接再点一次/u);
  assert.match(prompt, /紧挨着的上一条/u);
  assert.ok(prompt.indexOf("上一版不够热烈") < prompt.indexOf("再热烈一点"));
});

test("marks a gap instead of treating separated messages as adjacent", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [
      { id: "m1", sequence: 4, type: "human", authorName: "Hans", text: "先看登录" },
      { id: "m2", sequence: 12, type: "human", authorName: "Hans", text: "@Reviewer Agent 现在看这个" },
    ],
    assignment: { id: "m2", sequence: 12, type: "human", authorName: "Hans", text: "@Reviewer Agent 现在看这个" },
  });
  assert.match(prompt, /中间省略了 7 条/u);
  assert.doesNotMatch(prompt, /紧挨着的上一条/u);
  assert.ok(prompt.indexOf("先看登录") < prompt.indexOf("中间省略了 7 条"));
  assert.ok(prompt.indexOf("中间省略了 7 条") < prompt.indexOf("现在看这个"));
});

test("reports how many discussions are already ahead in the queue", async () => {
  const requests = [];
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: null,
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
  }));
  const client = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "group-thread-manager" } };
      if (method === "turn/start") return { turn: { id: "turn-manager" } };
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      return roomAgents[index];
    },
    getAgentContext: () => ({ messages: [], throughSequence: 2, omittedMessageCount: 0, firstParticipation: false }),
    addMessage: async (message) => message,
    advanceAgentContext: async () => 2,
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: client,
  });
  const first = await service.enqueueDiscussion({ agentIds: ["manager"], requestText: "先做这个" });
  const second = await service.enqueueDiscussion({ agentIds: ["manager"], requestText: "接着做" });
  service.close();

  assert.equal(first.queuedBehind, 0);
  assert.equal(second.queuedBehind, 1);
  assert.deepEqual(first.agentNames, ["Manager Agent"]);
  assert.deepEqual(second.agentIds, ["manager"]);
});

test("advances context when the turn accepts it and not when startup fails", async () => {
  const advanced = [];
  const failures = [];
  let failStart = true;
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: "thread-manager",
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
  }));
  const client = {
    request: async (method) => {
      if (method === "thread/resume") return { thread: { id: "thread-manager" } };
      if (method === "turn/start") {
        if (failStart) throw new Error("runtime down");
        return { turn: { id: "turn-manager" } };
      }
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      return roomAgents[index];
    },
    getAgentContext: () => ({ messages: [{ text: "检查问题" }], throughSequence: 7 }),
    addMessage: async (message) => { failures.push(message); return message; },
    advanceAgentContext: async (_agentId, sequence) => { advanced.push(sequence); return sequence; },
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: client,
  });
  await service.enqueueDiscussion({ agentIds: ["manager"], requestText: "检查问题" });
  while (!failures.length) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(advanced, []);
  failStart = false;
  await service.enqueueDiscussion({ agentIds: ["manager"], requestText: "再检查" });
  while (!advanced.length) await new Promise((resolve) => setImmediate(resolve));
  service.close();
  assert.deepEqual(advanced, [7]);
});

test("shows the next employee as waiting while the first one is working", async () => {
  const updates = [];
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: null,
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
    phase: "idle",
    label: "等待新任务",
  }));
  const client = {
    request: async (method, params) => {
      if (method === "thread/start") return { thread: { id: `group-thread-${String(params.cwd || "").endsWith("reviewer") ? "reviewer" : "manager"}` } };
      if (method === "turn/start") return { turn: { id: "turn-manager" } };
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      updates.push({ agentId, phase: patch.phase, label: patch.label });
      return roomAgents[index];
    },
    getAgentContext: () => ({ messages: [], throughSequence: 1 }),
    addMessage: async (message) => message,
    advanceAgentContext: async () => 1,
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager", reviewer: "D:\\employees\\reviewer" },
    room,
    broadcast: () => {},
    appServerClient: client,
  });
  await service.enqueueDiscussion({ agentIds: ["manager", "reviewer"], requestText: "一起看这个问题" });
  const waiting = () => updates.some((item) => item.agentId === "reviewer" && item.phase === "queued" && item.label === "等候上一位");
  for (let attempt = 0; attempt < 20 && !waiting(); attempt += 1) await new Promise((resolve) => setImmediate(resolve));
  service.close();
  assert.equal(waiting(), true);
  assert.equal(updates.some((item) => item.agentId === "manager" && item.phase === "queued"), false);
});

test("passes files from a quoted message that is outside the context window", async () => {
  const requests = [];
  const resolvedIds = [];
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: null,
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
  }));
  const client = {
    request: async (method, params) => {
      requests.push({ method, params });
      if (method === "thread/start") return { thread: { id: "group-thread-manager" } };
      if (method === "turn/start") return { turn: { id: "turn-manager" } };
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      return roomAgents[index];
    },
    getAgentContext: () => ({
      messages: [{
        id: "current",
        type: "human",
        authorName: "Hans",
        text: "@Manager Agent 看一下原稿",
        attachments: [{ id: "current-file" }],
      }],
      quotedMessage: {
        id: "quoted",
        type: "human",
        authorName: "Hans",
        text: "原稿",
        attachments: [{ id: "quoted-file" }],
        artifactIds: ["quoted-artifact"],
      },
      throughSequence: 2,
      omittedMessageCount: 1,
      firstParticipation: false,
    }),
    addMessage: async (message) => message,
    advanceAgentContext: async () => 2,
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: client,
    resolveAttachments: (ids) => {
      resolvedIds.push(...ids);
      return ids.map((id) => ({ id, name: id + ".png", mimeType: "image/png", path: "D:\\files\\" + id + ".png" }));
    },
    resolveArtifacts: (ids) => ids.map((id) => ({ id, name: id + ".md", mimeType: "text/markdown", path: "D:\\files\\" + id + ".md" })),
  });
  await service.enqueueDiscussion({
    agentIds: ["manager"],
    requestText: "@Manager Agent 看一下原稿",
    attachments: [{ id: "direct-file", name: "direct.png", mimeType: "image/png", path: "D:\\files\\direct.png" }],
  });
  for (let attempt = 0; attempt < 20 && !requests.some((request) => request.method === "turn/start"); attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  service.close();
  const started = requests.find((request) => request.method === "turn/start");
  const paths = (started?.params.input || []).map((item) => item.path).filter(Boolean);
  assert.deepEqual(resolvedIds, ["current-file", "quoted-file"]);
  assert.deepEqual(paths, [
    "D:\\files\\direct.png",
    "D:\\files\\current-file.png",
    "D:\\files\\quoted-file.png",
    "D:\\files\\quoted-artifact.md",
  ]);
});

test("keeps a later aside from replacing the assigned request", () => {
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [
      { id: "m1", sequence: 1, type: "human", authorName: "Hans", text: "@Reviewer Agent 先看登录", targetAgentIds: ["reviewer"] },
      { id: "m2", sequence: 2, type: "human", authorName: "Hans", text: "对了，按钮用蓝色" },
    ],
    assignment: { id: "m1", sequence: 1, type: "human", authorName: "Hans", text: "@Reviewer Agent 先看登录", targetAgentIds: ["reviewer"] },
    heldBackCount: 1,
    omittedBeforeCount: 0,
  });
  assert.match(prompt, /这次要完成的是下面这条/u);
  assert.match(prompt, /还有 1 条点到你的新消息/u);
  assert.match(prompt, /对了，按钮用蓝色/u);
  assert.doesNotMatch(prompt, /较早的/u);
  assert.doesNotMatch(prompt, /紧挨着的上一条/u);
});

test("clips one very long message instead of copying it whole", () => {
  const longText = "规格".repeat(4000);
  const prompt = buildDiscussionPrompt({
    agent: agents[1],
    agents,
    messages: [{ id: "m1", sequence: 1, type: "human", authorName: "Hans", text: longText }],
    assignment: { id: "m1", sequence: 1, type: "human", authorName: "Hans", text: longText },
  });
  assert.match(prompt, /后文省略，公共记录里有全文/u);
  assert.equal(prompt.includes(longText), false);
});

test("binds a turn to the message that queued it", async () => {
  const calls = [];
  const roomAgents = agents.map((agent) => ({
    ...agent,
    threadId: "thread-manager",
    instructions: "stable employee rules",
    model: "gpt-test",
    reasoningEffort: "medium",
    active: false,
  }));
  const client = {
    request: async (method) => {
      if (method === "thread/resume") return { thread: { id: "thread-manager" } };
      if (method === "turn/start") return { turn: { id: "turn-manager" } };
      return {};
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const room = {
    snapshot: () => ({ agents: roomAgents }),
    getAgent: (agentId) => roomAgents.find((agent) => agent.id === agentId),
    updateAgent: async (agentId, patch) => {
      const index = roomAgents.findIndex((agent) => agent.id === agentId);
      roomAgents[index] = { ...roomAgents[index], ...patch };
      return roomAgents[index];
    },
    getAgentContext: (_agentId, options) => {
      calls.push(options || {});
      return {
        messages: [{ id: "message-4", sequence: 4, type: "human", authorName: "Hans", text: "@Manager Agent 先做登录" }],
        assignment: { id: "message-4", sequence: 4, type: "human", authorName: "Hans", text: "@Manager Agent 先做登录", targetAgentIds: ["manager"] },
        throughSequence: 4,
        omittedMessageCount: 3,
        omittedBeforeCount: 0,
        heldBackCount: 1,
        firstParticipation: false,
      };
    },
    addMessage: async (message) => message,
    advanceAgentContext: async () => 4,
    beginAgentWork: () => {},
    finishAgentWork: () => {},
  };
  const service = createMultiAgentService({
    projectRoot: "D:\\project",
    employeeWorkRoots: { manager: "D:\\employees\\manager" },
    room,
    broadcast: () => {},
    appServerClient: client,
  });
  await service.enqueueDiscussion({
    agentIds: ["manager"],
    requestText: "@Manager Agent 先做登录",
    sourceMessageId: "message-4",
  });
  while (!calls.length) await new Promise((resolve) => setImmediate(resolve));
  service.close();
  assert.equal(calls[0].assignmentId, "message-4");
});
