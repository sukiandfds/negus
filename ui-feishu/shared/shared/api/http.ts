import { conversationReads } from "../state/conversationReads";

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "HttpError";
  }
}

const token = new URLSearchParams(window.location.search).get("token") || "";

// The token is only needed for the first same-origin request. The server then
// remembers authorization in an HttpOnly cookie. Remove it from the visible
// address bar so users do not accidentally copy it into screenshots, chat, or
// referrer-bearing links.
if (token) {
  try {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete("token");
    window.history.replaceState(window.history.state, document.title, `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
  } catch {
    // An unusual embedded browser may not allow history updates; API calls
    // still retain the in-memory token for this page load.
  }
}

// Installed PWAs reopen without the original query string; the server-issued
// HttpOnly cookie carries access in that case.
export const hasAccessToken = true;

export const withAccessToken = (pathname: string, params: Record<string, string> = {}) => {
  if (/^(?:https?:|data:|blob:)/iu.test(pathname)) return pathname;
  const query = new URLSearchParams(params);
  if (token) query.set("token", token);
  const encoded = query.toString();
  if (!encoded) return pathname;
  return `${pathname}${pathname.includes("?") ? "&" : "?"}${encoded}`;
};

type JsonMethod = "GET" | "POST" | "PATCH" | "DELETE";

interface JsonRequestOptions {
  method?: JsonMethod;
  body?: unknown;
  signal?: AbortSignal;
  errorMessage?: string;
  requireJsonContentType?: boolean;
}

const requestJson = async <T,>(pathname: string, {
  method = "GET",
  body,
  signal,
  errorMessage = "请求失败",
  requireJsonContentType = method === "GET",
}: JsonRequestOptions = {}): Promise<T> => {
  const response = await fetch(withAccessToken(pathname), {
    method,
    cache: "no-store",
    ...(body === undefined ? {} : {
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    signal,
  });
  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    if (method === "GET" && response.status === 401) throw new Error("访问令牌无效，请使用启动命令输出的完整链接");
    if (method === "GET" && response.status === 404) throw new HttpError("请求的项目会话不存在", response.status);
    const message = typeof payload?.error === "string" && payload.error.trim()
      ? payload.error
      : method === "GET" ? `项目数据服务暂不可用（${response.status}）` : `${errorMessage}（${response.status}）`;
    throw new Error(message);
  }
  if (requireJsonContentType && !(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("当前链接未连接到项目数据服务，请使用 pnpm start:demo 输出的 9360 链接");
  }
  if (payload === null) {
    if (method === "GET") throw new Error("项目数据返回格式错误");
    return {} as T;
  }
  return payload as T;
};

export const fetchJson = <T,>(pathname: string, signal?: AbortSignal) => {
  const finish = conversationReads.start(pathname);
  return requestJson<T>(pathname, { signal }).finally(finish);
};
export const postJson = <T,>(pathname: string, body: unknown, signal?: AbortSignal) => requestJson<T>(pathname, {
  method: "POST", body, signal, errorMessage: "发送失败",
});
export const patchJson = <T,>(pathname: string, body: unknown, signal?: AbortSignal) => requestJson<T>(pathname, {
  method: "PATCH", body, signal, errorMessage: "更新失败",
});
export const deleteJson = <T,>(pathname: string, body: unknown, signal?: AbortSignal) => requestJson<T>(pathname, {
  method: "DELETE", body, signal, errorMessage: "删除失败",
});
