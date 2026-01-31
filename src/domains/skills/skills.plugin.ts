import type { Plugin } from "../../core/plugin";
import { Application } from "../../core/app";
import { AgentPlugin } from "../agent/agent.plugin";
import { SkillRegistry } from "./registry";
import { SandboxManager } from "../sandbox/sandbox-manager";
import path from "path";
import fs from "fs/promises";
import { spawn } from "child_process";
import os from "os";

export class SkillsPlugin implements Plugin {
  name = "skills";
  private registry: SkillRegistry;
  private agentPlugin?: AgentPlugin;
  private app?: Application;

  constructor() {
    this.registry = new SkillRegistry(process.cwd());
  }

  setup(app: Application) {
    this.app = app;
    app.registerService("skills", this);

    try {
        this.agentPlugin = app.getService<AgentPlugin>("agent");
        this.registerEquipTool();
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

  async equipSkill(skillName: string, context: { agentId: string }) {
      const skill = this.registry.getSkill(skillName);
      if (!skill) {
          throw new Error(`Skill ${skillName} not found.`);
      }

      await this.agentPlugin?.globalBus.publish({
          type: "kairo.skill.equipped",
          source: "system:skills",
          data: { agentId: context.agentId, skillName }
      });

      let response = `## Skill: ${skill.name}\n\n${skill.content}`;

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
              agent.addSystemTool({
                  definition: scriptTool as any,
                  handler: async (args: any) => {
                      return await this.runSkillScript(args);
                  }
              });
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
      
      if (!scriptPath.startsWith(skill.path)) throw new Error("Invalid script path");

      try {
          await fs.access(scriptPath);
      } catch {
          throw new Error(`Script ${args.script_name} not found`);
      }

      // Create temp dir for execution
      const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kairo-skill-'));
      
      try {
          // Construct command
          const cmd = `python3 "${scriptPath}" ${args.args.map(a => `"${a}"`).join(" ")}`;
          const wrappedCmd = await SandboxManager.wrapWithSandbox(cmd);
          
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
          // Cleanup temp dir
          try {
             await fs.rm(tempDir, { recursive: true, force: true });
          } catch {}
      }
  }
}
