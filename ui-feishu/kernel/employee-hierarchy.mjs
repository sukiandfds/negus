// The employee graph is deliberately kept separate from routing.  Routing
// decides who owns a user message; this module decides who that owner may ask
// to do work.  A task may only move down one edge in this graph.

export const DEFAULT_EMPLOYEE_DELEGATIONS = Object.freeze({
  'negus-assistant': Object.freeze(['manager', 'researcher', 'developer', 'reviewer', 'grok']),
  manager: Object.freeze(['researcher', 'developer', 'reviewer', 'grok']),
  developer: Object.freeze(['researcher', 'reviewer']),
  researcher: Object.freeze(['grok']),
  reviewer: Object.freeze([]),
  grok: Object.freeze([]),
});

const clean = value => String(value ?? '').trim();

const hierarchyError = (message, code) => Object.assign(new Error(message), {
  statusCode: 400,
  code,
});

const entriesFrom = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(item => [item?.parentId || item?.from, item?.children || item?.to || item?.childId]);
  if (value instanceof Map) return [...value.entries()];
  return Object.entries(value);
};

const listIds = value => Array.isArray(value) ? value : value == null ? [] : [value];

const graphHasCycle = graph => {
  const visiting = new Set();
  const visited = new Set();
  const visit = id => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const child of graph.get(id) || []) if (visit(child)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...graph.keys()].some(visit);
};

/**
 * Build and validate the employee delegation DAG.
 *
 * `hierarchy` accepts either { parentId: [childId] } or an array of
 * { parentId, childId/children } records.  Definitions may also carry a
 * `delegatesTo` array.  Missing built-in employees are ignored so a room may
 * contain a subset of the built-in roster.
 */
export function createEmployeeHierarchy({ employees = [], hierarchy = null } = {}) {
  const definitions = Array.isArray(employees) ? employees : [];
  const ids = new Set(definitions.map(employee => clean(employee?.id)).filter(Boolean));
  if (!ids.size) throw hierarchyError('员工层级图不能为空', 'employee_hierarchy_empty');

  const graph = new Map([...ids].map(id => [id, new Set()]));
  const add = (parent, children, strict = false) => {
    parent = clean(parent);
    if (!ids.has(parent)) {
      if (strict && parent) throw hierarchyError(`层级图中的员工不存在：${parent}`, 'employee_unknown');
      return;
    }
    for (const childValue of listIds(children)) {
      const child = clean(childValue);
      if (!ids.has(child)) {
        if (strict && child) throw hierarchyError(`层级图中的员工不存在：${child}`, 'employee_unknown');
        continue;
      }
      graph.get(parent).add(child);
    }
  };

  const explicit = hierarchy != null;
  if (explicit) {
    for (const [parent, children] of entriesFrom(hierarchy)) add(parent, children, true);
  } else {
    // Definitions are allowed to override the built-in graph.  This keeps the
    // graph inspectable in employee.json while retaining a safe default.
    // A room may contain only a subset of the global roster.  Definitions can
    // therefore mention employees that are absent from this room; those edges
    // are filtered here, while an explicitly supplied hierarchy remains strict.
    for (const employee of definitions) add(employee?.id, employee?.delegatesTo || employee?.children);
    const hasDefinitionGraph = definitions.some(employee => Array.isArray(employee?.delegatesTo) || Array.isArray(employee?.children));
    if (!hasDefinitionGraph) {
      for (const [parent, children] of Object.entries(DEFAULT_EMPLOYEE_DELEGATIONS)) add(parent, children);
    }
  }

  // Lightweight fixtures and newly-created employees still need a deterministic
  // hierarchy.  Put otherwise-unconnected unknown employees under the first
  // employee, preserving the long-standing two-employee test setup (a -> b)
  // without granting arbitrary peer-to-peer delegation.
  const hasDefinitionGraph = definitions.some(employee => Array.isArray(employee?.delegatesTo) || Array.isArray(employee?.children));
  if (!explicit && !hasDefinitionGraph && ![...graph.values()].some(children => children.size)) {
    const [root, ...rest] = definitions;
    for (const employee of rest) add(root?.id, employee?.id);
  }
  if (graphHasCycle(graph)) throw hierarchyError('员工层级图包含环路', 'employee_hierarchy_cycle');

  const assertKnown = id => {
    id = clean(id);
    if (!ids.has(id)) throw hierarchyError(`员工不存在：${id || '(空)'}`, 'employee_unknown');
    return id;
  };
  const assertCanDelegate = (parentId, childId) => {
    const parent = assertKnown(parentId);
    const child = assertKnown(childId);
    if (parent === child) throw hierarchyError('员工不能向自己委派任务', 'employee_self_delegation');
    if (!graph.get(parent)?.has(child)) {
      throw hierarchyError(`只能向直属下属委派任务：${parent} -> ${child}`, 'employee_not_direct_report');
    }
    return { parentId: parent, childId: child };
  };
  return {
    ids: () => [...ids],
    childrenOf: parentId => {
      const parent = assertKnown(parentId);
      return [...(graph.get(parent) || [])];
    },
    canDelegate: (parentId, childId) => {
      try { assertCanDelegate(parentId, childId); return true; } catch { return false; }
    },
    assertKnown,
    assertCanDelegate,
    graph: () => Object.fromEntries([...graph].map(([parent, children]) => [parent, [...children]])),
  };
}

export function assertEmployeeHierarchyAcyclic(hierarchy) {
  if (!hierarchy || typeof hierarchy.graph !== 'function') throw new TypeError('需要员工层级图');
  // createEmployeeHierarchy performs the check before returning; this helper is
  // useful to callers that only need a named validation operation.
  return hierarchy.graph();
}
