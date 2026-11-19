import { useCallback, useEffect, useRef, useState } from 'react';
import { observeProjectStream } from './projectEvents';
import { groupApi } from '../shared/features/group-chat/data/groupApi';
import type { GroupMessage, GroupRoom } from '../shared/features/group-chat/model/types';

export type ChatRoom = GroupRoom;
type RoomActivity = Pick<ChatRoom, 'lastActivityAt' | 'latestMessage'>;

function compareActivity(left: RoomActivity, right: RoomActivity) {
  const leftSequence = left.latestMessage?.sequence;
  const rightSequence = right.latestMessage?.sequence;
  if (leftSequence != null && rightSequence != null && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  return (left.lastActivityAt || '').localeCompare(right.lastActivityAt || '');
}

export function useGroupChats() {
  const [rooms, setRooms] = useState<ChatRoom[]>([]);
  const requestVersion = useRef(0);
  const eventVersion = useRef(0);
  const observedActivity = useRef(new Map<string, { activity: RoomActivity; version: number }>());
  const refresh = useCallback(async (signal?: AbortSignal) => {
    const version = ++requestVersion.current;
    const startedAt = eventVersion.current;
    try {
      const data = await groupApi.rooms(signal);
      if (signal?.aborted || version !== requestVersion.current) return;
      setRooms(data.rooms.map(room => {
        const observed = observedActivity.current.get(room.id);
        if (!observed) return room;
        const order = compareActivity(observed.activity, room);
        if (order > 0 || (order === 0 && (observed.version > startedAt || !room.latestMessage))) {
          return { ...room, ...observed.activity };
        }
        observedActivity.current.delete(room.id);
        return room;
      }));
    }
    catch { /* Original conversation connection handles service recovery. */ }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const source = observeProjectStream();
    const activityTimers = new Map<string, number>();
    let refreshTimer = 0;
    const trackMessage = (roomId: string, message: GroupMessage) => {
      const activity: RoomActivity = { lastActivityAt: message.createdAt,
        latestMessage: { id: message.id, sequence: message.sequence,
          text: (message.text?.trim().replace(/\s+/g, ' ') || '[附件]').slice(0, 260) } };
      const previous = observedActivity.current.get(roomId);
      if (previous && compareActivity(activity, previous.activity) < 0) return;
      observedActivity.current.set(roomId, { activity, version: ++eventVersion.current });
      window.clearTimeout(activityTimers.get(roomId));
      activityTimers.set(roomId, window.setTimeout(() => {
        activityTimers.delete(roomId);
        const latest = observedActivity.current.get(roomId)?.activity;
        if (!latest) return;
        setRooms(current => {
          const room = current.find(item => item.id === roomId);
          if (!room || compareActivity(latest, room) < 0) return current;
          return current.map(item => item === room ? { ...room, ...latest } : item);
        });
      }, 180));
    };
    source.onmessage = event => {
      try {
        const payload = JSON.parse(event.data);
        if ((payload.type === 'group_message_created' || payload.type === 'group_message_updated')
          && payload.roomId && payload.message?.createdAt) {
          trackMessage(payload.roomId, payload.message);
          return;
        }
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
  }, [refresh]);
  const update = useCallback(async (roomId: string, patch: { name?: string; archived?: boolean }) => {
    const { room } = await groupApi.updateRoom(roomId, patch);
    ++requestVersion.current;
    setRooms(current => current.map(item => item.id === room.id
      ? { ...item, name: room.name, archived: room.archived } : item));
    return room;
  }, []);
  return { rooms, refresh, update };
}
