import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createFastImageClient } from '../image-generation/fast-image-client.mjs';
import { createImageSettingsStore, requireImageConnection, imageInstallationRoot } from '../image-generation/image-settings.mjs';

// Only the mount lives in Negus. UI, uploads and jobs belong to the independent repository.
export const createLynnWorkbenchRoutes = () => {
  let route;
  const store = createImageSettingsStore();
  return async (request, response, url) => {
    if (!url.pathname.startsWith('/api/apps/lynn/')) return false;
    if (!route) {
      const root = process.env.NEGUS_LYNN_ROOT || path.resolve(imageInstallationRoot, '../lynn-photo-workbench');
      route = import(pathToFileURL(path.join(root, 'server/mobile-route.mjs')).href).then(({ createMobileRoute }) => createMobileRoute({
        createClient: createFastImageClient,
        getConnection: async () => {
          const settings = await store.read();
          const entry = settings.configurations.find(item => item.id === settings.defaultId);
          if (!entry) throw Object.assign(new Error('请先在 Negus 设置 → 图片生成中选择供应商'), { statusCode: 400 });
          return requireImageConnection(entry);
        },
      })).catch(error => { route = null; throw error; });
    }
    return (await route)(request, response, url);
  };
};
