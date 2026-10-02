import { withVerifiedReasoning } from './model-capabilities.mjs';
const failure = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

export const createProviderProbe = ({ resolveDraft, fetchImpl = globalThis.fetch }) => async (input) => {
  const { baseUrl, key } = await resolveDraft(input);
  const testing = input.action === "test";
  const model = String(input.model || "").trim();
  if (testing && (!model || model.length > 120 || model.includes("::"))) throw failure("请选择有效模型");
  let response, payload;
  try {
    response = await fetchImpl(baseUrl + (testing ? "/responses" : "/models"), {
      method: testing ? "POST" : "GET", redirect: "error",
      headers: { Authorization: "Bearer " + key, ...(testing ? { "Content-Type": "application/json" } : {}) },
      signal: AbortSignal.timeout(testing ? 45000 : 10000),
      ...(testing ? { body: JSON.stringify({ model, input: "Reply only OK.", max_output_tokens: 128, store: false }) } : {}),
    });
    if (!response.ok) throw failure("供应商返回 HTTP " + response.status + "，请检查地址、Key、模型权限及接口支持", 502);
    payload = await response.json();
  } catch (error) {
    if (error.statusCode) throw error;
    throw failure(testing ? "模型测试超时或接口异常，未确认可用" : "模型目录查询失败，请检查地址和 Key", 502);
  }
  if (!testing) {
    if (!Array.isArray(payload.data)) throw failure("供应商未返回兼容的模型目录", 502);
    const models = [...new Set(payload.data.map(entry => entry?.id).filter(id =>
      typeof id === "string" && id.length > 0 && id.length <= 120 && !id.includes("::") && !/[\r\n]/u.test(id)))].sort();
    if (!models.length) throw failure("这个 Key 未查询到模型", 502);
    return { models, capabilities: models.map(model => withVerifiedReasoning({ model }, baseUrl)) };
  }
  const replied = Array.isArray(payload.output) && payload.output.some(item =>
    item.type === "message" && item.role === "assistant" && Array.isArray(item.content) && item.content.some(part =>
      part.type === "output_text" && typeof part.text === "string" && part.text.trim()));
  if (payload.status !== "completed" || !replied || payload.error) throw failure("请求未完成有效回复，暂不能确认模型可用", 502);
  return { usable: true, model, notice: "测试成功：模型已通过 Responses 接口回复。此测试不代表所有工具能力均已验证。" };
};
