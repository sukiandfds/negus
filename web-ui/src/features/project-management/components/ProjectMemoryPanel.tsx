import { BookOpen, ExternalLink, History, X } from "lucide-react";
import { useCallback, useState } from "react";
import { formatRecordedTimestamp } from "../../../shared/format/dateTime";
import { groupApi } from "../../group-chat/data/groupApi";
import type { GroupMessage, GroupRoom } from "../../group-chat/model/types";
import type { ProjectManagementDocument, ProjectManagementEntry } from "../model/types";
import styles from "../ProjectManagementApp.module.css";

interface ProjectMemoryPanelProps {
  document: ProjectManagementDocument;
  onOpenEntry: (entry: ProjectManagementEntry) => void;
}

const decisionEntries = (document: ProjectManagementDocument) => document.entries
  .filter((entry) => entry.type === "decision" || entry.category === "产品决策")
  .slice(0, 4);

const readAllMessages = async (room: GroupRoom, signal: AbortSignal) => {
  const collected: GroupMessage[] = [];
  let page = await groupApi.messages(room.id, { limit: 100 }, signal);
  let pages = 0;
  while (page && pages < 1000) {
    collected.unshift(...page.messages);
    if (!page.hasOlder || !page.oldestSequence) break;
    const previousOldest = page.oldestSequence;
    page = await groupApi.messages(room.id, { before: previousOldest, limit: 100 }, signal);
    if (page.oldestSequence >= previousOldest && page.messages.length > 0) break;
    pages += 1;
  }
  return [...new Map(collected.map((message) => [message.id, message])).values()]
    .sort((left, right) => (left.sequence || 0) - (right.sequence || 0));
};

export function ProjectMemoryPanel({ document, onOpenEntry }: ProjectMemoryPanelProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyMessages, setHistoryMessages] = useState<GroupMessage[]>([]);
  const [historyRoom, setHistoryRoom] = useState<GroupRoom | null>(null);

  const openHistory = useCallback(async () => {
    if (historyLoading) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError("");
    const controller = new AbortController();
    try {
      const rooms = (await groupApi.rooms(controller.signal)).rooms;
      const room = rooms.find((candidate) => candidate.projectId === document.project.id) || rooms[0];
      if (!room) throw new Error("当前项目没有可读取的群聊");
      setHistoryRoom(room);
      setHistoryMessages(await readAllMessages(room, controller.signal));
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setHistoryError(reason instanceof Error ? reason.message : "群聊历史读取失败");
    } finally {
      setHistoryLoading(false);
    }
  }, [document.project.id, historyLoading]);

  const closeHistory = () => {
    setHistoryOpen(false);
    setHistoryError("");
  };

  const decisions = decisionEntries(document);
  return (
    <>
      <section className={styles.memorySection} aria-labelledby="project-memory-title">
        <div className={styles.sectionHeading}>
          <div>
            <h2 id="project-memory-title"><BookOpen aria-hidden="true" />项目记忆</h2>
            <p>只读取项目管理记录和公共群聊；不把摘要当成隐式长期记忆。</p>
          </div>
          <span className={styles.sectionCount}>{document.recentUpdates.length + decisions.length}</span>
        </div>
        <div className={styles.memoryGrid}>
          <div className={styles.memoryCard}>
            <div className={styles.memoryCardHeader}><strong>最近更新</strong><span>{document.recentUpdates.length} 条</span></div>
            {document.recentUpdates.slice(0, 3).map((update) => {
              const entry = update.entryId ? document.entries.find((candidate) => candidate.id === update.entryId) : null;
              return (
                <button className={styles.memoryItem} type="button" key={`${update.entryId || "update"}-${update.at}-${update.change}`} onClick={() => entry && onOpenEntry(entry)} disabled={!entry}>
                  <span>{formatRecordedTimestamp(update.at)}</span><strong>{update.change}</strong>
                </button>
              );
            })}
            {!document.recentUpdates.length ? <span className={styles.memoryEmpty}>暂无更新记录</span> : null}
          </div>
          <div className={styles.memoryCard}>
            <div className={styles.memoryCardHeader}><strong>关键决策</strong><span>{decisions.length} 条</span></div>
            {decisions.map((entry) => (
              <button className={styles.memoryItem} type="button" key={entry.id} onClick={() => onOpenEntry(entry)}>
                <span>{entry.id}</span><strong>{entry.title}</strong>
              </button>
            ))}
            {!decisions.length ? <span className={styles.memoryEmpty}>暂无明确决策条目</span> : null}
          </div>
          <div className={styles.memoryCard}>
            <div className={styles.memoryCardHeader}><strong>完整群聊历史</strong><History aria-hidden="true" /></div>
            <p className={styles.memoryDescription}>按服务端分页读取公共群聊的全部已保存消息。完整历史不会自动注入 Agent 上下文。</p>
            <div className={styles.memoryActions}>
              <button className={styles.memoryPrimary} type="button" onClick={() => void openHistory} disabled={historyLoading}>
                {historyLoading ? "读取中" : "读取完整历史"}
              </button>
              <a className={styles.memoryLink} href="/group.html">打开群聊界面<ExternalLink aria-hidden="true" /></a>
            </div>
          </div>
        </div>
        <p className={styles.memoryPolicy}><strong>Agent 上下文边界：</strong>群聊 Agent 默认只接收自上次处理后的新增消息，并受消息数和字符数限制；项目经理入口只带入当前项目标识、阶段和目标。需要早期讨论时，应从上面的完整历史入口按需读取。</p>
      </section>

      {historyOpen ? (
        <div className={styles.memoryOverlay} role="presentation" onClick={(event) => { if (event.target === event.currentTarget) closeHistory(); }}>
          <section className={styles.memoryDialog} role="dialog" aria-modal="true" aria-labelledby="project-history-title">
            <header className={styles.memoryDialogHeader}>
              <div><span className={styles.eyebrow}>公共记录</span><h2 id="project-history-title">{historyRoom?.name || "完整群聊历史"}</h2></div>
              <button className={styles.iconButton} type="button" onClick={closeHistory} aria-label="关闭群聊历史"><X aria-hidden="true" /></button>
            </header>
            <div className={styles.memoryDialogBody}>
              {historyLoading ? <p className={styles.detailState}>正在按时间顺序读取全部历史...</p> : null}
              {historyError ? <p className={styles.detailError} role="alert">{historyError}</p> : null}
              {!historyLoading && !historyError && !historyMessages.length ? <p className={styles.memoryEmpty}>当前群聊还没有已保存消息。</p> : null}
              {historyMessages.map((message) => (
                <article className={styles.memoryMessage} key={message.id}>
                  <div><strong>{message.authorName || "未命名成员"}</strong><time>{formatRecordedTimestamp(message.createdAt)}</time></div>
                  <p>{message.text || "（附件或交付物）"}</p>
                </article>
              ))}
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
