import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { TransformComponent, TransformWrapper, type ReactZoomPanPinchRef } from "react-zoom-pan-pinch";
import styles from "./CodeBlock.module.css";

/** Shared SVG viewer: native dialog traps focus; restore the actual opening control. */
export default function DiagramViewer({ svg, onClose, returnFocusTo }: { svg: string; onClose: () => void; returnFocusTo: HTMLElement | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const controls = useRef<ReactZoomPanPinchRef>(null);
  const fit = () => {
    const viewBox = canvas.current?.querySelector("svg")?.viewBox.baseVal;
    if (!viewBox || !canvas.current) return;
    const scale = Math.min(1, (canvas.current.clientWidth - 32) / viewBox.width, (canvas.current.clientHeight - 32) / viewBox.height);
    controls.current?.centerView(Math.max(0.05, scale), 0);
  };
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    // The transform initializes while the native dialog is still hidden.
    const frame = requestAnimationFrame(fit);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", fit);
      element.close();
      requestAnimationFrame(() => { if (returnFocusTo?.isConnected) returnFocusTo.focus({ preventScroll: true }); });
    };
  }, []);
  return createPortal(
    <dialog ref={dialog} className={styles.viewer} aria-label="流程图放大预览" onClose={onClose}
      onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={styles.viewerLayout}>
        <div className={styles.toolbar}>
          <span>拖动查看 · 滚轮或双指缩放</span>
          <div className={styles.viewerActions}>
            <button type="button" aria-label="缩小图表" onClick={() => controls.current?.zoomOut()}>−</button>
            <button type="button" aria-label="放大图表" onClick={() => controls.current?.zoomIn()}>＋</button>
            <button type="button" onClick={fit}>适应窗口</button>
            <button type="button" onClick={() => controls.current?.centerView(1)}>原始大小</button>
            <button type="button" autoFocus aria-label="关闭图表预览" onClick={onClose}>关闭</button>
          </div>
        </div>
        <div ref={canvas} className={styles.viewerCanvas}>
          <TransformWrapper ref={controls} minScale={0.05} maxScale={8} limitToBounds={false} onInit={fit} doubleClick={{ mode: "reset" }}>
            <TransformComponent wrapperStyle={{ width: "100%", height: "100%" }} contentStyle={{ cursor: "grab" }}>
              <div className={styles.viewerSvg} dangerouslySetInnerHTML={{ __html: svg }} />
            </TransformComponent>
          </TransformWrapper>
        </div>
      </div>
    </dialog>, document.body,
  );
}
