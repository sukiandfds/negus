import assert from "node:assert/strict";
import test from "node:test";
import { messagesFromTurns } from "../server/codex-thread-history.mjs";

test("steered replies retain item order without borrowing the final reply timestamp", () => {
  const messages = messagesFromTurns([{id:"steered",startedAt:100,completedAt:200,status:"completed",items:[
    {type:"userMessage",id:"u1",content:[{type:"text",text:"First"}]},
    {type:"agentMessage",id:"a1",text:"Earlier answer"},
    {type:"userMessage",id:"u2",createdAt:150,content:[{type:"text",text:"Correction"}]},
    {type:"agentMessage",id:"a2",text:"Final answer"},
  ]}]);
  assert.deepEqual(messages.map((m)=>m.turnItemIndex),[0,1,2,3]);
  assert.equal(messages[1].createdAt,undefined);
  assert.equal(messages[1].superseded,true);
  assert.equal(messages[3].superseded,false);
  assert.equal(messages[3].createdAt,new Date(200000).toISOString());
});

test("scopes app-server message ids to their turn", () => {
  const messages = messagesFromTurns([
    {
      id: "turn-1",
      startedAt: 100,
      completedAt: 130,
      items: [
        { type: "userMessage", id: "item-1", content: [{ type: "text", text: "First" }] },
        { type: "agentMessage", id: "item-2", phase: "final_answer", text: "Answer one" },
      ],
    },
    {
      id: "turn-2",
      startedAt: 200,
      completedAt: 230,
      items: [
        { type: "userMessage", id: "item-1", content: [{ type: "text", text: "Second" }] },
        { type: "agentMessage", id: "item-2", phase: "final_answer", text: "Answer two" },
      ],
    },
  ]);

  const ids = messages.map((message) => message.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.notEqual(ids[0], ids[2]);
  assert.notEqual(ids[1], ids[3]);
  assert.deepEqual(messages.map((message) => message.turnId), ["turn-1", "turn-1", "turn-2", "turn-2"]);
});

test("renders completed Negus Image MCP outputs once and keeps the final answer", () => {
  const registered = [];
  const messages = messagesFromTurns([{
    id: "turn-image",
    startedAt: 100,
    completedAt: 130,
    items: [
      { type: "userMessage", id: "user-image", content: [{ type: "text", text: "Create a 4K image" }] },
      {
        type: "mcpToolCall",
        id: "tool-image",
        server: "negus_image",
        tool: "generate_image",
        status: "completed",
        result: {
          structuredContent: {
            outputs: [{ path: "D:\\demo\\generated.png", width: 3840, height: 1632 }],
          },
        },
      },
      {
        type: "agentMessage",
        id: "answer-image",
        phase: "final_answer",
        text: "Done. ![generated](D:\\demo\\generated.png)",
      },
    ],
  }], (file) => {
    registered.push(file);
    return { id: "media-image", url: "/api/media/media-image?w=3840&h=1632" };
  });

  assert.equal(messages.length, 3);
  assert.deepEqual(messages[1].blocks.map((block) => block.type), ["image"]);
  assert.equal(messages[1].blocks[0].source, "/api/media/media-image?w=3840&h=1632");
  assert.equal(messages[1].blocks[0].width, 3840);
  assert.equal(messages[1].blocks[0].height, 1632);
  assert.equal(messages[2].text, "Done.");
  assert.equal(registered.length, 2);
});
