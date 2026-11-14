import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmployeeHierarchy } from '../kernel/employee-hierarchy.mjs';

const employees = ['negus-assistant', 'manager', 'researcher', 'developer', 'reviewer', 'grok']
  .map(id => ({ id }));

test('built-in employee graph only permits direct reports', () => {
  const hierarchy = createEmployeeHierarchy({ employees });
  assert.deepEqual(hierarchy.childrenOf('manager'), ['researcher', 'developer', 'reviewer', 'grok']);
  assert.equal(hierarchy.canDelegate('developer', 'grok'), false);
  assert.throws(() => hierarchy.assertCanDelegate('developer', 'grok'), /直属下属/);
  assert.throws(() => hierarchy.assertCanDelegate('researcher', 'researcher'), /自己/);
  assert.throws(() => hierarchy.assertCanDelegate('missing', 'grok'), /员工不存在/);
});

test('explicit hierarchy rejects cycles before accepting tasks', () => {
  assert.throws(() => createEmployeeHierarchy({
    employees: [{ id: 'a' }, { id: 'b' }],
    hierarchy: { a: ['b'], b: ['a'] },
  }), /环路/);
});

