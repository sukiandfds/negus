import { createAccessGuard, rememberAuthorizedDevice } from "./http/access-control.mjs";
import { sendJson } from "./http/request-utils.mjs";
import { createArtifactRoutes } from "./routes/artifact-routes.mjs";
import { createConversationRoutes } from "./routes/conversation-routes.mjs";
import { createGroupRoutes } from "./routes/group-routes.mjs";
import { createSystemRoutes } from "./routes/system-routes.mjs";
import { createUsageRoutes } from "./routes/usage-routes.mjs";
import { createVersionRoutes } from "./routes/version-routes.mjs";

export const createRequestHandler = ({
  token, project, projectRoot, device, observerPort, conversations, execution, media, realtime,
  contextManagement, groupRoom, multiAgent, artifacts, webOutputs, fushengUsage, readWebVersion, serveStatic,
}) => {
  const routes = [
    createVersionRoutes({ readWebVersion }),
    createArtifactRoutes({ groupRoom, artifacts, webOutputs }),
    createGroupRoutes({ groupRoom, media, multiAgent, webOutputs }),
    createConversationRoutes({ conversations, execution, contextManagement, media, broadcast: realtime.broadcast }),
    createUsageRoutes({ fushengUsage }),
    createSystemRoutes({ token, project, projectRoot, device, observerPort, media, realtime }),
  ];

  const accessGuard = createAccessGuard({ token });
  const isProtected = (pathname) => pathname.startsWith("/api/") || pathname === "/events";

  return async (request, response) => {
    let url;
    try {
      url = new URL(request.url || "/", "http://localhost");
    } catch {
      response.writeHead(400);
      response.end("Bad Request");
      return;
    }

    if (isProtected(url.pathname)) {
      const access = accessGuard.check(request, url);
      if (!access.allowed) {
        response.writeHead(access.status, access.retryAfterSeconds ? { "Retry-After": String(access.retryAfterSeconds) } : {});
        response.end(access.status === 429 ? "Too Many Requests" : "Unauthorized");
        return;
      }
    }
    rememberAuthorizedDevice(request, response, url, token);

    try {
      for (const route of routes) {
        if (await route(request, response, url)) return;
      }
      if (isProtected(url.pathname)) {
        sendJson(response, { error: "Not found" }, 404);
        return;
      }
      await serveStatic(url, response);
    } catch (error) {
      const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 503;
      if (statusCode >= 500) console.warn(`[request-handler] ${request.method} ${url.pathname} failed: ${error?.message || error}`);
      if (response.headersSent) {
        response.destroy();
        return;
      }
      sendJson(response, { error: error instanceof Error ? error.message : String(error) }, statusCode);
    }
  };
};
