import { backendUrl } from "./backendBase";

export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isFile: boolean;
  extension: string;
  size?: number;
}

export interface ListResult {
  ok: boolean;
  path: string;
  items: FileEntry[];
  error?: string;
}

export interface ReadResult {
  ok: boolean;
  content: string;
  path: string;
  size: number;
  error?: string;
}

export interface WriteResult {
  ok: boolean;
  path: string;
  size: number;
  error?: string;
}

export interface SearchResult {
  name: string;
  path: string;
  isDirectory: boolean;
}

export interface SearchResults {
  ok: boolean;
  results: SearchResult[];
  error?: string;
}

export interface CreateResult {
  ok: boolean;
  path: string;
  type: string;
  error?: string;
}

export interface DeleteResult {
  ok: boolean;
  path: string;
  error?: string;
}

export interface PickFolderResult {
  ok: boolean;
  path?: string;
  cancelled?: boolean;
  error?: string;
}

export interface ProjectKeyFile {
  path: string;
  content: string;
}

export interface ProjectContextResult {
  ok: boolean;
  path?: string;
  tree?: string;
  keyFiles?: ProjectKeyFile[];
  truncated?: boolean;
  error?: string;
}

export async function fetchProjectContext(projectPath: string): Promise<ProjectContextResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/project-context"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projectPath }),
    });
    const data = (await response.json()) as ProjectContextResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function pickProjectFolder(initialPath?: string): Promise<PickFolderResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/pick-folder"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ initialPath: initialPath || "" }),
    });
    const data = (await response.json()) as PickFolderResult;
    return data;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function listDirectory(dirPath: string): Promise<ListResult> {
  try {
    const url = backendUrl(`/backend/vibe/list?path=${encodeURIComponent(dirPath)}`);
    const response = await fetch(url);
    const data = (await response.json()) as ListResult;
    return data;
  } catch (error) {
    return { ok: false, path: dirPath, items: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function readFile(filePath: string): Promise<ReadResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/read"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath }),
    });
    const data = (await response.json()) as ReadResult;
    return data;
  } catch (error) {
    return { ok: false, content: "", path: filePath, size: 0, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function writeFile(filePath: string, content: string): Promise<WriteResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/write"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: filePath, content }),
    });
    const data = (await response.json()) as WriteResult;
    return data;
  } catch (error) {
    return { ok: false, path: filePath, size: 0, error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function searchFiles(dirPath: string, query: string): Promise<SearchResults> {
  try {
    const url = backendUrl(`/backend/vibe/search?path=${encodeURIComponent(dirPath)}&q=${encodeURIComponent(query)}`);
    const response = await fetch(url);
    const data = (await response.json()) as SearchResults;
    return data;
  } catch (error) {
    return { ok: false, results: [], error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function createItem(itemPath: string, isDirectory: boolean, content?: string): Promise<CreateResult> {
  try {
    const response = await fetch(backendUrl("/backend/vibe/create"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: itemPath, isDirectory, content }),
    });
    const data = (await response.json()) as CreateResult;
    return data;
  } catch (error) {
    return { ok: false, path: itemPath, type: "", error: error instanceof Error ? error.message : "网络错误" };
  }
}

export async function deleteItem(itemPath: string): Promise<DeleteResult> {
  try {
    const url = backendUrl(`/backend/vibe/delete?path=${encodeURIComponent(itemPath)}`);
    const response = await fetch(url, { method: "DELETE" });
    const data = (await response.json()) as DeleteResult;
    return data;
  } catch (error) {
    return { ok: false, path: itemPath, error: error instanceof Error ? error.message : "网络错误" };
  }
}
