import { readJson, sendJson } from "../http/request-utils.mjs";

const employeeIdFrom = (url, body = {}) => String(body.employeeId || url.searchParams.get("employeeId") || "").trim();

export const createEmployeeGrowthRoutes = ({ growth }) => async (request, response, url) => {
  if (url.pathname === "/api/employee-growth" && request.method === "GET") {
    sendJson(response, growth.get(employeeIdFrom(url)));
    return true;
  }
  const match = /^\/api\/employee-growth\/(approve|reject|add-rule|disable-rule|delete-rule)$/u.exec(url.pathname);
  if (match && request.method === "POST") {
    const body = await readJson(request);
    if (match[1] === "add-rule") {
      sendJson(response, await growth.addRule(employeeIdFrom(url, body), body.text, body.requestId), 202);
      return true;
    }
    if (match[1] === "disable-rule" || match[1] === "delete-rule") {
      sendJson(response, await growth.changeRule(employeeIdFrom(url, body), body.proposalId, match[1] === "disable-rule" ? "disabled" : "deleted", { requestId: body.requestId }), 202);
      return true;
    }
    const decision = match[1] === "approve" ? "approved" : "rejected";
    sendJson(response, await growth.decide(employeeIdFrom(url, body), body.proposalId, decision, { requestId: body.requestId }), 202);
    return true;
  }
  return false;
};
