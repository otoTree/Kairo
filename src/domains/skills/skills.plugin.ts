import type { Plugin } from "../../core/plugin";
import { Application } from "../../core/app";
import { AgentPlugin } from "../agent/agent.plugin";
import { SkillRegistry } from "./registry";
import { SandboxManager } from "../sandbox/sandbox-manager";
import type { SandboxRuntimeConfig } from "../sandbox/sandbox-config";
import { ProcessManager } from "../kernel/process-manager";
import { BinaryRunner } from "./binary-runner";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import os from "os";

import { Vault } from "../vault/vault";

export class SkillsPlugin implements Plugin {
  name = "skills";
  private registry: SkillRegistry;
  private processManager: ProcessManager;
  private binaryRunner: BinaryRunner;
  private agentPlugin?: AgentPlugin;
  private app?: Application;

  constructor(private skillsDir: string = process.cwd()) {
    this.registry = new SkillRegistry(this.skillsDir);
    this.processManager = new ProcessManager();
    this.binaryRunner = new BinaryRunner(this.processManager);
  }

  private async exists(path: string): Promise<boolean> {
      try {
          await fs.access(path);
          return true;
      } catch {
          return false;
      }
    this.app = app;
    app.registerService("skills", this);

    try {
        const vault = app.getService<Vault>("vault");
        this.binaryRunner.setVault(vault);
    } catch (e) {
        console.warn("[Skills] Vault service not available. Secrets resolution disabled.");
    }

    try {
        this.agentPlugin = app.getService<AgentPlugin>("agent");
        this.registerEquipTool();
        this.registerSearchTool();
    } catch (e) {
        console.warn("[Skills] AgentPlugin not available during setup. System tools might not be registered.");
    }
  }

  async start() {
    await this.registry.scan();
    console.log(`[Skills] Found ${this.registry.getAllSkills().length} skills`);
    
    if (this.agentPlugin) {
        // Broadcast registered skills
        const skills = this.registry.getAllSkills();
        this.agentPlugin.globalBus.publish({
            type: "kairo.skill.registered",
            source: "system:skills",
            data: { skills: skills.map(s => ({ name: s.name, description: s.description })) }
        });
    }
  }

  private registerEquipTool() {
      if (!this.agentPlugin) return;

      this.agentPlugin.registerSystemTool({
        name: "kairo_equip_skill",
        description: "Equip a skill to gain its capabilities. Returns the skill documentation.",
        inputSchema: {
          type: "object" as const,
          properties: {
            name: { type: "string", description: "The name of the skill to equip" }
          },
          required: ["name"]
        }
      }, async (args: any, context: any) => {
          return await this.equipSkill(args.name, context);
      });
  }

  private registerSearchTool() {
      if (!this.agentPlugin) return;

      this.agentPlugin.registerSystemTool({
        name: "kairo_search_skills",
        description: "Search for available skills by name or description.",
        inputSchema: {
          type: "object" as const,
          properties: {
            query: { type: "string", description: "The search query (keywords)" }
          },
          required: ["query"]
        }
      }, async (args: any) => {
          return this.searchSkills(args.query);
      });
  }

  searchSkills(query: string) {
      const skills = this.registry.getAllSkills();
      const lowerQuery = query.toLowerCase();
      const matches = skills.filter(s => 
          s.name.toLowerCase().includes(lowerQuery) || 
          s.description.toLowerCase().includes(lowerQuery) ||
          (s.metadata.keywords && Array.isArray(s.metadata.keywords) && s.metadata.keywords.some((k: string) => k.toLowerCase().includes(lowerQuery)))
      );
      
      if (matches.length === 0) {
          return "No skills found matching your query.";
      }
      
      return matches.map(s => `- **${s.name}**: ${s.description}`).join("\n");
  }

  async equipSkill(skillName: string, context: { agentId: string, correlationId?: string, causationId?: string }) {
      const skill = this.registry.getSkill(skillName);
      if (!skill) {
          throw new Error(`Skill ${skillName} not found.`);
      }

      await this.agentPlugin?.globalBus.publish({
          type: "kairo.skill.equipped",
          source: "system:skills",
          data: { agentId: context.agentId, skillName },
          correlationId: context.correlationId,
          causationId: context.causationId
      });

      let response = `## Skill: ${skill.name}\n\n${skill.content}`;

      // Build Sandbox Config from Manifest Permissions
      const sandboxConfig: SandboxRuntimeConfig = {
          network: {
              allowedDomains: [],
              deniedDomains: [],
          },
          filesystem: {
              denyRead: [],
              allowWrite: [],
              denyWrite: []
          }
      };

      if (skill.manifest?.permissions) {
          for (const perm of skill.manifest.permissions) {
              if (perm.scope === 'network' && perm.request === 'connect') {
                  if (perm.criteria?.host) {
                      sandboxConfig.network.allowedDomains.push(perm.criteria.host);
                  }
              }
              if (perm.scope === 'kernel') {
                  if (perm.request === 'fs:write' && perm.criteria?.path) {
                      sandboxConfig.filesystem.allowWrite.push(perm.criteria.path);
                  }
                  // fs:read we can't enforce allow-list yet with current config schema
                  // But we can interpret fs:read as "don't deny this" if we had a default deny
              }
          }
      }

      // Binary Startup (V2 Manifest)
      if (skill.manifest?.artifacts?.binaries) {
          const platform = `${os.platform()}-${os.arch()}`; // e.g., darwin-arm64
          const binaryRelPath = skill.manifest.artifacts.binaries[platform];

          if (binaryRelPath) {
              const binaryPath = path.resolve(skill.path, binaryRelPath);
              try {
                  await fs.access(binaryPath);
                  const pid = await this.binaryRunner.run(skill.name, binaryPath, [], {}, context, sandboxConfig);
                  response += `\n\n**Binary Started:** Background process started with ID \`${pid}\`.`;
              } catch (e) {
                  console.error(`Failed to start binary for skill ${skill.name}:`, e);
                  response += `\n\n**Binary Error:** Failed to start binary for platform ${platform}: ${e}`;
              }
          } else {
              const available = Object.keys(skill.manifest.artifacts.binaries).join(", ");
              response += `\n\n**Binary Warning:** No binary found for current platform (${platform}). Available: ${available}`;
          }
      }

      // Container Orchestration Support
      if (skill.manifest?.artifacts?.container_stack) {
          const composePath = path.resolve(skill.path, skill.manifest.artifacts.container_stack);
          
          response += `\n\n### 🐳 Container Stack Required`;
          response += `\nThis skill requires a container stack to function.`;
          
          if (await this.exists(composePath)) {
              response += `\n\n**Action Required:** Please run the following command in the terminal to start the services:`;
              response += `\n\n\`\`\`bash\npodman-compose -f "${composePath}" up -d\n\`\`\``;
              response += `\n*(Or use \`docker compose\` if you prefer)*`;
          } else {
               response += `\n\n**Warning:** The compose file defined in manifest (\`${skill.manifest.artifacts.container_stack}\`) was not found at \`${composePath}\`.`;
          }
      }

      if (skill.hasScripts) {
          const scriptTool = {
              name: "run_skill_script",
              description: "Execute a script provided by the loaded skill.",
              inputSchema: {
                  type: "object",
                  properties: {
                      skill_name: { type: "string", const: skillName },
                      script_name: { type: "string" },
                      args: { type: "array", items: { type: "string" } },
                      destination_path: { type: "string" }
                  },
                  required: ["skill_name", "script_name", "args"]
              }
          };

          const agent = this.agentPlugin?.getAgent(context.agentId);
          if (agent) {
              agent.registerSystemTool(
                  scriptTool as any,
                  async (args: any) => {
                      return await this.runSkillScript(args);
                  }
              );
              response += `\n\n**Scripts available:** You can use \`run_skill_script\` to execute scripts in this skill.`;
          }
      }

      return response;
  }

  async runSkillScript(args: { skill_name: string, script_name: string, args: string[], destination_path?: string }) {
      if (!args.script_name) throw new Error("Script name required");
      const skill = this.registry.getSkill(args.skill_name);
      if (!skill) throw new Error(`Skill ${args.skill_name} not found`);

      const scriptPath = path.join(skill.path, "scripts", args.script_name);
      
      // 使用 path.resolve 规范化路径，防止 ../ 遍历攻击
      const resolvedScript = path.resolve(scriptPath);
      const resolvedSkillDir = path.resolve(skill.path);
      if (!resolvedScript.startsWith(resolvedSkillDir + path.sep)) throw new Error("Invalid script path");

      try {
          await fs.access(scriptPath);
      } catch {
          throw new Error(`Script ${args.script_name} not found`);
      }

      // Create temp dir for execution
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-skill-'));
      
      try {
          // 使用数组参数形式避免 shell 命令注入
          const baseArgs = ["python3", scriptPath, ...args.args];
          const wrappedCmd = await SandboxManager.wrapWithSandbox(baseArgs.join(" "));

          console.log(`[Skills] Executing in ${tempDir}: ${wrappedCmd}`);

          return await new Promise((resolve, reject) => {
              const child = spawn(wrappedCmd, {
                  shell: true,
                  cwd: tempDir
              });
              
              let stdout = "";
              let stderr = "";
              
              child.stdout.on("data", d => stdout += d.toString());
              child.stderr.on("data", d => stderr += d.toString());
              
              child.on("close", async (code) => {
                  if (code !== 0) {
                      reject(new Error(`Script failed with code ${code}: ${stderr}`));
                  } else {
                      let resultMsg = `Script executed successfully.\nOutput:\n${stdout}`;
                      
                      if (args.destination_path) {
                          // Heuristic: Last argument is the output filename
                          const outputFilename = args.args[args.args.length - 1];
                          if (!outputFilename) throw new Error("No output filename found in args");
                          const sourcePath = path.join(tempDir, outputFilename);
                          try {
                              await fs.copyFile(sourcePath, args.destination_path as string);
                              resultMsg += `\nArtifact copied to ${args.destination_path}`;
                          } catch (e) {
                              resultMsg += `\nFailed to copy artifact: ${e}`;
                          }
                      }
                      resolve(resultMsg);
                  }
              });
          });
      } finally {
          // 清理临时目录
          try {
             await fs.rm(tempDir, { recursive: true, force: true });
          } catch (cleanupErr) {
             console.warn(`[Skills] Failed to cleanup temp dir ${tempDir}:`, cleanupErr);
          }
      }
  }
}
