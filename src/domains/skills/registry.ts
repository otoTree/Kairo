import fs from 'fs/promises';
import path from 'path';
import fm from 'front-matter';
import yaml from 'js-yaml';
import type { Skill } from './types';
import type { SkillManifestV2 } from './manifest';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private skillsDir: string;

  constructor(skillsDir: string) {
    this.skillsDir = skillsDir;
  }

  async scan(): Promise<Skill[]> {
    this.skills.clear();
    
    try {
      // Check if skills directory exists
      try {
        await fs.access(this.skillsDir);
      } catch {
        console.warn(`Skills directory not found at ${this.skillsDir}`);
        return [];
      }

      const entries = await fs.readdir(this.skillsDir, { withFileTypes: true });
      
      for (const entry of entries) {
        if (entry.isDirectory()) {
          await this.loadSkill(entry.name);
        }
      }
    } catch (error) {
      console.error('Failed to scan skills:', error);
    }

    return Array.from(this.skills.values());
  }

  private async loadSkill(dirName: string) {
    const skillPath = path.join(this.skillsDir, dirName);
    const readmePath = path.join(skillPath, 'SKILL.md');
    const scriptsPath = path.join(skillPath, 'scripts');
    
    // Manifest paths
    const manifestYamlPath = path.join(skillPath, 'manifest.yaml');
    const manifestJsonPath = path.join(skillPath, 'manifest.json');
    const kairoYamlPath = path.join(skillPath, 'kairo.yaml'); // Alias

    let manifest: SkillManifestV2 | undefined;
    let content = '';
    let metadata: Record<string, any> = {};

    try {
      // 1. Try to load V2 Manifest
      try {
        if (await this.exists(manifestYamlPath)) {
          const raw = await fs.readFile(manifestYamlPath, 'utf-8');
          manifest = yaml.load(raw) as SkillManifestV2;
        } else if (await this.exists(kairoYamlPath)) {
          const raw = await fs.readFile(kairoYamlPath, 'utf-8');
          manifest = yaml.load(raw) as SkillManifestV2;
        } else if (await this.exists(manifestJsonPath)) {
          const raw = await fs.readFile(manifestJsonPath, 'utf-8');
          manifest = JSON.parse(raw) as SkillManifestV2;
        }
      } catch (e) {
        console.warn(`Failed to parse manifest for skill ${dirName}:`, e);
      }

      // 2. Try to load SKILL.md (Content + Legacy Metadata)
      if (await this.exists(readmePath)) {
        const raw = await fs.readFile(readmePath, 'utf-8');
        const parsed = fm<any>(raw);
        content = parsed.body;
        // If no manifest found, use front-matter as metadata
        if (!manifest) {
          metadata = parsed.attributes;
        } else {
           // Merge front-matter into metadata, but manifest takes precedence for core fields
           metadata = { ...parsed.attributes, ...metadata };
        }
      }

      // 3. Validation: Must have either a manifest OR a valid SKILL.md with metadata
      if (!manifest && Object.keys(metadata).length === 0) {
        // Not a valid skill directory
        return;
      }

      // 4. Check for scripts directory
      let hasScripts = false;
      try {
        if (await this.exists(scriptsPath)) {
          const scriptStats = await fs.stat(scriptsPath);
          hasScripts = scriptStats.isDirectory();
        }
      } catch {
        hasScripts = false;
      }

      const skill: Skill = {
        name: manifest?.name || metadata.name || dirName,
        description: manifest?.description || metadata.description || dirName,
        path: skillPath,
        content,
        metadata,
        manifest,
        hasScripts
      };

      this.skills.set(skill.name, skill);
    } catch (error) {
      console.error(`Failed to load skill ${dirName}:`, error);
    }
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }
}
