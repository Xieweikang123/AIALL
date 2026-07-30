/**
 * Incremental Markdown Renderer - Block-level caching for streaming.
 * Only re-renders the last (incomplete) block on each tick.
 */

import { renderMarkdownLite } from "./renderMarkdown";
import { prepareStreamingMarkdownForRender } from "./streamingMarkdownTrim";
import { sanitizeMarkdownForStreamingDisplay } from "../services/markdownDisplaySanitize";

type BlockType = "heading" | "code" | "list" | "table" | "blockquote" | "hr" | "paragraph";

interface MarkdownBlock {
  type: BlockType;
  source: string;
  html: string;
  complete: boolean;
}

function splitIntoBlocks(source: string): MarkdownBlock[] {
  const lines = source.split("\n");
  const blocks: MarkdownBlock[] = [];
  let currentType: BlockType = "paragraph";
  let currentLines: string[] = [];
  let inCodeFence = false;

  function flushBlock() {
    if (currentLines.length === 0) return;
    blocks.push({
      type: currentType,
      source: currentLines.join("\n"),
      html: "",
      complete: !inCodeFence,
    });
    currentLines = [];
  }

  for (const line of lines) {
    const trimmed = line.trim();

    if (inCodeFence) {
      currentLines.push(line);
      if (/^```\s*$/.test(trimmed)) {
        inCodeFence = false;
        flushBlock();
        currentType = "paragraph";
      }
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushBlock();
      currentType = "code";
      currentLines.push(line);
      inCodeFence = true;
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s/);
    if (headingMatch) {
      flushBlock();
      currentType = "heading";
      currentLines.push(line);
      flushBlock();
      currentType = "paragraph";
      continue;
    }

    if (/^[-*_]{3,}$/.test(trimmed) && trimmed.replace(/[-*_ ]/g, "").length === 0) {
      flushBlock();
      currentType = "hr";
      currentLines.push(line);
      flushBlock();
      currentType = "paragraph";
      continue;
    }

    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed)) {
      if (currentType !== "list") {
        flushBlock();
        currentType = "list";
      }
      currentLines.push(line);
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      if (currentType !== "blockquote") {
        flushBlock();
        currentType = "blockquote";
      }
      currentLines.push(line);
      continue;
    }

    if (/^\|/.test(trimmed)) {
      if (currentType !== "table") {
        flushBlock();
        currentType = "table";
      }
      currentLines.push(line);
      continue;
    }

    if (!trimmed) {
      if (currentType !== "paragraph") {
        flushBlock();
        currentType = "paragraph";
      } else {
        currentLines.push(line);
      }
      continue;
    }

    if (currentType !== "paragraph") {
      flushBlock();
      currentType = "paragraph";
    }
    currentLines.push(line);
  }

  flushBlock();
  return blocks;
}

function renderBlock(block: MarkdownBlock): string {
  const sanitized = sanitizeMarkdownForStreamingDisplay(block.source);
  return renderMarkdownLite(prepareStreamingMarkdownForRender(sanitized));
}

export class IncrementalMarkdownRenderer {
  private cachedHtml: Map<string, string> = new Map();
  private lastSource = "";
  private lastResultHtml = "";

  render(source: string): string {
    if (source === this.lastSource) return this.lastResultHtml;
    this.lastSource = source;

    if (!source.trim()) {
      this.cachedHtml.clear();
      this.lastResultHtml = "";
      return "";
    }

    const blocks = splitIntoBlocks(source);
    const htmlParts: string[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const isLast = i === blocks.length - 1;

      if (!isLast && block.complete) {
        let html = this.cachedHtml.get(block.source);
        if (html === undefined) {
          html = renderBlock(block);
          this.cachedHtml.set(block.source, html);
        }
        htmlParts.push(html);
      } else {
        htmlParts.push(renderBlock(block));
      }
    }

    this.lastResultHtml = htmlParts.join("\n");
    return this.lastResultHtml;
  }

  reset(): void {
    this.cachedHtml.clear();
    this.lastSource = "";
    this.lastResultHtml = "";
  }
}

let sharedRenderer: IncrementalMarkdownRenderer | null = null;

export function getSharedIncrementalRenderer(): IncrementalMarkdownRenderer {
  if (!sharedRenderer) {
    sharedRenderer = new IncrementalMarkdownRenderer();
  }
  return sharedRenderer;
}

export function resetSharedIncrementalRenderer(): void {
  sharedRenderer?.reset();
  sharedRenderer = null;
}