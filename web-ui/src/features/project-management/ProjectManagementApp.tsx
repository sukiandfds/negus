import { ArrowUpRight, BriefcaseBusiness, ClipboardList, Eye, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ViewSwitcher } from "../../components/ViewSwitcher/ViewSwitcher";
import { formatRecordedTimestamp as formatProjectManagementTimestamp } from "../../shared/format/dateTime";
import { createProjectPageDraft, fetchProjectManagement, fetchProjectManagementEntry, readProjectManagementCache } from "./data/projectManagementApi";
import { EntryDetailPanel } from "./components/EntryDetailPanel";
import { EntrySummaryRow } from "./components/EntrySummaryRow";
import { UpdateLogPanel } from "./components/UpdateLogPanel";
import { ProjectMemoryPanel } from "./components/ProjectMemoryPanel";
import { openAgentConversation } from "../agent-sharing/navigation/openAgentConversation";
import type { ProjectManagementDocument, ProjectManagementEntry, ProjectPageDraft } from "./model/types";
import styles from "./ProjectManagementApp.module.css";

export function ProjectManagementApp() {
  const [document, setDocument] = useState<ProjectManagementDocument | null>(() => readProjectManagementCache());
  const [selectedEntry, setSelectedEntry] = useState<ProjectManagementEntry | null>(null);
  const [error, setError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [managerOpening, setManagerOpening] = useState(false);
  const [managerError, setManagerError] = useState("");
  const [pageRequest, setPageRequest] = useState("");
  const [pageLocation, setPageLocation] = useState("");
  const [pageDraftError, setPageDraftError] = useState("");
  const [pageDraftSubmitting, setPageDraftSubmitting] = useState(false);
  const summaryRequestRef = useRef<AbortController | null>(null);
  const detailRequestRef = useRef<AbortController | null>(null);

  const load = useCallback((force = false) => {
    summaryRequestRef.current?.abort();
    const controller = new AbortController();
    summaryRequestRef.current = controller;
    setLoading(true);
    setError("");
    fetchProjectManagement(controller.signal, { force })
      .then(setDocument)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(reason instanceof Error ? reason.message : "项目管理数据读取失败");
      })
      .finally(() => {
        if (summaryRequestRef.current === controller) setLoading(false);
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const cleanup = load();
    return () => {
      cleanup?.();
      detailRequestRef.current?.abort();
    };
  }, [load]);

  const entryMap = useMemo(
    () => new Map((document?.entries || []).map((entry) => [entry.id, entry])),
    [document],
  );

  const openEntry = useCallback((entry: ProjectManagementEntry) => {
    detailRequestRef.current?.abort();
    const controller = new AbortController();
    detailRequestRef.current = controller;
    setSelectedEntry(entry);
    setDetailLoading(true);
    setDetailError("");
    fetchProjectManagementEntry(entry.id, controller.signal)
      .then(setSelectedEntry)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setDetailError(reason instanceof Error ? reason.message : "条目详情读取失败");
      })
      .finally(() => {
        if (detailRequestRef.current === controller) setDetailLoading(false);
      });
  }, []);

  const closeEntry = useCallback(() => {
    detailRequestRef.current?.abort();
    detailRequestRef.current = null;
    setSelectedEntry(null);
    setDetailLoading(false);
    setDetailError("");
  }, []);

  const openProjectManager = useCallback(async () => {
    if (!document?.project || managerOpening) return;
    setManagerError("");
    setManagerOpening(true);
    try {
      await openAgentConversation({
        agentId: "manager",
        projectContext: {
          id: document.project.id,
          title: document.project.title,
          phase: document.project.phase,
          goal: document.project.goal,
        },
      });
    } catch (reason) {
      setManagerError(reason instanceof Error ? reason.message : "暂时无法进入项目经理单聊");
    } finally {
      setManagerOpening(false);
    }
  }, [document?.project, managerOpening]);

  const submitPageDraft = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pageRequest.trim() || pageDraftSubmitting) return;
    setPageDraftSubmitting(true);
    setPageDraftError("");
    try {
      const draft = await createProjectPageDraft({ request: pageRequest.trim(), location: pageLocation.trim() });
      setDocument((current) => current ? { ...current, pageDrafts: [draft, ...(current.pageDrafts || [])] } : current);
      setPageRequest("");
      setPageLocation("");
    } catch (reason) {
      setPageDraftError(reason instanceof Error ? reason.message : "页面草稿创建失败");
    } finally {
      setPageDraftSubmitting(false);
    }
  }, [pageLocation, pageDraftSubmitting, pageRequest]);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <ClipboardList aria-hidden="true" />
        <div className={styles.heading}>
          <h1>项目管理</h1>
          <span>独立数据源 · 摘要优先，详情下钻</span>
        </div>
        <span className={styles.headerSpacer} />
        <ViewSwitcher current="progress" />
        <button className={styles.refreshButton} type="button" onClick={() => load(true)} disabled={loading} title="重新读取项目管理文件">
          <RefreshCw aria-hidden="true" />
          <span>{loading ? "读取中" : "刷新"}</span>
        </button>
      </header>

      <section className={styles.scrollArea}>
        <div className={styles.content}>
          {loading && !document ? <p className={styles.state}>正在读取项目管理目录...</p> : null}
          {error ? (
            <div className={styles.errorState} role="alert">
              <strong>项目管理数据暂时不可用</strong>
              <span>{error}</span>
              <button type="button" onClick={() => load(true)}>重试</button>
            </div>
          ) : null}

          {document ? (
            <>
              <section className={styles.projectOverview}>
                <div className={styles.projectCopy}>
                  <span className={styles.eyebrow}>单项目控制台</span>
                  <h2>{document.project.title}</h2>
                  <p>{document.project.goal}</p>
                </div>
                <div className={styles.projectFacts}>
                  <span><small>阶段</small><strong>{document.project.phase}</strong></span>
                  <span><small>健康</small><strong className={styles[`health-${document.project.health}`] || styles.healthNormal}>{document.project.statusLabel}</strong></span>
                  <span><small>数据更新</small><strong>{formatProjectManagementTimestamp(document.updatedAt)}</strong></span>
                </div>
                <div className={styles.managerAction}>
                  <button className={styles.managerButton} type="button" onClick={() => void openProjectManager()} disabled={managerOpening}>
                    <BriefcaseBusiness aria-hidden="true" />
                    <span>{managerOpening ? "正在进入" : "与项目经理讨论"}</span>
                  </button>
                  {managerError ? <span className={styles.managerError} role="alert">{managerError}</span> : null}
                </div>
              </section>

              <section className={styles.pageBuilder} aria-labelledby="page-builder-title">
                <div className={styles.sectionHeading}>
                  <div>
                    <h2 id="page-builder-title"><Sparkles aria-hidden="true" />按需求创建页面</h2>
                    <p>告诉 Negus 需要什么功能、放在哪里；先生成可检查的结构化草稿，不会自动发布。</p>
                  </div>
                  <span className={styles.draftCount}>{document.pageDrafts?.length || 0} 个草稿</span>
                </div>
                <form className={styles.pageBuilderForm} onSubmit={submitPageDraft}>
                  <label>
                    <span>你需要什么页面或功能</span>
                    <textarea value={pageRequest} onChange={(event) => setPageRequest(event.target.value)} placeholder="例如：给团队增加一个报销发票上传页面，能查看提交记录" maxLength={2000} rows={3} />
                  </label>
                  <label>
                    <span>放在哪里（可选）</span>
                    <input value={pageLocation} onChange={(event) => setPageLocation(event.target.value)} placeholder="例如：项目首页 / 财务区" maxLength={300} />
                  </label>
                  <div className={styles.pageBuilderActions}>
                    <span className={styles.pageBuilderHint}>草稿会保存到当前项目，可继续讨论后再决定发布。</span>
                    <button type="submit" disabled={pageDraftSubmitting || pageRequest.trim().length < 4}><ArrowUpRight aria-hidden="true" />{pageDraftSubmitting ? "生成中" : "生成预览草稿"}</button>
                  </div>
                  {pageDraftError ? <span className={styles.pageBuilderError} role="alert">{pageDraftError}</span> : null}
                </form>
                {document.pageDrafts?.length ? <div className={styles.pageDraftList}>{document.pageDrafts.map((draft) => <PageDraftCard key={draft.id} draft={draft} />)}</div> : <p className={styles.empty}>还没有页面草稿。提交一条需求后，结构化预览会出现在这里。</p>}
              </section>

              <ProjectMemoryPanel document={document} onOpenEntry={openEntry} />

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><h2>当前计划</h2><p>只显示目录中明确列出的计划条目。</p></div>
                  <span className={styles.sectionCount}>{document.plan.length}</span>
                </div>
                {document.plan.length ? (
                  <div className={styles.entryList}>{document.plan.map((entry) => <EntrySummaryRow key={entry.id} entry={entry} onOpen={openEntry} />)}</div>
                ) : <p className={styles.empty}>暂无明确计划。</p>}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><h2>当前进行中</h2><p>只显示目录中明确标记为正在进行的条目。</p></div>
                  <span className={styles.sectionCount}>{document.inProgress.length}</span>
                </div>
                {document.inProgress.length ? (
                  <div className={styles.entryList}>{document.inProgress.map((entry) => <EntrySummaryRow key={entry.id} entry={entry} onOpen={openEntry} />)}</div>
                ) : <p className={styles.empty}>暂无明确进行中的条目。</p>}
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><h2>最近更新</h2><p>每条记录保留时间、变化和用户影响；点击可查看完整条目。</p></div>
                  <span className={styles.sectionCount}>{document.recentUpdates.length}</span>
                </div>
                <UpdateLogPanel updates={document.recentUpdates} entries={entryMap} onOpen={openEntry} />
              </section>

              <section className={styles.section}>
                <div className={styles.sectionHeading}>
                  <div><h2>按分类查看</h2><p>分类默认收起，避免把详情、日志和证据堆在首屏。</p></div>
                  <span className={styles.sectionCount}>{document.stats.total}</span>
                </div>
                <div className={styles.categoryList}>
                  {document.categories.map((category) => (
                    <details key={category.name} className={styles.category}>
                      <summary><span>{category.name}</span><small>{category.entries.length} 条目</small></summary>
                      <div className={styles.entryList}>{category.entries.map((entry) => <EntrySummaryRow key={entry.id} entry={entry} onOpen={openEntry} />)}</div>
                    </details>
                  ))}
                </div>
              </section>
            </>
          ) : null}
        </div>
      </section>

      {selectedEntry ? (
        <EntryDetailPanel
          entry={selectedEntry}
          entries={entryMap}
          onOpenRelated={openEntry}
          onClose={closeEntry}
          loading={detailLoading}
          error={detailError}
        />
      ) : null}
    </main>
  );
}

function PageDraftCard({ draft }: { draft: ProjectPageDraft }) {
  return (
    <article className={styles.pageDraftCard}>
      <div className={styles.pageDraftHeader}>
        <div><span className={styles.entryId}>{draft.id}</span><h3>{draft.title}</h3></div>
        <span className={styles.draftStatus}><Eye aria-hidden="true" />{draft.statusLabel}</span>
      </div>
      <p className={styles.pageDraftRequest}>{draft.request}</p>
      <p className={styles.pageDraftLocation}>页面位置：{draft.location}</p>
      <div className={styles.pageDraftComponents}>
        {draft.components.map((component) => <span key={component.id} title={component.description}>{component.label}</span>)}
      </div>
      <div className={styles.pageDraftBoundary}><strong>{draft.dataBinding.statusLabel}</strong><span>{draft.dataBinding.message}</span></div>
    </article>
  );
}
