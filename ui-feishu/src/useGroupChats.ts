import { useCallback, useEffect, useRef, useState } from 'react';
import { observeProjectStream } from './projectEvents';
import { groupApi } from '../shared/features/group-chat/data/groupApi';
import type { GroupRoom } from '../shared/features/group-chat/model/types';

export type ChatRoom = GroupRoom & { lastActivityAt?: string };
export function useGroupChats() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const requestVersion = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const data = await groupApi.rooms(signal);
      if (!signal?.aborted && version === requestVersion.current) setRooms(data.rooms);
    }
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
  const update = useCallback(async (roomId: string, patch: { name?: string; archived?: boolean }) => {
    const { room } = await groupApi.updateRoom(roomId, patch);
    ++requestVersion.current;
    setRooms(current => current.map(item => item.id === room.id ? { ...item, ...room } : item));
    return room;
  }, []);
  return { rooms, refresh, update };
}
