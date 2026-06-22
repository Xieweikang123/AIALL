/**
 * Memory quality assessment service.
 * Evaluates the quality of project memory content and provides improvement suggestions.
 */

export type MemoryQualityLevel = "poor" | "fair" | "good" | "excellent";

export type MemoryQualityResult = {
  score: number; // 0-100
  level: MemoryQualityLevel;
  hints: string[];
  sectionScores: {
    terms: number;
    navigation: number;
    preferences: number;
  };
};

/**
 * Assess the quality of a memory line (0-1).
 */
function assessLineQuality(line: string): number {
  if (!line.startsWith("- ")) return 0;
  const text = line.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "");
  if (!text) return 0;

  let score = 0;

  // Pure path or file reference without description → low quality
  const purePathPattern = /^`?[a-z/._-]+\.[a-z]+`?$/i;
  if (purePathPattern.test(text)) return 0.1;

  // Path with description → medium quality
  const pathWithDescPattern = /^`?[a-z/._-]+\.[a-z]+`?\s*[:：]/i;
  if (pathWithDescPattern.test(text)) score += 0.3;

  // Contains Chinese description → higher quality
  if (/[\u4e00-\u9fff]/.test(text)) score += 0.25;

  // Contains actionable keywords (should/must/prohibit/priority/commonly)
  if (/(?:应|需|禁止|优先|常用|约定|必须|建议|不要|避免)/.test(text)) score += 0.25;

  // Contains specific paths or code references
  if (/(?:`[^`]+`|src\/|server\/|components\/)/.test(text)) score += 0.1;

  // Contains dates (temporal relevance)
  if (/\d{4}-\d{2}-\d{2}/.test(text)) score += 0.1;

  return Math.min(score, 1);
}

/**
 * Extract section content from memory markdown.
 */
function extractSection(content: string, sectionName: string): string {
  const sectionRegex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i");
  const match = content.match(sectionRegex);
  return match ? match[1].trim() : "";
}

/**
 * Assess quality of a memory section.
 */
function assessSectionQuality(sectionContent: string): number {
  if (!sectionContent) return 0;

  const lines = sectionContent.split("\n").filter(l => l.trim());
  if (lines.length === 0) return 0;

  let totalScore = 0;
  let validLines = 0;

  for (const line of lines) {
    const lineScore = assessLineQuality(line);
    if (lineScore > 0) {
      totalScore += lineScore;
      validLines++;
    }
  }

  if (validLines === 0) return 0;

  const avgLineScore = totalScore / validLines;

  // Bonus for having enough content (3-10 lines is ideal)
  const lineCountBonus = Math.min(1, lines.length / 3) * 0.2;

  // Penalty for too many empty or low-quality lines
  const emptyLineCount = lines.filter(l => !l.trim() || assessLineQuality(l) < 0.2).length;
  const emptyPenalty = (emptyLineCount / lines.length) * 0.3;

  return Math.min(1, Math.max(0, avgLineScore + lineCountBonus - emptyPenalty));
}

/**
 * Assess overall memory quality.
 */
export function assessMemoryQuality(content: string): MemoryQualityResult {
  const hints: string[] = [];

  // Check for empty or near-empty content
  if (!content.trim() || content.trim().length < 50) {
    return {
      score: 0,
      level: "poor",
      hints: ["记忆内容为空或过短，请添加项目信息"],
      sectionScores: { terms: 0, navigation: 0, preferences: 0 },
    };
  }

  // Extract sections
  const termsContent = extractSection(content, "术语");
  const navigationContent = extractSection(content, "导航");
  const preferencesContent = extractSection(content, "偏好");

  // Assess each section
  const termsScore = assessSectionQuality(termsContent);
  const navigationScore = assessSectionQuality(navigationContent);
  const preferencesScore = assessSectionQuality(preferencesContent);

  // Calculate overall score
  const sectionWeights = { terms: 0.3, navigation: 0.4, preferences: 0.3 };
  const overallScore = Math.round(
    termsScore * sectionWeights.terms * 100 +
    navigationScore * sectionWeights.navigation * 100 +
    preferencesScore * sectionWeights.preferences * 100
  );

  // Generate hints based on section scores
  if (termsScore < 0.3) {
    hints.push("术语部分为空或内容质量低，建议添加项目特有术语");
  }
  if (navigationScore < 0.3) {
    hints.push("导航部分缺少描述性内容，建议添加关键路径说明");
  }
  if (preferencesScore < 0.3) {
    hints.push("偏好部分为空，建议添加编码风格和工作流习惯");
  }

  // Check for empty lines ratio
  const lines = content.split("\n");
  const emptyLines = lines.filter(l => !l.trim()).length;
  const emptyRatio = emptyLines / lines.length;
  if (emptyRatio > 0.3) {
    hints.push(`空行过多（${Math.round(emptyRatio * 100)}%），建议清理`);
  }

  // Check for duplicate content
  const bulletLines = lines.filter(l => l.startsWith("- "));
  const uniqueBullets = new Set(bulletLines.map(l => l.replace(/^- /, "").replace(/^\[[\d-]+\]\s*/, "").trim().toLowerCase()));
  if (bulletLines.length > 5 && uniqueBullets.size < bulletLines.length * 0.7) {
    hints.push("存在重复内容，建议去重");
  }

  // Determine quality level
  let level: MemoryQualityLevel;
  if (overallScore >= 80) {
    level = "excellent";
  } else if (overallScore >= 60) {
    level = "good";
  } else if (overallScore >= 40) {
    level = "fair";
  } else {
    level = "poor";
  }

  return {
    score: overallScore,
    level,
    hints,
    sectionScores: {
      terms: Math.round(termsScore * 100),
      navigation: Math.round(navigationScore * 100),
      preferences: Math.round(preferencesScore * 100),
    },
  };
}

/**
 * Get quality level color for UI display.
 */
export function getQualityLevelColor(level: MemoryQualityLevel): string {
  switch (level) {
    case "excellent":
      return "#22c55e"; // green
    case "good":
      return "#3b82f6"; // blue
    case "fair":
      return "#f59e0b"; // yellow
    case "poor":
      return "#ef4444"; // red
    default:
      return "#6b7280"; // gray
  }
}

/**
 * Get quality level label for UI display.
 */
export function getQualityLevelLabel(level: MemoryQualityLevel): string {
  switch (level) {
    case "excellent":
      return "优秀";
    case "good":
      return "良好";
    case "fair":
      return "一般";
    case "poor":
      return "较差";
    default:
      return "未知";
  }
}
