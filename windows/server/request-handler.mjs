import { projectEvents } from './external-assistant/project-events.mjs';
import { scopedDispatch } from './external-assistant/dispatch.mjs';
import { externalRoutes } from './external-assistant/routes.mjs';
import { panelSignals } from './status-panel/resources.mjs';
import { createGroupCreationRoute } from "../../ui-feishu/server/group-extension.mjs";
import { createTaskRoutes } from "../../ui-feishu/server/task-routes.mjs";
import { secureInputRoute } from './routes/secret-input.mjs';
import { createConnectionRoutes } from './routes/connection-routes.mjs';
import { createImageSettingsRoutes } from "./routes/image-settings-routes.mjs";
import { createLynnWorkbenchRoutes } from "./routes/lynn-workbench-routes.mjs";
import { createConversationForwardRoutes } from "./routes/conversation-forward-routes.mjs";
import { createMaintenanceGate } from "./http/maintenance-gate.mjs";
import { authorized, rememberAuthorizedDevice } from "./http/access-control.mjs";
import { sendJson } from "./http/request-utils.mjs";
import { createArtifactRoutes } from "./routes/artifact-routes.mjs";
import { createConversationRoutes } from "./routes/conversation-routes.mjs";
import { createFollowUpQueueRoutes } from "./routes/follow-up-queue-routes.mjs";
import { createGroupRoutes } from "./routes/group-routes.mjs";
import { createSystemRoutes } from "./routes/system-routes.mjs";
import { createUsageRoutes } from "./routes/usage-routes.mjs";
import { createVersionRoutes } from "./routes/version-routes.mjs";
import { createAgentPublicationRoutes } from "./routes/agent-publication-routes.mjs";
import { createEmployeeRoutes } from "./routes/employee-routes.mjs";
import { createEmployeeProjectDirectoryRoutes } from "./routes/employee-project-directory-routes.mjs";
import { createEmployeeGrowthRoutes } from "./routes/employee-growth-routes.mjs";
import { createProjectReviewRoutes } from "./routes/project-review-routes.mjs";
import { createDesktopAutomationReader } from "./desktop-automations.mjs";
import { createModelDefaultsStore } from './model-defaults-store.mjs';
import path from 'node:path';

export const createRequestHandler = ({
  museMessages, token, project, projectRoot, device, observerPort, conversations, execution, media, realtime, submissions,
  conversationForward, followUpQueue, contextManagement, groupRoom, roomDirectory, multiAgent, multiAgentDirectory, artifacts, webOutputs, fushengUsage, readWebVersion, serveStatic,
  agentConversationStore, agentPublicationService,
  employeeRuntime, employeeProjectDirectory, employeeGrowth, modelProviders, projectActivityIndex, projectStatus, agentTasks,
}) => {
  const readAutomations = createDesktopAutomationReader();
  const connectPanel=panelSignals({readAutomations,agentTasks});
  const externalEvents = modelProviders?.modelEvents?.events || projectEvents(projectRoot);
  const modelDefaults = createModelDefaultsStore(path.join(projectRoot, 'runtime/model-defaults.json'));
  const externalDispatch = employeeProjectDirectory && scopedDispatch({projectRoot, directory:employeeProjectDirectory, events:externalEvents, broadcast:realtime.broadcast});
  const maintenance = createMaintenanceGate({
    projectRoot,
    isBusy: () => {
      const services = [execution, followUpQueue, employeeRuntime, conversationForward, agentTasks, externalDispatch,
        ...(multiAgentDirectory ? [...multiAgentDirectory.values()] : multiAgent ? [multiAgent] : [])].filter(Boolean);
      // A service missing its busy contract is unknown, never safe to stop.
      return services.some((service) => typeof service.hasPendingWork !== "function" || service.hasPendingWork());
    },
  });
  const external = externalRoutes({projectRoot, execution, employeeRuntime, museMessages, followUpQueue, externalDispatch, events:externalEvents, workspaceToken:token, directory:employeeProjectDirectory, roomDirectory, agentConversationStore, multiAgentDirectory, tasks:agentTasks, artifacts, schedules:readAutomations, conversations, media, fushengUsage, readWebVersion, modelProviders, modelDefaults});
  const routes = [
    external.admin,
    ...(roomDirectory?.create ? [createGroupCreationRoute({ roomDirectory }), createTaskRoutes({ roomDirectory, multiAgentDirectory, groupRoom, media, agentTasks, employeeProjectDirectory })] : []),
    secureInputRoute,
    createConnectionRoutes(),
    createLynnWorkbenchRoutes(),
    createImageSettingsRoutes({ projectRoot }),
    async (request, response, url) => {
      if (url.pathname !== '/api/desktop/automations' || request.method !== 'GET') return false;
      sendJson(response, await readAutomations());
      return true;
    },
    ...(conversationForward ? [createConversationForwardRoutes({ service: conversationForward })] : []),
    createVersionRoutes({ readWebVersion }),
    createArtifactRoutes({ groupRoom, roomDirectory, artifacts, webOutputs }),
    createAgentPublicationRoutes({
      conversationStore: agentConversationStore,
      publicationService: agentPublicationService,
      employeeRuntime,
    }),
    ...(employeeRuntime ? [createEmployeeRoutes({ employeeRuntime })] : []),
    ...(employeeProjectDirectory ? [createEmployeeProjectDirectoryRoutes({ directory: employeeProjectDirectory, projectRoot })] : []),
    ...(employeeGrowth ? [createEmployeeGrowthRoutes({ growth: employeeGrowth })] : []),
    ...(projectActivityIndex ? [createProjectReviewRoutes({ activityIndex: projectActivityIndex, projectStatus, projectActivity:external.projectActivity })] : []),
    createGroupRoutes({ groupRoom, roomDirectory, media, multiAgent, multiAgentDirectory, webOutputs }),
    createFollowUpQueueRoutes({ queue: followUpQueue, media }),
    createConversationRoutes({ projectRoot, museMessages, externalDispatch, readAutomations,
      conversations, execution, followUpQueue, contextManagement, media, submissionStore: submissions,
      broadcast: realtime.broadcast,
      publishThreadEvent: execution.publishThreadEvent,
      agentConversationStore,
      employeeRuntime,
      agentTasks,
      roomDirectory,
      modelProviders,
    }),
    createUsageRoutes({ fushengUsage }),
    createSystemRoutes({ token, project, projectRoot, device, observerPort, media, realtime:{...realtime,connect(req,res){realtime.connect(req,res);connectPanel(req,res);}}, modelProviders, modelDefaults, fushengUsage }),
  ];

  return async (request, response) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if(url.pathname === '/mcp/muse') {
      if (maintenance(request,response,url)) return;
      try { await external.mcp(request,response,url); }
      catch(error) { if(!response.headersSent) sendJson(response,{error:error.statusCode===403?'接入已撤销或未获授权':'请求无法处理'},error.statusCode||503); else response.end(); }
      finally { maintenance.release(request); }
      return;
    }
    const protectedRoute = url.pathname.startsWith("/api/") || url.pathname === "/events";
    if (protectedRoute && !authorized(request, token)) {
      response.writeHead(401);
      response.end("Unauthorized");
      return;
    }
    rememberAuthorizedDevice(request, response, url, token);

    if (maintenance(request, response, url)) return;
    try {
      for (const route of routes) {
        if (await route(request, response, url)) return;
      }
      if (protectedRoute) {
        sendJson(response, { error: "Not found" }, 404);
        return;
      }
      await serveStatic(url, response);
    } catch (error) {
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, error?.statusCode || 503);
    } finally {
      maintenance.release(request);
    }
  };
};
