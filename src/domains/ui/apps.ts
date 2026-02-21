/**
 * 应用注册表与启动逻辑
 *
 * 管理预装应用列表，提供启动入口。
 * KDP 应用通过 WindowManager 创建窗口，
 * Native 应用通过 ProcessManager 启动进程。
 */

/** 应用类型 */
export type AppType = "kdp" | "native";

/** 应用注册表条目 */
export interface AppEntry {
  id: string;
  name: string;
  icon: string;
  type: AppType;
  /** native 类型的启动命令 */
  command?: string;
  category: string;
}

/** 预装应用列表 */
export const PREINSTALLED_APPS: AppEntry[] = [
  {
    id: "brand",
    name: "Kairo",
    icon: "<>",
    type: "kdp",
    category: "系统",
  },
  {
    id: "terminal",
    name: "终端",
    icon: ">_",
    type: "kdp",
    category: "系统",
  },
  {
    id: "files",
    name: "文件",
    icon: "[]",
    type: "kdp",
    category: "系统",
  },
  {
    id: "chromium",
    name: "Chromium",
    icon: "O",
    type: "native",
    command: "chromium-browser --no-sandbox --ozone-platform=wayland",
    category: "应用",
  },
];

/**
 * 按分类分组应用列表
 */
export function groupByCategory(
  apps: AppEntry[]
): Map<string, AppEntry[]> {
  const groups = new Map<string, AppEntry[]>();
  for (const app of apps) {
    const list = groups.get(app.category) ?? [];
    list.push(app);
    groups.set(app.category, list);
  }
  return groups;
}
