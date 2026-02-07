import { describe, it, expect, afterAll } from "bun:test";
import { BinaryRunner } from "./binary-runner";
import { ProcessManager } from "../kernel/process-manager";
import path from "path";

describe("BinaryRunner Integration", () => {
  const processManager = new ProcessManager();
  const runner = new BinaryRunner(processManager);
  const fixturePath = path.resolve(process.cwd(), "tests/fixtures/skills/hello-world/run.sh");
  let skillId: string;

  afterAll(() => {
    if (skillId) {
      runner.stop(skillId);
    }
  });

  it("should successfully start a binary skill", async () => {
    skillId = await runner.run("hello-skill", fixturePath, [], {
      TEST_VAR: "true"
    });

    expect(skillId).toStartWith("skill-hello-skill-");

    // Get the underlying process to check output
    const proc = processManager.getProcess(skillId);
    expect(proc).toBeDefined();

    if (proc && proc.stdout) {
      const output = await new Response(proc.stdout as ReadableStream).text();
      expect(output).toContain("Hello from Binary Skill!");
      expect(output).toContain("KAIRO_SKILL_NAME=hello-skill");
      
      // Wait for process to exit
      await proc.exited;
      expect(proc.exitCode).toBe(0);
    }
  });
});
