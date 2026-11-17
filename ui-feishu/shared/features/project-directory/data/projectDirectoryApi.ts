import { fetchJson, HttpError } from "../../../shared/api/http";
import { createCachedResource } from "../../../shared/state/localCache";
import type { DirectoryProject, ProjectDirectoryResponse } from "../model/types";

const validProjects = (value: unknown): value is DirectoryProject[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry) && typeof entry === "object" && typeof entry.id === "string");
export const projectDirectoryResource = createCachedResource("negus-project-directory-v1", validProjects);

export const projectDirectoryApi = {
  list: (_signal?: AbortSignal, invalidate = false): Promise<DirectoryProject[]> =>
    projectDirectoryResource.refresh(async () => {
      const read = () => fetchJson<ProjectDirectoryResponse>("/api/project-directory", AbortSignal.timeout(60000));
      // One bounded recovery per invalidation; shared resource still coalesces concurrent callers.
      const response = await read().catch(error => {
        if (error instanceof HttpError ? error.status >= 500 && error.status < 600
          : error instanceof TypeError || ['TimeoutError', 'AbortError'].includes(error?.name)) return read();
        throw error;
      });
      if (!validProjects(response?.projects)) throw new Error("Invalid project directory response");
      return response.projects;
    }, invalidate),
};
