import type { SelfDevelopmentRiskLevel } from "@/lib/supabase/database.types";
import type { RiskAssessment } from "./types";

/**
 * Deterministic risk classification for a self-development request.
 *
 * The AI never decides whether its own change is risky. The risk engine
 * classifies the prompt plus the plan's affected files against keyword tiers
 * and escalates to the highest tier hit. `critical` requests force an extra
 * explicit operator confirmation at BOTH approval gates (plan and deploy).
 */

const CRITICAL_PATTERNS: readonly RegExp[] = [
  /super\s*admin|admin\s*role|authorization|authentication|password|credentials?|api\s*key|secret|token/i,
  /row\s*level\s*security|\brls\b|policy.*grant|bypass|\bescalat/i,
  /drop\s+table|truncate|production\s+database|delete\s+(all|every)/i,
  /\.env|security\.ts|middleware|supabase\.ts/i,
];

const HIGH_PATTERNS: readonly RegExp[] = [
  /auth|session|security|deploy|migration|middleware|privacy|payment|billing/i,
  /server\/cloud|server\/self-development|app\/api|supabase/i,
];

const MEDIUM_PATTERNS: readonly RegExp[] = [
  /api|endpoint|database|schema|provider|execution|workspace|git|snapshot/i,
];

const LOW_PATTERNS: readonly RegExp[] = [
  /ui|css|component|\bstyle\b|label|copy|text|docs?\.md/i,
];

function matches(text: string, patterns: readonly RegExp[]): string[] {
  const reasons: string[] = [];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const phrase = pattern.source;
    if (match && !reasons.includes(phrase)) reasons.push(phrase.replace(/\\/g, ""));
  }
  return reasons;
}

export function classifyRisk(input: { prompt: string; affectedFiles: readonly string[] }): RiskAssessment {
  const prompt = input.prompt.trim();
  const files = input.affectedFiles.join("\n");
  const combined = `${prompt}\n${files}`;

  const critical = matches(combined, CRITICAL_PATTERNS);
  if (critical.length > 0) return { level: "critical", reasons: critical.slice(0, 5) };

  const high = matches(combined, HIGH_PATTERNS);
  if (high.length > 0) return { level: "high", reasons: high.slice(0, 5) };

  const medium = matches(combined, MEDIUM_PATTERNS);
  if (medium.length > 0) return { level: "medium", reasons: medium.slice(0, 5) };

  const low = matches(combined, LOW_PATTERNS);
  return { level: "low", reasons: low.slice(0, 5).length > 0 ? low.slice(0, 5) : ["No high-risk indicators found."] };
}

export function riskLevelLabel(level: SelfDevelopmentRiskLevel): string {
  return level.charAt(0).toUpperCase() + level.slice(1);
}