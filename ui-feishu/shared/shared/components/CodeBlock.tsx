import { useState } from "react";
import styles from "./CodeBlock.module.css";

export function CodeBlock({ text, language = "", collapsible = true, compact = false }: {
  text: string;
  language?: string;
  collapsible?: boolean;
  compact?: boolean;
}) {
  const [copyFailed, setCopyFailed] = useState(false);
  const long = collapsible && (compact || Array.from(text.replace(/[\r\n]/g, "")).length > 500);
  const copy = async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(text);
      setCopyFailed(false);
    } catch { setCopyFailed(true); }
  };
  const content = <>
    <div className={styles.toolbar}>
      <span>{language || "代码"}</span>
      <button type="button" onClick={copy}>{copyFailed ? "复制失败，重试" : "复制"}</button>
    </div>
    <pre className={styles.body}><code>{text}</code></pre>
  </>;
  return long ? (
    <details className={styles.block}>
      <summary className={styles.summary} title="展开或收起代码">
        <span>{text.trim().split(/\r?\n/, 1)[0] || language || "代码"}</span>
      </summary>
      {content}
    </details>
  ) : <div className={styles.block}>{content}</div>;
}
