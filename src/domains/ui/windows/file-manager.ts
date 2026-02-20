/**
 * Kairo 文件管理器窗口
 *
 * 通过 KDP 协议渲染的文件浏览器，双栏布局（侧边栏 + 内容区）。
 * 支持网格/列表两种视图模式。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpColor } from "../tokens";
import type { KdpEvent, WindowController } from "../window-manager";
import {
  BG_BASE,
  BG_SURFACE,
  BG_ELEVATED,
  BG_OVERLAY,
  TEXT_PRIMARY,
  TEXT_SECONDARY,
  TEXT_TERTIARY,
  BRAND_BLUE,
  BORDER,
  STATE_SELECTED,
  BITMAP_SCALE,
  WINDOW,
  SPACING,
} from "../tokens";
import {
  listDirectory,
  getDiskSpace,
  formatBytes,
  formatDate,
  getFileType,
  collapseHome,
  openEntry,
  renameEntry,
  deleteEntry,
  copyEntry,
} from "../../kernel/fs";

// ============================================================
// 文件管理器常量
// ============================================================

const FM_WIDTH = 900;
const FM_HEIGHT = 600;
const SIDEBAR_WIDTH = WINDOW.sidebarWidth; // 220px
const NAVBAR_HEIGHT = 32;
const CONTENT_X = SIDEBAR_WIDTH;
const CONTENT_Y = WINDOW.titleBarHeight + NAVBAR_HEIGHT;
const CONTENT_WIDTH = FM_WIDTH - SIDEBAR_WIDTH;
const CONTENT_HEIGHT = FM_HEIGHT - CONTENT_Y - WINDOW.statusBarHeight;

/** 网格视图文件项尺寸 */
const GRID_ITEM_WIDTH = 80;
const GRID_ITEM_HEIGHT = 96;
const GRID_GAP = SPACING.md;

// ============================================================
// 数据类型
// ============================================================

export type ViewMode = "grid" | "list";

export interface FileItem {
  name: string;
  isDirectory: boolean;
  size?: number;       // bytes
  modifiedAt?: string; // 格式化后的日期字符串
  type?: string;       // 文件类型描述
}

export interface SidebarItem {
  id: string;
  label: string;
  group: "favorites" | "devices" | "tags";
}

export interface FileManagerState {
  /** 当前路径 */
  currentPath: string;
  /** 路径面包屑 */
  breadcrumbs: string[];
  /** 文件列表 */
  files: FileItem[];
  /** 选中的文件索引 */
  selectedIndex: number;
  /** 视图模式 */
  viewMode: ViewMode;
  /** 侧边栏项目 */
  sidebarItems: SidebarItem[];
  /** 侧边栏选中项 */
  activeSidebarId: string;
  /** 可用磁盘空间（格式化字符串） */
  availableSpace: string;
  /** 右键菜单状态 */
  contextMenu: ContextMenuState | null;
  /** 导航历史 */
  history: string[];
  /** 历史指针 */
  historyIndex: number;
}

/** 右键菜单状态 */
export interface ContextMenuState {
  x: number;
  y: number;
  targetIndex: number; // 右键点击的文件索引，-1 表示空白区域
  items: ContextMenuItem[];
}

export interface ContextMenuItem {
  id: string;
  label: string;
  shortcut?: string;
}

// ============================================================
// 辅助函数
// ============================================================

/** 格式化文件大小 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

// ============================================================
// UI 树构建
// ============================================================

/**
 * 构建文件管理器完整 KDP UI 树
 */
export function buildFileManagerTree(state: FileManagerState): KdpNode {
  const c = (color: KdpColor) => [...color] as unknown as KdpColor;
  const children: KdpNode[] = [];

  // 背景
  children.push({
    type: "rect", id: "bg",
    x: 0, y: 0, width: FM_WIDTH, height: FM_HEIGHT,
    color: c(BG_BASE),
  });

  // 标题栏
  children.push({
    type: "rect", id: "titlebar",
    x: 0, y: 0, width: FM_WIDTH, height: WINDOW.titleBarHeight,
    color: c(BG_SURFACE),
  });
  children.push({
    type: "text", id: "title",
    x: 12, y: 10,
    text: `kairo-files: ${state.currentPath}`,
    color: c(TEXT_PRIMARY),
    scale: BITMAP_SCALE.body,
  });
  children.push({
    type: "rect", id: "btn_close",
    x: FM_WIDTH - 28, y: 10, width: 16, height: 16,
    color: c(TEXT_SECONDARY),
    action: "close",
  });

  // 侧边栏
  children.push({
    type: "rect", id: "sidebar",
    x: 0, y: WINDOW.titleBarHeight, width: SIDEBAR_WIDTH,
    height: FM_HEIGHT - WINDOW.titleBarHeight - WINDOW.statusBarHeight,
    color: c(BG_ELEVATED),
  });
  // 侧边栏右边框
  children.push({
    type: "rect", id: "sidebar_border",
    x: SIDEBAR_WIDTH - 1, y: WINDOW.titleBarHeight, width: 1,
    height: FM_HEIGHT - WINDOW.titleBarHeight - WINDOW.statusBarHeight,
    color: c(BORDER),
  });

  // 侧边栏项目
  let sidebarY = WINDOW.titleBarHeight + SPACING.lg;
  let currentGroup = "";

  for (const item of state.sidebarItems) {
    // 分组标题
    if (item.group !== currentGroup) {
      currentGroup = item.group;
      const groupLabels: Record<string, string> = {
        favorites: "收藏夹",
        devices: "设备",
        tags: "标签",
      };
      children.push({
        type: "text", id: `sidebar_group_${item.group}`,
        x: 12, y: sidebarY,
        text: groupLabels[item.group] ?? item.group,
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      });
      sidebarY += 20;
    }

    const isActive = item.id === state.activeSidebarId;

    // 选中背景
    if (isActive) {
      children.push({
        type: "rect", id: `sidebar_sel_${item.id}`,
        x: 4, y: sidebarY - 2, width: SIDEBAR_WIDTH - 8, height: 28,
        color: c(STATE_SELECTED),
      });
    }

    children.push({
      type: "text", id: `sidebar_item_${item.id}`,
      x: 16, y: sidebarY + 4,
      text: item.label,
      color: c(isActive ? BRAND_BLUE : TEXT_PRIMARY),
      scale: BITMAP_SCALE.body,
      action: `navigate_${item.id}`,
    });

    sidebarY += 28;
  }

  // 导航栏
  children.push({
    type: "rect", id: "navbar",
    x: SIDEBAR_WIDTH, y: WINDOW.titleBarHeight,
    width: CONTENT_WIDTH, height: NAVBAR_HEIGHT,
    color: [0.086, 0.086, 0.118, 0.85],
  });

  // 路径面包屑
  const pathText = state.breadcrumbs.join(" / ");
  children.push({
    type: "text", id: "nav_path",
    x: SIDEBAR_WIDTH + SPACING.xl + 28, y: WINDOW.titleBarHeight + 8,
    text: pathText,
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.body,
  });

  // 前进/后退按钮
  children.push({
    type: "text", id: "nav_back",
    x: SIDEBAR_WIDTH + 8, y: WINDOW.titleBarHeight + 8,
    text: "<",
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.body,
    action: "navigate_back",
  });
  children.push({
    type: "text", id: "nav_forward",
    x: SIDEBAR_WIDTH + 24, y: WINDOW.titleBarHeight + 8,
    text: ">",
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.body,
    action: "navigate_forward",
  });

  // 内容区背景
  children.push({
    type: "rect", id: "content_area",
    x: CONTENT_X, y: CONTENT_Y,
    width: CONTENT_WIDTH, height: CONTENT_HEIGHT,
    color: c(BG_BASE),
  });

  // 文件列表渲染
  if (state.viewMode === "grid") {
    buildGridView(children, state, c);
  } else {
    buildListView(children, state, c);
  }

  // 状态栏
  const statusY = FM_HEIGHT - WINDOW.statusBarHeight;
  children.push({
    type: "rect", id: "statusbar",
    x: 0, y: statusY, width: FM_WIDTH, height: WINDOW.statusBarHeight,
    color: c(BG_SURFACE),
  });

  const countText = state.selectedIndex >= 0
    ? `已选择 1 项`
    : `${state.files.length} 个项目`;
  children.push({
    type: "text", id: "status_count",
    x: 12, y: statusY + 6,
    text: countText,
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.caption,
  });

  const spaceText = `可用: ${state.availableSpace}`;
  children.push({
    type: "text", id: "status_space",
    x: FM_WIDTH - spaceText.length * 8 - 12,
    y: statusY + 6,
    text: spaceText,
    color: c(TEXT_SECONDARY),
    scale: BITMAP_SCALE.caption,
  });

  // 右键菜单（浮层，最后渲染以覆盖其他元素）
  if (state.contextMenu) {
    buildContextMenu(children, state.contextMenu, c);
  }

  return { type: "root", children };
}

/** 构建右键菜单浮层 */
function buildContextMenu(
  children: KdpNode[],
  menu: ContextMenuState,
  c: (color: KdpColor) => KdpColor,
) {
  const menuWidth = 200;
  const itemHeight = 28;
  const menuHeight = menu.items.length * itemHeight + 8; // 上下 4px padding

  // 菜单背景（Elevated 层级）
  children.push({
    type: "rect", id: "ctx_menu_bg",
    x: menu.x, y: menu.y, width: menuWidth, height: menuHeight,
    color: c(BG_OVERLAY),
  });

  // 菜单边框
  children.push({
    type: "rect", id: "ctx_menu_border_top",
    x: menu.x, y: menu.y, width: menuWidth, height: 1,
    color: c(BORDER),
  });
  children.push({
    type: "rect", id: "ctx_menu_border_bot",
    x: menu.x, y: menu.y + menuHeight - 1, width: menuWidth, height: 1,
    color: c(BORDER),
  });

  // 菜单项
  let itemY = menu.y + 4;
  for (let i = 0; i < menu.items.length; i++) {
    const item = menu.items[i];

    // 菜单项文字
    children.push({
      type: "text", id: `ctx_item_${item.id}`,
      x: menu.x + 12, y: itemY + 6,
      text: item.label,
      color: c(TEXT_PRIMARY),
      scale: BITMAP_SCALE.body,
      action: `ctx_${item.id}`,
    });

    // 快捷键提示
    if (item.shortcut) {
      const shortcutWidth = item.shortcut.length * 8;
      children.push({
        type: "text", id: `ctx_shortcut_${item.id}`,
        x: menu.x + menuWidth - shortcutWidth - 12, y: itemY + 6,
        text: item.shortcut,
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      });
    }

    itemY += itemHeight;
  }
}

/** 构建网格视图 */
function buildGridView(
  children: KdpNode[],
  state: FileManagerState,
  c: (color: KdpColor) => KdpColor,
) {
  const cols = Math.floor((CONTENT_WIDTH - 2 * SPACING.lg) / (GRID_ITEM_WIDTH + GRID_GAP));
  let itemX = CONTENT_X + SPACING.lg;
  let itemY = CONTENT_Y + SPACING.lg;

  for (let i = 0; i < state.files.length; i++) {
    const file = state.files[i];
    const isSelected = i === state.selectedIndex;
    const col = i % cols;

    if (col === 0 && i > 0) {
      itemX = CONTENT_X + SPACING.lg;
      itemY += GRID_ITEM_HEIGHT + GRID_GAP;
    }

    // 选中背景
    if (isSelected) {
      children.push({
        type: "rect", id: `file_sel_${i}`,
        x: itemX - 4, y: itemY - 4,
        width: GRID_ITEM_WIDTH + 8, height: GRID_ITEM_HEIGHT + 8,
        color: c(STATE_SELECTED),
      });
    }

    // 文件图标（文字替代）
    const icon = file.isDirectory ? "[D]" : "[F]";
    children.push({
      type: "text", id: `file_icon_${i}`,
      x: itemX + 16, y: itemY + 8,
      text: icon,
      color: c(file.isDirectory ? BRAND_BLUE : TEXT_SECONDARY),
      scale: 3,
      action: `open_${i}`,
    });

    // 文件名
    const displayName = file.name.length > 10
      ? file.name.substring(0, 9) + "..."
      : file.name;
    children.push({
      type: "text", id: `file_name_${i}`,
      x: itemX, y: itemY + 56,
      text: displayName,
      color: c(TEXT_PRIMARY),
      scale: BITMAP_SCALE.caption,
    });

    itemX += GRID_ITEM_WIDTH + GRID_GAP;
  }
}

/** 构建列表视图 */
function buildListView(
  children: KdpNode[],
  state: FileManagerState,
  c: (color: KdpColor) => KdpColor,
) {
  // 列标题
  const headerY = CONTENT_Y + 4;
  children.push(
    { type: "text", id: "col_name", x: CONTENT_X + 12, y: headerY, text: "名称", color: c(TEXT_SECONDARY), scale: BITMAP_SCALE.caption },
    { type: "text", id: "col_size", x: CONTENT_X + CONTENT_WIDTH - 340, y: headerY, text: "大小", color: c(TEXT_SECONDARY), scale: BITMAP_SCALE.caption },
    { type: "text", id: "col_date", x: CONTENT_X + CONTENT_WIDTH - 240, y: headerY, text: "修改日期", color: c(TEXT_SECONDARY), scale: BITMAP_SCALE.caption },
    { type: "text", id: "col_type", x: CONTENT_X + CONTENT_WIDTH - 100, y: headerY, text: "类型", color: c(TEXT_SECONDARY), scale: BITMAP_SCALE.caption },
  );

  // 分隔线
  children.push({
    type: "rect", id: "list_divider",
    x: CONTENT_X, y: headerY + 16,
    width: CONTENT_WIDTH, height: 1,
    color: c(BORDER),
  });

  const rowHeight = 32;
  let rowY = headerY + 20;

  for (let i = 0; i < state.files.length; i++) {
    const file = state.files[i];
    const isSelected = i === state.selectedIndex;

    // Hover/选中背景
    if (isSelected) {
      children.push({
        type: "rect", id: `row_sel_${i}`,
        x: CONTENT_X, y: rowY,
        width: CONTENT_WIDTH, height: rowHeight,
        color: c(STATE_SELECTED),
      });
    }

    // 图标 + 名称
    const icon = file.isDirectory ? "[D]" : "[F]";
    children.push({
      type: "text", id: `row_icon_${i}`,
      x: CONTENT_X + 12, y: rowY + 8,
      text: icon,
      color: c(file.isDirectory ? BRAND_BLUE : TEXT_SECONDARY),
      scale: BITMAP_SCALE.caption,
    });
    children.push({
      type: "text", id: `row_name_${i}`,
      x: CONTENT_X + 40, y: rowY + 8,
      text: file.name,
      color: c(TEXT_PRIMARY),
      scale: BITMAP_SCALE.body,
      action: `open_${i}`,
    });

    // 大小
    if (file.size !== undefined) {
      children.push({
        type: "text", id: `row_size_${i}`,
        x: CONTENT_X + CONTENT_WIDTH - 340, y: rowY + 8,
        text: formatSize(file.size),
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      });
    }

    // 修改日期
    if (file.modifiedAt) {
      children.push({
        type: "text", id: `row_date_${i}`,
        x: CONTENT_X + CONTENT_WIDTH - 240, y: rowY + 8,
        text: file.modifiedAt,
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      });
    }

    // 类型
    if (file.type) {
      children.push({
        type: "text", id: `row_type_${i}`,
        x: CONTENT_X + CONTENT_WIDTH - 100, y: rowY + 8,
        text: file.type,
        color: c(TEXT_SECONDARY),
        scale: BITMAP_SCALE.caption,
      });
    }

    rowY += rowHeight;
  }
}

// ============================================================
// 默认状态
// ============================================================

export function getDefaultFileManagerState(): FileManagerState {
  return {
    currentPath: "~/Documents",
    breadcrumbs: ["~", "Documents"],
    files: [
      { name: "projects", isDirectory: true },
      { name: "images", isDirectory: true },
      { name: "report.md", isDirectory: false, size: 4096, modifiedAt: "Feb 20 10:00", type: "Markdown" },
      { name: "notes.txt", isDirectory: false, size: 1024, modifiedAt: "Feb 19 15:30", type: "Text" },
      { name: "config.toml", isDirectory: false, size: 512, modifiedAt: "Feb 18 09:00", type: "TOML" },
      { name: "backup.tar", isDirectory: false, size: 10485760, modifiedAt: "Feb 15 12:00", type: "Archive" },
    ],
    selectedIndex: -1,
    viewMode: "grid",
    sidebarItems: [
      { id: "home", label: "主目录", group: "favorites" },
      { id: "desktop", label: "桌面", group: "favorites" },
      { id: "documents", label: "文档", group: "favorites" },
      { id: "downloads", label: "下载", group: "favorites" },
      { id: "local", label: "本地磁盘", group: "devices" },
      { id: "work", label: "工作", group: "tags" },
      { id: "personal", label: "个人", group: "tags" },
    ],
    activeSidebarId: "documents",
    availableSpace: "12.4 GB",
    contextMenu: null,
    history: ["~/Documents"],
    historyIndex: 0,
  };
}

// ============================================================
// 右键菜单模板
// ============================================================

/** 文件右键菜单 */
function getFileContextMenu(): ContextMenuItem[] {
  return [
    { id: "open", label: "打开", shortcut: "Enter" },
    { id: "copy", label: "复制", shortcut: "Ctrl+C" },
    { id: "rename", label: "重命名", shortcut: "F2" },
    { id: "delete", label: "删除", shortcut: "Del" },
  ];
}

/** 空白区域右键菜单 */
function getBlankContextMenu(): ContextMenuItem[] {
  return [
    { id: "new_folder", label: "新建文件夹", shortcut: "Ctrl+N" },
    { id: "paste", label: "粘贴", shortcut: "Ctrl+V" },
    { id: "toggle_view", label: "切换视图" },
  ];
}

// ============================================================
// 文件管理器控制器
// ============================================================

/** 侧边栏 ID → 路径映射 */
const SIDEBAR_PATHS: Record<string, string> = {
  home: "~",
  desktop: "~/Desktop",
  documents: "~/Documents",
  downloads: "~/Downloads",
};

export class FileManagerController implements WindowController {
  readonly windowType = "file-manager";
  state: FileManagerState;
  /** 剪贴板（复制的文件路径） */
  private clipboard: string | null = null;

  constructor(initialState?: FileManagerState) {
    this.state = initialState ?? getDefaultFileManagerState();
  }

  buildTree(): KdpNode {
    return buildFileManagerTree(this.state);
  }

  handleEvent(event: KdpEvent): boolean {
    const { type, data } = event;

    if (type === "user_action") {
      return this.handleAction(data.elementId as string, data.actionType as string);
    }

    if (type === "key_event" && data.state === 1) {
      return this.handleKey(data.key as number, data.modifiers as number);
    }

    return false;
  }

  /** 处理 UI action 事件 */
  private handleAction(elementId: string, actionType: string): boolean {
    // 关闭右键菜单（点击任何非菜单区域）
    if (this.state.contextMenu && !elementId.startsWith("ctx_")) {
      this.state.contextMenu = null;
      return true;
    }

    // 右键菜单操作
    if (elementId.startsWith("ctx_")) {
      return this.handleContextAction(elementId.slice(4));
    }

    // 文件打开
    if (elementId.startsWith("open_")) {
      const idx = parseInt(elementId.slice(5), 10);
      return this.openFile(idx);
    }

    // 侧边栏导航
    if (elementId.startsWith("navigate_")) {
      const target = elementId.slice(9);
      if (target === "back") return this.navigateBack();
      if (target === "forward") return this.navigateForward();
      const path = SIDEBAR_PATHS[target];
      if (path) {
        this.navigateTo(path);
        this.state.activeSidebarId = target;
        return true;
      }
    }

    return false;
  }

  /** 处理右键菜单操作 */
  private handleContextAction(action: string): boolean {
    const targetIdx = this.state.contextMenu?.targetIndex ?? -1;
    this.state.contextMenu = null;

    switch (action) {
      case "open":
        return this.openFile(targetIdx);
      case "copy":
        if (targetIdx >= 0 && targetIdx < this.state.files.length) {
          const file = this.state.files[targetIdx];
          this.clipboard = `${this.state.currentPath}/${file.name}`;
        }
        return true;
      case "rename":
        // 重命名需要 input 节点支持，标记选中状态
        this.state.selectedIndex = targetIdx;
        return true;
      case "delete":
        if (targetIdx >= 0 && targetIdx < this.state.files.length) {
          const file = this.state.files[targetIdx];
          deleteEntry(`${this.state.currentPath}/${file.name}`).then(() => {
            this.refreshDirectory();
          });
        }
        return true;
      case "new_folder":
        // 创建新文件夹（默认名称）
        import("../../kernel/fs").then(({ createDirectory }) => {
          createDirectory(this.state.currentPath, "新建文件夹").then(() => {
            this.refreshDirectory();
          });
        });
        return true;
      case "paste":
        if (this.clipboard) {
          copyEntry(this.clipboard, this.state.currentPath).then(() => {
            this.refreshDirectory();
          });
        }
        return true;
      case "toggle_view":
        this.state.viewMode = this.state.viewMode === "grid" ? "list" : "grid";
        return true;
    }
    return false;
  }

  /** 处理键盘事件 */
  private handleKey(key: number, modifiers: number): boolean {
    const ctrl = (modifiers & 2) !== 0;

    // Escape：关闭右键菜单
    if (key === 1 && this.state.contextMenu) {
      this.state.contextMenu = null;
      return true;
    }

    // Enter：打开选中文件
    if (key === 28 && this.state.selectedIndex >= 0) {
      return this.openFile(this.state.selectedIndex);
    }

    // Delete：删除选中文件
    if (key === 111 && this.state.selectedIndex >= 0) {
      const file = this.state.files[this.state.selectedIndex];
      deleteEntry(`${this.state.currentPath}/${file.name}`).then(() => {
        this.refreshDirectory();
      });
      return true;
    }

    // Ctrl+C：复制
    if (ctrl && key === 46 && this.state.selectedIndex >= 0) {
      const file = this.state.files[this.state.selectedIndex];
      this.clipboard = `${this.state.currentPath}/${file.name}`;
      return false;
    }

    // Ctrl+V：粘贴
    if (ctrl && key === 47 && this.clipboard) {
      copyEntry(this.clipboard, this.state.currentPath).then(() => {
        this.refreshDirectory();
      });
      return true;
    }

    // 方向键导航
    if (key === 103) { // Up
      if (this.state.selectedIndex > 0) this.state.selectedIndex--;
      return true;
    }
    if (key === 108) { // Down
      if (this.state.selectedIndex < this.state.files.length - 1) this.state.selectedIndex++;
      return true;
    }

    // Backspace：返回上级目录
    if (key === 14) {
      return this.navigateBack();
    }

    return false;
  }

  /** 打开文件/目录 */
  private openFile(index: number): boolean {
    if (index < 0 || index >= this.state.files.length) return false;
    const file = this.state.files[index];

    if (file.isDirectory) {
      const newPath = `${this.state.currentPath}/${file.name}`;
      this.navigateTo(newPath);
      return true;
    }

    // 非目录文件：通过事件通知外部处理
    console.log(`[FileManager] 打开文件: ${this.state.currentPath}/${file.name}`);
    return false;
  }

  /** 导航到指定路径 */
  navigateTo(path: string): void {
    this.state.currentPath = path;
    this.state.breadcrumbs = path.split("/").filter(Boolean);
    this.state.selectedIndex = -1;
    this.state.contextMenu = null;

    // 更新历史
    this.state.history = this.state.history.slice(0, this.state.historyIndex + 1);
    this.state.history.push(path);
    this.state.historyIndex = this.state.history.length - 1;

    this.refreshDirectory();
  }

  /** 后退 */
  private navigateBack(): boolean {
    if (this.state.historyIndex > 0) {
      this.state.historyIndex--;
      const path = this.state.history[this.state.historyIndex];
      this.state.currentPath = path;
      this.state.breadcrumbs = path.split("/").filter(Boolean);
      this.state.selectedIndex = -1;
      this.refreshDirectory();
      return true;
    }
    return false;
  }

  /** 前进 */
  private navigateForward(): boolean {
    if (this.state.historyIndex < this.state.history.length - 1) {
      this.state.historyIndex++;
      const path = this.state.history[this.state.historyIndex];
      this.state.currentPath = path;
      this.state.breadcrumbs = path.split("/").filter(Boolean);
      this.state.selectedIndex = -1;
      this.refreshDirectory();
      return true;
    }
    return false;
  }

  /** 刷新当前目录 */
  async refreshDirectory(): Promise<void> {
    const listing = await listDirectory(this.state.currentPath);
    this.state.files = listing.entries.map((e) => ({
      name: e.name,
      isDirectory: e.isDirectory,
      size: e.size,
      modifiedAt: formatDate(e.modifiedAt),
      type: e.isDirectory ? "文件夹" : getFileType(e.name),
    }));

    const disk = await getDiskSpace("/");
    this.state.availableSpace = formatBytes(disk.available);
  }

  /** 显示右键菜单 */
  showContextMenu(x: number, y: number, fileIndex: number): void {
    this.state.contextMenu = {
      x,
      y,
      targetIndex: fileIndex,
      items: fileIndex >= 0 ? getFileContextMenu() : getBlankContextMenu(),
    };
  }
}
