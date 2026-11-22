import { toolOptions } from "./toolOptions";
import { MessageInput } from "./MessageInput";
import { useEffect, useId, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from "react";
import { ListEnd, Send, Sparkles, Square } from "lucide-react";
import { AttachmentButton, AttachmentPreviews } from "../../attachments/components/AttachmentDraft";
import { useAttachmentDraft } from "../../attachments/hooks/useAttachmentDraft";
import { ContextControl } from "../../context-management/components/ContextControl";
import type { ContextStatus } from "../../context-management/model/types";
import type { ExecutionStatus as ExecutionStatusValue } from "../../execution/model/types";
import { ModelSettingsControl } from "../../models/components/ModelSettingsControl";
import type { CodexModel } from "../../models/model/types";
import type { MediaFile } from "../../../shared/model/media";
import type { FollowUpQueueItem } from "../model/followUpQueue";
import type { SessionMessage } from "../model/types";
import { heartbeatAssistantText, parseHeartbeatUser } from "../rendering/heartbeatMessage";
import { GoalConfirmation } from "../../goals/components/GoalConfirmation";
import { GoalControl } from "../../goals/components/GoalControl";
import type { EditableGoalStatus, ThreadGoal } from "../../goals/model/types";
import { goalCapabilityOptions } from "../../goals/model/capability";
import { SlashCommandMenu, type SlashCommandOption } from "./SlashCommandMenu";
import { QuoteDraft, type MessageQuote } from "./QuoteDraft";
import { MessageEditingBar } from "./MessageEditingBar";
import { useDismissibleLayer } from "../../../shared/hooks/useDismissibleLayer";
import styles from "./ConversationComposer.module.css";

const visibleMessageText = (message: SessionMessage) => parseHeartbeatUser(message.text)?.instructions ?? heartbeatAssistantText(message.text) ?? message.text;

interface SlashState { start: number; end: number; query: string; replaceDraft?: boolean }

const slashCommands: SlashCommandOption[] = [
  { id: "compact", command: "/compact", group: "会话", label: "压缩上下文", detail: "整理当前对话上下文" },
  { id: "stop", command: "/stop", group: "会话", label: "停止任务", detail: "停止当前正在运行的任务" },
  { id: "review", command: "/review", group: "Codex", label: "审查当前项目", detail: "调用原生 Codex reviewer" },
  ...goalCapabilityOptions,
  ...toolOptions,
];

const findSlash = (value: string, caret: number): SlashState | null => {
  const beforeCaret = value.slice(0, caret);
  const match = beforeCaret.match(/^\s*\/([^\s/]*)$/u);
  if (!match) return null;
  const start = beforeCaret.search(/\//u);
  return start >= 0 ? { start, end: caret, query: match[1] || "" } : null;
};

export interface ConversationComposerHandle {
  quoteMessage: (message: SessionMessage) => void;
  editQueuedMessage: (item: FollowUpQueueItem, remove: (id: string) => Promise<boolean>) => Promise<boolean>;
  hasDraft: () => boolean;
  insertForward: (text: string) => boolean;
}

interface ConversationComposerProps {
  ref?: Ref<ConversationComposerHandle>;
  desktopContext?: ReactNode;
  connected: boolean;
  selected: boolean;
  archived: boolean;
  status: ExecutionStatusValue;
  contextStatus: ContextStatus;
  shownModel: string;
  shownEffort: string;
  models: CodexModel[];
  modelsLoading: boolean;
  modelChanging: boolean;
  modelError: string;
  selectedModelUnavailable?: boolean;
  sendPreparationError?: string;
  onPrepareSend?: (queue: boolean) => Promise<string | false>;
  onSend: (text: string, attachments?: MediaFile[], preparedThread?: string, finishUpload?: (submissionId: string) => Promise<MediaFile[]>) => Promise<boolean>;
  onQueue: (text: string, attachments?: MediaFile[], finishUpload?: (id: string) => Promise<MediaFile[]>) => Promise<boolean>;
  queueing: boolean;
  editingMessage: SessionMessage | null;
  onCancelEdit: () => void;
  onInterrupt: () => Promise<boolean>;
  onReview: () => Promise<boolean>;
  goal: ThreadGoal | null;
  goalBusy: boolean;
  goalError: string;
  goalResumePrompt: boolean;
  onDismissGoalResumePrompt: () => void;
  onChangeGoalStatus: (status: EditableGoalStatus) => Promise<boolean>;
  onClearGoal: () => Promise<boolean>;
  onSetGoal: (objective: string, attachments?: MediaFile[]) => Promise<boolean>;
  onEditGoal: (objective: string) => Promise<boolean>;
  onCompactContext: () => Promise<boolean>;
  onAutoCompactThresholdChange: (threshold: number | null) => Promise<boolean>;
  onModelChange: (model: string, reasoningEffort?: string) => Promise<boolean>;
  onReasoningEffortChange: (reasoningEffort: string) => Promise<boolean>;
}

export function ConversationComposer({
  ref,
  desktopContext,
  connected, selected, archived, status, contextStatus,
  shownModel, shownEffort,
  models, modelsLoading, modelChanging, modelError,
  onSend, onPrepareSend, selectedModelUnavailable, sendPreparationError, onQueue, queueing,
  editingMessage, onCancelEdit,
  onInterrupt, onReview, goal, goalBusy, goalError, goalResumePrompt, onDismissGoalResumePrompt, onChangeGoalStatus, onClearGoal, onSetGoal, onEditGoal,
  onCompactContext, onAutoCompactThresholdChange, onModelChange,
  onReasoningEffortChange,
}: ConversationComposerProps) {
  const [text, setText] = useState("");
  const [queueNext, setQueueNext] = useState(false);
  const [quote, setQuote] = useState<MessageQuote | null>(null);
  const [goalConfirmation, setGoalConfirmation] = useState<"replace" | "resume" | null>(null);
  const [slash, setSlash] = useState<SlashState | null>(null);
  const [activeSlash, setActiveSlash] = useState(0);
  const [collapsedSlashGroups, setCollapsedSlashGroups] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const promptId = useId();
  const submittingRef = useRef(false);
  const draft = useAttachmentDraft();
  const [sendingDraft, setSendingDraft] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);
  const inputDisabled = sendingDraft || withdrawing || !selected || archived || queueing || draft.uploading || goalBusy;
  const editing = Boolean(editingMessage);
  const sendToQueue = (queueNext || contextStatus.phase === "compacting") && !editing;
  const sendLabel = editing ? "重新发送" : sendToQueue ? "加入等候队列" : status.active ? "插入发送" : "发送";
  const inheritedAttachments = editingMessage?.blocks?.flatMap((block) => (
    "file" in block && block.file ? [block.file] : []
  )) || [];
  const hasContent = Boolean(text.trim() || draft.attachments.length || inheritedAttachments.length);
  useImperativeHandle(ref, () => ({
    hasDraft: () => Boolean(editing || hasContent || quote || submittingRef.current || draft.uploading),
    insertForward: value => {
      if (inputDisabled || editing || hasContent || quote || submittingRef.current || !value.trim()) {
        draft.setError("请先处理输入框中的草稿，再转发消息");
        return false;
      }
      setText(value);
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
      return true;
    },
    quoteMessage: message => {
      if (!selected || archived) return;
      onCancelEdit();
      setQuote({ id: message.id, authorName: message.authorName || (message.role === "user" ? "我" : "助手"),
        text: visibleMessageText(message) || message.blocks?.map(block => "file" in block && block.file ? block.file.name : `[${block.type}]`).join(" ") || "附件" });
      requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }));
    },
    editQueuedMessage: async (item, remove) => {
      if (inputDisabled || submittingRef.current) return false;
      if (editing || hasContent) {
        draft.setError("请先处理输入框中的草稿，再编辑等待消息");
        textareaRef.current?.focus();
        return false;
      }
      submittingRef.current = true;
      setWithdrawing(true);
      setText(item.text);
      setQuote(null);
      draft.restoreFiles(item.attachments);
      setSlash(null);
      try {
        if (!await remove(item.id)) {
          setText("");
          draft.clear();
          draft.setError("撤回未确认，已退出编辑，请查看原消息状态后重试。");
          return false;
        }
        requestAnimationFrame(() => textareaRef.current?.focus());
        return true;
      } finally {
        submittingRef.current = false;
        setWithdrawing(false);
      }
    },
  }));
  const slashOptions = slash
    ? slashCommands.filter((option) => option.command.slice(1).startsWith(slash.query.toLocaleLowerCase()))
    : [];
  const visibleSlashOptions = slashOptions.filter((option) => !collapsedSlashGroups[option.group]);

  const updateSlash = (value: string, caret: number) => {
    setSlash(findSlash(value, caret));
    setActiveSlash(0);
  };

  const insertSlashCommand = (option: SlashCommandOption) => {
    if (!slash) return;
    if (option.id === "stop") {
      setSlash(null);
      void onInterrupt();
      return;
    }
    const next = slash.replaceDraft
      ? `${option.command} ${text.trim()}`
      : `${text.slice(0, slash.start)}${option.command} ${text.slice(slash.end)}`;
    const caret = slash.replaceDraft ? next.length : slash.start + option.command.length + 1;
    setText(next);
    setSlash(null);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(caret, caret);
    });
  };

  const toggleSlashGroup = (group: string) => {
    setCollapsedSlashGroups((current) => ({ ...current, [group]: !current[group] }));
    setActiveSlash(0);
  };

  const openSlashMenu = () => {
    if (slash) {
      setSlash(null);
      return;
    }
    const textarea = textareaRef.current;
    const caret = textarea?.selectionStart ?? text.length;
    const hasDraft = Boolean(text.trim());
    setSlash({ start: hasDraft ? 0 : caret, end: hasDraft ? text.length : caret, query: "", replaceDraft: hasDraft });
    setActiveSlash(0);
  };

  useDismissibleLayer({
    active: Boolean(slash),
    onDismiss: () => setSlash(null),
    isInside: target => target instanceof Element && Boolean(target.closest("[data-capability-menu]")),
  });

  useEffect(() => {
    if (!editingMessage) return;
    setText(visibleMessageText(editingMessage));
    setQuote(null);
    setSlash(null);
    draft.clear();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [draft.clear, editingMessage?.id]);

  useEffect(() => {
    if (activeSlash >= visibleSlashOptions.length) setActiveSlash(0);
  }, [activeSlash, visibleSlashOptions.length]);

  const submit = async (confirmedGoal = false) => {
    const disabled = inputDisabled || !hasContent;
    if (disabled || submittingRef.current) return;
    const goalMatch = !editing && !quote ? text.trim().match(/^\/goal(?:\s+([\s\S]*))?$/iu) : null;
    if (goalMatch && !confirmedGoal && goal && goal.status !== "complete") {
      setGoalConfirmation(goalMatch[1]?.trim() ? "replace" : "resume");
      return;
    }
    if (goalMatch && !goalMatch[1]?.trim() && !draft.attachments.length && !goal) return;
    submittingRef.current = true;
    const submittedText = text;
    const submittedQuote = quote;
    const messageText = quote ? `${[`引用 ${quote.authorName}：`, quote.text].join("\n").split(/\r?\n/u).map(line => `> ${line}`).join("\n")}\n\n${submittedText}` : submittedText;
    if (!editing && !quote && !draft.attachments.length && !inheritedAttachments.length) {
      const command = submittedText.trim().toLocaleLowerCase();
      if (command === "/compact" || command === "/stop" || command === "/review") {
        setText("");
        setSlash(null);
        try {
          const accepted = command === "/compact"
            ? await onCompactContext()
            : command === "/stop" ? await onInterrupt() : await onReview();
          if (!accepted) setText(submittedText);
        } catch {
          setText(submittedText);
        } finally {
          submittingRef.current = false;
        }
        return;
      }
    }
    let uploaded: MediaFile[] = [];
    try {
      const preparedThread = !goalMatch && onPrepareSend ? await onPrepareSend(sendToQueue) : undefined;
      if (preparedThread === false) return;
      const send = async (files: MediaFile[], finish?: (id: string) => Promise<MediaFile[]>) => {
        const accepted = sendToQueue ? await onQueue(messageText, files, finish)
          : await onSend(messageText, files, preparedThread || undefined, finish);
        if (accepted && sendToQueue) setQueueNext(false);
        return accepted;
      };
      setText("");
      setSlash(null);
      if (!editing && !goalMatch && draft.attachments.length) {
        const transfer = draft.prepareMessageAttachments();
        setSendingDraft(true);
        setQuote(null);
        let accepted: boolean;
        try {
          const finish = async (id: string) => uploaded = await transfer.finishUpload(id);
          accepted = await send(transfer.previews, finish);
        } catch (error) {
          draft.setError(error instanceof Error ? error.message : "附件发送失败");
          accepted = false;
        } finally {
          transfer.dispose();
        }
        if (!accepted) {
          if (uploaded.length) draft.restoreFiles(uploaded);
          setText(current => current || submittedText);
          setQuote(current => current || submittedQuote);
        }
        return;
      }
      uploaded = draft.attachments.length ? await draft.uploadAll() : [];
      const submittedAttachments = editing
        ? [...inheritedAttachments, ...uploaded.filter((attachment) => !inheritedAttachments.some((item) => item.id === attachment.id))]
        : uploaded;
      draft.clear();
      setQuote(current => current === submittedQuote ? null : current);
      const accepted = goalMatch
        ? (goalMatch[1]?.trim() || submittedAttachments.length
          ? await onSetGoal(goalMatch[1]?.trim() || "", submittedAttachments)
          : await onChangeGoalStatus("active"))
        : await send(submittedAttachments);
      if (!accepted) {
        setQuote(current => current || submittedQuote);
        if (uploaded.length) draft.restoreFiles(uploaded);
        setText((current) => current || submittedText);
      }
    } catch {
      setQuote(current => current || submittedQuote);
      if (uploaded.length) draft.restoreFiles(uploaded);
      setText((current) => current || submittedText);
    } finally {
      setSendingDraft(false);
      submittingRef.current = false;
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  return (
      <div className={styles.positioner}>
        {desktopContext}
        <GoalControl goal={goal} busy={goalBusy} error={goalError}
          disabled={!connected || !selected || archived}
          onStatusChange={onChangeGoalStatus} onClear={onClearGoal} onEdit={onEditGoal} />
        {goalResumePrompt && goal ? <GoalConfirmation kind="resume" paused={goal.status === "paused"}
          busy={goalBusy} error={goalError} objective={goal.displayObjective || goal.objective}
          onCancel={onDismissGoalResumePrompt}
          onConfirm={() => { void onChangeGoalStatus("active").then((ok) => { if (ok) onDismissGoalResumePrompt(); }); }} /> : null}
        {goalConfirmation ? <GoalConfirmation
          kind={goalConfirmation} objective={goalConfirmation === "replace" ? text.replace(/^\s*\/goal\s*/iu, "") : goal?.displayObjective || goal?.objective || ""}
          onCancel={() => setGoalConfirmation(null)}
          onConfirm={() => { setGoalConfirmation(null); void submit(true); }} /> : null}
      <div
        className={styles.composer}
        aria-label="Codex 对话输入"
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
          if (inputDisabled || !event.dataTransfer.files.length) return;
          event.preventDefault();
          draft.addFiles(event.dataTransfer.files);
        }}
      >
        <SlashCommandMenu
          options={slashOptions}
          collapsedGroups={collapsedSlashGroups}
          activeIndex={activeSlash}
          onActiveChange={setActiveSlash}
          onToggleGroup={toggleSlashGroup}
          onSelect={insertSlashCommand}
        />
        {editingMessage ? <MessageEditingBar preview={visibleMessageText(editingMessage) || "附件指令"} onCancel={() => {
          setText("");
          draft.clear();
          onCancelEdit();
        }} /> : null}
        <AttachmentPreviews
          attachments={sendingDraft ? [] : draft.attachments}
          error={draft.error}
          uploading={draft.uploading}
          uploadSlow={draft.uploadSlow}
          onRemove={draft.removeFile}
        />
        <label className={styles.srOnly} htmlFor={promptId}>给 Codex 发送指令</label>
        {selectedModelUnavailable ? <small role="alert">所选模型已下架，请换一个模型</small> : null}
        {sendPreparationError ? <small role="alert">{sendPreparationError}</small> : null}
        <QuoteDraft quote={quote} onClear={() => setQuote(null)} />
        {sendToQueue ? <div className={styles.editingBar} role="status">消息将进入等候队列</div> : null}
        <MessageInput
          id={promptId}
          ref={textareaRef}
          value={text}
          placeholder={!selected ? "请选择一个对话" : archived ? "已归档，请先恢复对话" : !sendToQueue && status.active && status.phase !== "submitted" ? "追加指令，引导当前任务" : "给 Codex 发送指令"}
          disabled={inputDisabled}
          onChange={(event) => {
            setText(event.target.value);
            updateSlash(event.target.value, event.target.selectionStart);
          }}
          submit={submit} onFiles={draft.addFiles}
          onClick={(event) => updateSlash(event.currentTarget.value, event.currentTarget.selectionStart)}
          onKeyDown={(event) => {
            if (slash && visibleSlashOptions.length) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const direction = event.key === "ArrowDown" ? 1 : -1;
                setActiveSlash((index) => (index + direction + visibleSlashOptions.length) % visibleSlashOptions.length);
                return;
              }
              if (event.key === "Enter") {
                const exactCommand = slashOptions.some((option) => option.command.slice(1).toLocaleLowerCase() === slash.query.toLocaleLowerCase());
                if (exactCommand) {
                  setSlash(null);
                } else {
                  event.preventDefault();
                  insertSlashCommand(visibleSlashOptions[activeSlash] || visibleSlashOptions[0]);
                  return;
                }
              } else if (event.key === "Tab") {
                event.preventDefault();
                insertSlashCommand(visibleSlashOptions[activeSlash] || visibleSlashOptions[0]);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setSlash(null);
                return;
              }
            }
          }}
        />
        <div className={styles.footer}>
          <div className={styles.leadingControls} onPointerDown={() => textareaRef.current?.blur()}>
            <AttachmentButton disabled={inputDisabled} onFiles={draft.addFiles} />
            <button
              className={styles.commandButton}
              type="button"
              aria-label="打开能力菜单"
              title="打开能力菜单"
              data-capability-menu
              aria-expanded={Boolean(slash)}
              aria-haspopup="listbox"
              onMouseDown={(event) => event.preventDefault()}
              disabled={inputDisabled}
              onClick={openSlashMenu}
            >
              <Sparkles aria-hidden="true" />
            </button>
            <button
              className={styles.commandButton}
              type="button"
              aria-label="等候队列"
              title="等候队列"
              aria-pressed={sendToQueue}
              disabled={inputDisabled || editing}
              onClick={() => setQueueNext(current => !current)}
            >
              <ListEnd aria-hidden="true" />
            </button>
          </div>
          <span className={styles.spacer} />
          <div className={styles.settingsControls}>
            <ModelSettingsControl
              currentModel={shownModel}
              currentEffort={shownEffort}
              models={models}
              loading={modelsLoading}
              changing={modelChanging}
              error={modelError}
              disabled={!selected || archived}
              onModelChange={onModelChange}
              onReasoningEffortChange={onReasoningEffortChange}
            />
            <ContextControl
              status={contextStatus}
              disabled={!connected || !selected || archived}
              onCompact={onCompactContext}
              onThresholdChange={onAutoCompactThresholdChange}
            />
          </div>
          {draft.uploading ? (
            <button
              className={styles.sendButton}
              type="button"
              aria-label="取消图片上传"
              title="取消图片上传"
              onClick={draft.cancelUpload}
            >
              <Square className={styles.stopIcon} aria-hidden="true" />
            </button>
          ) : ((status.active && status.phase !== "submitted") || goal?.status === "active") && !hasContent ? (
            <button
              className={styles.sendButton}
              type="button"
              aria-label="停止当前任务"
              title="停止当前任务"
              disabled={inputDisabled}
              onClick={() => void onInterrupt()}
            >
              <Square className={styles.stopIcon} aria-hidden="true" />
            </button>
          ) : (
            <button
              className={styles.sendButton}
              type="button"
              title={sendLabel}
              aria-label={sendLabel}
              disabled={inputDisabled || !hasContent}
              onClick={() => void submit()}
            >
              <Send aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
