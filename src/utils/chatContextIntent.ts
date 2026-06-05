export interface ChatContextIntent {
  includeProject: boolean;
  includeFile: boolean;
  hint: string;
}

const PROJECT_PATTERNS: RegExp[] = [
  /(?:解释|介绍|说明|概述|分析|了解|讲讲|梳理).{0,10}(?:整个|这个|本)?项目/,
  /项目.{0,16}(?:做什么|干啥|干嘛|是什么|怎么样|如何|架构|结构|模块|技术栈|入口)/,
  /(?:整体|全局).{0,8}(?:架构|结构|设计|概览)/,
  /(?:目录|文件夹).{0,8}结构/,
  /技术栈/,
  /(?:核心|主要|关键).{0,8}(?:模块|功能|流程)/,
  /代码库|代码仓库|repository|repo\b/i,
  /^解释项目/,
];

const FILE_PATTERNS: RegExp[] = [
  /(?:这段|这个|当前|本|此|这里).{0,6}(?:代码|文件|函数|方法|组件|类|逻辑)/,
  /(?:优化|修复|重构|改写|改进|加上|补充|修改|实现).{0,10}(?:代码|函数|文件|逻辑)?/,
  /(?:找出|修复|解决).{0,6}(?:bug|错误|问题)/i,
  /这段代码|当前文件|这个文件/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(text));
}

function buildHint(includeProject: boolean, includeFile: boolean): string {
  if (!includeProject && !includeFile) {
    return "将仅发送你的问题";
  }
  const parts: string[] = [];
  if (includeProject) parts.push("项目结构");
  if (includeFile) parts.push("当前文件");
  return `将自动附带：${parts.join("、")}`;
}

export function detectChatContextIntent(
  message: string,
  options: { hasProject: boolean; hasOpenFile: boolean },
): ChatContextIntent {
  const text = message.trim();
  const wantsProject = matchesAny(text, PROJECT_PATTERNS);
  const wantsFile = matchesAny(text, FILE_PATTERNS);

  let includeProject = wantsProject && options.hasProject;
  let includeFile = wantsFile && options.hasOpenFile;

  if (wantsProject && wantsFile) {
    includeProject = options.hasProject;
    includeFile = options.hasOpenFile;
  } else if (!wantsProject && !wantsFile) {
    // 未明确说明时：仅在与代码/实现相关的问题里自动附带上下文
    const codeRelated = /代码|函数|文件|组件|类|bug|接口|实现|逻辑|变量|模块|优化|修复|重构/i.test(text);
    if (codeRelated) {
      if (options.hasOpenFile) {
        includeFile = true;
      } else if (options.hasProject) {
        includeProject = true;
      }
    }
  } else if (wantsProject && !wantsFile) {
    includeFile = false;
  } else if (wantsFile && !wantsProject) {
    includeProject = false;
  }

  return {
    includeProject,
    includeFile,
    hint: buildHint(includeProject, includeFile),
  };
}
