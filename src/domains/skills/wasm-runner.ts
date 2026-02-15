
import fs from 'node:fs/promises';
import type { Vault } from '../vault/vault';

export class WasmRunner {
  private vault?: Vault;

  setVault(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Run a WASM module
   * @param wasmPath Path to .wasm file
   * @param imports Custom imports (optional)
   * @param enableWasi Whether to enable WASI (WebAssembly System Interface)
   * @param skillName Name of the skill for identification
   */
  async run(wasmPath: string, imports: Record<string, any> = {}, enableWasi = false, skillName: string = "unknown-wasm") {
    console.log(`[WasmRunner] Loading WASM from ${wasmPath}`);
    
    let runtimeToken = "";
    if (this.vault) {
        runtimeToken = this.vault.createRuntimeToken({
            skillId: skillName,
            // WASM runs in-process, so PID is same as host
            pid: process.pid 
        });
    }

    try {
      const wasmBuffer = await fs.readFile(wasmPath);
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      
      let finalImports = { ...imports };
      
      // Inject Vault Host Functions if Vault is available
      if (this.vault) {
          finalImports = {
              ...finalImports,
              env: {
                  ...finalImports.env,
                  // Simple host function to resolve secret
                  // In real WASM, this would deal with memory pointers
                  // Here we assume a high-level interface or a wrapper will handle pointers
                  // For now, let's just log that we are ready
                  // kairo_vault_resolve: (handlePtr: number, tokenPtr: number) => ...
              }
          };
      }

      let wasi: any = null;

      if (enableWasi) {
          try {
              // Dynamic import to avoid build errors if types are missing
              // @ts-ignore
              const { default: WASI } = await import("bun:wasi");
              wasi = new WASI({
                  args: process.argv,
                  env: {
                      ...process.env,
                      KAIRO_SKILL_NAME: skillName,
                      KAIRO_RUNTIME_TOKEN: runtimeToken
                  },
                  preopens: {
                    "/": "/"
                  }
              });
              finalImports = {
                  ...finalImports,
                  wasi_snapshot_preview1: wasi.exports
              };
              console.log("[WasmRunner] WASI enabled");
          } catch (e) {
              console.warn("[WasmRunner] Failed to initialize WASI. Ensure running with Bun.", e);
          }
      }

      const instance = await WebAssembly.instantiate(wasmModule, finalImports);
      
      if (wasi) {
          // WASI.start() calls _start() entry point
          wasi.start(instance);
      }
      
      return instance;
    } catch (e) {
      console.error(`[WasmRunner] Failed to run WASM ${wasmPath}:`, e);
      throw e;
    }
  }
}
