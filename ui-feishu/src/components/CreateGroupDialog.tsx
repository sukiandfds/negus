import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { postJson } from '../../../web-ui/src/shared/api/http';
import styles from '../../../web-ui/src/features/conversations/components/ConversationActions.module.css';
import type { DirectoryState } from '../types';
import type { ChatRoom } from '../useGroupChats';

export function CreateGroupDialog({ directory, onClose, onCreated }: { directory: DirectoryState; onClose: () => void; onCreated: (room: ChatRoom) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const projects = directory.projects.filter(project => project.kind !== 'employee');
  const [projectId, setProjectId] = useState(projects[0]?.projectId || projects[0]?.id || '');
  const [agents, setAgents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef({ signature: '', id: '' });
  useEffect(() => { dialog.current?.showModal(); }, []);
  const create = async () => {
    if (busy) return;
    const body = { name: name.trim(), projectId, agentIds: agents };
    const signature = JSON.stringify(body);
    if (request.current.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    setBusy(true); setError('');
    try { const data = await postJson<{ room: ChatRoom }>('/api/group/rooms', { ...body, requestId: request.current.id }); onCreated(data.room); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <dialog ref={dialog} className={`${styles.dialog} create-group-dialog`} aria-label="创建群聊" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><strong>创建群聊</strong><button aria-label="关闭创建群聊" disabled={busy} onClick={onClose}><X size={17} /></button></header>
    <form onSubmit={event => { event.preventDefault(); void create(); }}>
      <label>群聊名称<input autoFocus aria-label="群聊名称" value={name} disabled={busy} onChange={event => setName(event.target.value)} /></label>
      <label>所属项目<select aria-label="所属项目" value={projectId} disabled={busy} onChange={event => setProjectId(event.target.value)}>{projects.map(project => <option key={project.id} value={project.projectId || project.id}>{project.name}</option>)}</select></label>
      <fieldset disabled={busy}><legend>添加员工</legend>{directory.projects.filter(project => project.employeeId).map(employee => <label key={employee.employeeId} className="group-member-choice"><input type="checkbox" checked={agents.includes(employee.employeeId!)} onChange={event => setAgents(previous => event.target.checked ? [...previous, employee.employeeId!] : previous.filter(id => id !== employee.employeeId))} />{employee.name}</label>)}</fieldset>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button type="submit" disabled={busy || !name.trim() || !projectId}>{busy ? '正在创建…' : '创建群聊'}</button></footer>
    </form>
  </dialog>;
}
