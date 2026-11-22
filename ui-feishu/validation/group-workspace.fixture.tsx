import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GroupWorkspace } from '../src/components/GroupWorkspace';
import '../shared/styles/tokens.css';
import '../shared/styles/global.css';
import '../src/style.css';

function Fixture() {
  const [id, setId] = useState('room-a');
  return <main className="show-chat" style={{ height: '100dvh' }}><button onClick={() => setId(id === 'room-a' ? 'room-b' : 'room-a')}>切换测试群</button>
    <GroupWorkspace room={{ id, name: id, projectId: 'p' } as any} projectName="测试项目"
      forwardTargets={[
        { id: 'group:room-b', kind: 'group', roomId: 'room-b', name: 'room-b', subtitle: '测试项目' },
        { id: 'thread-target', threadId: 'thread-target', name: '目标会话', subtitle: '测试项目' },
        { id: 'thread-target-b', threadId: 'thread-target-b', name: '另一目标会话', subtitle: '测试项目' },
      ]}
      onOpenTarget={async target => { if (target.roomId) setId(target.roomId); return true; }}
      onBack={() => {}} onShare={() => {}} onRename={async () => {}} /></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
