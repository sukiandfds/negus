import { useEffect, useSyncExternalStore } from "react";
import { modelCatalogFor, readModelCatalog } from "../data/modelCatalogCache";
import { refreshModelCatalog } from "../data/modelCatalogRefresh";
import { currentConversationId } from "../../../shared/api/conversationScope";

export function useModels() {
  const conversationId = currentConversationId();
  const catalog = modelCatalogFor(conversationId);
  const cached = useSyncExternalStore(catalog.subscribe, catalog.getSnapshot);
  const models = cached.data ?? readModelCatalog();
  const loading = cached.refreshing || (cached.data === null && !cached.error);
  useEffect(() => {
    const refresh = () => {
      void refreshModelCatalog("", conversationId).catch(() => {});
    };
    window.addEventListener('negus-channels-updated', refresh);
    return () => window.removeEventListener('negus-channels-updated', refresh);
  }, [conversationId]);

  useEffect(() => {
    void refreshModelCatalog("", conversationId, false).catch(() => {});
  }, [conversationId]);

  return { models, loading, loaded: cached.data !== null, error: cached.error };
}
