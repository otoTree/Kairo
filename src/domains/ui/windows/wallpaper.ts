/**
 * 壁纸 Surface 控制器
 *
 * 渲染层：background（通过 KDP set_layer(2)）
 * 初始阶段使用纯色渐变，后续支持图片壁纸。
 */

import type { KdpNode } from "../builders/kdp-node";
import type { WindowController } from "../window-manager";
import { BG_BASE, BRAND_BLUE } from "../tokens";

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
 */
export class WallpaperController implements WindowController {
  readonly windowType = "wallpaper";
  private width: number;
  private height: number;

  constructor(opts: WallpaperOptions) {
    this.width = opts.width;
    this.height = opts.height;
  }

  buildTree(): KdpNode {
    // 微光椭圆居中
    const glowW = 400;
    const glowH = 200;
    const glowX = Math.floor((this.width - glowW) / 2);
    const glowY = Math.floor((this.height - glowH) / 2);

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
      ],
    };
  }

  /** 更新屏幕尺寸 */
  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
  }
}
