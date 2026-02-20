/**
 * Camera 协议接口 — 视频帧捕获流
 */
export interface Camera {
  /** 打开摄像头，指定分辨率 */
  open(width: number, height: number): Promise<void>;
  /** 捕获单帧图像，返回 JPEG/PNG Buffer */
  capture(): Promise<Uint8Array>;
  /** 关闭摄像头 */
  close(): Promise<void>;
  /** 帧到达事件 */
  on(event: 'frame', listener: (data: Uint8Array) => void): void;
}
