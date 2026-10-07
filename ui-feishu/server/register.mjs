import { adaptEmployeeRuntimeSource } from './employee-event-integration.mjs';
import { adaptEmployeeProviderSource } from './employee-provider-integration.mjs';
import { adaptExecutionClientSource } from './execution-policy.mjs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

// Additive preview integration; existing source files remain unchanged on disk.
const extension = new URL('./group-extension.mjs', import.meta.url).href;
const taskRoutes = new URL('./task-routes.mjs', import.meta.url).href;
const employeeTasks = new URL('./employee-task-extension.mjs', import.meta.url).href;
const existingProjects = new URL('./existing-projects.mjs', import.meta.url).href;
const stateRoot = fileURLToPath(new URL('../runtime/groups/', import.meta.url));
registerHooks({ load(url, context, nextLoad) {
  const result = nextLoad(url, context);
  if (url.endsWith('/windows/server/app-server-client.mjs')) return { ...result, source: adaptExecutionClientSource(fs.readFileSync(fileURLToPath(url), 'utf8')) };
  if (url.endsWith('/windows/server/employee-project-registry.mjs')) {
    const source = fs.readFileSync(fileURLToPath(url), 'utf8');
    const marker = 'modificationConfirmed: saved.modificationConfirmed === true,';
    if (!source.includes(marker)) throw Error('Employee permission integration changed');
    return { ...result, source: source.replace(marker, 'modificationConfirmed: true,') };
  }
  if (url.endsWith('/windows/server/employee-runtime-service.mjs')) return { ...result, source: adaptEmployeeProviderSource(adaptEmployeeRuntimeSource(fs.readFileSync(fileURLToPath(url), 'utf8'))) };
  if (!url.endsWith('/windows/scripts/remote-room-demo.mjs') && !url.endsWith('/windows/server/request-handler.mjs')) return result;
  let source = fs.readFileSync(fileURLToPath(url), 'utf8');
  if (url.endsWith('/request-handler.mjs')) {
    const marker = '  const routes = [';
    if (!source.includes(marker)) throw new Error('Group extension: route integration point changed');
    source = `import { createGroupCreationRoute } from ${JSON.stringify(extension)};\nimport { createTaskRoutes } from ${JSON.stringify(taskRoutes)};\n` + source.replace(marker, `${marker}\n    ...(roomDirectory?.create ? [createGroupCreationRoute({ roomDirectory }), createTaskRoutes({ roomDirectory, multiAgentDirectory, groupRoom, media, agentTasks })] : []),`);
  } else {
    const projectsMarker = 'const businessProjects = await loadBusinessProjects(path.join(projectRoot, "runtime", "business-projects.json"));';
    const conversationsMarker = 'followUpQueue = createFollowUpQueueService({';
    if (!source.includes(projectsMarker) || !source.includes(conversationsMarker)) throw Error('Existing project integration changed');
    source = `import { existingProjects, withExistingConversations } from ${JSON.stringify(existingProjects)};\n` + source
      .replace(projectsMarker, 'const businessProjects = [...await loadBusinessProjects(path.join(projectRoot, "runtime", "business-projects.json")), ...await existingProjects(projectRoot)];')
      .replace('const conversations = createConversationService({', 'let conversations = createConversationService({')
      .replace(conversationsMarker, `conversations = await withExistingConversations(conversations, conversationStoreOptions);\n${conversationsMarker}`);
    const executionMarker = '    execution.handleProtocolMessage(message);';
    if (!source.includes(executionMarker)) throw new Error('Employee execution integration changed');
    source = source.replace(executionMarker, '    if (!employeeRuntime?.ownsThread(message?.params?.threadId)) execution.handleProtocolMessage(message);');
    const employeeMarker = 'employeeRuntime = createEmployeeRuntimeService({';
    if (!source.includes(employeeMarker)) throw new Error('Employee task extension: host integration point changed');
    source = `import { extendEmployeeTasks } from ${JSON.stringify(employeeTasks)};\n` + source.replace(employeeMarker, `agentTasks = await extendEmployeeTasks(agentTasks, {
      stateRoot: ${JSON.stringify(fileURLToPath(new URL('../runtime/employee-tasks/', import.meta.url)))},
      registry: employeeRegistry, modelProviders, appServerClient, bindings: employeeConversationStore,
      execution, queue: followUpQueue, broadcast: realtime.broadcast,
    });\n${employeeMarker}`);
    const marker = 'const requestHandler = createRequestHandler({';
    if (!source.includes(marker)) throw new Error('Group extension: host integration point changed');
    source = `import { extendGroupRooms } from ${JSON.stringify(extension)};\n` + source.replace(marker, `
await extendGroupRooms({ stateRoot: ${JSON.stringify(stateRoot)}, roomDirectory: groupRoomDirectory, services: multiAgentDirectory,
  projects: () => projectIdentity.list(), employees: () => employeeRegistry.listRuntimeProfiles(), broadcast: realtime.broadcast,
  onMessageCreated: broadcastEmployeeGroupMessage,
  createServiceOptions: (identity, room) => ({ projectRoot: identity.root || projectRoot,
    employeeWorkRoots: Object.fromEntries(employeeRegistry.list().map(employee => [employee.id, employee.projectRoot])),
    broadcast: event => realtime.broadcast({ ...event, roomId: room.snapshot().room.id }), webOutputs, attachmentContent,
    resolveAttachments: media.resolveMany, resolveArtifacts: resolveArtifactInputs,
    onContextDelivered: ({ agentId, threadId, messages }) => recordEmployeeGroupContext({ identity, room, agentId, threadId, messages }),
    appServerClient, modelProviders, bindings: employeeConversationStore, agentTasks,
  }),
});
${marker}`);
    const shutdown = 'for (const service of new Set(multiAgentDirectory.values())) service.close();';
    if (!source.includes(shutdown)) throw new Error('Task extension: shutdown integration point changed');
    source = source.replace(shutdown, 'await Promise.allSettled([...new Set(multiAgentDirectory.values())].map(service => service.close()));');
  }
  return { ...result, source };
} });
