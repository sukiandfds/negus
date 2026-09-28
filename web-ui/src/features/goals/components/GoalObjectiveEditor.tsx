import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "@tiptap/markdown";
import styles from "./GoalControl.module.css";

export function GoalObjectiveEditor({ value, disabled, onChange, onSave }: {
  value: string; disabled: boolean; onChange: (value: string) => void; onSave: () => void;
}) {
  const callbacks = useRef({ onChange, onSave });
  callbacks.current = { onChange, onSave };
  const emitted = useRef(value);
  const editor = useEditor({
    extensions: [StarterKit.configure({ link: { openOnClick: false } }), Markdown],
    content: value,
    contentType: "markdown",
    autofocus: "end",
    editable: !disabled,
    editorProps: {
      attributes: { role: "textbox", "aria-label": "目标", "aria-multiline": "true", class: styles.richText },
      handleKeyDown: (_view, event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault(); callbacks.current.onSave(); return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      emitted.current = editor.getMarkdown();
      callbacks.current.onChange(emitted.current);
    },
  });
  useEffect(() => { editor?.setEditable(!disabled); }, [editor, disabled]);
  useEffect(() => {
    if (editor && value !== emitted.current) {
      editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
      emitted.current = value;
    }
  }, [editor, value]);
  return <EditorContent editor={editor} className={styles.editorContent} />;
}
