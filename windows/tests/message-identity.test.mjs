import assert from "node:assert/strict";
import test from "node:test";
import { mergeIdentified } from "../server/message-identity.mjs";

const latest = (_, right) => right;
test("a late receipt joins the optimistic input and the protocol item even after employee attribution", () => {
  const local = { id: "optimistic-a", role: "user", submissionId: "a" };
  const remote = { id: "codex:1", role: "user", authorId: "employee" };
  const receipt = { ...remote, submissionId: "a" };
  assert.deepEqual(mergeIdentified([local, remote, receipt], latest), [receipt]);
});
test("a room keeps different authors' sends and different work items distinct", () => {
  const m = { clientMessageId: "a", authorId: "employee" };
  const rows = [m, { ...m, authorId: "human" }, { workId: "w", itemId: "x" }, { workId: "w" }];
  assert.deepEqual(mergeIdentified([...rows, ...rows], latest), rows);
});
