import type { Connect } from "vite";
import path from "node:path";
import { readJsonBody, sendJson, sendSseEvent, sendSseHeaders } from "./server/httpUtils";
import { resolveChatEndpoint } from "./server/aiForward";
import {
  gitStatus,
  gitDiff,
  gitDiffContent,
  gitCommitFileDiff,
  gitCommit,
  gitLog,
  gitAheadCommits,
  gitIsRepo,
  gitAdd,
  gitReset,
  gitDiscard,
  gitDiscardAll,
  gitRemotes,
  gitFetch,
  gitPull,
  gitPush,
  gitStashList,
  gitStashSave,
  gitStashPop,
  gitStashApply,
  gitStashDrop,
  gitChangedFilesSince,
} from "./server/vibeGit";
import type { ServerResponse, IncomingMessage } from "node:http";

export function registerGitRoutes(middlewares: Connect.Server) {
  // GET /backend/vibe/git/status
  middlewares.use("/backend/vibe/git/status", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const stat = await fs.promises.stat(resolved).catch(() => null);
      if (!stat || !stat.isDirectory()) {
        sendJson(res, 400, { ok: false, error: "路径不存在或不是目录" });
        return;
      }

      const isRepo = await gitIsRepo(resolved);
      if (!isRepo) {
        sendJson(res, 200, { ok: true, branch: "", files: [], isRepo: false });
        return;
      }

      const result = await gitStatus(resolved);
      sendJson(res, 200, { ...result, isRepo: true });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取 Git 状态失败" });
    }
  });

  // GET /backend/vibe/git/changed-since?path=&since=
  middlewares.use("/backend/vibe/git/changed-since", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const sinceCommit = url.searchParams.get("since") || "";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitChangedFilesSince(resolved, sinceCommit);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取变更文件失败" });
    }
  });

  // GET /backend/vibe/git/diff?path=&staged=
  middlewares.use("/backend/vibe/git/diff", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const staged = url.searchParams.get("staged") === "true";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitDiff(resolved, undefined, staged);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取 diff 失败" });
    }
  });

  // GET /backend/vibe/git/diff-content?path=&file=
  middlewares.use("/backend/vibe/git/diff-content", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const filePath = url.searchParams.get("file") || "";

      if (!projectPath || !filePath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 file 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitDiffContent(resolved, filePath);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取 diff 内容失败" });
    }
  });

  // GET /backend/vibe/git/commit-file-diff?path=&hash=&file=
  middlewares.use("/backend/vibe/git/commit-file-diff", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const hash = url.searchParams.get("hash") || "";
      const file = url.searchParams.get("file") || "";
      const oldFile = url.searchParams.get("oldFile") || undefined;

      if (!projectPath || !hash || !file) {
        sendJson(res, 400, { ok: false, error: "缺少 path、hash 或 file 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitCommitFileDiff(resolved, hash, file, oldFile);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取提交文件 diff 失败" });
    }
  });

  // POST /backend/vibe/git/generate-message
  middlewares.use("/backend/vibe/git/generate-message", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        path?: string;
        endpoint?: string;
        apiKey?: string;
        model?: string;
      };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (!body.endpoint?.trim() || !body.model?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 AI 配置" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const statusResult = await gitStatus(resolved);
      if (!statusResult.ok) {
        sendJson(res, 400, { ok: false, error: statusResult.error || "获取 Git 状态失败" });
        return;
      }
      const diffResult = await gitDiff(resolved, undefined, true);
      if (!diffResult.ok) {
        sendJson(res, 400, { ok: false, error: diffResult.error || "获取已暂存 diff 失败" });
        return;
      }

      const stagedFiles = statusResult.files.filter((f) => f.staged);
      if (!stagedFiles.length) {
        sendJson(res, 200, { ok: true, message: "" });
        return;
      }

      const diffText = diffResult.patch || "";
      const fileList = stagedFiles.map((f) => `${f.status}: ${f.path}`).join("\n");
      const prompt = `你是一个 Git 提交信息生成器。根据以下已暂存的文件变更生成一条准确的中文提交信息。

已暂存文件列表：
${fileList}

Diff 内容：
${diffText.slice(0, 12000)}

要求：
- 使用中文
- 第一行：简洁概括变更（不超过72字符），使用动词开头，描述"做了什么"
- 如果需要，在第一行后空一行，提供更详细的说明（可选）
- 分析变更类型：新功能、修复、重构、文档、样式、测试、构建、配置等
- 描述变更的目的和影响，而不仅仅是代码改动
- 不要加前缀如 "feat:" 或 "fix:"，直接描述变更内容
- 不要加引号或句号

示例：
添加用户登录功能，支持邮箱和手机号验证
修复订单支付状态同步问题，确保库存及时更新
重构用户模块代码结构，提升可维护性和测试覆盖率
更新项目文档，补充API接口使用说明`;

      const chatEndpoint = resolveChatEndpoint(body.endpoint);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (body.apiKey) headers.Authorization = `Bearer ${body.apiKey}`;

      sendSseHeaders(res);

      const aiResponse = await fetch(chatEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: body.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text().catch(() => "");
        sendSseEvent(res, "error", { message: `AI 请求失败，HTTP ${aiResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ""}` });
        res.end();
        return;
      }

      const reader = aiResponse.body?.getReader();
      if (!reader) {
        sendSseEvent(res, "error", { message: "AI 响应体为空" });
        res.end();
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              sendSseEvent(res, "delta", { text: delta });
            }
          } catch {
            // skip malformed
          }
        }
      }

      const cleaned = content.trim().replace(/^["'"]|["'"]$/g, "").trim();
      sendSseEvent(res, "done", { message: cleaned });
      res.end();
    } catch (error) {
      sendSseEvent(res, "error", { message: error instanceof Error ? error.message : "生成提交信息失败" });
      res.end();
    }
  });

  // POST /backend/vibe/git/ai-batch-groups
  middlewares.use("/backend/vibe/git/ai-batch-groups", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as {
        path?: string;
        endpoint?: string;
        apiKey?: string;
        model?: string;
      };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (!body.endpoint?.trim() || !body.model?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 AI 配置" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const statusResult = await gitStatus(resolved);
      if (!statusResult.ok) {
        sendJson(res, 400, { ok: false, error: statusResult.error || "获取 Git 状态失败" });
        return;
      }

      const unstagedFiles = statusResult.files.filter((f) => !f.staged && f.status !== "ignored");
      if (!unstagedFiles.length) {
        sendSseHeaders(res);
        sendSseEvent(res, "done", { groups: [] });
        res.end();
        return;
      }

      const diffResult = await gitDiff(resolved, undefined, false);
      const diffText = diffResult.ok ? (diffResult.patch || "") : "";
      const fileList = unstagedFiles.map((f) => `${f.status}: ${f.path}`).join("\n");
      const prompt = `你是一个 Git 提交分组助手。根据以下未暂存的文件变更，将文件按功能/逻辑相关性分成多个批次，每个批次生成一条中文提交信息。

未暂存文件列表：
${fileList}

Diff 内容：
${diffText.slice(0, 15000)}

要求：
- 按功能模块或逻辑相关性分组，不要简单按目录分
- 每组用简洁的中文名称命名（如「认证模块」「UI 样式调整」）
- 每组生成一条中文 commit message（动词开头，描述做了什么）
- 每个文件只能出现在一个组中
- 如果只有一个逻辑变更，分成一组即可
- 使用中文

请严格以 JSON 格式输出，不要包含任何其他文字或 markdown 标记：
{"groups":[{"name":"分组名称","files":["文件路径"],"message":"提交信息"}]}`;

      const chatEndpoint = resolveChatEndpoint(body.endpoint);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (body.apiKey) headers.Authorization = `Bearer ${body.apiKey}`;

      sendSseHeaders(res);

      const aiResponse = await fetch(chatEndpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model: body.model,
          messages: [{ role: "user", content: prompt }],
          stream: true,
        }),
      });

      if (!aiResponse.ok) {
        const errText = await aiResponse.text().catch(() => "");
        sendSseEvent(res, "error", { message: `AI 请求失败，HTTP ${aiResponse.status}${errText ? `: ${errText.slice(0, 200)}` : ""}` });
        res.end();
        return;
      }

      const reader = aiResponse.body?.getReader();
      if (!reader) {
        sendSseEvent(res, "error", { message: "AI 响应体为空" });
        res.end();
        return;
      }

      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let content = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          try {
            const parsed = JSON.parse(data) as {
              choices?: Array<{ delta?: { content?: string } }>;
            };
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              content += delta;
              sendSseEvent(res, "delta", { text: delta });
            }
          } catch {
            // skip malformed
          }
        }
      }

      const cleaned = content.trim();
      let groups: Array<{ name: string; files: string[]; message: string }> = [];
      try {
        const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as { groups?: Array<{ name: string; files: string[]; message: string }> };
          if (Array.isArray(parsed.groups)) {
            groups = parsed.groups;
          }
        }
      } catch {
        // AI 返回的 JSON 解析失败，返回空分组
      }

      sendSseEvent(res, "done", { groups });
      res.end();
    } catch (error) {
      sendSseEvent(res, "error", { message: error instanceof Error ? error.message : "AI 分批分组失败" });
      res.end();
    }
  });

  // POST /backend/vibe/git/commit
  middlewares.use("/backend/vibe/git/commit", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; message?: string };
      if (!body.path?.trim() || !body.message?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 或 message 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitCommit(resolved, body.message.trim());
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "提交失败" });
    }
  });

  // GET /backend/vibe/git/log
  middlewares.use("/backend/vibe/git/log", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const count = Number(url.searchParams.get("count")) || 20;

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitLog(resolved, count);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取提交历史失败" });
    }
  });

  // GET /backend/vibe/git/ahead-commits
  middlewares.use("/backend/vibe/git/ahead-commits", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";
      const count = Number(url.searchParams.get("count")) || 20;

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitAheadCommits(resolved, count);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取待推送提交失败" });
    }
  });

  // POST /backend/vibe/git/add
  middlewares.use("/backend/vibe/git/add", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitAdd(resolved, body.files || []);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "暂存失败" });
    }
  });

  // POST /backend/vibe/git/reset
  middlewares.use("/backend/vibe/git/reset", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitReset(resolved, body.files || []);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "取消暂存失败" });
    }
  });

  // POST /backend/vibe/git/discard
  middlewares.use("/backend/vibe/git/discard", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; files?: string[] };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = body.files && body.files.length > 0
        ? await gitDiscard(resolved, body.files)
        : await gitDiscardAll(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "丢弃更改失败" });
    }
  });

  // GET /backend/vibe/git/remotes
  middlewares.use("/backend/vibe/git/remotes", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path") || "";

      if (!projectPath) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath);
      const result = await gitRemotes(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "获取远程信息失败" });
    }
  });

  // POST /backend/vibe/git/fetch
  middlewares.use("/backend/vibe/git/fetch", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitFetch(resolved, body.remote?.trim() || undefined);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Fetch 失败" });
    }
  });

  // POST /backend/vibe/git/pull
  middlewares.use("/backend/vibe/git/pull", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string; branch?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitPull(resolved, body.remote?.trim() || undefined, body.branch?.trim() || undefined);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Pull 失败" });
    }
  });

  // POST /backend/vibe/git/push
  middlewares.use("/backend/vibe/git/push", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; remote?: string; branch?: string; setUpstream?: boolean };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitPush(resolved, body.remote?.trim() || undefined, body.branch?.trim() || undefined, body.setUpstream);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : "Push 失败" });
    }
  });

  // GET /backend/vibe/git/stash-list
  middlewares.use("/backend/vibe/git/stash-list", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "GET") {
      sendJson(res, 405, { error: "仅支持 GET 请求" });
      return;
    }

    try {
      const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
      const projectPath = url.searchParams.get("path");
      if (!projectPath?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(projectPath.trim());
      const result = await gitStashList(resolved);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, stashes: [], error: error instanceof Error ? error.message : "获取贮藏列表失败" });
    }
  });

  // POST /backend/vibe/git/stash-save
  middlewares.use("/backend/vibe/git/stash-save", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; message?: string };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashSave(resolved, body.message);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-pop
  middlewares.use("/backend/vibe/git/stash-pop", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashPop(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "弹出贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-apply
  middlewares.use("/backend/vibe/git/stash-apply", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (body.stashIndex === undefined) {
        sendJson(res, 400, { ok: false, error: "缺少 stashIndex 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashApply(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "应用贮藏失败" });
    }
  });

  // POST /backend/vibe/git/stash-drop
  middlewares.use("/backend/vibe/git/stash-drop", async (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "仅支持 POST 请求" });
      return;
    }

    try {
      const body = (await readJsonBody(req)) as { path?: string; stashIndex?: number };
      if (!body.path?.trim()) {
        sendJson(res, 400, { ok: false, error: "缺少 path 参数" });
        return;
      }
      if (body.stashIndex === undefined) {
        sendJson(res, 400, { ok: false, error: "缺少 stashIndex 参数" });
        return;
      }

      const resolved = path.resolve(body.path.trim());
      const result = await gitStashDrop(resolved, body.stashIndex);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, { ok: false, output: "", error: error instanceof Error ? error.message : "删除贮藏失败" });
    }
  });
}

import fs from "node:fs";
