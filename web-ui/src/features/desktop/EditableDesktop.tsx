import { useEffect, useRef, useState, type ComponentProps, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { Grip, Plus, Scan, Trash2, X, ArrowDownRight, Pin, PinOff, MessageSquare, MoreHorizontal } from "lucide-react";
import { ContentRenderer } from "../conversations/rendering/ContentRenderer";
import { CurrentTasksWidget } from "./CurrentTasksWidget";
import { AutomationsWidget } from "./AutomationsWidget";
import type { useDesktopWorkspace } from "./useDesktopWorkspace";
import { COLUMNS, ROW, clampRect, overlaps, type DesktopRect, type DesktopTile } from "./desktopLayout";
import { recognizeStroke, shapeRect, type Point, type RegionShape, type StrokeResult } from "./desktopShapes";
import styles from "./EditableDesktop.module.css";

type Props = ComponentProps<typeof CurrentTasksWidget> & { workspace: ReturnType<typeof useDesktopWorkspace>; onDiscuss: () => void; editing: boolean; onEditingChange: (editing: boolean) => void };
type Gesture = { pointerId: number; mode: "draw" | "move" | "resize"; start: Point; current: Point; points: Point[]; tile?: DesktopTile; rect: DesktopRect; width: number };
const position = (rect: DesktopRect): CSSProperties => ({ left: `${rect.x / COLUMNS * 100}%`, top: rect.y * ROW, width: `${rect.w / COLUMNS * 100}%`, height: rect.h * ROW, "--region-height": `${rect.h * ROW - 8}px` } as CSSProperties);

export function EditableDesktop({ workspace, onDiscuss, editing, onEditingChange: setEditing, ...taskProps }: Props) {
  const [focused, setFocused] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState("");
  const [menuTile, setMenuTile] = useState<string | null>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const menuTarget = workspace.tiles.find((tile) => tile.id === menuTile);
  const scroll = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const ghost = useRef<HTMLDivElement>(null);
  const ink = useRef<SVGPolylineElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const suppressClick = useRef(false);
  const height = Math.max(640, ...workspace.tiles.map((tile) => (tile.y + tile.h + 8) * ROW));
  const point = (x: number, y: number): Point => { const rect = canvas.current!.getBoundingClientRect(); return { x: x - rect.left, y: y - rect.top }; };
  const cancelGesture = () => {
    gesture.current = null; cancelAnimationFrame(frame.current);
    if (ghost.current) ghost.current.style.display = "none";
    ink.current?.setAttribute("points", ""); setDragging(false);
  };
  const closeMenu = () => { menu.current?.close(); setMenuTile(null); };
  const finishEditing = () => { cancelGesture(); setEditing(false); setFocused(null); closeMenu(); setHint(""); };
  useEffect(() => { if (menuTile) menu.current?.showModal(); else menu.current?.close(); }, [menuTile]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { if (!taskProps.active) finishEditing(); }, [taskProps.active]);
  useEffect(() => { if (!editing) { cancelGesture(); setFocused(null); closeMenu(); setHint(""); } }, [editing]);
  useEffect(() => {
    const cancel = () => { cancelGesture(); };
    const hidden = () => { if (document.hidden) cancel(); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape" && !menu.current?.open) finishEditing(); };
    window.addEventListener("resize", cancel); window.addEventListener("blur", cancel); window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("resize", cancel); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", hidden); };
  }, []);
  const nextRect = (value: Gesture) => {
    if (!value.tile) return value.rect;
    const end = point(value.current.x, value.current.y);
    const dx = Math.round((end.x - value.start.x) / (value.width / COLUMNS));
    const dy = Math.round((end.y - value.start.y) / ROW);
    return clampRect(value.mode === "move" ? { ...value.tile, x: value.tile.x + dx, y: value.tile.y + dy } : { ...value.tile, w: value.tile.w + dx, h: value.tile.h + dy });
  };
  const tick = () => {
    const value = gesture.current;
    if (!value || !canvas.current) return;
    if (value.mode === "draw") ink.current?.setAttribute("points", value.points.map((p) => `${p.x},${p.y}`).join(" "));
    else if (ghost.current) {
      const box = scroll.current!.getBoundingClientRect();
      if (value.current.y < box.top + 36) scroll.current!.scrollTop -= 6;
      else if (value.current.y > box.bottom - 36) scroll.current!.scrollTop += 6;
      value.rect = nextRect(value);
      Object.assign(ghost.current.style, { display: "block", left: `${value.rect.x / COLUMNS * 100}%`, top: `${value.rect.y * ROW}px`, width: `${value.rect.w / COLUMNS * 100}%`, height: `${value.rect.h * ROW}px` });
    }
    frame.current = requestAnimationFrame(tick);
  };
  const start = (event: ReactPointerEvent, mode: Gesture["mode"], tile?: DesktopTile) => {
    if (!editing || event.button !== 0 || event.isPrimary === false || gesture.current || !canvas.current) return;
    if (tile) { setFocused(tile.id); workspace.setSelectedId(tile.id); }
    if (tile?.pinned) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = point(event.clientX, event.clientY), width = canvas.current.getBoundingClientRect().width;
    gesture.current = { pointerId: event.pointerId, mode, start: p, current: { x: event.clientX, y: event.clientY }, points: [p], tile, width, rect: tile || { x: 0, y: 0, w: 2, h: 2 } };
    setDragging(true); setHint("");
    frame.current = requestAnimationFrame(tick);
  };
  const move = (event: ReactPointerEvent) => {
    const value = gesture.current;
    if (!value || value.pointerId !== event.pointerId) return;
    value.current = { x: event.clientX, y: event.clientY };
    if (value.mode === "draw") {
      const samples = event.nativeEvent.getCoalescedEvents?.() || [];
      for (const sample of samples.length ? samples : [event]) {
        const p = point(sample.clientX, sample.clientY), previous = value.points.at(-1)!;
        if (Math.hypot(p.x - previous.x, p.y - previous.y) >= 2 && value.points.length < 4096) value.points.push(p);
      }
    }
  };
  const createRegion = (result: StrokeResult, shape: RegionShape) => {
    if (!canvas.current || workspace.tiles.length >= 60) { setHint("桌面已满，请先移除不需要的区域。"); return; }
    const rect = shapeRect(result.rect, shape, canvas.current.getBoundingClientRect().width);
    if (workspace.tiles.some((tile) => overlaps(tile, rect))) { setHint("这个范围与已有组件重叠，请在空白处重新画。"); return; }
    const id = crypto.randomUUID();
    workspace.update({ ...rect, id, kind: "content", shape, title: `新区域 ${workspace.tiles.filter((tile) => tile.kind === "content").length + 1}` });
    workspace.setSelectedId(id); setFocused(id); setHint("");
    // Drawing only creates and selects a region. No message/model execution.
  };
  const finish = (event: ReactPointerEvent) => {
    const value = gesture.current;
    if (!value || value.pointerId !== event.pointerId) return;
    value.current = { x: event.clientX, y: event.clientY };
    const end = point(event.clientX, event.clientY);
    if (value.mode === "draw") value.points.push(end);
    const moved = Math.hypot(end.x - value.start.x, end.y - value.start.y) > 5;
    const rect = nextRect(value);
    cancelGesture(); suppressClick.current = true;
    if (value.mode === "draw") {
      const result = recognizeStroke(value.points, value.width);
      if (!result) { setFocused(null); return; }
      createRegion(result, result.shape);
    } else if (moved && value.tile) {
      if (workspace.tiles.some((tile) => tile.id !== value.tile!.id && tile.pinned && overlaps(tile, rect))) { setHint("这里有固定组件，位置已保留。"); return; }
      workspace.update({ ...value.tile, ...rect });
    }
  };
  const discuss = (tile: DesktopTile) => { finishEditing(); workspace.setSelectedId(tile.id); onDiscuss(); };
  return <div ref={scroll} className={`${styles.viewport} ${editing ? styles.customizing : ""}`} onPointerDownCapture={(event) => { suppressClick.current = false; if (event.isPrimary === false) cancelGesture(); }} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancelGesture}
    onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); suppressClick.current = false; } }}
    onContextMenu={(event) => { if (editing) event.preventDefault(); }}>
    {workspace.storageError && <p className={styles.hint} role="alert">布局保存失败，请暂时不要刷新。</p>}
    {hint && <div className={styles.feedback} role="status">{hint}</div>}
    <div ref={canvas} className={`${styles.canvas} ${editing ? styles.editing : ""} ${dragging ? styles.dragging : ""}`} style={{ height }} aria-label="桌面绘制区域"
      onPointerDown={(event) => { if (editing && (event.target as HTMLElement).dataset.drawSurface !== undefined) start(event, "draw"); }}>
      {editing && <><div className={styles.drawSurface} data-draw-surface="" /><div className={`${styles.scrollSafeArea} ${styles.scrollSafeLeft}`} aria-hidden="true" /><div className={`${styles.scrollSafeArea} ${styles.scrollSafeRight}`} aria-hidden="true" /></>}
      {workspace.tiles.map((tile) => <section key={tile.id} data-tile-id={tile.id} data-region-shape={tile.shape || "rectangle"} className={`${styles.tile} ${tile.shape === "circle" ? styles.circleTile : ""} ${focused === tile.id && editing || workspace.selectedId === tile.id ? styles.selected : ""}`} style={position(tile)} aria-label={tile.title}>
        <div className={styles.tileContent} inert={editing}>
          {tile.kind === "tasks" ? <CurrentTasksWidget {...taskProps} active={taskProps.active && !dragging} /> : tile.kind === "automations" ? <AutomationsWidget active={taskProps.active} /> : <div className={styles.contentCard}>
            {!tile.image && tile.content && tile.shape !== "circle" && <button type="button" className={styles.contentTitle} onClick={() => discuss(tile)}>{tile.title}<Scan size={14} /></button>}
            {tile.image ? <button type="button" className={styles.imageArea} aria-label={`修改 ${tile.title} 的图片`} onClick={() => discuss(tile)}><img src={tile.image.src} alt={tile.image.alt} draggable={false} style={tile.image.shape === "rectangle" ? { width: "100%", height: "100%", borderRadius: 0, objectFit: "contain" } : undefined} /></button> : tile.content ? <div className={styles.scrollContent}><ContentRenderer message={tile.content} /></div>
              : <button type="button" className={styles.emptyArea} onClick={() => discuss(tile)}><Plus size={22} /><span>{workspace.requestLabel(tile) || "这里想要什么？"}</span></button>}
          </div>}
        </div>
        {editing && <>
          <button type="button" className={styles.editSurface} aria-label={`选择和移动 ${tile.title}`} onPointerDown={(event) => start(event, "move", tile)} onClick={() => { setFocused(tile.id); workspace.setSelectedId(tile.id); }} onKeyDown={(event) => {
            const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
            if (delta && !tile.pinned) { event.preventDefault(); workspace.update({ ...tile, x: tile.x + delta[0], y: tile.y + delta[1] }); }
          }} />
          {focused === tile.id && <><span className={styles.moveBadge}>{tile.pinned ? <Pin size={15} /> : <Grip size={15} />}</span><button type="button" className={styles.moreButton} aria-label={`管理 ${tile.title}`} onClick={() => setMenuTile(tile.id)}><MoreHorizontal size={16} /></button>
            {!tile.pinned && <button className={styles.resize} type="button" aria-label={`调整 ${tile.title} 大小`} onPointerDown={(event) => start(event, "resize", tile)} onKeyDown={(event) => {
              const delta = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
              if (delta) { event.preventDefault(); workspace.update({ ...tile, w: tile.w + delta[0], h: tile.h + delta[1] }); }
            }}><ArrowDownRight size={16} /></button>}</>}
        </>}
        {!editing && tile.pinned && <span className={styles.pinBadge} aria-label="已固定"><Pin size={10} /></span>}
      </section>)}
      <svg className={styles.ink} aria-hidden="true"><polyline ref={ink} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      <div ref={ghost} className={styles.ghost} aria-hidden="true" />
    </div>
    <dialog ref={menu} className={styles.contextMenu} aria-label="组件菜单" onClose={() => setMenuTile(null)} onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
      {menuTarget && <div><header><strong>{menuTarget.title}</strong><button type="button" aria-label="关闭组件菜单" onClick={closeMenu}><X size={16} /></button></header>
        <button type="button" onClick={() => discuss(menuTarget)}><MessageSquare size={17} />针对该区域对话</button>
        <button type="button" onClick={() => { workspace.update({ ...menuTarget, pinned: !menuTarget.pinned }); closeMenu(); }}>{menuTarget.pinned ? <PinOff size={17} /> : <Pin size={17} />}{menuTarget.pinned ? "取消固定" : "固定"}</button>
        <button type="button" onClick={() => { workspace.remove(menuTarget.id); closeMenu(); setFocused(null); }}><Trash2 size={17} />从桌面移除</button>
        <p>移除组件不会停止或删除后台任务</p>
      </div>}
    </dialog>
  </div>;
}
