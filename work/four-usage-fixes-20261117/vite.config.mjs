import config from '../../ui-feishu/vite.config.ts';
export default { ...config, server: { ...config.server, port: 5201, proxy: {} } };
