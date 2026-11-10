import { Check, LoaderCircle, X } from "lucide-react";
import { useState } from "react";
import { useEmployeeGrowth } from "../hooks/useEmployeeGrowth";
import type { GrowthProposal } from "../model/types";
import styles from "./EmployeeGrowthPanel.module.css";

const categoryLabels: Record<string, string> = { fact: "事实记忆", rule: "规则建议", skill: "Skill 建议" };
const statusLabels: Record<string, string> = { ready: "待审批", pending: "处理中", approved: "已生效", disabled: "已停用", rejected: "已拒绝", failed: "保存失败" };

function Proposal({ proposal, busy, onApprove, onReject, onDisable, onDelete }: { proposal: GrowthProposal; busy: boolean; onApprove: () => void; onReject: () => void; onDisable: () => void; onDelete: () => void }) {
  const actionable = proposal.status === "ready" || proposal.status === "failed";
  return (
    <article className={styles.proposal} data-status={proposal.status}>
      <div className={styles.proposalHeader}><strong>{categoryLabels[proposal.category] || proposal.category}</strong><span>{statusLabels[proposal.status] || proposal.status}</span></div>
      {proposal.title ? <h4>{proposal.title}</h4> : null}
      <p>{proposal.content}</p>
      {proposal.error ? <small>{proposal.error}</small> : null}
      {actionable ? (
        <div className={styles.actions}>
          <button type="button" disabled={busy} onClick={onApprove}><Check aria-hidden="true" />批准</button>
          <button type="button" disabled={busy} onClick={onReject}><X aria-hidden="true" />拒绝</button>
        </div>
      ) : null}
      {proposal.category === "rule" && ["approved", "disabled"].includes(proposal.status) ? <div className={styles.actions}>
        {proposal.status === "approved" && <button type="button" disabled={busy} onClick={onDisable}>停用</button>}
        <button type="button" disabled={busy} onClick={onDelete}>删除</button>
      </div> : null}
      {busy ? <LoaderCircle className={styles.spinner} aria-label="处理中" /> : null}
    </article>
  );
}

export function EmployeeGrowthPanel({ employeeId }: { employeeId: string }) {
  const [text, setText] = useState("");
  const growth = useEmployeeGrowth(employeeId);
  if (!employeeId) return null;
  return (
    <section className={styles.panel} aria-label="记忆与能力">
      <header><h3>记忆与能力</h3>{growth.loading ? <LoaderCircle className={styles.spinner} aria-hidden="true" /> : null}</header>
      <form className={styles.proposal} onSubmit={event => { event.preventDefault(); void growth.add(text).then(ok => { if (ok) setText(""); }); }}>
        <label htmlFor="employee-rule">添加规则</label><textarea id="employee-rule" value={text} onChange={event => setText(event.target.value)} maxLength={2000} />
        <div className={styles.actions}><button type="submit" disabled={!text.trim() || Boolean(growth.busyId)}>保存规则</button></div>
      </form>
      {growth.facts.length ? <div className={styles.facts}><strong>已记录事实</strong>{growth.facts.slice(-3).map((fact) => <p key={fact.id}>{fact.text}</p>)}</div> : null}
      {growth.error ? <p className={styles.empty}>{growth.error}</p> : null}
      {!growth.loading && !growth.error && !growth.facts.length && !growth.proposals.length ? <p className={styles.empty}>本次暂无新的成长记录</p> : null}
      {growth.proposals.map((proposal) => <Proposal key={proposal.id} proposal={proposal} busy={Boolean(growth.busyId)} onApprove={() => void growth.approve(proposal.id)} onReject={() => void growth.reject(proposal.id)} onDisable={() => void growth.change(proposal.id, "disable-rule")} onDelete={() => void growth.change(proposal.id, "delete-rule")} />)}
    </section>
  );
}
