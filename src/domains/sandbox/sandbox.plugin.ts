import type { Plugin } from "../../core/plugin";
import type { Application } from "../../core/app";
import { SandboxManager } from "./sandbox-manager";
import { PythonEnvManager } from "./python-env";
import { AgentPlugin } from "../agent/agent.plugin";
import * as path from "path";
import * as fs from "fs/promises";
import { spawn } from "child_process";

export interface SandboxPluginConfig {
  pythonEnvPath: string;
  workspacePath: string;
  deliverablesPath: string;
}

export class SandboxPlugin implements Plugin {
  readonly name = "sandbox";
  private app?: Application;
  private pythonEnv?: PythonEnvManager;

  constructor(private config?: SandboxPluginConfig) {}

  setup(app: Application) {
    this.app = app;
    console.log("[Sandbox] Setting up Sandbox domain...");
    app.registerService("sandbox", SandboxManager);
  }

  async start() {
    console.log("[Sandbox] Starting Sandbox domain...");
    // Ensure clean state on start
    await SandboxManager.reset();

    if (this.config) {
        // Initialize Python Env
        this.pythonEnv = new PythonEnvManager(this.config.pythonEnvPath);
        await this.pythonEnv.ensureEnv();

        // Install dependencies from requirements.txt if it exists in project root
        const requirementsPath = path.join(process.cwd(), "requirements.txt");
        await this.pythonEnv.installRequirements(requirementsPath);

        // Ensure workspace and deliverables directories exist
        await fs.mkdir(this.config.workspacePath, { recursive: true });
        await fs.mkdir(this.config.deliverablesPath, { recursive: true });

        // Initialize SandboxManager with config
        await SandboxManager.initialize({
            network: {
                allowedDomains: [], // Allow nothing by default
                deniedDomains: []
            },
            filesystem: {
                allowWrite: [this.config.workspacePath, this.config.deliverablesPath],
                denyRead: [], 
                denyWrite: []
            }
        });

        // Register tools to Agent
        try {
            const agentPlugin = this.app?.getService<AgentPlugin>("agent");
            if (agentPlugin) {
                this.registerTools(agentPlugin);
            }
        } catch (e) {
            console.warn("[Sandbox] AgentPlugin not found, skipping tool registration.");
        }
    }
  }

  private registerTools(agent: AgentPlugin) {
      agent.registerSystemTool({
          name: "run_python",
          description: "Execute Python code in a sandboxed environment. The code runs in a persistent workspace.",
          inputSchema: {
              type: "object",
              properties: {
                  code: { type: "string", description: "The Python code to execute" }
              },
              required: ["code"]
          }
      }, async (args) => {
          if (!this.config || !this.pythonEnv) throw new Error("Sandbox not configured");
          
          const scriptPath = path.join(this.config.workspacePath, `script_${Date.now()}.py`);
          await fs.writeFile(scriptPath, args.code);

          const pythonPath = this.pythonEnv.getPythonPath();
          const command = `${pythonPath} ${scriptPath}`;
          
          // Wrap with sandbox
          const sandboxedCommand = await SandboxManager.wrapWithSandbox(command);
          
          return new Promise((resolve, reject) => {
             const child = spawn(sandboxedCommand, { 
                 cwd: this.config!.workspacePath,
                 shell: true
             });

             let output = "";
             let error = "";

             child.stdout.on("data", d => output += d.toString());
             child.stderr.on("data", d => error += d.toString());

             child.on("close", (code) => {
                 resolve({
                     stdout: output,
                     stderr: error,
                     exitCode: code
                 });
             });
             
             child.on("error", (err) => {
                 reject(err);
             });
          });
      });
  }

  async stop() {
    console.log("[Sandbox] Stopping Sandbox domain...");
    await SandboxManager.reset();
  }
}
