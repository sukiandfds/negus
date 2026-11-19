import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const DEFAULT_FEATURED_GROUP = "gpt 易燃易爆炸";

const serviceError = (message, statusCode = 503) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const roundAmount = (value) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;

const shanghaiRange = (date) => {
  const shifted = new Date(date.getTime() + SHANGHAI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const startMs = Date.UTC(year, month, day) - SHANGHAI_OFFSET_MS;
  return {
    queryDate: `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    startTimestamp: Math.floor(startMs / 1000),
    endTimestamp: Math.floor(date.getTime() / 1000),
  };
};

const readCredentials = async (credentialsFile) => {
  let credentials;
  try {
    credentials = JSON.parse(await fs.readFile(credentialsFile, "utf8"));
  } catch {
    throw serviceError("浮生云算凭据文件不可用");
  }
  const baseUrl = String(credentials.base_url || "").trim().replace(/\/+$/u, "");
  const userId = Number(credentials.user_id);
  const accessToken = String(credentials.access_token || "").trim();
  if (!baseUrl || !Number.isInteger(userId) || !accessToken) {
    throw serviceError("浮生云算凭据配置不完整");
  }
  return { baseUrl, userId, accessToken };
};

const requestJson = async (fetchImpl, url, headers = undefined) => {
  let response;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetchImpl(url, { method: "GET", headers, signal: AbortSignal.timeout(8000), redirect: "error" });
      break;
    } catch {
      if (attempt === 1) throw serviceError("浮生云算网络连接失败");
    }
  }
  if (!response) throw serviceError("浮生云算网络连接失败");
  if (response.status === 401) throw serviceError("浮生云算访问令牌无效", 401);
  if (!response.ok) throw serviceError(`浮生云算接口暂不可用（${response.status}）`);
  try {
    return await response.json();
  } catch {
    throw serviceError("浮生云算返回格式错误");
  }
};

export const createFushengUsageService = ({
  credentialsFile,
  legacyCredentialsFile,
  fetchImpl = fetch,
  now = () => new Date(),
  cacheMs = 15_000,
  featuredGroupName = DEFAULT_FEATURED_GROUP,
}) => {
  let cached = null;
  let cachedAt = 0;
  let cachedKey = "";
  let inFlight = null;
  const publicPricing = new Map();
  const loadCredentials = async () => {
    // Only fall back when the new file does not exist, never after a corrupt write.
    const exists = await fs.access(credentialsFile).then(() => true, () => false);
    return readCredentials(!exists && legacyCredentialsFile ? legacyCredentialsFile : credentialsFile);
  };
  const credentialStatus = async () => {
    const value = await loadCredentials().catch(() => null);
    return { configured: Boolean(value), userId: value?.userId ?? null };
  };
  const saveCredentials = async (input) => {
    const userId = Number(input.userId);
    const accessToken = typeof input.accessToken === 'string' ? input.accessToken.trim() : '';
    if (!Number.isSafeInteger(userId) || userId <= 0 || !accessToken || accessToken.length > 8192 || /\s/.test(accessToken))
      throw serviceError('请填写有效的用户 ID 和账户访问令牌', 400);
    const value = { base_url: 'https://fushengyunsuan.cn', user_id: userId, access_token: accessToken };
    const temporary = `${credentialsFile}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(credentialsFile), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, credentialsFile);
    } finally {
      await fs.rm(temporary, { force: true });
    }
    if (inFlight) await inFlight.catch(() => {});
    cached = null;
    cachedAt = 0;
    cachedKey = '';
    return { configured: true, userId };
  };


  const publicOrigin = "https://fushengyunsuan.cn";
  const readPublicRatios = ({ force = false, origin = publicOrigin } = {}) => {
    const cached = publicPricing.get(origin);
    if (cached?.pending || (!force && cached && now().getTime() - cached.at < cacheMs)) return cached.request;
    const request = requestJson(fetchImpl, new URL("/api/pricing", origin)).then(pricing => {
      if (!pricing.group_ratio || pricing.success === false) throw serviceError("供应商公开价表格式错误");
      return Object.fromEntries(Object.entries(pricing.group_ratio)
        .filter(([, ratio]) => ratio !== null && ratio !== "" && Number.isFinite(Number(ratio)) && Number(ratio) >= 0)
        .map(([group, ratio]) => [group, Number(ratio)]));
    });
    const entry = { pending: true, request, at: now().getTime() };
    publicPricing.set(origin, entry);
    void request.then(() => { entry.pending = false; }, () => {
      if (publicPricing.get(origin) === entry) publicPricing.delete(origin);
    });
    return request;
  };
  const readChannelRatios = async (entries, { force = false } = {}) => {
    const credentials = await loadCredentials().catch(() => null);
    const origin = credentials?.baseUrl || publicOrigin;
    const pricing = await readPublicRatios({ origin, force });
    const account = credentials && await requestJson(fetchImpl, new URL("/api/token/?p=1&page_size=100", origin),
      { Authorization: `Bearer ${credentials.accessToken}`, "New-Api-User": String(credentials.userId) }).catch(() => null);
    const items = Array.isArray(account?.data) ? account.data : account?.data?.items || [];
    const result = {};
    await Promise.all(entries.map(async entry => {
      try {
        if (!entry.key || !entry.baseUrl || new URL(entry.baseUrl).origin !== origin) return;
        const token = await requestJson(fetchImpl, new URL("/api/usage/token/", origin), { Authorization: `Bearer ${entry.key}` });
        const groups = token.data?.group ? [token.data.group] : Number(account?.data?.total || items.length) <= items.length
          ? [...new Set(items.filter(item => item.name === token.data?.name).map(item => item.group).filter(Boolean))] : [];
        if (groups.length !== 1 || !Object.hasOwn(pricing, groups[0])) return;
        result[entry.id] = { priceRatio: pricing[groups[0]], priceGroup: groups[0], ratioSource: "supplier" };
      } catch { /* A configuration without a verified group has no assigned ratio. */ }
    }));
    return result;
  };

  const query = async () => {
    const currentDate = now();
    const range = shanghaiRange(currentDate);
    const credentials = await loadCredentials();
    const headers = {
      Authorization: `Bearer ${credentials.accessToken}`,
      "New-Api-User": String(credentials.userId),
    };
    const usageUrl = new URL("/api/data/self", credentials.baseUrl);
    usageUrl.searchParams.set("start_timestamp", String(range.startTimestamp));
    usageUrl.searchParams.set("end_timestamp", String(range.endTimestamp));
    usageUrl.searchParams.set("default_time", "hour");

    const [accountResponse, usageResponse, statusResponse, pricingResponse] = await Promise.all([
      requestJson(fetchImpl, new URL("/api/user/self", credentials.baseUrl), headers),
      requestJson(fetchImpl, usageUrl, headers),
      requestJson(fetchImpl, new URL("/api/status", credentials.baseUrl)),
      requestJson(fetchImpl, new URL("/api/pricing", credentials.baseUrl)),
    ]);

    const account = accountResponse?.data;
    if (!account || Number(account.id) !== credentials.userId) {
      throw serviceError("浮生云算账户校验失败", 502);
    }
    const quotaPerUnit = finiteNumber(statusResponse?.data?.quota_per_unit);
    if (quotaPerUnit <= 0) throw serviceError("浮生云算金额换算单位无效", 502);

    const totals = (Array.isArray(usageResponse?.data) ? usageResponse.data : []).reduce((summary, row) => ({
      requests: summary.requests + finiteNumber(row?.count),
      tokens: summary.tokens + finiteNumber(row?.token_used),
      quota: summary.quota + finiteNumber(row?.quota),
    }), { requests: 0, tokens: 0, quota: 0 });

    const groupRatios = Object.fromEntries(Object.entries(pricingResponse?.group_ratio || {})
      .map(([name, ratio]) => [name, finiteNumber(ratio)]));

    return {
      provider: "fusheng",
      updatedAt: currentDate.toISOString(),
      queryDate: range.queryDate,
      today: {
        amountUsd: roundAmount(totals.quota / quotaPerUnit),
        requests: Math.trunc(totals.requests),
        tokens: Math.trunc(totals.tokens),
      },
      account: {
        balanceUsd: roundAmount(finiteNumber(account.quota) / quotaPerUnit),
        historicalUsageUsd: roundAmount(finiteNumber(account.used_quota) / quotaPerUnit),
        historicalRequests: Math.trunc(finiteNumber(account.request_count)),
      },
      featuredGroup: {
        name: featuredGroupName,
        ratio: Object.hasOwn(groupRatios, featuredGroupName) ? groupRatios[featuredGroupName] : null,
      },
      groupRatios,
    };
  };

  const read = async ({ force = false, cacheKey = "" } = {}) => {
    const currentDate = now();
    const currentRange = shanghaiRange(currentDate);
    const fresh = cached
      && cacheKey
      && cachedKey === cacheKey
      && cached.queryDate === currentRange.queryDate
      && currentDate.getTime() - cachedAt < cacheMs;
    if (!force && fresh) return cached;
    if (inFlight) return inFlight;
    inFlight = query()
      .then((result) => {
        cached = result;
        cachedAt = currentDate.getTime();
        cachedKey = cacheKey;
        return result;
      })
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  };

  return { read, readPublicRatios, readChannelRatios, credentialStatus, saveCredentials };
};
