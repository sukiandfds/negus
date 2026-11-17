import { useCallback, useEffect, useRef, useState } from 'react';
import { observeProjectStream } from './projectEvents';
import { groupApi } from '../shared/features/group-chat/data/groupApi';
import type { GroupRoom } from '../shared/features/group-chat/model/types';

export type ChatRoom = GroupRoom & { lastActivityAt?: string };
export function useGroupChats() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const requestVersion = useRef(0);
  const observedActivity = useRef(new Map<string, string>());
  const rememberActivity = useCallback((roomId: string, lastActivityAt: string) => {
    if (!roomId || !lastActivityAt) return;
    if ((observedActivity.current.get(roomId) || "") < lastActivityAt) {
      observedActivity.current.set(roomId, lastActivityAt);
    }
  }, []);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    try {
      const data = await groupApi.rooms(signal);
      if (signal?.aborted || version !== requestVersion.current) return;
      const next = data.rooms.map(room => {
        const responseActivity = (room as ChatRoom).lastActivityAt || "";
        rememberActivity(room.id, responseActivity);
        const latest = observedActivity.current.get(room.id);
        return latest && latest !== responseActivity ? { ...room, lastActivityAt: latest } : room;
      });
      setRooms(next);
    }
    catch { /* Original conversation connection handles service recovery. */ }
  }, [rememberActivity]);
  const updateActivity = useCallback((roomId: string, lastActivityAt: string) => {
    if (!roomId || !lastActivityAt) return;
    rememberActivity(roomId, lastActivityAt);
    setRooms(current => {
      let changed = false;
      const next = current.map(room => {
        if (room.id !== roomId || (room.lastActivityAt || "") >= lastActivityAt) return room;
        changed = true;
        return { ...room, lastActivityAt };
      });
      return changed ? next : current;
    });
  }, [rememberActivity]);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const source = observeProjectStream();
    const activityTimers = new Map<string, number>();
    let refreshTimer = 0;
    source.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'group_message_created' && payload.roomId && payload.message?.createdAt) {
          const pending = activityTimers.get(payload.roomId);
          if (pending) window.clearTimeout(pending);
          const timer = window.setTimeout(() => {
            activityTimers.delete(payload.roomId);
            updateActivity(payload.roomId, payload.message.createdAt);
          }, 180);
          activityTimers.set(payload.roomId, timer);
          return;
        }
        // A new message only changes the room's activity time; avoid replacing
        // the full room list and re-rendering the active conversation for it.
        if (payload.type === 'sessions_changed') {
          if (payload.source === 'group' && payload.roomId) return;
          window.clearTimeout(refreshTimer);
          refreshTimer = window.setTimeout(() => void refresh(controller.signal), 180);
        }
      } catch {}
    };
    return () => {
      controller.abort();
      source.close();
      activityTimers.forEach(timer => window.clearTimeout(timer));
      window.clearTimeout(refreshTimer);
    };
  }, [refresh, updateActivity]);
  const update = useCallback(async (roomId: string, patch: { name?: string; archived?: boolean }) => {
    const { room } = await groupApi.updateRoom(roomId, patch);
    ++requestVersion.current;
    rememberActivity(room.id, (room as ChatRoom).lastActivityAt || "");
    setRooms(current => current.map(item => item.id === room.id ? { ...item, ...room } : item));
    return room;
  }, [rememberActivity]);
  return { rooms, refresh, update };
}
