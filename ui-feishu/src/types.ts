import type { useProjectConversations } from '../../web-ui/src/features/conversations/hooks/useProjectConversations';
import type { useProjectDirectory } from '../../web-ui/src/features/project-directory/hooks/useProjectDirectory';
import type { useUsageMonitor } from '../../web-ui/src/features/usage-monitor/hooks/useUsageMonitor';
import type { SessionSummary } from '../../web-ui/src/features/conversations/model/types';

export type ConversationState = ReturnType<typeof useProjectConversations>;
export type DirectoryState = ReturnType<typeof useProjectDirectory>;
export type UsageState = ReturnType<typeof useUsageMonitor>;
export type Section = 'messages' | 'employees' | 'tasks';
export type ConversationFilter = 'all' | 'employees' | 'projects';
export type ChatTab = 'messages' | 'files';
export type Conversation = {
  id: string; name: string; subtitle: string; agentId?: string;
  threadId?: string | null; conversationId?: string | null; time?: string | null;
  main?: boolean; active?: boolean; pending?: boolean; session?: SessionSummary;
  kind?: 'project' | 'automation' | 'group'; label?: string; preview?: string; roomId?: string;
  projectId?: string; children?: Conversation[];
  taskId?: string;
};
