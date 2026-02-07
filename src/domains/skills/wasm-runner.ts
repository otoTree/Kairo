
import fs from 'node:fs/promises';

export class WasmRunner {
  /**
   * Run a WASM module
   * @param wasmPath Path to .wasm file
   * @param imports Custom imports (optional)
   * @param enableWasi Whether to enable WASI (WebAssembly System Interface)
   */
  async run(wasmPath: string, imports: Record<string, any> = {}, enableWasi = false) {
    console.log(`[WasmRunner] Loading WASM from ${wasmPath}`);
    
    try {
      const wasmBuffer = await fs.readFile(wasmPath);
      const wasmModule = await WebAssembly.compile(wasmBuffer);
      
      let finalImports = { ...imports };
      let wasi: any = null;

      if (enableWasi) {
          try {
              // Dynamic import to avoid build errors if types are missing
              // @ts-ignore
              const { default: WASI } = await import("bun:wasi");
              wasi = new WASI({
                  args: process.argv,
                  env: process.env,
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
