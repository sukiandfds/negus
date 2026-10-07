import { useCallback, useEffect, useState } from 'react';
import { observeProjectStream } from './projectEvents';
import { groupApi } from '../../web-ui/src/features/group-chat/data/groupApi';
import type { GroupRoom } from '../../web-ui/src/features/group-chat/model/types';

export type ChatRoom = GroupRoom & { lastActivityAt?: string };
export function useGroupChats() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    try { const data = await groupApi.rooms(signal); if (!signal?.aborted) setRooms(data.rooms); }
    catch { /* Original conversation connection handles service recovery. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const source = observeProjectStream();
    let timer = 0;
    source.onmessage = event => {
      try { if (['sessions_changed', 'group_message_created'].includes(JSON.parse(event.data).type)) { clearTimeout(timer); timer = window.setTimeout(() => void refresh(controller.signal), 180); } } catch {}
    };
    return () => { controller.abort(); source.close(); clearTimeout(timer); };
  }, [refresh]);
  return { rooms, refresh };
}
