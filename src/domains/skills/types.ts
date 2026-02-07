import type { KairoEvent } from "../events/types";
import type { SkillManifestV2 } from "./manifest";

export interface Skill {
  name: string;
  description: string;
  path: string; // Absolute path to skill directory
  content: string; // Markdown content of SKILL.md (if available)
  metadata: Record<string, any>; // Parsed frontmatter or legacy metadata
  manifest?: SkillManifestV2; // V2 Manifest
  hasScripts: boolean;
}

// Event Data Payloads
export interface SkillRegisteredPayload {
  skills: Array<{ name: string; description: string }>;
}

export interface SkillEquippedPayload {
  agentId?: string;
  skillName: string;
}

export interface SkillErrorPayload {
  agentId?: string;
  skillName: string;
  error: string;
}

export interface SkillExecPayload {
  skillName: string;
  script: string;
}

declare module "../events/types" {
  interface KairoEventMap {
    "kairo.skill.registered": SkillRegisteredPayload;
    "kairo.skill.equipped": SkillEquippedPayload;
    "kairo.skill.error": SkillErrorPayload;
    "kairo.skill.exec": SkillExecPayload;
  }
}
