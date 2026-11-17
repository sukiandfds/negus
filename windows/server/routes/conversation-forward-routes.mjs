import { readJson, sendJson } from "../http/request-utils.mjs";
export const createConversationForwardRoutes = ({ service }) => async (request, response, url) => {
  if (url.pathname === "/api/conversation-forward/targets" && request.method === "GET") {
    sendJson(response, await service.listTargets()); return true;
  }
  if (url.pathname === "/api/conversation-summary" && request.method === "POST") {
    const body = await readJson(request);
    const value = await service.summarize(String(body.threadId || ""));
    sendJson(response, value); return true;
  }
  if (url.pathname === "/api/conversation-forward" && request.method === "POST") {
    const body = await readJson(request);
    sendJson(response, await service.forward({
      sourceThreadId: String(body.sourceThreadId || ""), targetThreadId: String(body.targetThreadId || ""),
      requestId: String(body.requestId || ""),
    }), 202); return true;
  }
  return false;
};
