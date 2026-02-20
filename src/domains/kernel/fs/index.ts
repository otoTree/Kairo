/**
 * 文件系统读取服务
 *
 * 为文件管理器提供目录列表、文件元数据、磁盘空间查询。
 * 所有操作只读，不执行写入/删除。
 */

import { readdir, stat, statfs, rename, rm, cp, mkdir } from "node:fs/promises";
import { join, basename, extname, resolve, dirname } from "node:path";
import { homedir } from "node:os";

// ============================================================
// 类型定义
// ============================================================

export interface FsEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  modifiedAt: Date;
  createdAt: Date;
  permissions: number;
}

export interface DiskSpace {
  total: number;       // bytes
  free: number;        // bytes
  available: number;   // bytes
}

export interface DirectoryListing {
  path: string;
  entries: FsEntry[];
  error?: string;
}

// ============================================================
// 文件类型映射
// ============================================================

const EXT_TYPE_MAP: Record<string, string> = {
  ".md": "Markdown",
  ".txt": "Text",
  ".ts": "TypeScript",
  ".js": "JavaScript",
  ".json": "JSON",
  ".toml": "TOML",
  ".yaml": "YAML",
  ".yml": "YAML",
  ".xml": "XML",
  ".html": "HTML",
  ".css": "CSS",
  ".png": "Image",
  ".jpg": "Image",
  ".jpeg": "Image",
  ".gif": "Image",
  ".svg": "SVG",
  ".pdf": "PDF",
  ".zip": "Archive",
  ".tar": "Archive",
  ".gz": "Archive",
  ".zig": "Zig",
  ".rs": "Rust",
  ".py": "Python",
  ".sh": "Shell",
};

/** 根据扩展名推断文件类型 */
export function getFileType(name: string): string {
  if (!name.includes(".")) return "File";
  const ext = extname(name).toLowerCase();
  return EXT_TYPE_MAP[ext] ?? ext.slice(1).toUpperCase();
}

// ============================================================
// 路径工具
// ============================================================

/** 展开 ~ 为用户主目录 */
export function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    return join(homedir(), p.slice(1));
  }
  return p;
}

/** 将绝对路径缩写为 ~ 开头 */
export function collapseHome(p: string): string {
  const home = homedir();
  if (p.startsWith(home)) {
    return "~" + p.slice(home.length);
  }
  return p;
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 读取目录内容
 * 目录排在前面，文件排在后面，各自按名称排序
 */
export async function listDirectory(dirPath: string): Promise<DirectoryListing> {
  const absPath = resolve(expandHome(dirPath));

  try {
    const dirents = await readdir(absPath, { withFileTypes: true });
    const entries: FsEntry[] = [];

    for (const dirent of dirents) {
      // 跳过隐藏文件（以 . 开头）
      if (dirent.name.startsWith(".")) continue;

      try {
        const fullPath = join(absPath, dirent.name);
        const st = await stat(fullPath);
        entries.push({
          name: dirent.name,
          path: fullPath,
          isDirectory: st.isDirectory(),
          isSymlink: dirent.isSymbolicLink(),
          size: st.size,
          modifiedAt: st.mtime,
          createdAt: st.birthtime,
          permissions: st.mode,
        });
      } catch {
        // 无权限或损坏的符号链接，跳过
      }
    }

    // 目录在前，文件在后，各自按名称排序
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { path: absPath, entries };
  } catch (err: any) {
    return { path: absPath, entries: [], error: err.message };
  }
}

/**
 * 查询磁盘空间
 */
export async function getDiskSpace(path = "/"): Promise<DiskSpace> {
  try {
    const st = await statfs(path);
    return {
      total: st.blocks * st.bsize,
      free: st.bfree * st.bsize,
      available: st.bavail * st.bsize,
    };
  } catch {
    return { total: 0, free: 0, available: 0 };
  }
}

/**
 * 格式化字节数为人类可读字符串
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

/**
 * 格式化日期为短格式
 */
export function formatDate(date: Date): string {
  const m = date.toLocaleString("en-US", { month: "short" });
  const d = date.getDate();
  const h = date.getHours().toString().padStart(2, "0");
  const min = date.getMinutes().toString().padStart(2, "0");
  return `${m} ${d} ${h}:${min}`;
}

// ============================================================
// 文件操作 API
// ============================================================

export interface FileOpResult {
  success: boolean;
  error?: string;
}

/**
 * 打开文件/目录（返回路径，由调用方决定如何处理）
 */
export async function openEntry(entryPath: string): Promise<{ path: string; isDirectory: boolean }> {
  const absPath = resolve(expandHome(entryPath));
  const st = await stat(absPath);
  return { path: absPath, isDirectory: st.isDirectory() };
}

/**
 * 重命名文件/目录
 */
export async function renameEntry(oldPath: string, newName: string): Promise<FileOpResult> {
  try {
    const absOld = resolve(expandHome(oldPath));
    const absNew = join(dirname(absOld), newName);
    await rename(absOld, absNew);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 删除文件/目录（目录递归删除）
 */
export async function deleteEntry(entryPath: string): Promise<FileOpResult> {
  try {
    const absPath = resolve(expandHome(entryPath));
    await rm(absPath, { recursive: true });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 复制文件/目录
 */
export async function copyEntry(srcPath: string, destDir: string): Promise<FileOpResult> {
  try {
    const absSrc = resolve(expandHome(srcPath));
    const absDest = join(resolve(expandHome(destDir)), basename(absSrc));
    await cp(absSrc, absDest, { recursive: true });
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * 创建新目录
 */
export async function createDirectory(parentPath: string, name: string): Promise<FileOpResult> {
  try {
    const absPath = join(resolve(expandHome(parentPath)), name);
    await mkdir(absPath);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
