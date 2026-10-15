import { useEffect, useMemo, useRef, useState } from "react";
import { AtSign, ChevronDown, MessagesSquare, Send, Sparkles, Square } from "lucide-react";
import { AttachmentButton, AttachmentPreviews } from "../../attachments/components/AttachmentDraft";
import { useAttachmentDraft } from "../../attachments/hooks/useAttachmentDraft";
import { SlashCommandMenu, type SlashCommandOption } from "../../conversations/components/SlashCommandMenu";
import { goalCapabilityOptions } from "../../goals/model/capability";
import type { GroupAgent } from "../model/types";
import { mentionedAgentIds } from "../model/agentMentions";
import type { MediaFile } from "../../../shared/model/media";
import { useDismissibleLayer } from "../../../shared/hooks/useDismissibleLayer";
import { MentionMenu, type MentionOption } from "./MentionMenu";
import styles from "./GroupComposer.module.css";

interface MentionState { start: number; end: number; query: string }

export interface GroupComposerCopy {
  placeholder: string;
  discussionHint: string;
  contextHint: string;
  busyReplyHint: (names: string[]) => string;
  orderedReplyHint: (names: string[]) => string;
  singleReplyHint: (name: string) => string;
  stopLabel: string;
  stopDetail: string;
}

export const defaultGroupComposerCopy: GroupComposerCopy = {
  placeholder: "发给项目群。可用 @ 点名，也可以说‘各位/所有人’一起讨论",
  discussionHint: "被点到的员工按顺序回复，没被点名的不会插话",
  contextHint: "群里的完整记录一直保留。每次点名是单独一件事，先发的先做，后一条等下一轮。点名后的补充跟着这一条；短的续话接着上一条理解。已经点到的同事会自己回复。",
  busyReplyHint: (names) => `${names.join("、")}会在当前任务结束后按顺序回复`,
  orderedReplyHint: (names) => `按顺序回复：${names.join("、")}`,
  singleReplyHint: (name) => `将叫 ${name} 回复`,
  stopLabel: "停止当前任务",
  stopDetail: "终止当前群聊正在运行和排队的任务",
};

const createCapabilityOptions = (copy: GroupComposerCopy): SlashCommandOption[] => [
  { id: "stop", command: "/stop", group: "会话", label: copy.stopLabel, detail: copy.stopDetail },
  ...goalCapabilityOptions,
  { id: "file", command: "/file", group: "文件", label: "读取附件", detail: "按问题读取并处理已上传文件" },
  { id: "image", command: "/image", group: "MCP 工具", label: "生成或修改图片", detail: "调用已配置的图片能力" },
  { id: "skill", command: "/skill", group: "Skills", label: "使用 Skill", detail: "选择并遵循匹配的 Skill" },
  { id: "app", command: "/app", group: "Apps", label: "使用 App", detail: "选择当前可用连接器" },
];

const findMention = (text: string, caret: number): MentionState | null => {
  const beforeCaret = text.slice(0, caret);
  const match = beforeCaret.match(/(?:^|\s)@([^\s@\n]*)$/u);
  if (!match) return null;
  const atIndex = beforeCaret.lastIndexOf("@");
  return atIndex >= 0 ? { start: atIndex, end: caret, query: match[1].trim() } : null;
};

export function GroupComposer({ agents, disabled, busy = false, error, notice = "", quote = null, mentionRequest = null, copy: copyOverrides, onClearQuote, onSend, onInterrupt }: {
  agents: GroupAgent[];
  disabled: boolean;
  busy?: boolean;
  error: string;
  notice?: string;
  quote?: { id: string; authorName: string; text: string } | null;
  mentionRequest?: { nonce: number; name: string } | null;
  copy?: Partial<GroupComposerCopy>;
  onClearQuote?: () => void;
  onSend: (text: string, attachments?: MediaFile[], replyTo?: { id: string; authorName: string; text: string } | null) => Promise<boolean>;
  onInterrupt: () => Promise<boolean>;
}) {
  const copy = { ...defaultGroupComposerCopy, ...copyOverrides };
  const [text, setText] = useState("");
  const draft = useAttachmentDraft();
  const [mention, setMention] = useState<MentionState | null>(null);
  const [personnelOpen, setPersonnelOpen] = useState(false);
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  const [activeMention, setActiveMention] = useState(0);
  const [activeCapability, setActiveCapability] = useState(0);
  const [collapsedCapabilityGroups, setCollapsedCapabilityGroups] = useState<Record<string, boolean>>({});
  const composerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const mentionOptions = useMemo<MentionOption[]>(() => {
    const query = mention?.query.toLocaleLowerCase() || "";
    // Human mentions are reserved for future multi-user notifications; only Agent mentions route work today.
    // Only employees can be asked to work. Human mentions are not notifications yet.
    const options: MentionOption[] = agents.map((agent) => ({ id: `agent:${agent.id}`, name: agent.name, detail: agent.responsibility, kind: "agent" as const, agentId: agent.id }));
    return options.filter((option) => !query || option.name.toLocaleLowerCase().includes(query)).slice(0, 8);
  }, [agents, mention?.query]);
  const selectedAgentIds = useMemo(() => mentionedAgentIds(text, agents), [agents, text]);
  const selectedNames = selectedAgentIds.map((id) => agents.find((agent) => agent.id === id)?.name || "").filter(Boolean);
  const capabilityOptions = useMemo(() => createCapabilityOptions(copy), [copy.stopDetail, copy.stopLabel]);
  const personnelOptions = useMemo<MentionOption[]>(() => agents
    .filter((agent) => !selectedAgentIds.includes(agent.id))
    .map((agent) => ({
      id: `agent:${agent.id}`,
      name: agent.name,
      detail: agent.responsibility,
      kind: "agent" as const,
      agentId: agent.id,
    })), [agents, selectedAgentIds]);

  const updateMention = (value: string, caret: number) => {
    setMention(findMention(value, caret));
    setActiveMention(0);
  };

  const insertMention = (option: MentionOption) => {
    if (!mention) return;
    const next = `${text.slice(0, mention.start)}@${option.name} ${text.slice(mention.end)}`;
    const caret = mention.start + option.name.length + 2;
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const insertPersonnel = (option: MentionOption) => {
    setPersonnelOpen(false);
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const prefix = caret > 0 && !/\s$/u.test(text.slice(0, caret)) ? " " : "";
    const insertion = `${prefix}@${option.name} `;
    const next = `${text.slice(0, caret)}${insertion}${text.slice(caret)}`;
    const nextCaret = caret + insertion.length;
    setText(next);
    setMention(null);
    setActiveMention(0);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const insertCapability = (option: SlashCommandOption) => {
    if (option.id === "stop") {
      setCapabilityOpen(false);
      void onInterrupt();
      return;
    }
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const prefix = caret > 0 && !/\s$/u.test(text.slice(0, caret)) ? " " : "";
    const insertion = `${prefix}${option.command} `;
    const next = `${text.slice(0, caret)}${insertion}${text.slice(caret)}`;
    const nextCaret = caret + insertion.length;
    setText(next);
    setCapabilityOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  };

  const submit = async () => {
    if (submittingRef.current || disabled || draft.uploading || (!text.trim() && !draft.attachments.length)) return;
    submittingRef.current = true;
    try {
      const uploaded = await draft.uploadAll();
      if (await onSend(text, uploaded, quote)) {
        setText("");
        setMention(null);
        draft.clear();
      }
    } catch {}
    finally { submittingRef.current = false; }
  };
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
  }, [text]);
  useEffect(() => {
    const node = composerRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      const shell = node.closest("main");
      if (!(shell instanceof HTMLElement)) return;
      shell.style.setProperty("--group-composer-cover", `${Math.ceil(node.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      const shell = node.closest("main");
      if (shell instanceof HTMLElement) shell.style.removeProperty("--group-composer-cover");
    };
  }, []);
  useEffect(() => {
    if (!mentionRequest?.nonce || !mentionRequest.name) return;
    const mention = `@${mentionRequest.name} `;
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const prefix = caret > 0 && !/\s/u.test(text.slice(caret - 1, caret)) ? " " : "";
    const next = `${text.slice(0, caret)}${prefix}${mention}${text.slice(caret)}`;
    const nextCaret = caret + prefix.length + mention.length;
    setText(next);
    setMention(null);
    setPersonnelOpen(false);
    setCapabilityOpen(false);
    setContextOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [mentionRequest?.nonce]);
  useDismissibleLayer({
    active: personnelOpen,
    onDismiss: () => setPersonnelOpen(false),
    isInside: target => target instanceof Node && Boolean(composerRef.current?.contains(target)),
  });
  useDismissibleLayer({
    active: capabilityOpen,
    onDismiss: () => setCapabilityOpen(false),
    isInside: target => target instanceof Element && Boolean(target.closest("[data-capability-menu]")),
  });
  useDismissibleLayer({
    active: contextOpen,
    onDismiss: () => setContextOpen(false),
    isInside: target => target instanceof Element && Boolean(target.closest("[data-context-note]")),
  });
  return (
    <div className={styles.composerArea} ref={composerRef}>
      {error ? <div className={styles.errorText} role="alert">{error}</div> : notice ? <div className={styles.noticeText} role="status">{notice}</div> : null}
      {mention ? (
        <MentionMenu options={mentionOptions} activeIndex={activeMention} onActiveChange={setActiveMention} onSelect={insertMention} />
      ) : personnelOpen ? (
        <div className={styles.personnelMenu}>
          {/* Reserved product entry: selected Agents discuss in rounds, then the manager publishes one consolidated result. */}
          <div className={styles.discussionOption}>
            <MessagesSquare aria-hidden="true" />
            <span><strong>点名</strong><small>{copy.discussionHint}</small></span>
          </div>
          <MentionMenu options={personnelOptions} activeIndex={activeMention} onActiveChange={setActiveMention} onSelect={insertPersonnel} />
        </div>
      ) : contextOpen ? (
        <div className={styles.personnelMenu} data-context-note role="note">
          <div className={styles.discussionOption}>
            <MessagesSquare aria-hidden="true" />
            <span>
              <strong>员工看到的上下文</strong>
              <small>{copy.contextHint}</small>
            </span>
          </div>
        </div>
      ) : capabilityOpen ? (
        <SlashCommandMenu
          options={capabilityOptions}
          collapsedGroups={collapsedCapabilityGroups}
          activeIndex={activeCapability}
          onActiveChange={setActiveCapability}
          onToggleGroup={(group) => {
            setCollapsedCapabilityGroups((current) => ({ ...current, [group]: !current[group] }));
            setActiveCapability(0);
          }}
          onSelect={insertCapability}
        />
      ) : null}
      <div
        className={styles.composer}
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          draft.addFiles(event.dataTransfer.files);
        }}
      >
        <AttachmentPreviews
          attachments={draft.attachments}
          error={draft.error}
          uploading={draft.uploading}
          uploadSlow={draft.uploadSlow}
          onRemove={draft.removeFile}
          onCancelUpload={draft.cancelUpload}
        />
        {quote ? (
        <div className={styles.quoteDraft}>
          <span>回复 {quote.authorName}：{quote.text}</span>
          <button type="button" aria-label="取消引用" onClick={onClearQuote}>取消</button>
        </div>
      ) : null}
        {selectedNames.length ? <p className={styles.orderHint}>{busy ? copy.busyReplyHint(selectedNames) : selectedNames.length > 1 ? copy.orderedReplyHint(selectedNames) : copy.singleReplyHint(selectedNames[0])}</p> : null}
        <textarea
          ref={textareaRef}
          value={text}
          rows={2}
          placeholder={copy.placeholder}
          onChange={(event) => {
            setText(event.target.value);
            setPersonnelOpen(false);
            setCapabilityOpen(false);
            updateMention(event.target.value, event.target.selectionStart);
          }}
          onPaste={(event) => {
            if (!event.clipboardData.files.length) return;
            event.preventDefault();
            draft.addFiles(event.clipboardData.files);
          }}
          onClick={(event) => updateMention(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (mention && mentionOptions.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveMention((index) => (index + direction + mentionOptions.length) % mentionOptions.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                insertMention(mentionOptions[activeMention] || mentionOptions[0]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMention(null);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          disabled={disabled}
        />
        <div className={styles.footer}>
          <div className={styles.leadingControls}>
            <AttachmentButton disabled={disabled || draft.uploading} onFiles={draft.addFiles} />
            <button
              className={styles.commandButton}
              type="button"
              aria-label="打开能力菜单"
              title="打开能力菜单"
              data-capability-menu
              aria-expanded={capabilityOpen}
              aria-haspopup="listbox"
              onMouseDown={(event) => event.preventDefault()}
              disabled={disabled}
              onClick={() => {
                setMention(null);
                setPersonnelOpen(false);
                setActiveCapability(0);
                setCapabilityOpen((value) => !value);
              }}
            >
              <Sparkles aria-hidden="true" />
            </button>
            <button
              className={styles.commandButton}
              type="button"
              aria-expanded={personnelOpen}
              aria-haspopup="listbox"
              aria-label="点名员工"
              onMouseDown={(event) => event.preventDefault()}
              title={selectedAgentIds.length ? `已指定 ${selectedAgentIds.length} 人` : "指定人员"}
              disabled={disabled}
              onClick={() => {
                setMention(null);
                setCapabilityOpen(false);
                setActiveMention(0);
                setPersonnelOpen((value) => !value);
              }}
            >
              <AtSign aria-hidden="true" />
            </button>
            {busy && (text.trim() || draft.attachments.length) ? (
              <button className={styles.commandButton} type="button" aria-label={copy.stopLabel} title={copy.stopLabel} onClick={() => void onInterrupt()}>
                <Square className={styles.stopIcon} aria-hidden="true" />
              </button>
            ) : null}
          </div>
          <span className={styles.composerSpacer} />
          <div className={styles.settingsControls}>
            {/* Reserved for group context management similar to conversation context compaction. */}
            <button
              className={styles.settingTrigger}
              type="button"
              data-context-note
              aria-expanded={contextOpen}
              aria-label="查看员工上下文规则"
              title="查看员工上下文规则"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setMention(null);
                setPersonnelOpen(false);
                setCapabilityOpen(false);
                setContextOpen((value) => !value);
              }}
            >
              <span>上下文</span>
              <ChevronDown aria-hidden="true" />
            </button>
          </div>
          {draft.uploading ? (
            <button className={styles.sendButton} type="button" aria-label="取消上传" title="取消上传" onClick={draft.cancelUpload}>
              <Square className={styles.stopIcon} aria-hidden="true" />
            </button>
          ) : busy && !text.trim() && !draft.attachments.length ? (
            <button className={styles.sendButton} type="button" aria-label={copy.stopLabel} title={copy.stopLabel} onClick={() => void onInterrupt()}>
              <Square className={styles.stopIcon} aria-hidden="true" />
            </button>
          ) : (
            <button className={styles.sendButton} type="button" title={busy ? "加入等候" : "发送"} aria-label={busy ? "加入等候" : "发送"} disabled={disabled || (!text.trim() && !draft.attachments.length)} onClick={() => void submit()}><Send aria-hidden="true" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
