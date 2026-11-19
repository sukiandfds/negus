const failure = message => Object.assign(new Error(message), { statusCode: 502 });

export const readProviderModels = async response => {
  if (!response.ok) {
    const detail = response.status === 401 ? "密钥失效（HTTP 401），请更新 API Key"
      : response.status === 403 ? "HTTP 403，当前 Key 无权访问此分组" : `供应商返回 HTTP ${response.status}`;
    throw failure(`配置模型目录读取失败：${detail}`);
  }
  let payload;
  try { payload = await response.json(); }
  catch (error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") throw error;
    throw failure("配置模型目录响应格式错误");
  }
  if (payload && ((Object.hasOwn(payload, "success") && payload.success !== true) || payload.error
    || ["error", "failed", "failure"].includes(String(payload.status).toLowerCase()))) {
    throw failure("供应商未成功返回模型目录，请检查配置或稍后重试");
  }
  if (!Array.isArray(payload?.data) || payload.data.some(entry => typeof entry?.id !== "string"
    || !entry.id.trim() || entry.id.length > 120 || entry.id.includes("::") || /[\r\n]/u.test(entry.id))) {
    throw failure("配置模型目录响应格式错误");
  }
  return [...new Set(payload.data.map(entry => entry.id))];
};
