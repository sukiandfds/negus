import { fetchJson } from "../../../shared/api/http";
import { createCachedResource } from "../../../shared/state/localCache";
import type { DirectoryProject, ProjectDirectoryResponse } from "../model/types";

const validProjects = (value: unknown): value is DirectoryProject[] => Array.isArray(value)
  && value.every((entry) => Boolean(entry) && typeof entry === "object" && typeof entry.id === "string");
export const projectDirectoryResource = createCachedResource("negus-project-directory-v1", validProjects);

export const projectDirectoryApi = {
  list: (_signal?: AbortSignal, invalidate = false): Promise<DirectoryProject[]> =>
    projectDirectoryResource.refresh(async () => {
      const response = await fetchJson<ProjectDirectoryResponse>("/api/project-directory", AbortSignal.timeout(10000));
      if (!validProjects(response?.projects)) throw new Error("Invalid project directory response");
      return response.projects;
    }, invalidate),
};
