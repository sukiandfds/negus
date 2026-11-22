import { toolOptions } from "../../conversations/components/toolOptions";
import { MessageInput } from "../../conversations/components/MessageInput";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Send, Sparkles, Square } from "lucide-react";
import { AttachmentButton, AttachmentPreviews } from "../../attachments/components/AttachmentDraft";
import { useAttachmentDraft } from "../../attachments/hooks/useAttachmentDraft";
import { SlashCommandMenu, type SlashCommandOption } from "../../conversations/components/SlashCommandMenu";
import { QuoteDraft } from "../../conversations/components/QuoteDraft";
import { MessageEditingBar } from "../../conversations/components/MessageEditingBar";
import { goalCapabilityOptions } from "../../goals/model/capability";
import type { MediaFile } from "../../../shared/model/media";
import { useDismissibleLayer } from "../../../shared/hooks/useDismissibleLayer";
import composerStyles from "../../conversations/components/ConversationComposer.module.css";
import styles from "./GroupComposer.module.css";

export interface GroupComposerCopy {
  placeholder: string;
  stopLabel: string;
  stopDetail: string;
}

export const defaultGroupComposerCopy: GroupComposerCopy = {
  placeholder: "发送消息给运营管理；也可以 @ 指定员工",
  stopLabel: "停止当前任务",
  stopDetail: "终止当前群聊正在运行和排队的任务",
};

const createCapabilityOptions = (copy: GroupComposerCopy): SlashCommandOption[] => [
  { id: "stop", command: "/stop", group: "会话", label: copy.stopLabel, detail: copy.stopDetail },
  ...goalCapabilityOptions,
  ...toolOptions,
];

export function GroupComposer({ disabled, busy = false, error, notice = "", quote = null, editingMessage = null, copy: copyOverrides, onClearQuote, onSend, onEdit, onCancelEdit, onInterrupt }: {
  disabled: boolean;
  busy?: boolean;
  error: string;
  notice?: string;
  quote?: { id: string; authorName: string; text: string } | null;
  editingMessage?: { id: string; text: string } | null;
  copy?: Partial<GroupComposerCopy>;
  onClearQuote?: () => void;
  onSend: (text: string, attachments?: MediaFile[], replyTo?: { id: string; authorName: string; text: string } | null, finishUpload?: (id: string) => Promise<MediaFile[]>) => Promise<boolean>;
  onEdit?: (messageId: string, text: string) => Promise<boolean>;
  onCancelEdit?: () => void;
  onInterrupt: () => Promise<boolean>;
}) {
  const copy = { ...defaultGroupComposerCopy, ...copyOverrides };
  const [text, setText] = useState("");
  const draft = useAttachmentDraft();
  const [capabilityOpen, setCapabilityOpen] = useState(false);
  const [activeCapability, setActiveCapability] = useState(0);
  const [collapsedCapabilityGroups, setCollapsedCapabilityGroups] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const submittingRef = useRef(false);
  const inputId = useId();
  const capabilityOptions = useMemo(() => createCapabilityOptions(copy), [copy.stopDetail, copy.stopLabel]);

  useDismissibleLayer({
    active: capabilityOpen,
    onDismiss: () => setCapabilityOpen(false),
    isInside: target => target instanceof Element && Boolean(target.closest("[data-capability-menu]")),
  });

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
    const transfer = !editingMessage && draft.attachments.length ? draft.prepareMessageAttachments() : null;
    try {
      const accepted = editingMessage && onEdit
        ? await onEdit(editingMessage.id, text)
        : await onSend(text, transfer?.previews || [], quote, transfer?.finishUpload);
      if (accepted) setText("");
    } finally {
      transfer?.dispose();
      submittingRef.current = false;
    }

  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  useEffect(() => {
    if (!editingMessage) return;
    setText(editingMessage.text);
    setCapabilityOpen(false);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(editingMessage.text.length, editingMessage.text.length);
    });
  }, [editingMessage?.id]);

  return (
    <div className={composerStyles.positioner}>
      {error ? <div className={styles.errorText} role="alert">{error}</div> : notice ? <div className={styles.noticeText} role="status">{notice}</div> : null}
      <div
        className={composerStyles.composer}
        aria-label="群聊输入"
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
          if (editingMessage) return;
          if (!event.dataTransfer.files.length) return;
          event.preventDefault();
          draft.addFiles(event.dataTransfer.files);
        }}
      >
        {capabilityOpen ? (
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
        {editingMessage ? <MessageEditingBar preview={editingMessage.text || "附件指令"} onCancel={() => {
          setText("");
          draft.clear();
          onCancelEdit?.();
        }} /> : null}
        <AttachmentPreviews
          attachments={draft.attachments}
          error={draft.error}
          uploading={draft.uploading}
          uploadSlow={draft.uploadSlow}
          onRemove={draft.removeFile}
          onCancelUpload={draft.cancelUpload}
        />
        <label className={composerStyles.srOnly} htmlFor={inputId}>发送群聊消息</label>
        <QuoteDraft quote={editingMessage ? null : quote} onClear={onClearQuote} />
        <MessageInput
          id={inputId}
          ref={textareaRef}
          value={text}
          placeholder={editingMessage ? "修改自己的消息" : copy.placeholder}
          onChange={(event) => setText(event.target.value)}
          submit={submit} onFiles={editingMessage ? undefined : draft.addFiles}
          disabled={disabled}
        />
        <div className={composerStyles.footer}>
          <div className={composerStyles.leadingControls} onPointerDown={() => textareaRef.current?.blur()}>
            <AttachmentButton disabled={disabled || draft.uploading || Boolean(editingMessage)} onFiles={draft.addFiles} />
            <button
              className={composerStyles.commandButton}
              type="button"
              aria-label="打开能力菜单"
              title="打开能力菜单"
              data-capability-menu
              aria-expanded={capabilityOpen}
              aria-haspopup="listbox"
              onMouseDown={(event) => event.preventDefault()}
              disabled={disabled}
              onClick={() => {
                setActiveCapability(0);
                setCapabilityOpen((value) => !value);
              }}
            >
              <Sparkles aria-hidden="true" />
            </button>
          </div>
          <span className={composerStyles.spacer} />
          {draft.uploading ? (
            <button className={composerStyles.sendButton} type="button" aria-label="取消上传" title="取消上传" onClick={draft.cancelUpload}>
              <Square className={composerStyles.stopIcon} aria-hidden="true" />
            </button>
          ) : busy && !text.trim() && !draft.attachments.length ? (
            <button className={composerStyles.sendButton} type="button" aria-label={copy.stopLabel} title={copy.stopLabel} onClick={() => void onInterrupt()}>
              <Square className={composerStyles.stopIcon} aria-hidden="true" />
            </button>
          ) : (
            <button className={composerStyles.sendButton} type="button" title={editingMessage ? "重新发送" : busy ? "加入等候" : "发送"} aria-label={editingMessage ? "重新发送" : busy ? "加入等候" : "发送"} disabled={disabled || !text.trim() && (Boolean(editingMessage) || !draft.attachments.length)} onClick={() => void submit()}><Send aria-hidden="true" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
