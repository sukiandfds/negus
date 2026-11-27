import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { readJsonFile, writeJsonFileAtomic } from '../persistence/json-file.mjs';

const hash = value => createHash('sha256').update(value).digest();
export const denied = () => Object.assign(Error('接入已撤销或未获授权'), { statusCode: 403 });

// Configuration holds only a verifier, never the issued link. Owner authentication
// belongs at the UI boundary; this service has no MCP mutation registration.
export function externalAccess(projectRoot) {
  const file = path.join(projectRoot, 'runtime', 'external-assistant-access.json');
  const empty = { revision: 0, grants: [], credential: null };
  let pending = Promise.resolve();
  const read = () => readJsonFile(file, empty);
  const visible = s => ({ actor: '00', revision: s.revision, allProjects: s.allProjects === true, projects: s.grants, active: Boolean(s.credential) });
  function mutate(revision, change) {
    const operation = pending.then(async () => {
      const state = await read();
      if (state.revision !== revision) throw Object.assign(Error('授权状态已变化，请刷新后重试'), { statusCode: 409 });
      const [next, result] = change(state);
      next.revision = revision + 1;
      await writeJsonFileAtomic(file, next, { mode: 0o600 });
      return { ...visible(next), ...result };
    });
    pending = operation.catch(() => {});
    return operation;
  }
  return {
    status: async () => visible(await read()),
    issue: revision => mutate(revision, s => {
      if (s.credential) throw Object.assign(Error('请先撤销现有令牌'), { statusCode: 409 });
      const secret = randomBytes(32).toString('base64url');
      return [{ ...s, credential: { id: randomUUID(), digest: hash(secret).toString('hex') } }, { secret }];
    }),
    revoke: revision => mutate(revision, s => [{ ...s, credential: null, allProjects:false, grants: [] }, {}]),
    grant: (revision, ids, allowedIds, allProjects=false) => mutate(revision, s => {
      if (typeof allProjects !== "boolean" || !Array.isArray(ids) || !ids.every(id => typeof id === 'string' && allowedIds.has(id))) throw denied();
      return [{ ...s, allProjects, grants: [...new Set(ids)] }, {}];
    }),
    authorize: async secret => {
      if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw denied();
      const s = await read();
      if (!s.credential || !timingSafeEqual(hash(secret), Buffer.from(s.credential.digest, 'hex'))) throw denied();
      return { actor: '00', id: s.credential.id, revision: s.revision, allProjects: s.allProjects === true, projects: s.grants };
    },
  };
}
