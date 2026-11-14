import { fetchJson, postJson } from "../../../shared/api/http";
import { createClientId } from "../../../shared/id/clientId";
import type { EmployeeGrowthResponse, GrowthProposal } from "../model/types";

export const employeeGrowthApi = {
  list: (employeeId: string, signal?: AbortSignal) => fetchJson<EmployeeGrowthResponse>(`/api/employee-growth?employeeId=${encodeURIComponent(employeeId)}`, signal),
  approve: (employeeId: string, proposalId: string, signal?: AbortSignal) => postJson<GrowthProposal>("/api/employee-growth/approve", { employeeId, proposalId, requestId: createClientId("growth") }, signal),
  reject: (employeeId: string, proposalId: string, signal?: AbortSignal) => postJson<GrowthProposal>("/api/employee-growth/reject", { employeeId, proposalId, requestId: createClientId("growth") }, signal),
  add: (employeeId: string, text: string) => postJson<GrowthProposal>("/api/employee-growth/add-rule", { employeeId, text, requestId: createClientId("growth") }),
  change: (employeeId: string, proposalId: string, action: "disable-rule" | "delete-rule", requestId: string) => postJson<GrowthProposal>(`/api/employee-growth/${action}`, { employeeId, proposalId, requestId }),
};
