import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import styles from './SecretField.module.css';

export type SecretMode = 'keep' | 'replace' | 'clear';
export function SecretField({ label, value, mode, disabled, onChange }: {
  label: string; value: string; mode: SecretMode; disabled?: boolean;
  onChange: (value: string, mode: SecretMode) => void;
}) {
  const [visible, setVisible] = useState(false);
  return <div className={styles.root}>
    {mode === 'keep' ? <>
      <span className={styles.saved}>•••••••• <small>已保存</small></span>
      <button type="button" disabled={disabled} onClick={() => onChange('', 'replace')}>修改</button>
      <button type="button" disabled={disabled} onClick={() => onChange('', 'clear')}>清空</button>
    </> : <>
      <input aria-label={label} type={visible ? 'text' : 'password'} autoComplete="new-password" spellCheck={false}
        disabled={disabled} value={value} placeholder="可不填" onChange={e => onChange(e.target.value, e.target.value ? 'replace' : 'clear')} />
      <button type="button" className={styles.eye} disabled={disabled} aria-label={visible ? '隐藏' + label : '显示' + label} onClick={() => setVisible(!visible)}>
        {visible ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </>}
  </div>;
}
