import { ModelInfoDialog } from "../../../shared/components/ModelInfoDialog";
import {createCachedResource} from '../../../shared/state/localCache';
import { formatModelDisplayName } from '../../models/model/modelDisplayName';
import { useMemo, useState, useSyncExternalStore, type CSSProperties } from "react";
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
const modelColors = ["#80b1ff", "#c4a1ff", "#66dfbf", "#ffb76d", "#f89fca", "#68d9f2", "#e7d775", "#fa9c99", "#a8dc83", "#a6a9ff"];
const versionOf = (model: string) => modelLabel(model).match(/^[a-z][a-z0-9]*[- ]\d+(?:\.\d+)*/i)?.[0] ?? "其他模型";
const versionOrder = (a: string, b: string) => a === "其他模型" ? 1 : b === "其他模型" ? -1 : b.localeCompare(a, "en", { numeric: true });
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
  const versions = useMemo(() => {
    const groups = new Map<string, Map<string, IntelligenceEfficiencyPoint[]>>();
    for (const point of snapshot?.points ?? []) {
      const version = versionOf(point.model);
      if (!groups.has(version)) groups.set(version, new Map());
      const models = groups.get(version)!;
      if (!models.has(point.model)) models.set(point.model, []);
      models.get(point.model)!.push(point);
    }
    let colorIndex = 0;
    return [...groups].sort(([a], [b]) => versionOrder(a, b)).map(([version, models]) => ({
      version, models: [...models].map(([model, points]) => {
        const index = colorIndex++;
        return { model, points, color: modelColors[index] ?? `hsl(${(index * 137.508) % 360} 72% 74%)` };
      }),
    }));
  }, [snapshot]);
  const availableModels = versions.flatMap(({models}) => models.map(({model}) => model));
  const visibleModels = availableModels.filter((model) => !hiddenModels.includes(model));
  const allSelected = availableModels.length > 0 && visibleModels.length === availableModels.length;

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
    <div className={styles.root}>
      <button className={styles.trigger} type="button" aria-label="查看智力效率" title="智力效率" aria-expanded={open} aria-haspopup="dialog" onClick={toggle}>
        <Radar aria-hidden="true" />
      </button>
      {open ? (
        <ModelInfoDialog className={styles.popover} label="智力效率" onClose={() => setOpen(false)}>
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
                <div className={styles.sortRow}>
                  <span className={styles.controlLabel}>版本</span>
                  <button className={`${styles.filterButton} ${allSelected ? styles.active : ""}`} type="button" aria-pressed={allSelected} onClick={showAll}>全部</button>
                  {versions.map(({version, models}) => {
                    const selected = visibleModels.length === models.length && models.every(({model}) => visibleModels.includes(model));
                    return <button key={version} className={`${styles.filterButton} ${selected ? styles.active : ""}`} type="button" aria-pressed={selected}
                      onClick={() => persistModels(availableModels.filter(model => !models.some(entry => entry.model === model)))}>{version}</button>;
                  })}
                </div>
                <div className={styles.modelFilters}>
                  {versions.map(({version, models}) => <div key={version} className={styles.filterRow} role="group" aria-label={`${version} 模型`}>
                    <span className={styles.controlLabel}>{version}</span>
                    {models.map(({model, color}) => <button key={model} className={`${styles.filterButton} ${styles.modelFilter}`} style={{ "--model-color": color } as CSSProperties}
                      type="button" aria-pressed={!hiddenModels.includes(model)} onClick={() => toggleModel(model)}>{modelLabel(model)}</button>)}
                  </div>)}
                </div>
                <div className={styles.sortRow}>
                  <label className={styles.sortLabel} htmlFor="intelligence-efficiency-sort">排序</label>
                  <select id="intelligence-efficiency-sort" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="iq">智力分</option><option value="average_minutes">用时</option><option value="average_price_usd">成本</option></select>
                  <button className={styles.actionButton} type="button" aria-label={direction === "desc" ? "降序" : "升序"} title={direction === "desc" ? "降序" : "升序"} onClick={() => setDirection((value) => value === "desc" ? "asc" : "desc")}>{direction === "desc" ? <ArrowDown aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}</button>
                  <button className={styles.textButton} type="button" onClick={reset}><RotateCcw aria-hidden="true" />重置</button>
                </div>
              </div>
              <div className={styles.cardViewport}>
                {visibleModels.length ? versions.map(({version, models}) => {
                  const visible = models.filter(({model}) => !hiddenModels.includes(model));
                  if (!visible.length) return null;
                  return <section className={styles.versionSection} key={version} aria-label={version}>
                    <h3>{version}</h3>
                    {visible.map(({model, color, points}) => <section className={styles.modelGroup} aria-label={modelLabel(model)} key={model}
                      style={{ "--model-color": color, "--columns": points.length <= 6 ? points.length : Math.ceil(points.length / 2),
                        "--compact-columns": points.length <= 3 ? points.length : Math.ceil(points.length / 2) } as CSSProperties}>
                      <h4>{modelLabel(model)}</h4>
                      <div className={styles.cardGrid}>
                      {sortedPoints(points, sortKey, direction).map((point) => (
                        <article className={styles.card} key={`${point.model}:${point.effort}`}>
                          <div className={styles.cardHead}><strong>{point.effort}</strong>{point.valid_tasks ? <span>{point.valid_tasks}</span> : null}</div>
                          <div className={styles.cardMain}>{point.iq.toFixed(1)}</div>
                          <div className={styles.cardMeta}><span>{point.average_price_usd===null?'—':'$'+point.average_price_usd.toFixed(2)}</span><span>{point.average_minutes===null?'—':point.average_minutes.toFixed(1)+' 分钟'}</span></div>
                        </article>
                      ))}
                      </div>
                    </section>)}
                  </section>;
                }) : <div className={styles.empty}>请至少选择一个模型</div>}
              </div>
            </>
          ) : <div className={styles.state}><p>{loading ? "正在读取智力效率数据..." : error || "暂无数据"}</p>{error ? <button type="button" onClick={() => void load()}>重试</button> : null}</div>}
          {error && snapshot && <p role="alert">读取最新榜单失败，当前显示上次结果。</p>}
          <footer className={styles.footer}><span>数据仅供模型选择参考</span><a href="https://codexradar.com" target="_blank" rel="noreferrer">Codex Radar</a></footer>
        </ModelInfoDialog>
      ) : null}
    </div>
  );
}
