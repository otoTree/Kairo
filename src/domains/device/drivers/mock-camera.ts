import { EventEmitter } from 'events';
import type { IDeviceDriver } from './types';

/**
 * Mock Camera 驱动 — 模拟摄像头设备，用于开发和测试
 * 定期生成假帧数据
 */
export class MockCameraDriver extends EventEmitter implements IDeviceDriver {
  id: string;
  type = 'camera';
  private connected = false;
  private frameTimer?: ReturnType<typeof setInterval>;
  private frameCount = 0;
  private width = 640;
  private height = 480;

  constructor(id: string) {
    super();
    this.id = id;
  }

  async connect(options?: { width?: number; height?: number; fps?: number }): Promise<void> {
    this.width = options?.width || 640;
    this.height = options?.height || 480;
    const fps = options?.fps || 1;
    this.connected = true;

    // 模拟帧生成
    this.frameTimer = setInterval(() => {
      if (!this.connected) return;
      this.frameCount++;
      // 生成一个简单的假帧（带帧号标记的小 buffer）
      const header = `FRAME:${this.frameCount}:${this.width}x${this.height}`;
      const data = Buffer.from(header);
      this.emit('data', data);
    }, 1000 / fps);

    console.log(`[MockCamera] ${this.id} opened (${this.width}x${this.height})`);
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    if (this.frameTimer) {
      clearInterval(this.frameTimer);
      this.frameTimer = undefined;
    }
    this.emit('disconnected');
    console.log(`[MockCamera] ${this.id} closed`);
  }

  async write(_data: Buffer | string | Uint8Array): Promise<void> {
    // 摄像头通常不接受写入，但可用于发送控制命令
    console.log(`[MockCamera] ${this.id} received control command`);
  }

  /** 模拟捕获单帧 */
  async capture(): Promise<Uint8Array> {
    this.frameCount++;
    return Buffer.from(`CAPTURE:${this.frameCount}:${this.width}x${this.height}`);
  }
}
