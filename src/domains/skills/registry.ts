import fs from 'fs/promises';
import path from 'path';
import fm from 'front-matter';
import { Skill } from './types';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private skillsDir: string;

  constructor(rootDir: string) {
    this.skillsDir = path.join(rootDir, 'skills');
  }

  async scan(): Promise<Skill[]> {
    this.skills.clear();
    
    try {
      // Check if skills directory exists
      try {
        await fs.access(this.skillsDir);
      } catch {
        // Create it if it doesn't exist? Or just warn?
        // For now, let's just log and return empty, maybe user hasn't added any skills yet.
        // But we should probably create the directory to encourage usage.
        // await fs.mkdir(this.skillsDir, { recursive: true });
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

    try {
      // Check for SKILL.md
      try {
        await fs.access(readmePath);
      } catch {
        // Not a valid skill directory
        return;
      }

      const content = await fs.readFile(readmePath, 'utf-8');
      const parsed = fm<any>(content);
      
      // Check for scripts directory
      let hasScripts = false;
      try {
        await fs.access(scriptsPath);
        const scriptStats = await fs.stat(scriptsPath);
        hasScripts = scriptStats.isDirectory();
      } catch {
        hasScripts = false;
      }

      const skill: Skill = {
        name: dirName,
        description: parsed.attributes.description || parsed.attributes.name || dirName,
        path: skillPath,
        content: parsed.body,
        metadata: parsed.attributes,
        hasScripts
      };

      this.skills.set(skill.name, skill);
    } catch (error) {
      console.error(`Failed to load skill ${dirName}:`, error);
    }
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  getAllSkills(): Skill[] {
    return Array.from(this.skills.values());
  }
}
