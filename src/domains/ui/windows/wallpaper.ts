/**
 * 壁纸 Surface 控制器
 *
 * 渲染层：background（通过 KDP set_layer(2)）
 * 包含纯色渐变壁纸 + Windows 风格桌面图标。
 * 点击桌面图标可启动对应应用。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { KdpEvent, WindowController } from "../window-manager";
import { BG_BASE, BRAND_BLUE } from "../tokens";
import { DesktopIconsController } from "./desktop-icons";

export interface WallpaperOptions {
  /** 屏幕宽度 */
  width: number;
  /** 屏幕高度 */
  height: number;
}

/**
 * 壁纸控制器
 *
 * 生成 background 层的 UI 树：
 * - 底色使用 Base #0D0D12
 * - 中心微光使用 Kairo Blue 3% 透明度
 * - 桌面图标（Windows 风格，左侧按列排列）
 */
export class WallpaperController implements WindowController {
  readonly windowType = "wallpaper";
  private width: number;
  private height: number;
  /** 桌面图标子控制器 */
  private desktopIcons: DesktopIconsController;

  /** 应用启动回调（由外部设置） */
  set onLaunchApp(cb: ((appId: string) => void) | undefined) {
    this.desktopIcons.onLaunchApp = cb;
  }

  constructor(opts: WallpaperOptions) {
    this.width = opts.width;
    this.height = opts.height;
    this.desktopIcons = new DesktopIconsController({
      width: opts.width,
      height: opts.height,
    });
  }

  buildTree(): KdpNode {
    // 微光椭圆居中
    const glowW = 400;
    const glowH = 200;
    const glowX = Math.floor((this.width - glowW) / 2);
    const glowY = Math.floor((this.height - glowH) / 2);

    // 获取桌面图标节点
    const iconsTree = this.desktopIcons.buildTree();
    const iconNodes = iconsTree.children ?? [];

    return {
      type: "root",
      children: [
        {
          type: "rect",
          id: "wallpaper-base",
          x: 0,
          y: 0,
          width: this.width,
          height: this.height,
          color: BG_BASE,
        },
        {
          type: "rect",
          id: "wallpaper-glow",
          x: glowX,
          y: glowY,
          width: glowW,
          height: glowH,
          color: [BRAND_BLUE[0], BRAND_BLUE[1], BRAND_BLUE[2], 0.03],
          radius: 200,
        },
        // 桌面图标
        ...iconNodes,
      ],
    };
  }

  /** 处理桌面图标点击事件 */
  handleEvent(event: KdpEvent): boolean {
    return this.desktopIcons.handleEvent(event);
  }

  /** 更新屏幕尺寸 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.desktopIcons.resize(width, height);
  }
}
