import { spawn } from "child_process";
import * as path from "path";
import * as fs from "fs/promises";
import { existsSync } from "fs";

export class PythonEnvManager {
    constructor(private envPath: string) {}

    async ensureEnv() {
        const pythonExecutable = path.join(this.envPath, "bin", "python");
        if (existsSync(pythonExecutable)) {
            return; // Already exists
        }

        console.log(`[PythonEnv] Creating virtual environment at ${this.envPath}...`);
        
        // Ensure parent directory exists (though venv usually handles it, being safe)
        // Actually venv requires the target dir to be the env dir.
        
        // Create venv
        await this.runCommand("python3", ["-m", "venv", this.envPath]);

        // Configure Tsinghua mirror
        const pipPath = path.join(this.envPath, "bin", "pip");
        await this.runCommand(pipPath, [
            "config", 
            "set", 
            "global.index-url", 
            "https://pypi.tuna.tsinghua.edu.cn/simple"
        ]);
        
        console.log(`[PythonEnv] Virtual environment created and configured.`);
    }

    async installRequirements(requirementsPath: string) {
        if (!existsSync(requirementsPath)) {
            return;
        }

        console.log(`[PythonEnv] Installing dependencies from ${requirementsPath}...`);
        const pipPath = path.join(this.envPath, "bin", "pip");
        
        try {
            await this.runCommand(pipPath, ["install", "-r", requirementsPath]);
            console.log(`[PythonEnv] Dependencies installed successfully.`);
        } catch (error) {
            console.error(`[PythonEnv] Failed to install dependencies:`, error);
            // We don't throw here to avoid blocking startup if a package fails
        }
    }

    private runCommand(command: string, args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const proc = spawn(command, args, { stdio: "inherit" });
            proc.on("close", (code) => {
                if (code === 0) resolve();
                else reject(new Error(`Command ${command} ${args.join(" ")} failed with code ${code}`));
            });
            proc.on("error", reject);
        });
    }

    getPythonPath(): string {
        return path.join(this.envPath, "bin", "python");
    }
}
