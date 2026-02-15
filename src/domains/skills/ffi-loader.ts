
import { dlopen, type FFIFunction, JSCallback } from "bun:ffi";
import type { Vault } from "../vault/vault";

export class FFILoader {
  private vault?: Vault;

  setVault(vault: Vault) {
    this.vault = vault;
  }

  /**
   * Load a shared library using FFI
   * @param libPath Path to the shared library
   * @param symbols Symbol definitions map
   * @param skillName Name of the skill for identification
   * @returns The loaded library instance with callable symbols
   */
  load<T extends Record<string, any>>(libPath: string, symbols: T, skillName: string = "unknown-ffi") {
    try {
      console.log(`[FFILoader] Loading library from ${libPath}`);
      
      let runtimeToken = "";
      if (this.vault) {
          runtimeToken = this.vault.createRuntimeToken({
              skillId: skillName,
              pid: process.pid
          });
      }

      // We could inject a special symbol wrapper if the library expects it
      // But usually FFI libraries have their own API.
      // We can expose a helper to get the vault callback.
      
      return {
          lib: dlopen(libPath, symbols),
          token: runtimeToken,
          resolveSecret: (handle: string) => {
              if (!this.vault) return undefined;
              return this.vault.resolveWithToken(runtimeToken, handle);
          }
      };
    } catch (e) {
      console.error(`[FFILoader] Failed to load library ${libPath}:`, e);
      throw e;
    }
  }
}
