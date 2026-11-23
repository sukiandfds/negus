import { useSyncExternalStore } from "react";
import { occupationNotices, occupationText } from "../../../shared/api/occupation";
import type { SessionMessage } from "../model/types";
import styles from "./ConversationView.module.css";

export function OccupationNotice({ scope, messages = [] }: { scope: string; messages?: SessionMessage[] }) {
  const notice = useSyncExternalStore(occupationNotices.subscribe, () => occupationNotices.get(scope));
  const last = messages.at(-1);
  if (last?.deliveryState !== "occupied" && (!notice || Date.parse(last?.createdAt || "") > notice)) return null;
  return <div role="status" className={styles.modelSwitch}>{occupationText}</div>;
}
