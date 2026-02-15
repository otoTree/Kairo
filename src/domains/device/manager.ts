import { DeviceRegistry } from './registry';
import type { IDeviceDriver } from './drivers/types';
import { MockSerialDriver } from './drivers/mock-serial';

import { NativeSerialDriver } from './drivers/serial';

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

    // Create driver based on type
    let driver: IDeviceDriver;
    switch (device.type) {
      case 'serial':
        // Check if we should use Mock
        if (process.platform === 'darwin' || process.env.KAIRO_MOCK_DEVICES === 'true' || device.metadata?.mock) {
            driver = new MockSerialDriver(deviceId, [
                { match: 'PING', reply: 'PONG', delay: 100 },
                { match: 'HELLO', reply: 'WORLD', delay: 500 }
            ]);
        } else {
            driver = new NativeSerialDriver(deviceId, device.path);
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
