import { readJson, sendJson } from "../http/request-utils.mjs";

export const createUsageRoutes = ({ fushengUsage }) => async (request, response, url) => {
  const credentialsRoute = url.pathname === '/api/usage/fusheng/credentials';
  if (!(credentialsRoute && ['GET', 'POST'].includes(request.method))
    && !(url.pathname === '/api/usage/fusheng' && request.method === 'GET')) return false;
  if (!fushengUsage) {
    const error = new Error("浮生云算用量服务未配置");
    error.statusCode = 503;
    throw error;
  }
  if (credentialsRoute) {
    sendJson(response, request.method === 'GET'
      ? await fushengUsage.credentialStatus()
      : await fushengUsage.saveCredentials(await readJson(request, 16 * 1024)));
    return true;
  }
  sendJson(response, await fushengUsage.read({
    force: url.searchParams.get("refresh") === "1",
    cacheKey: url.searchParams.get("turnId") || "",
  }));
  return true;
};
