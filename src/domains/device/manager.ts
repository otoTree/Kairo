import { DeviceRegistry } from './registry';
import type { IDeviceDriver } from './drivers/types';
import { MockSerialDriver } from './drivers/mock-serial';
import { MockCameraDriver } from './drivers/mock-camera';
import { NativeSerialDriver } from './drivers/serial';
import { GPIODriver } from './drivers/gpio';

export class DeviceManager {
  private drivers = new Map<string, IDeviceDriver>();

  constructor(private registry: DeviceRegistry) {}

  async getDriver(deviceId: string): Promise<IDeviceDriver> {
    if (this.drivers.has(deviceId)) {
      return this.drivers.get(deviceId)!;
    }

    const device = this.registry.get(deviceId);
    if (!device) {
      throw new Error(`Device ${deviceId} not found`);
    }

    // Check status
    if (device.status !== 'busy') {
        throw new Error(`Device ${deviceId} is not claimed (status: ${device.status})`);
    }

    // 根据设备类型创建驱动
    let driver: IDeviceDriver;
    const useMock = process.platform === 'darwin' || process.env.KAIRO_MOCK_DEVICES === 'true' || device.metadata?.mock;

    switch (device.type) {
      case 'serial':
        if (useMock) {
            driver = new MockSerialDriver(deviceId, [
                { match: 'PING', reply: 'PONG', delay: 100 },
                { match: 'HELLO', reply: 'WORLD', delay: 500 }
            ]);
        } else {
            driver = new NativeSerialDriver(deviceId, device.path);
        }
        break;
      case 'camera':
        // Camera 驱动：目前仅支持 Mock
        driver = new MockCameraDriver(deviceId);
        break;
      case 'gpio':
        if (useMock) {
            // GPIO 在非 Linux 环境下不可用，使用 Mock Serial 替代
            driver = new MockSerialDriver(deviceId, []);
        } else {
            driver = new GPIODriver(deviceId);
        }
        break;
      default:
        throw new Error(`Unsupported device type: ${device.type}`);
    }

    await driver.connect();
    this.drivers.set(deviceId, driver);
    return driver;
  }

  async releaseDriver(deviceId: string) {
    const driver = this.drivers.get(deviceId);
    if (driver) {
      await driver.disconnect();
      this.drivers.delete(deviceId);
    }
  }
}
