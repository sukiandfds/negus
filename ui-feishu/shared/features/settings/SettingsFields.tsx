import { useId, type ReactNode } from 'react';
import { SecretField } from '../../shared/components/SecretField';
import type { ProviderDraft } from './settingsTypes';
import styles from './SettingsPage.module.css';

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className={styles.section}><h2>{title}</h2><div className={styles.panel}>{children}</div></section>;
}
export function SettingRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className={styles.row}><span className={styles.rowLabel}>{label}</span><div className={styles.control}>{children}</div></div>;
}
export function ProviderFields({ draft, onChange, models, disabled, onDiscover, preview }: {
  draft: ProviderDraft; onChange: (draft: ProviderDraft) => void; models: string[];
  disabled: boolean; onDiscover: () => void; preview: boolean;
}) {
  const modelList = useId();
  const input = (field: 'name' | 'website' | 'baseUrl' | 'userId', label: string, placeholder = '可不填') =>
    <SettingRow label={label}><input aria-label={label} value={draft[field]} maxLength={2000} autoComplete="off" placeholder={placeholder}
      onChange={event => onChange({ ...draft, [field]: event.target.value })} /></SettingRow>;
  return <fieldset className={styles.fields} disabled={disabled}>
    <SettingsSection title="供应商">
      {input('name', '配置名称')}
      {input('website', '供应商官网', 'https://example.com')}
      {input('baseUrl', 'API 接口地址', 'https://api.example.com/v1')}
    </SettingsSection>
    <SettingsSection title="账户信息">
      {input('userId', '用户 ID')}
      <SettingRow label="用户 Key"><SecretField label="用户 Key" value={draft.userKey} mode={draft.userKeyMode} disabled={disabled}
        onChange={(userKey, userKeyMode) => onChange({ ...draft, userKey, userKeyMode })} /></SettingRow>
    </SettingsSection>
    <SettingsSection title="模型调用">
      <SettingRow label="分组 Key"><SecretField label="分组 Key" value={draft.groupKey} mode={draft.groupKeyMode} disabled={disabled}
        onChange={(groupKey, groupKeyMode) => onChange({ ...draft, groupKey, groupKeyMode })} /></SettingRow>
      <SettingRow label="分组模型"><div className={styles.modelInput}>
        <input aria-label="分组模型" list={modelList} value={draft.model} maxLength={200} placeholder="选择或填写模型，可不填"
          onChange={event => onChange({ ...draft, model: event.target.value })} />
        <datalist id={modelList}>{models.map(model => <option key={model} value={model} />)}</datalist>
        <button type="button" disabled={preview || disabled} onClick={onDiscover}>查询模型</button>
      </div></SettingRow>
    </SettingsSection>
  </fieldset>;
}
