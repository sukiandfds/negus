import test from 'node:test';
import assert from 'node:assert/strict';
import { createFollowUpQueueService } from '../server/follow-up-queue-service.mjs';
import { createConversationRoutes } from '../server/routes/conversation-routes.mjs';

test('queued assistant reports retain their native actor before and after dispatch; human metadata is ignored', async t => {
  const actor = { authorId: 'worker', authorName: '执行助手', displaySourceAgentId: 'worker' };
  const events = [];
  const queue = createFollowUpQueueService({ execution: { getStatus: () => ({ active: true, turnId: 'turn' }) },
    media: { resolveMany: () => [] }, conversations: { steerMessage: async () => {} },
    publishThreadEvent: (_, event) => events.push(event),
    sourceActorFor: (_, id) => id === 'native-report' ? actor : null });
  t.after(() => queue.close());
  const report = await queue.enqueue({ threadId: 'source', submissionId: 'queue-report', stableDispatchId: 'native-report', text: '报告' });
  assert.equal(report.authorName, actor.authorName);
  assert.equal(queue.list('source')[0].displaySourceAgentId, actor.authorId);
  const human = await queue.enqueue({ threadId: 'source', submissionId: 'human', text: '真人补充', ...actor });
  assert.equal(human.displaySourceAgentId, undefined);
  await queue.sendNow('source', report.id);
  const submitted = events.find(event => event.type === 'user_message_submitted');
  assert.equal(submitted.submissionId, 'native-report');
  assert.equal(submitted.displaySourceAgentId, actor.authorId);
});

const viewFixture = () => {
  let revision = 'native'; let actorRevision = 'actor-a'; let reads = 0;
  const route = createConversationRoutes({
    conversations: { getSourceRevision: async () => revision,
      findSession: async () => { reads++; return { threadId: 'thread', messages: [] }; },
      getGoal: async () => ({ goal: null }), getPendingUserInput: async () => null },
    execution: { getStatus: () => ({ phase: 'idle' }) }, followUpQueue: { list: () => [] },
    contextManagement: { load: async () => ({}) }, agentTasks: { actorRevisionFor: () => actorRevision } });
  return { setNative: value => { revision = value; }, setActor: value => { actorRevision = value; }, reads: () => reads,
    read: async previous => {
      let body;
      const response = { writeHead() {}, end: value => { body = JSON.parse(value); } };
      const url = new URL('http://localhost/api/session?threadId=thread&view=1');
      if (previous) url.searchParams.set('sourceRevision', previous);
      await route({ method: 'GET' }, response, url);
      return body;
    } };
};
test('actor changes refresh cached bodies while unchanged native and actor versions reuse them', async () => {
  const view = viewFixture();
  const first = await view.read();
  assert.equal((await view.read(first.sourceRevision)).session, null);
  view.setActor('actor-b');
  const changed = await view.read(first.sourceRevision);
  assert.ok(changed.session);
  assert.equal((await view.read(changed.sourceRevision)).session, null);
  assert.equal(view.reads(), 2);
});
test('actor identity alone cannot certify a cached body when its native version is unavailable', async () => {
  const view = viewFixture(); view.setNative(null);
  const first = await view.read();
  assert.equal(first.sourceRevision, null);
  assert.ok((await view.read(first.sourceRevision)).session);
  assert.equal(view.reads(), 2);
});
