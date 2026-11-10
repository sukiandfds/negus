import { useEffect, useState } from 'react';
import { fetchJson, postJson } from '../../shared/api/http';
import styles from './SettingsPage.module.css';

type Connection = { connected: boolean; connectedAt?: string | null };
const endpoint = '/api/connections/cloudflare';
export function ConnectionsSettings() {
  const [state, setState] = useState<Connection | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    const abort = new AbortController();
    void fetchJson<Connection>(endpoint, abort.signal).then(setState).catch(e => { if (!abort.signal.aborted) setError(e.message); });
    return () => abort.abort();
  }, []);
  const run = async (action: 'connect' | 'disconnect' | 'test') => {
    if (busy) return;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'connect') {
        const result = await postJson<{ url: string }>(endpoint, { action }, AbortSignal.timeout(60000));
        const url = new URL(result.url);
        if (url.origin !== 'https://mcp.cloudflare.com') throw Error('Cloudflare 授权地址无效');
        window.location.assign(url.href);
      } else if (action === 'disconnect') {
        setState(await postJson<Connection>(endpoint, { action }));
        setNotice('已断开 Negus 连接。您还可以在 Cloudflare 中撤销该应用的授权。');
      } else {
        const result = await postJson<{ toolCount: number }>(endpoint, { action }, AbortSignal.timeout(60000));
        setNotice('连接测试成功，Cloudflare 已返回可用工具。');
        if (!result.toolCount) setNotice('已连接，但 Cloudflare 没有返回可用工具。');
      }
    } catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    finally { setBusy(''); }
  };
  return <>
    <header className={styles.contentHeader}><div><h1>账号连接</h1><p>连接您的平台账号，让 Negus 助手为您查询和管理。</p></div></header>
    <section className={styles.section}><h2>Cloudflare</h2><div className={styles.panel}>
      <div className={styles.row}><span className={styles.rowLabel}>连接状态</span><span>{state ? state.connected ? '已连接' : '未连接' : '正在读取…'}</span></div>
      <div className={styles.row}><span>域名、DNS、网站部署和访问分析；可用能力以您授予的权限为准。</span></div>
      <div className={styles.row}><span>授权保存在服务器上，所有助手和模型渠道共用，公网访问也可使用。</span></div>
    </div></section>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <footer className={styles.formFooter}>
      <button type="button" disabled={Boolean(busy) || !state} onClick={() => void run('connect')}>{busy === 'connect' ? '正在连接…' : state?.connected ? '重新授权' : '连接 Cloudflare'}</button>
      {state?.connected && <><button type="button" disabled={Boolean(busy)} onClick={() => void run('test')}>{busy === 'test' ? '正在测试…' : '测试连接'}</button><button type="button" disabled={Boolean(busy)} onClick={() => void run('disconnect')}>断开连接</button></>}
    </footer>
    <p className={styles.feedback} role="status">{notice || (state?.connected ? '您可以回到对话，试试：“列出我 Cloudflare 账户里的域名和 Pages 项目。”' : '点击连接后，在 Cloudflare 官方页面登录并选择授权范围，完成后自动返回这里。')}</p>
  </>;
}
