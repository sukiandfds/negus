import { createClientId } from "../../../shared/id/clientId";
import { readStorage, writeStorage } from "../../../shared/state/storage";
import type { StoredMember } from "../model/types";

const memberKey = "negus-group-member";
const legacyMemberKey = "codex-collab-group-member";

const isStoredMember = (value: unknown): value is StoredMember => Boolean(
  value && typeof value === "object"
  && typeof (value as StoredMember).id === "string"
  && typeof (value as StoredMember).name === "string"
  && (value as StoredMember).id
  && (value as StoredMember).name,
);

export const createMemberId = () => createClientId("member");

export const readStoredMember = (): StoredMember | null => {
  const current = readStorage<unknown>(memberKey);
  if (isStoredMember(current)) return current;
  const legacy = readStorage<unknown>(legacyMemberKey);
  if (isStoredMember(legacy)) writeStorage(memberKey, legacy);
  return isStoredMember(legacy) ? legacy : null;
};

export const writeStoredMember = (member: StoredMember) => {
  // Storage may be unavailable in private or restricted mobile browsers.
  writeStorage(memberKey, member);
};
