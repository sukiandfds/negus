import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Send, Sparkles, Square } from "lucide-react";
import { AttachmentButton, AttachmentPreviews } from "../../attachments/components/AttachmentDraft";
import { useAttachmentDraft } from "../../attachments/hooks/useAttachmentDraft";
import { SlashCommandMenu, type SlashCommandOption } from "../../conversations/components/SlashCommandMenu";
import { QuoteDraft } from "../../conversations/components/QuoteDraft";
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
  { id: "file", command: "/file", group: "文件", label: "读取附件", detail: "按问题读取并处理已上传文件" },
  { id: "image", command: "/image", group: "MCP 工具", label: "生成或修改图片", detail: "调用已配置的图片能力" },
  { id: "skill", command: "/skill", group: "Skills", label: "使用 Skill", detail: "选择并遵循匹配的 Skill" },
  { id: "app", command: "/app", group: "Apps", label: "使用 App", detail: "选择当前可用连接器" },
];

export function GroupComposer({ disabled, busy = false, error, notice = "", quote = null, copy: copyOverrides, onClearQuote, onSend, onInterrupt }: {
  disabled: boolean;
  busy?: boolean;
  error: string;
  notice?: string;
  quote?: { id: string; authorName: string; text: string } | null;
  copy?: Partial<GroupComposerCopy>;
  onClearQuote?: () => void;
  onSend: (text: string, attachments?: MediaFile[], replyTo?: { id: string; authorName: string; text: string } | null) => Promise<boolean>;
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
    try {
      const uploaded = await draft.uploadAll();
      if (await onSend(text, uploaded, quote)) {
        setText("");
        draft.clear();
      }
    } catch {}
    finally { submittingRef.current = false; }
  };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, [text]);

  return (
    <div className={composerStyles.positioner}>
      {error ? <div className={styles.errorText} role="alert">{error}</div> : notice ? <div className={styles.noticeText} role="status">{notice}</div> : null}
      <div
        className={composerStyles.composer}
        aria-label="群聊输入"
        onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onDrop={(event) => {
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
        <AttachmentPreviews
          attachments={draft.attachments}
          error={draft.error}
          uploading={draft.uploading}
          uploadSlow={draft.uploadSlow}
          onRemove={draft.removeFile}
          onCancelUpload={draft.cancelUpload}
        />
        <label className={composerStyles.srOnly} htmlFor={inputId}>发送群聊消息</label>
        <QuoteDraft quote={quote} onClear={onClearQuote} />
        <textarea
          id={inputId}
          ref={textareaRef}
          value={text}
          rows={2}
          placeholder={copy.placeholder}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            if (!event.clipboardData.files.length) return;
            event.preventDefault();
            draft.addFiles(event.clipboardData.files);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
          disabled={disabled}
        />
        <div className={composerStyles.footer}>
          <div className={composerStyles.leadingControls} onPointerDown={() => textareaRef.current?.blur()}>
            <AttachmentButton disabled={disabled || draft.uploading} onFiles={draft.addFiles} />
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
            <button className={composerStyles.sendButton} type="button" title={busy ? "加入等候" : "发送"} aria-label={busy ? "加入等候" : "发送"} disabled={disabled || (!text.trim() && !draft.attachments.length)} onClick={() => void submit()}><Send aria-hidden="true" /></button>
          )}
        </div>
      </div>
    </div>
  );
}
