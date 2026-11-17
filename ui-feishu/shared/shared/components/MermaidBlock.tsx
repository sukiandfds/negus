import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import DOMPurify from "dompurify";
import { CodeBlock } from "./CodeBlock";
import styles from "./CodeBlock.module.css";

const loadMermaid = () => import("mermaid").then(({ default: mermaid }) => {
  mermaid.initialize({ startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true,
    maxTextSize: 50000, maxEdges: 500, theme: "dark", htmlLabels: false,
    secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "htmlLabels", "themeCSS", "themeVariables"] });
  return mermaid;
});
let engine: ReturnType<typeof loadMermaid> | undefined;
let serial = 0;
const DiagramViewer = lazy(() => import("./DiagramViewer"));

export function MermaidBlock({ text }: { text: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [result, setResult] = useState({ text: "", svg: "", failed: false });
  const [expanded, setExpanded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const open = (element: HTMLElement) => { opener.current = element; setExpanded(true); };
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        if (text.length > 50000) throw new Error("Diagram too large");
        const mermaid = await (engine ??= loadMermaid().catch(error => { engine = undefined; throw error; }));
        if (cancelled) return;
        const { svg } = await mermaid.render(`mermaid-${id}-${++serial}`, text);
        const safeSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ["a", "image", "foreignObject"] });
        const document = new DOMParser().parseFromString(safeSvg, "image/svg+xml");
        const chart = document.documentElement as unknown as SVGSVGElement;
        const width = chart.viewBox?.baseVal.width;
        if (width && Number.isFinite(width)) chart.style.width = `${width}px`;
        if (!cancelled) setResult({ text, svg: new XMLSerializer().serializeToString(chart), failed: false });
      } catch {
        if (!cancelled) setResult({ text, svg: "", failed: true });
      }
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [text, id]);
  const current = result.text === text;
  return <div className={styles.block}>
    {current && result.svg ? <>
      <div className={styles.toolbar}><span>Mermaid</span><button type="button" onClick={event => open(event.currentTarget)}>放大查看</button></div>
      <div className={styles.diagram} role="button" tabIndex={0} aria-label="Mermaid 流程图" title="点击放大查看"
        onClick={event => open(event.currentTarget)} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); open(event.currentTarget); } }}
        dangerouslySetInnerHTML={{ __html: result.svg }} />
      {expanded && <Suspense fallback={<div role="status">正在打开预览…</div>}><DiagramViewer svg={result.svg} returnFocusTo={opener.current} onClose={() => setExpanded(false)} /></Suspense>}
    </>
      : <div className={styles.toolbar} role="status">{current && result.failed ? "图表代码未完整或语法有误，请查看源码" : "正在绘制图表…"}</div>}
    <details open={current && result.failed}>
      <summary className={styles.summary}>Mermaid 源码</summary>
      <CodeBlock text={text} language="mermaid" collapsible={false} />
    </details>
  </div>;
}
