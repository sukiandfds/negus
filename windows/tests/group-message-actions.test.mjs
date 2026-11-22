import assert from "node:assert/strict";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createGroupRoomStore } from "../server/group-room-store.mjs";
import { createGroupRoutes } from "../server/routes/group-routes.mjs";

const manager = [{ id: "manager", name: "运营管理", responsibility: "协调" }];

async function roomIn(directory, id, agents = manager) {
  return createGroupRoomStore({
    stateFile: path.join(directory, `${id}.json`),
    project: "fixture",
    projectId: "project",
    roomId: id,
    agentDefinitions: agents,
    broadcast: () => {},
  });
}

async function serve(route) {
  const server = http.createServer(async (request, response) => {
    try {
      if (!(await route(request, response, new URL(request.url, "http://127.0.0.1")))) {
        response.writeHead(404);
        response.end();
      }
    } catch (error) {
      response.writeHead(error?.statusCode || 500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error?.message || String(error) }));
    }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}

test("edits only the caller's human message in place and preserves prior revisions", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-edit-"));
  const stateFile = path.join(directory, "source.json");
  const room = await createGroupRoomStore({
    stateFile,
    project: "fixture",
    projectId: "project",
    roomId: "source",
    agentDefinitions: manager,
    broadcast: () => {},
  });
  const original = await room.addMessage({ authorId: "member-1", authorName: "我", text: "原消息" });
  const other = await room.addMessage({ authorId: "member-2", authorName: "他人", text: "他人消息" });
  const agent = await room.addMessage({ type: "agent", authorId: "manager", authorName: "运营管理", agentId: "manager", text: "员工回复" });
  const route = createGroupRoutes({
    groupRoom: room,
    roomDirectory: { list: () => [room], require: id => id === "source" ? room : null },
    media: { resolveMany: () => [] },
    multiAgent: {},
    multiAgentDirectory: new Map(),
    webOutputs: { isRequest: () => false },
  });
  const { server, origin } = await serve(route);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await room.close();
    await fs.rm(directory, { recursive: true, force: true });
  });
  const edit = (body) => fetch(`${origin}/api/group/message`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const updatedResponse = await edit({
    roomId: "source",
    memberId: "member-1",
    authorName: "我",
    messageId: original.id,
    clientMessageId: original.clientMessageId,
    text: "修改后的消息",
  });
  const updated = await updatedResponse.json();
  assert.equal(updatedResponse.status, 200);
  assert.equal(updated.message.id, original.id);
  assert.equal(updated.message.sequence, original.sequence);
  assert.equal(updated.message.createdAt, original.createdAt);
  assert.equal(updated.message.text, "修改后的消息");
  assert.deepEqual(updated.message.editHistory.map(item => item.text), ["原消息"]);
  assert.equal(room.getMessage(other.id).text, "他人消息");
  assert.equal(room.getMessage(agent.id).text, "员工回复");

  const forbidden = await edit({ roomId: "source", memberId: "member-1", authorName: "我", messageId: other.id, text: "越权修改" });
  assert.equal(forbidden.status, 403);
  assert.equal(room.getMessage(other.id).text, "他人消息");

  const agentEdit = await edit({ roomId: "source", memberId: "member-1", authorName: "我", messageId: agent.id, text: "修改员工消息" });
  assert.equal(agentEdit.status, 404);
  assert.equal(room.getMessage(agent.id).text, "员工回复");

  const restored = await createGroupRoomStore({ stateFile, project: "fixture", projectId: "project", roomId: "source", agentDefinitions: manager, broadcast: () => {} });
  assert.equal(restored.getMessage(original.id).text, "修改后的消息");
  assert.equal(restored.getMessage(original.id).editHistory[0].text, "原消息");
  await restored.close();
});

test("forwards selected source messages to another permitted group without deleting history", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-forward-"));
  const source = await roomIn(directory, "source");
  const target = await roomIn(directory, "target");
  const archived = await roomIn(directory, "archived");
  const archivedSnapshot = archived.snapshot;
  archived.snapshot = () => {
    const snapshot = archivedSnapshot();
    return { ...snapshot, room: { ...snapshot.room, archived: true } };
  };
  const keep = await source.addMessage({ authorId: "member-2", authorName: "他人", text: "保留的旧消息" });
  const first = await source.addMessage({ authorId: "member-1", authorName: "我", text: "第一条" });
  const second = await source.addMessage({ type: "agent", authorId: "manager", authorName: "运营管理", agentId: "manager", text: "第二条" });
  let receives = 0;
  const targetService = {
    receive: async input => {
      receives += 1;
      return target.addMessageWithStatus({ ...input.message, clientMessageId: input.requestId });
    },
  };
  const roomDirectory = {
    list: () => [source, target, archived],
    require: id => ({ source, target, archived })[id],
  };
  const route = createGroupRoutes({
    groupRoom: source,
    roomDirectory,
    media: { resolveMany: () => [] },
    multiAgent: {},
    multiAgentDirectory: new Map([["target", targetService]]),
    webOutputs: { isRequest: () => false },
  });
  const { server, origin } = await serve(route);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.all([source.close(), target.close(), archived.close()]);
    await fs.rm(directory, { recursive: true, force: true });
  });
  const forward = (body) => fetch(`${origin}/api/group/forward`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId: "member-1", authorName: "我", sourceRoomId: "source", targetRoomId: "target", ...body }),
  });
  const body = { messageIds: [first.id, second.id], requestId: "forward-request-1" };

  const firstResponse = await forward(body);
  const firstResult = await firstResponse.json();
  assert.equal(firstResponse.status, 202);
  assert.equal(receives, 1);
  assert.equal(firstResult.targetRoomId, "target");
  const forwarded = target.snapshot().messages.find(message => message.type === "human");
  assert.equal(forwarded.authorId, "member-1");
  assert.match(forwarded.text, /来源：fixture 项目群/);
  assert.ok(forwarded.text.indexOf("第一条") < forwarded.text.indexOf("第二条"));
  assert.equal(source.getMessage(keep.id).text, "保留的旧消息");
  assert.equal(source.getMessage(first.id).text, "第一条");
  assert.equal(source.getMessage(second.id).text, "第二条");

  const retried = await (await forward(body)).json();
  assert.equal(retried.message.id, forwarded.id);
  assert.equal(receives, 1);
  const conflict = await forward({ ...body, messageIds: [keep.id] });
  assert.equal(conflict.status, 409);
  const archivedTarget = await forward({ ...body, targetRoomId: "archived", requestId: "forward-request-2" });
  assert.equal(archivedTarget.status, 409);
});

test("shares an employee reply only with groups where that employee is a member", async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "negus-group-share-"));
  const source = await roomIn(directory, "source");
  const target = await roomIn(directory, "target");
  const unrelated = await roomIn(directory, "unrelated", [{ id: "developer", name: "技术研发", responsibility: "开发" }]);
  const human = await source.addMessage({ authorId: "member-1", authorName: "我", text: "用户消息" });
  const agent = await source.addMessage({ type: "agent", authorId: "manager", authorName: "运营管理", agentId: "manager", text: "员工回复" });
  const roomDirectory = {
    list: () => [source, target, unrelated],
    require: id => ({ source, target, unrelated })[id],
  };
  const route = createGroupRoutes({
    groupRoom: source,
    roomDirectory,
    media: { resolveMany: () => [] },
    multiAgent: {},
    multiAgentDirectory: new Map(),
    webOutputs: { isRequest: () => false },
  });
  const { server, origin } = await serve(route);
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await Promise.all([source.close(), target.close(), unrelated.close()]);
    await fs.rm(directory, { recursive: true, force: true });
  });

  const targets = await (await fetch(`${origin}/api/group/share-targets?sourceRoomId=source&agentId=manager`)).json();
  assert.deepEqual(targets.rooms, [{ id: "target", name: "fixture 项目群" }]);
  const share = (body) => fetch(`${origin}/api/group/share`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const shared = await share({ sourceRoomId: "source", targetRoomId: "target", messageId: agent.id, requestId: "share-request-1" });
  assert.equal(shared.status, 201);
  const sharedMessage = (await shared.json()).message;
  assert.equal(sharedMessage.type, "agent");
  assert.equal(sharedMessage.authorId, "manager");
  assert.equal(sharedMessage.text, "员工回复");
  assert.equal(source.getMessage(agent.id).text, "员工回复");

  const duplicate = await share({ sourceRoomId: "source", targetRoomId: "target", messageId: agent.id, requestId: "share-request-1" });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).message.id, sharedMessage.id);
  const humanShare = await share({ sourceRoomId: "source", targetRoomId: "target", messageId: human.id, requestId: "share-request-2" });
  assert.equal(humanShare.status, 403);
  const unrelatedTarget = await share({ sourceRoomId: "source", targetRoomId: "unrelated", messageId: agent.id, requestId: "share-request-3" });
  assert.equal(unrelatedTarget.status, 403);
});
