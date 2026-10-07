import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAppServerClient } from '../../windows/server/app-server-client.mjs';
import { createAppServerConversationStore } from '../../windows/server/app-server-conversation-store.mjs';
import { createProviderConversationStore } from '../../windows/server/provider-conversation-store.mjs';
import { createJsonlConversationStore } from '../../windows/server/jsonl-conversation-store.mjs';
import { createConversationService } from '../../windows/server/conversation-service.mjs';
import { createModelProviderService } from '../../windows/server/model-provider-service.mjs';
import { readCurrentApiConfiguration } from '../../windows/server/current-api-configuration.mjs';

const installationRoot = fileURLToPath(new URL('../../', import.meta.url));
const readJson = async (file, fallback) => {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
};
export async function existingProjects(currentRoot) {
  if (path.resolve(currentRoot) === path.resolve(installationRoot)) return [];
  const state = await readJson(path.join(installationRoot, 'runtime/project-identities.json'), { projects: [] });
  return state.projects.filter(project => ['personal', 'business'].includes(project.kind) && project.root && project.root !== currentRoot)
    .map(project => ({ key: project.key, name: project.name, root: project.root, provider: project.provider || 'codex' }));
}

// Keep original histories and provider routes in their owning stores; never copy or recreate a chat.
export function combineConversations(current, previous, previousIds) {
  const currentIds = new Set();
  const select = id => !currentIds.has(id) && previousIds.has(id) ? previous : current;
  const result = { ...current,
    listSessions: async (...args) => {
      const [recent, older] = await Promise.all([current.listSessions(...args), previous.listSessions(...args)]);
      for (const item of recent) currentIds.add(item.threadId);
      for (const item of older) previousIds.add(item.threadId);
      return [...new Map([...older, ...recent].map(item => [item.threadId, item])).values()]
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    },
    close: () => { current.close(); previous.close(); },
  };
  for (const method of Object.keys(current)) {
    if (['listSessions', 'createSession', 'listModels', 'close'].includes(method) || typeof current[method] !== 'function') continue;
    result[method] = async (id, ...args) => {
      const owner = select(id);
      const value = await owner[method](id, ...args);
      if (method === 'forkSession' && owner === previous && value?.threadId) previousIds.add(value.threadId);
      return value;
    };
  }
  return result;
}

export async function withExistingConversations(current, options) {
  const projects = await existingProjects(options.projectRoot);
  if (!projects.length) return current;
  const home = path.join(os.homedir(), '.codex');
  const routesFile = path.join(installationRoot, 'runtime/conversation-provider-routes.json');
  const routes = await readJson(routesFile, {});
  const previousIds = new Set(Object.keys(routes));
  const clients = createAppServerClient({ codexHome: home, workingDirectory: installationRoot, label: 'existing-projects' });
  const providers = createModelProviderService({ projectRoot: installationRoot, defaultClient: clients,
    currentApiConfiguration: () => readCurrentApiConfiguration(home) });
  const prepareResumeFile = providers.prepareResumeFile;
  providers.prepareResumeFile = (id, info) => id === 'current' ? Promise.resolve(info) : prepareResumeFile(id, info);
  const histories = new Map();
  let currentStore;
  const historyFor = id => {
    if (!histories.has(id)) histories.set(id, createJsonlConversationStore({
      sessionRoot: path.join(id === 'current' ? home : path.join(installationRoot, 'runtime/model-providers', id, 'codex-home'), 'sessions'),
      projectRoot: installationRoot, projectRoots: projects.map(project => project.root), registerMedia: options.registerMedia,
      onChange: options.onAutoTitleChanged ? event => options.onAutoTitleChanged(event.threadId) : () => {},
    }));
    return histories.get(id);
  };
  const listHistory = async (...args) => {
    const savedRoutes = await readJson(routesFile, {});
    const ids = new Set(['current', ...Object.values(savedRoutes).map(route => route.providerId).filter(Boolean)]);
    const lists = await Promise.all([...ids].map(id => historyFor(id).listSessions(...args)));
    const nativeSessions = currentStore ? await currentStore.listSessions(...args).catch(() => []) : [];
    const sessions = new Map([...lists.flat(), ...nativeSessions].map(session => [session.threadId, session]));
    for (const [id, route] of Object.entries(savedRoutes)) {
      const session = sessions.get(id) || route.summary;
      if (!session || Boolean(session.archived) !== Boolean(args[1])) continue;
      sessions.set(id, { ...session, title: route.manualTitle || session.title,
        cwd: session.cwd || route.resumeInfo?.cwd,
        modelProviderId: route.pendingProviderId || route.providerId || 'current' });
    }
    for (const id of sessions.keys()) previousIds.add(id);
    return [...sessions.values()];
  };
  await Promise.all([listHistory('all', false), listHistory('all', true)]);
  const makeStore = (client, id) => createAppServerConversationStore({ ...options, client,
    projectRoot: installationRoot, projectRoots: projects.map(project => project.root),
    threadRuntimeOptions: async () => null,
    autoTitleStateFile: path.join(installationRoot, 'runtime/conversation-display-titles.json'),
    historyFallback: (...args) => historyFor(id).findSession(...args),
    onProtocolMessage: event => { options.onProtocolMessage?.(event); void native.handleProtocolMessage(event); },
  });
  currentStore = makeStore(clients, 'current');
  const native = createProviderConversationStore({ current: currentStore, providers, stateFile: routesFile, createStore: makeStore });
  const service = createConversationService({ primary: native, fallback: {
    listSessions: listHistory,
    findSession: async (...args) => {
      for (const history of histories.values()) { const session = await history.findSession(...args); if (session) return session; }
      return null;
    }, close: () => { for (const history of histories.values()) history.close(); providers.close(); },
  } });
  // Provider histories stay local during listing; only opening a chat starts that provider.
  return combineConversations(current, { ...service, listSessions: listHistory }, previousIds);
}
