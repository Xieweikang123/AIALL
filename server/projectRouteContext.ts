import fs from "node:fs";
import path from "node:path";
import { readFileContent } from "./vibeFs";

export type TopLevelRouteEntry = {
  path: string;
  componentRef: string;
};

export function extractTopLevelRoutes(routerSource: string): TopLevelRouteEntry[] {
  const routes: TopLevelRouteEntry[] = [];
  const seen = new Set<string>();
  const blockRe = /\{\s*path:\s*["']([^"']+)["'][\s\S]*?\}/g;
  let block: RegExpExecArray | null;
  while ((block = blockRe.exec(routerSource))) {
    const body = block[0];
    const routePath = block[1]?.trim();
    if (!routePath) continue;
    if (/redirect\s*:/.test(body) && !/component\s*:/.test(body)) continue;
    const importMatch = body.match(/component:\s*\(\)\s*=>\s*import\(\s*["']([^"']+)["']\s*\)/);
    const identMatch = body.match(/component:\s*([A-Za-z]\w*)\s*,?/);
    const componentRef = (importMatch?.[1] || identMatch?.[1] || "").trim();
    if (!componentRef || seen.has(routePath)) continue;
    seen.add(routePath);
    routes.push({ path: routePath, componentRef });
  }
  return routes;
}

/** Strip simple HTML tags for prompt injection. */
export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** First page-level description paragraph in a Vue SFC template. */
export function extractVuePageDescription(vueSource: string, maxLen = 220): string {
  const descMatch = vueSource.match(/<p[^>]*class="[^"]*\bdesc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
  if (!descMatch?.[1]) return "";
  const plain = stripHtmlToPlainText(descMatch[1]);
  return plain.length > maxLen ? `${plain.slice(0, maxLen)}…` : plain;
}

function resolveComponentFilePath(projectRoot: string, componentRef: string): string | null {
  const normalized = componentRef.replace(/\\/g, "/");
  if (normalized.includes("/")) {
    const rel = normalized.startsWith("src/") ? normalized : `src/${normalized}`;
    if (rel.endsWith(".vue") || rel.endsWith(".tsx") || rel.endsWith(".jsx")) {
      return path.join(projectRoot, rel);
    }
    return path.join(projectRoot, `${rel}.vue`);
  }
  const candidates = [
    path.join(projectRoot, "src", "views", `${componentRef}.vue`),
    path.join(projectRoot, "src", "components", `${componentRef}.vue`),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export async function buildRouteContextSummary(projectRoot: string): Promise<string> {
  const routerCandidates = [
    path.join(projectRoot, "src", "router", "index.ts"),
    path.join(projectRoot, "src", "router", "index.js"),
    path.join(projectRoot, "src", "router.ts"),
  ];
  let routerSource = "";
  for (const candidate of routerCandidates) {
    const result = await readFileContent(candidate).catch(() => null);
    if (result?.ok && result.content.trim()) {
      routerSource = result.content;
      break;
    }
  }
  if (!routerSource) return "";

  const routes = extractTopLevelRoutes(routerSource).filter((r) => r.path !== "/" || r.componentRef);
  if (!routes.length) return "";

  const lines = ["", "顶层路由与页面说明（节选）："];
  for (const route of routes.slice(0, 12)) {
    const filePath = resolveComponentFilePath(projectRoot, route.componentRef);
    let desc = "";
    if (filePath) {
      const vueResult = await readFileContent(filePath).catch(() => null);
      if (vueResult?.ok) {
        desc = extractVuePageDescription(vueResult.content.slice(0, 4_000));
      }
    }
    const tail = desc ? ` — ${desc}` : "";
    lines.push(`- \`${route.path}\` → \`${route.componentRef}\`${tail}`);
  }
  lines.push("", "（以上已注入项目上下文；回答产品概览时优先引用，勿重复 read_file 路由入口与已列页面。）");
  return lines.join("\n");
}
