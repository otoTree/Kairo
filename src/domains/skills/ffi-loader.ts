
import { dlopen, type FFIFunction } from "bun:ffi";

export class FFILoader {
  /**
   * Load a shared library using FFI
   * @param libPath Path to the shared library
   * @param symbols Symbol definitions map
   * @returns The loaded library instance with callable symbols
   * 
   * Example symbols:
   * {
   *   add: {
   *     args: ["int32", "int32"],
   *     returns: "int32"
   *   }
   * }
   */
  load<T extends Record<string, any>>(libPath: string, symbols: T) {
    try {
      console.log(`[FFILoader] Loading library from ${libPath}`);
      // dlopen returns { symbols: { ... }, close: () => void }
      return dlopen(libPath, symbols);
    } catch (e) {
      console.error(`[FFILoader] Failed to load library ${libPath}:`, e);
      throw e;
    }
  }
}
