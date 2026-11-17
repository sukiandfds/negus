import { useCallback, useEffect, useRef, useState } from "react";
import { hasAccessToken, withAccessToken } from "../../../shared/api/http";
import { createClientId } from "../../../shared/id/clientId";
import { employeeGrowthApi } from "../data/employeeGrowthApi";
import type { EmployeeGrowthResponse, GrowthFact, GrowthProposal, GrowthProposalStatus } from "../model/types";

const refreshIntervalMs = 8000;
const normalizeProposal = (item: GrowthProposal): GrowthProposal => {
  const raw = item as GrowthProposal & { kind?: string; text?: string; writeStatus?: string };
  return {
    ...raw,
    category: raw.category || raw.kind || "rule",
    content: raw.content || raw.text || "",
    status: raw.writeStatus === "failed" ? "failed" : raw.status === "pending" ? "ready" : raw.status,
  };
};
const normalize = (payload: EmployeeGrowthResponse | null | undefined): GrowthProposal[] => (
  Array.isArray(payload?.proposals) ? payload.proposals
    .filter((item) => item && item.id && item.status !== "deleted" && (item.content || (item as GrowthProposal & { text?: string }).text))
    .map(normalizeProposal) : []
);

export function useEmployeeGrowth(employeeId: string) {
  const [facts, setFacts] = useState<GrowthFact[]>([]);
  const [proposals, setProposals] = useState<GrowthProposal[]>([]);
  const [loading, setLoading] = useState(Boolean(employeeId));
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");
  const requestVersionRef = useRef(0);
  const ruleRequestIdsRef = useRef(new Map<string, string>());

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (busyId) return null;
    const requestVersion = ++requestVersionRef.current;
    if (!employeeId) { setFacts([]); setProposals([]); setLoading(false); return null; }
    try {
      const result = await employeeGrowthApi.list(employeeId, signal);
      if (signal?.aborted || requestVersion !== requestVersionRef.current) return null;
      setFacts(Array.isArray(result?.facts) ? result.facts.filter((item) => item?.id && item.text) : []);
      const current = normalize(result);
      setProposals(current);
      setError("");
      return current;
    } catch (reason) {
      if (!signal?.aborted && requestVersion === requestVersionRef.current) {
        setError(reason instanceof Error ? reason.message : String(reason));
      }
      return null;
    } finally {
      if (!signal?.aborted && requestVersion === requestVersionRef.current) setLoading(false);
    }
  }, [busyId, employeeId]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(Boolean(employeeId));
    void refresh(controller.signal);
    if (!employeeId) return () => controller.abort();
    const timer = window.setInterval(() => void refresh(controller.signal), refreshIntervalMs);
    let source: EventSource | null = null;
    if (hasAccessToken && typeof EventSource !== "undefined") {
      source = new EventSource(withAccessToken("/events"));
      source.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as { type?: string; employeeId?: string };
          if (payload.employeeId === employeeId && payload.type?.startsWith("employee_growth")) void refresh(controller.signal);
        } catch { /* polling remains the fallback */ }
      };
    }
    return () => { controller.abort(); window.clearInterval(timer); source?.close(); };
  }, [employeeId, refresh]);

  const setProposalStatus = useCallback((proposalId: string, status: GrowthProposalStatus) => {
    setProposals((current) => current.map((item) => item.id === proposalId ? { ...item, status } : item));
  }, []);
  const decide = useCallback(async (proposalId: string, action: "approve" | "reject") => {
    if (!employeeId || busyId) return false;
    const previousStatus = proposals.find(item => item.id === proposalId)?.status || "ready";
    requestVersionRef.current += 1;
    setBusyId(proposalId);
    setProposalStatus(proposalId, "pending");
    try {
      const result = action === "approve"
        ? await employeeGrowthApi.approve(employeeId, proposalId)
        : await employeeGrowthApi.reject(employeeId, proposalId);
      const normalized = normalizeProposal(result);
      setProposals((current) => current.map((item) => item.id === proposalId ? { ...item, ...normalized } : item));
      window.dispatchEvent(new CustomEvent("negus:project-status-changed"));
      return true;
    } catch (reason) {
      setProposalStatus(proposalId, previousStatus);
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    } finally { setBusyId(""); }
  }, [busyId, employeeId, proposals, setProposalStatus]);

  const mutateRule = async (id: string, action: "disable-rule" | "delete-rule") => {
    if (!employeeId || busyId) return false;
    const requestKey = `${employeeId}:${id}:${action}`;
    const requestId = ruleRequestIdsRef.current.get(requestKey) || createClientId("growth");
    ruleRequestIdsRef.current.set(requestKey, requestId);
    requestVersionRef.current += 1; setBusyId(id);
    try {
      const result = normalizeProposal(await employeeGrowthApi.change(employeeId, id, action, requestId));
      ruleRequestIdsRef.current.delete(requestKey);
      setProposals(current => result.status === "deleted" ? current.filter(item => item.id !== id) : current.map(item => item.id === id ? result : item));
      setError("");
      await refresh();
      return true;
    } catch (reason) {
      const current = await refresh();
      const aligned = current && (action === "delete-rule"
        ? !current.some(item => item.id === id)
        : current.some(item => item.id === id && item.status === "disabled"));
      if (aligned) {
        ruleRequestIdsRef.current.delete(requestKey);
        setError("");
        return true;
      }
      setError(reason instanceof Error ? reason.message : String(reason));
      return false;
    }
    finally { setBusyId(""); }
  };
  const add = async (text: string) => {
    if (!employeeId || busyId) return false;
    requestVersionRef.current += 1; setBusyId("new");
    try {
      const result = normalizeProposal(await employeeGrowthApi.add(employeeId, text));
      setProposals(current => [...current.filter(item => item.id !== result.id), result]); setError(""); return result.status === "approved";
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); return false; }
    finally { setBusyId(""); }
  };
  return { facts, proposals, loading, error, busyId, add, change: mutateRule, approve: (id: string) => decide(id, "approve"), reject: (id: string) => decide(id, "reject"), refresh };
}
