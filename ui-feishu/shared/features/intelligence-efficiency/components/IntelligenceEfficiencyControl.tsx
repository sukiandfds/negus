import {createCachedResource} from '../../../shared/state/localCache';
import { formatModelDisplayName } from '../../models/model/modelDisplayName';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ArrowDown, ArrowUp, Radar, RefreshCw, RotateCcw, X } from "lucide-react";
import { readIntelligenceEfficiency } from "../data/intelligenceEfficiencyApi";
import type { IntelligenceEfficiencyPoint, IntelligenceEfficiencySnapshot } from "../model/types";
import { readStorage, writeStorage } from "../../../shared/state/storage";
import styles from "./IntelligenceEfficiencyControl.module.css";

const radar=createCachedResource<IntelligenceEfficiencySnapshot>("negus:radar-scores:v1",
  (value):value is IntelligenceEfficiencySnapshot=>!!value && typeof value==='object' && 'points' in value && Array.isArray(value.points) && value.points.length>0 && value.points.every(p=>p && typeof p.model==='string' && typeof p.effort==='string' && Number.isFinite(p.iq)));
const load=()=>radar.refresh(readIntelligenceEfficiency).catch(()=>{});
const FILTER_STORAGE_KEY = "negus:radar-hidden-models";
type SortKey = "iq" | "average_minutes" | "average_price_usd";

const modelLabel = formatModelDisplayName;
const sortedPoints = (points: IntelligenceEfficiencyPoint[], sortKey: SortKey, direction: "asc" | "desc") => {
  const multiplier = direction === "asc" ? 1 : -1;
  return [...points].sort((left, right) => (left[sortKey]===null?1:right[sortKey]===null?-1:(left[sortKey]! - right[sortKey]!) * multiplier));
};

export function IntelligenceEfficiencyControl() {
  const [open, setOpen] = useState(false);
  const {data:snapshot,refreshing:loading,error}=useSyncExternalStore(radar.subscribe,radar.getSnapshot);
  const [hiddenModels,setHiddenModels]=useState<string[]>(()=>{const v=readStorage<unknown>(FILTER_STORAGE_KEY);return Array.isArray(v)?v:[];});
  const [sortKey, setSortKey] = useState<SortKey>("iq");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const rootRef = useRef<HTMLDivElement>(null);

  const availableModels = useMemo(() => snapshot ? [...new Set(snapshot.points.map((point) => point.model))] : [], [snapshot]);
  const visibleModels = availableModels.filter((model) => !hiddenModels.includes(model));
  const allSelected = availableModels.length > 0 && visibleModels.length === availableModels.length;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const persistModels = (models: string[]) => {
    setHiddenModels(models);
    writeStorage(FILTER_STORAGE_KEY, models);
  };
  const reset = () => {
    persistModels([]);
    setSortKey("iq");
    setDirection("desc");
  };
  const toggleModel = (model: string) => {
    persistModels(hiddenModels.includes(model) ? hiddenModels.filter(item=>item!==model) : [...hiddenModels,model]);
  };
  const showAll = () => persistModels([]);
  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loading) void load();
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button className={styles.trigger} type="button" aria-label="查看智力效率" title="智力效率" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <Radar aria-hidden="true" />
      </button>
      {open ? (
        <section className={styles.popover} role="dialog" aria-label="智力效率">
          <header className={styles.header}>
            <div><h2>智力效率</h2><p>{snapshot ? `150 分制 · ${snapshot.round}` : "Codex Radar 社区众测数据"}</p></div>
            <div className={styles.headerActions}>
              <button className={styles.actionButton} type="button" aria-label="刷新智力效率" title="刷新" disabled={loading} onClick={() => void load()}><RefreshCw className={loading ? styles.spinning : ""} aria-hidden="true" /></button>
              <button className={styles.closeButton} type="button" aria-label="关闭" title="关闭" onClick={() => setOpen(false)}><X aria-hidden="true" /></button>
            </div>
          </header>
          {snapshot ? (
            <>
              <div className={styles.controls}>
                <div className={styles.filterRow}>
                  <span className={styles.controlLabel}>模型</span>
                  <button className={`${styles.filterButton} ${allSelected ? styles.active : ""}`} type="button" aria-pressed={allSelected} onClick={showAll}>全部</button>
                  {availableModels.map((model) => <button key={model} className={`${styles.filterButton} ${!hiddenModels.includes(model) ? styles.active : ""}`} type="button" aria-pressed={!hiddenModels.includes(model)} onClick={() => toggleModel(model)}>{modelLabel(model)}</button>)}
                </div>
                <div className={styles.sortRow}>
                  <label className={styles.sortLabel} htmlFor="intelligence-efficiency-sort">排序</label>
                  <select id="intelligence-efficiency-sort" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="iq">智力分</option><option value="average_minutes">用时</option><option value="average_price_usd">成本</option></select>
                  <button className={styles.actionButton} type="button" aria-label={direction === "desc" ? "降序" : "升序"} title={direction === "desc" ? "降序" : "升序"} onClick={() => setDirection((value) => value === "desc" ? "asc" : "desc")}>{direction === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}</button>
                  <button className={styles.textButton} type="button" onClick={reset}><RotateCcw aria-hidden="true" />重置</button>
                </div>
              </div>
              <div className={styles.cardViewport}>
                {visibleModels.length ? visibleModels.map((model) => (
                  <section className={`${styles.modelGroup} ${styles.defaultTone}`} key={model}>
                    <h3>{modelLabel(model)}</h3>
                    <div className={styles.cardGrid}>
                      {sortedPoints(snapshot.points.filter((point) => point.model === model), sortKey, direction).map((point) => (
                        <article className={styles.card} key={`${point.model}:${point.effort}`}>
                          <div className={styles.cardHead}><strong>{modelLabel(point.model)} {point.effort}</strong>{point.valid_tasks ? <span>{point.valid_tasks}</span> : null}</div>
                          <div className={styles.cardMain}>{point.iq.toFixed(1)}</div>
                          <div className={styles.cardMeta}><span>{point.average_price_usd===null?'—':'$'+point.average_price_usd.toFixed(2)}</span><span>{point.average_minutes===null?'—':point.average_minutes.toFixed(1)+' 分钟'}</span></div>
                        </article>
                      ))}
                    </div>
                  </section>
                )) : <div className={styles.empty}>请至少选择一个模型</div>}
              </div>
            </>
          ) : <div className={styles.state}><p>{loading ? "正在读取智力效率数据..." : error || "暂无数据"}</p>{error ? <button type="button" onClick={() => void load()}>重试</button> : null}</div>}
          {error && snapshot && <p role="alert">读取最新榜单失败，当前显示上次结果。</p>}
          <footer className={styles.footer}><span>数据仅供模型选择参考</span><a href="https://codexradar.com" target="_blank" rel="noreferrer">Codex Radar</a></footer>
        </section>
      ) : null}
    </div>
  );
}
