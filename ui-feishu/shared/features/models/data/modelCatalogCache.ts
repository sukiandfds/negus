import { createCachedResource } from "../../../shared/state/localCache";
import { currentConversationId } from "../../../shared/api/conversationScope";
import type { CodexModel } from "../model/types";

const validModels = (value: unknown): value is CodexModel[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry)
    && typeof entry === "object"
    && typeof entry.model === "string"
    && Array.isArray(entry.supportedReasoningEfforts));

const catalogs = new Map<string, ReturnType<typeof createCachedResource<CodexModel[]>>>();
const emptyModels: CodexModel[] = [];
export const modelCatalogFor = (conversationId = currentConversationId()) => {
  let resource = catalogs.get(conversationId);
  if (!resource) {
    // v2 avoids trusting the old global catalog, which could belong to an employee.
    resource = createCachedResource("negus-models-v2:" + encodeURIComponent(conversationId), validModels);
    catalogs.set(conversationId, resource);
  }
  return resource;
};
export const readModelCatalog = () => modelCatalogFor().getSnapshot().data ?? emptyModels;
