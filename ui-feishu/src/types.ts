import type { useProjectConversations } from '../shared/features/conversations/hooks/useProjectConversations';
import type { useProjectDirectory } from '../shared/features/project-directory/hooks/useProjectDirectory';
import type { useUsageMonitor } from '../shared/features/usage-monitor/hooks/useUsageMonitor';
import type { SessionSummary } from '../shared/features/conversations/model/types';

export type ConversationState = ReturnType<typeof useProjectConversations>;
export type DirectoryState = ReturnType<typeof useProjectDirectory>;
export type UsageState = ReturnType<typeof useUsageMonitor>;
export type Section = 'messages' | 'employees' | 'tasks';
export type ConversationFilter = 'all' | 'employees' | 'projects' | 'background';
export type ChatTab = 'messages' | 'files';
export type Conversation = {
  id: string; name: string; subtitle: string; agentId?: string;
  threadId?: string | null; conversationId?: string | null; time?: string | null;
  main?: boolean; active?: boolean; pending?: boolean; session?: SessionSummary;
  origin?: 'user' | 'assistant';
  kind?: 'project' | 'automation' | 'group'; label?: string; preview?: string; roomId?: string;
  projectId?: string; children?: Conversation[];
  taskId?: string;
};
