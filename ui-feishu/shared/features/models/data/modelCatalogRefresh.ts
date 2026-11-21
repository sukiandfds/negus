import { postJson } from "../../../shared/api/http";
import { currentConversationId } from "../../../shared/api/conversationScope";
import { modelApi } from "./modelApi";
import { modelCatalogFor } from "./modelCatalogCache";

export const refreshModelCatalog = (
  providerId = "",
  conversationId = currentConversationId(),
  invalidate = true,
) => modelCatalogFor(conversationId).refresh(async () => {
  const models = await modelApi.list(AbortSignal.timeout(15000), providerId || undefined, conversationId);
  return models.filter((entry) => entry.available !== false);
}, invalidate);

export type CatalogResult = { id: string; name: string; owner?: string; count?: number | null; error?: string; protected?: string; ticket?: string };

export const refreshConfiguredModels = async (providerId = "", conversationId = currentConversationId()) => {
  const result = await postJson<{ results: CatalogResult[] }>("/api/model-channels/catalog",
    { action: "refresh", providerId }, AbortSignal.timeout(90000));
  if (!Array.isArray(result.results)) throw new Error("模型目录刷新需要更新后端");
  await refreshModelCatalog("", conversationId);
  return result.results;
};
