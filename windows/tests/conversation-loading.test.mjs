import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import ts from "../../web-ui/node_modules/typescript/lib/typescript.js";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const mergeUrl = moduleUrl(compile(await fs.readFile(new URL("../../web-ui/src/features/conversations/state/conversationMerge.ts", import.meta.url), "utf8")));
const source = compile(await fs.readFile(new URL("../../web-ui/src/features/conversations/hooks/useConversationSession.ts", import.meta.url), "utf8"));
const detail = (threadId) => ({ threadId, messages: [{ id: `${threadId}-message`, role: "user", text: threadId }], contentVersion: 1 });

async function harness(cachedSessions = [], partialSessionIds = []) {
  const slots = []; let cursor = 0; const pending = [];
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback(fn) { return fn; }, useEffect() {},
  };
  const api = { session(id, options, signal) { return new Promise((resolve, reject) => pending.push({ id, options, signal, resolve, reject })); } };
  const key = `__loadingTest${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { hooks, api };
  const rewritten = source.replace(/import .* from "react";/, `const {useState,useRef,useCallback,useEffect}=globalThis.${key}.hooks;`)
    .replace(/import .* from "\.\.\/data\/conversationApi";/, `const conversationApi=globalThis.${key}.api;`)
    .replace('"../state/conversationMerge"', JSON.stringify(mergeUrl));
  const { useConversationSession } = await import(moduleUrl(rewritten));
  delete globalThis[key];
  globalThis.window = { location: { search: "", pathname: "/" }, history: { replaceState() {} }, setTimeout, clearTimeout };
  const initial = { selectedId: "a", session: cachedSessions.find((s) => s.threadId === "a") || null, cachedSessions, partialSessionIds, sessionIsPartial: false };
  const render = () => { cursor = 0; return useConversationSession(initial); };
  return { render, pending };
}

test("prefetch warms a conversation without replacing the visible conversation", async () => {
  const h = await harness([detail("a")]);
  const loading = h.render().loadSession("b", { prefetch: true });
  assert.equal(h.pending.length, 1);
  assert.equal(h.render().session.threadId, "a");
  assert.equal(h.render().loadingSession, false);
  h.pending[0].resolve(detail("b")); await loading;
  h.render().selectSession("b");
  assert.equal(h.render().session.threadId, "b");
  assert.equal(h.render().loadingSession, false);
  h.pending[1].resolve(detail("b"));
});

test("late response for previous selection only warms cache and cannot replace new selection", async () => {
  const h = await harness([detail("a")]);
  const first = h.render().loadSession("a");
  h.render().selectSession("b");
  assert.equal(h.pending[0].signal.aborted, false);
  h.pending[0].resolve(detail("a")); await first;
  assert.equal(h.render().selectedId, "b");
  assert.equal(h.render().session, null);
  h.pending[1].resolve(detail("b")); await new Promise(setImmediate);
  assert.equal(h.render().session.threadId, "b");
});

test("adopting a persisted partial cache forces full-page recovery", async () => {
  const h = await harness([detail("a"), detail("b")], ["b"]);
  const loading = h.render().adoptSelection("b", true);
  assert.equal(h.pending[0].options.contentVersion, undefined);
  assert.equal(h.render().session.threadId, "b");
  h.pending[0].resolve(detail("b")); await loading;
});

test("failed background prefetch leaves the selected conversation and its error unchanged", async () => {
  const h = await harness([detail("a")]);
  const loading = h.render().loadSession("b", { prefetch: true, retry: false });
  h.pending[0].reject(new Error("offline")); await loading;
  assert.equal(h.render().session.threadId, "a");
  assert.equal(h.render().sessionError, "");
});

test("selecting an in-flight prefetch immediately clears previous error and shows loading", async () => {
  const h = await harness([detail("a")]);
  const failed = h.render().loadSession("a", { retry: false });
  h.pending[0].reject(new Error("previous conversation offline")); await failed;
  const prefetch = h.render().loadSession("b", { prefetch: true, retry: false });
  h.render().selectSession("b");
  assert.equal(h.render().session, null);
  assert.equal(h.render().loadingSession, true);
  assert.equal(h.render().sessionError, "");
  // Clear selection before completion so no redundant follow-up is scheduled.
  h.render().clearSelection();
  h.pending[1].resolve(detail("b")); await prefetch;
});

const groupSource = compile(await fs.readFile(new URL("../../web-ui/src/features/group-chat/hooks/useGroupRoom.ts", import.meta.url), "utf8"));
const groupMessageUrl = moduleUrl(compile(await fs.readFile(new URL("../../web-ui/src/features/group-chat/data/groupMessageState.ts", import.meta.url), "utf8")));
const groupSnapshotUrl = moduleUrl(compile(await fs.readFile(new URL("../../web-ui/src/features/group-chat/data/groupSnapshot.ts", import.meta.url), "utf8"))
  .replace('"./groupMessageState"', JSON.stringify(groupMessageUrl)));
const groupSnapshot = (id, text = id) => ({ room: { id }, messages: [{ id: `${id}-message`, text, sequence: 1 }], agents: [], members: [] });
const groupPage = (text) => ({ messages: [{ id: text, text, sequence: 1 }], found: true, hasOlder: false, hasNewer: false, oldestSequence: 1, newestSequence: 1 });

async function groupHarness() {
  const slots = []; let cursor = 0; const pending = [];
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === "function" ? value() : value; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useCallback(fn) { return fn; }, useEffect() {},
  };
  const api = Object.fromEntries(["snapshot", "messages"].map((kind) => [kind, (id, ...args) => new Promise((resolve, reject) => pending.push({ kind, id, args, resolve, reject }))]));
  const key = `__groupLoadingTest${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { hooks, api };
  const rewritten = groupSource.replace(/import .* from "react";/, `const {useState,useRef,useCallback,useEffect}=globalThis.${key}.hooks;`)
    .replace(/import .* from ".*clientId";/, 'const createClientId=()=>"test";')
    .replace(/import .* from ".*groupMemberStorage";/, 'const readStoredMember=()=>null,writeStoredMember=()=>{},createMemberId=()=>"test";')
    .replace(/import .* from ".*groupApi";/, `const groupApi=globalThis.${key}.api;`)
    .replace('"../data/groupMessageState"', JSON.stringify(groupMessageUrl))
    .replace('"../data/groupSnapshot"', JSON.stringify(groupSnapshotUrl))
    .replace(/import .* from ".*useGroupEvents";/, 'const useGroupEvents=()=>({});');
  const { useGroupRoom } = await import(moduleUrl(rewritten));
  delete globalThis[key];
  const storage = new Map([["negus-group-snapshot-v1", JSON.stringify(groupSnapshot("current-project"))]]);
  globalThis.window = { localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, setTimeout, clearTimeout };
  const render = () => { cursor = 0; return useGroupRoom(); };
  return { render, pending };
}

test("late group history cannot replace the new room or finish its history request", async () => {
  const h = await groupHarness();
  const old = h.render().jumpToDate("2026-09-01");
  h.render().selectRoom("b");
  const version = h.render().historyNavigation.version;
  const current = h.render().loadOlder();
  assert.equal(h.pending[0].args[1].aborted, true);
  h.pending[0].resolve(groupPage("old-room")); await old;
  assert.equal(h.render().snapshot, null);
  assert.equal(h.render().historyLoading, true);
  assert.equal(h.render().historyNavigation.version, version);
  h.pending[1].resolve(groupPage("new-room")); await current;
  assert.equal(h.render().historyLoading, false);
});

test("group refresh response stays obsolete after switching away and back", async () => {
  const h = await groupHarness();
  const old = h.render().refresh();
  h.render().selectRoom("b"); h.render().selectRoom("current-project");
  h.pending[0].resolve(groupSnapshot("current-project", "stale")); await old;
  assert.equal(h.render().snapshot.messages[0].text, "current-project");
  const first = h.render().refresh(); const second = h.render().refresh();
  h.pending[2].resolve(groupSnapshot("current-project", "newest")); await second;
  h.pending[1].resolve(groupSnapshot("current-project", "older")); await first;
  assert.equal(h.render().snapshot.messages[0].text, "newest");
});

test("failed old group history does not leak an error into the selected room", async () => {
  const h = await groupHarness();
  const old = h.render().loadOlder();
  h.render().selectRoom("b"); h.render();
  h.pending[0].reject(new Error("old room offline")); await old;
  assert.equal(h.render().error, "");
  assert.equal(h.render().historyLoading, false);
});

test("quick group switches preserve a just-loaded snapshot before debounce persistence", async () => {
  const h = await groupHarness();
  const update = h.render().refresh();
  h.pending[0].resolve(groupSnapshot("current-project", "updated")); await update;
  h.render().selectRoom("b"); h.render().selectRoom("current-project");
  assert.equal(h.render().snapshot.messages[0].text, "updated");
  assert.equal(h.render().loading, false);
});

test("group switch cancels the old frame and new-room deltas still paint; closed sources cannot mutate state", async () => {
  const source = compile(await fs.readFile(new URL("../../web-ui/src/features/group-chat/realtime/useGroupEvents.ts", import.meta.url), "utf8"));
  const slots = []; let cursor = 0; let effect; let cleanup; let frameId = 0;
  const frames = new Map(); const sources = [];
  const hooks = {
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = value; return [slots[index], (next) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }]; },
    useRef(value) { const index = cursor++; return slots[index] ||= { current: value }; },
    useEffect(fn) { effect = fn; },
  };
  const key = `__groupEventsTest${Math.random().toString(36).slice(2)}`;
  globalThis[key] = { hooks };
  const rewritten = source.replace(/import .* from "react";/, `const {useState,useRef,useEffect}=globalThis.${key}.hooks;`)
    .replace(/import .* from ".*groupApi";/, 'const groupApi={eventsUrl:()=>"/events"};')
    .replace('"../data/groupMessageState"', JSON.stringify(groupMessageUrl))
    .replace('"../data/groupSnapshot"', JSON.stringify(groupSnapshotUrl));
  const { useGroupEvents } = await import(moduleUrl(rewritten));
  delete globalThis[key];
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousEventSource = globalThis.EventSource;
  globalThis.EventSource = class { constructor() { sources.push(this); } close() {} };
  globalThis.window = {
    addEventListener() {}, removeEventListener() {}, setTimeout, clearTimeout,
    requestAnimationFrame(fn) { frames.set(++frameId, fn); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); },
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  let snapshot = groupSnapshot("a");
  const setSnapshot = (next) => { snapshot = typeof next === "function" ? next(snapshot) : next; };
  const render = (room) => { cursor = 0; return useGroupEvents(setSnapshot, room); };
  const delta = (room, text) => ({ data: JSON.stringify({ type: "group_agent_delta", roomId: room, workId: `${room}-work`, agentId: "agent", itemId: "item", delta: text }) });
  try {
    render("a"); cleanup = effect();
    sources[0].onmessage(delta("a", "old"));
    assert.equal(frames.size, 1);
    cleanup();
    assert.equal(frames.size, 0);
    snapshot = groupSnapshot("b");
    render("b"); cleanup = effect();
    sources[1].onopen();
    sources[0].onerror();
    sources[0].onmessage(delta("a", "must be ignored"));
    assert.equal(render("b").connected, true);
    assert.equal(snapshot.messages.some((message) => message.workId === "a-work"), false);
    sources[1].onmessage(delta("b", "new"));
    assert.equal(frames.size, 1);
    for (const fn of frames.values()) fn(); frames.clear();
    assert.equal(render("b").streaming["b-work"].text, "new");
  } finally {
    cleanup?.();
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.EventSource = previousEventSource;
  }
});
