import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, X } from 'lucide-react';
import styles from './UserInputDialog.module.css';

type Ask = { id: string; label: string; instruction: string };
export function SecretInputDialog({ thread }: { thread: string }) {
  const [ask, setAsk] = useState<Ask | null>(null);
  const endpoint = '/api/connections/secret-input?thread=' + encodeURIComponent(thread);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        if (document.hidden) return;
        const response = await fetch(endpoint, { cache: 'no-store' });
        if (response.ok) {
          const data = await response.json();
          if (live) setAsk(data.request);
        }
      } catch { /* Retry on the next poll. */ }
      finally { if (live) timer = setTimeout(poll, 3500); }
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [endpoint]);
  return ask && <CredentialForm key={ask.id} ask={ask} endpoint={endpoint} onDone={() => setAsk(current => current?.id === ask.id ? null : current)} />;
}

function CredentialForm({ ask, endpoint, onDone }: { ask: Ask; endpoint: string; onDone: () => void }) {
  const [error, fail] = useState(''), [busy, wait] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  async function finish(dismiss: boolean) {
    if (busy) return;
    wait(true); fail('');
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dismiss ? { id: ask.id, dismiss: true } : { id: ask.id, value: input.current?.value }) });
      if (!response.ok) throw Error((await response.json()).error);
      onDone();
    } catch (e) { fail(e instanceof Error ? e.message : '请求失败，请重试'); }
    finally { wait(false); }
  }
  return <dialog ref={dialog} className={styles.credential} aria-labelledby="credential-title" onCancel={e => { e.preventDefault(); void finish(true); }}>
    <form className={styles.form} onSubmit={e => { e.preventDefault(); void finish(false); }}>
      <header className={styles.header}><span className={styles.icon}><LockKeyhole /></span>
        <div><h2 id="credential-title">安全输入</h2><p>仅保存到主机钥匙串，不进入对话。</p></div>
        <button className={styles.close} type="button" disabled={busy} aria-label="关闭" onClick={() => void finish(true)}><X size={18} /></button>
      </header>
      <div className={styles.questions}><fieldset className={styles.question}>
        <label htmlFor="credential-value"><strong>{ask.label}</strong></label>
        <p id="credential-help">{ask.instruction}</p>
        <input id="credential-value" aria-describedby="credential-help" ref={input} className={styles.textInput} type="password" autoComplete="off" autoFocus required />
      </fieldset></div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer className={styles.footer}><button disabled={busy}>保存</button></footer>
    </form>
  </dialog>;
}
