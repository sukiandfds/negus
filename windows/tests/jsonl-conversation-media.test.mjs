import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJsonlConversationStore } from "../server/jsonl-conversation-store.mjs";

test("attaches tool preview images to the following final assistant message", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-jsonl-media-"));
  const projectRoot = path.join(root, "project");
  const threadId = "00000000-0000-4000-8000-000000000001";
  const file = path.join(root, `rollout-${threadId}.jsonl`);
  const lines = [
    { type: "session_meta", payload: { id: threadId, cwd: projectRoot, title: "Media test" } },
    { type: "response_item", payload: { type: "custom_tool_call_output", output: [
      { type: "input_text", text: "Script completed" },
      { type: "input_image", image_url: "data:image/png;base64,AAAA" },
    ] } },
    { timestamp: "2026-08-01T09:38:20.165Z", type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [
      { type: "output_text", text: "Here are the images." },
    ] } },
  ];
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");

  const store = createJsonlConversationStore({
    sessionRoot: root,
    projectRoot,
    registerMedia: () => null,
    onChange: () => {},
  });
  try {
    const session = await store.findSession(threadId);
    assert.equal(session.messages.length, 1);
    assert.deepEqual(session.messages[0].blocks.map((block) => block.type), ["markdown", "image"]);
    assert.equal(session.messages[0].blocks[1].source, "data:image/png;base64,AAAA");
    assert.equal(session.messages[0].createdAt, "2026-08-01T09:38:20.165Z");
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("keeps archived JSONL sessions out of the active list", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-jsonl-archive-"));
  const sessionRoot = path.join(root, "sessions");
  const archivedRoot = path.join(root, "archived_sessions");
  const projectRoot = path.join(root, "project");
  await Promise.all([mkdir(sessionRoot), mkdir(archivedRoot)]);
  const writeSession = async (directory, threadId, title) => {
    const lines = [
      { type: "session_meta", payload: { id: threadId, cwd: projectRoot, title } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] } },
      { type: "response_item", payload: { type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done" }] } },
    ];
    await writeFile(path.join(directory, `rollout-${threadId}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  };
  const activeId = "00000000-0000-4000-8000-000000000011";
  const archivedId = "00000000-0000-4000-8000-000000000012";
  await writeSession(sessionRoot, activeId, "Active");
  await writeSession(archivedRoot, archivedId, "Archived");

  const store = createJsonlConversationStore({
    sessionRoot,
    projectRoot,
    registerMedia: () => null,
    onChange: () => {},
  });
  try {
    const active = await store.listSessions("all", false);
    const archived = await store.listSessions("all", true);
    assert.deepEqual(active.map((session) => session.threadId), [activeId]);
    assert.deepEqual(archived.map((session) => session.threadId), [archivedId]);
    assert.equal((await store.findSession(archivedId)).archived, true);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("lists sessions from each configured business project and preserves cwd", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-jsonl-projects-"));
  const mainRoot = path.join(root, "main");
  const financeRoot = path.join(root, "finance");
  const threadIds = [
    "00000000-0000-4000-8000-000000000021",
    "00000000-0000-4000-8000-000000000022",
  ];
  await mkdir(mainRoot);
  await mkdir(financeRoot);
  for (const [index, projectRoot] of [mainRoot, financeRoot].entries()) {
    const lines = [
      { type: "session_meta", payload: { id: threadIds[index], cwd: projectRoot, title: `Project ${index + 1}` } },
      { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] } },
    ];
    await writeFile(path.join(root, `rollout-${threadIds[index]}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`, "utf8");
  }

  const store = createJsonlConversationStore({
    sessionRoot: root,
    projectRoot: mainRoot,
    projectRoots: [mainRoot, financeRoot],
    registerMedia: () => null,
    onChange: () => {},
  });
  try {
    const sessions = await store.listSessions();
    assert.deepEqual(new Set(sessions.map((session) => session.cwd)), new Set([mainRoot, financeRoot]));
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("JSONL preserves internal identity and links commentary/final to enclosing protocol turn", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'negus-turn-identity-'));
  t.after(() => rm(root, {recursive:true,force:true}));
  const threadId='00000000-0000-4000-8000-000000000091';
  const turn='01a17bed-protocol';
  const lines=[
    {type:'session_meta',payload:{id:threadId,cwd:root}},
    {type:'event_msg',payload:{type:'task_started',turn_id:turn}},
    ...['commentary','final_answer'].map((phase,i)=>({timestamp:`2026-10-27T05:56:${i ? '25.045' : '00.434'}Z`,type:'response_item',payload:{type:'message',id:`reply-${i}`,role:'assistant',phase,content:[{type:'output_text',text:phase}],internal_chat_message_metadata_passthrough:{turn_id:'4840b54c-internal'}}})),
    {type:'event_msg',payload:{type:'task_complete',turn_id:turn}},
  ];
  await writeFile(path.join(root,`rollout-${threadId}.jsonl`),lines.map(JSON.stringify).join('\n')+'\n');
  const store=createJsonlConversationStore({sessionRoot:root,projectRoot:root,registerMedia:()=>null,onChange:()=>{}});
  t.after(()=>store.close());
  const session=await store.findSession(threadId);
  assert.equal(session.messages.length,2);
  for(const message of session.messages){
    assert.equal(message.turnId,'4840b54c-internal');
    assert.equal(message.protocolTurnId,turn);
    assert.equal(message.turnStatus,'completed');
  }
});

test('no-reply history evidence requires task_complete and survives reloading', async (t) => {
  const root=await mkdtemp(path.join(os.tmpdir(),'negus-no-reply-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const threadId='00000000-0000-4000-8000-000000000092';
  const file=path.join(root,`rollout-${threadId}.jsonl`);
  const lines=[{type:'session_meta',payload:{id:threadId,cwd:root}},
    {type:'event_msg',payload:{type:'task_started',turn_id:'empty'}},
    {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'hello'}]}}];
  await writeFile(file,lines.map(JSON.stringify).join('\n')+'\n');
  const make=()=>createJsonlConversationStore({sessionRoot:root,projectRoot:root,registerMedia:()=>null,onChange:()=>{}});
  let store=make();
  try {
    assert.equal((await store.findSession(threadId)).messages[0].turnHasFinalAnswer,undefined);
    const {appendFile}=await import('node:fs/promises');
    await appendFile(file,JSON.stringify({type:'event_msg',payload:{type:'task_complete',turn_id:'empty'}})+'\n');
    for(let mount=0;mount<2;mount++) {
      const message=(await store.findSession(threadId)).messages[0];
      assert.equal(message.turnStatus,'completed');assert.equal(message.turnHasFinalAnswer,false);
      store.close();store=make();
    }
  } finally {store.close();}
});
