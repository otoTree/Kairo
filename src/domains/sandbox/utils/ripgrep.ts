import { spawnSync } from 'child_process'
import { execFile } from 'child_process'
import type { ExecFileException } from 'child_process'
// @ts-ignore
import { rgPath } from '@vscode/ripgrep'

// Cache for ripgrep availability check
let ripgrepCache: boolean | undefined

/**
 * Check if ripgrep (rg) is available synchronously
 * Returns true if rg is installed, false otherwise
 * Cached to avoid repeated system calls
 */
export function hasRipgrepSync(): boolean {
  if (ripgrepCache !== undefined) {
    return ripgrepCache
  }

  if (rgPath) {
    ripgrepCache = true
    return true
  }

  try {
    const result = spawnSync('which', ['rg'], {
      stdio: 'ignore',
      timeout: 1000,
    })

    ripgrepCache = result.status === 0
    return ripgrepCache
  } catch {
    ripgrepCache = false
    return false
  }
}

/**
 * Execute ripgrep with the given arguments
 * @param args Command-line arguments to pass to rg
 * @param target Target directory or file to search
 * @param abortSignal AbortSignal to cancel the operation
 * @returns Array of matching lines (one per line of output)
 * @throws Error if ripgrep exits with non-zero status (except exit code 1 which means no matches)
 */
export async function ripGrep(
  args: string[],
  target: string,
  abortSignal: AbortSignal,
): Promise<string[]> {
  const bin = rgPath || 'rg';
  return new Promise((resolve, reject) => {
    execFile(
      bin,
      [...args, target],
      {
        maxBuffer: 20_000_000, // 20MB
        signal: abortSignal,
        timeout: 10_000, // 10 second timeout
      },
      (error: ExecFileException | null, stdout: string, stderr: string) => {
        // Success case - exit code 0
        if (!error) {
          resolve(stdout.trim().split('\n').filter(Boolean))
          return
        }

        // Exit code 1 means "no matches found" - this is normal, return empty array
        if (error.code === 1) {
          resolve([])
          return
        }

        // All other errors should fail
        reject(
          new Error(
            `ripgrep failed with exit code ${error.code}: ${stderr || error.message}`,
          ),
        )
      },
    )
  })
}
