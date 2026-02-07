import mitt, { type Emitter } from 'mitt';
import fs from 'fs/promises';
import path from 'path';

export type DeviceType = 'serial' | 'camera' | 'audio_in' | 'audio_out' | 'gpio';

export interface DeviceInfo {
  id: string;          // e.g., "dev_serial_01" or alias
  type: DeviceType;
  path: string;        // e.g., "/dev/ttyUSB0"
  hardwareId: string;  // VID:PID or Serial Number
  status: 'available' | 'busy' | 'error';
  metadata: Record<string, any>;
}

interface DeviceMapping {
  vid: string;
  pid: string;
  alias: string;
  type: DeviceType;
}

type DeviceRegistryEvents = {
  'device:connected': DeviceInfo;
  'device:disconnected': { id: string };
};

export class DeviceRegistry {
  private devices = new Map<string, DeviceInfo>();
  public readonly events: Emitter<DeviceRegistryEvents> = mitt<DeviceRegistryEvents>();
  private mappings: DeviceMapping[] = [];

  constructor(private configPath: string = path.join(process.cwd(), 'config', 'devices.json')) {}

  async loadConfig() {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      const config = JSON.parse(content);
      if (Array.isArray(config.mappings)) {
        this.mappings = config.mappings;
        console.log(`[DeviceRegistry] Loaded ${this.mappings.length} device mappings`);
      }
    } catch (e) {
      console.warn(`[DeviceRegistry] Failed to load config from ${this.configPath}:`, e);
    }
  }

  resolveMapping(vid: number, pid: number): DeviceMapping | undefined {
    // Convert dec to hex string if needed, or assume input matches config format
    // usb-detection returns integers. config has hex strings (usually).
    const vidHex = vid.toString(16).padStart(4, '0');
    const pidHex = pid.toString(16).padStart(4, '0');
    
    return this.mappings.find(m => 
      m.vid.toLowerCase() === vidHex && m.pid.toLowerCase() === pidHex
    );
  }

  register(device: DeviceInfo) {
    this.devices.set(device.id, device);
    console.log(`[DeviceRegistry] Registered ${device.id} (${device.type})`);
    this.events.emit('device:connected', device);
  }


  unregister(id: string) {
    if (this.devices.has(id)) {
      this.devices.delete(id);
      console.log(`[DeviceRegistry] Unregistered ${id}`);
      this.events.emit('device:disconnected', { id });
    }
  }

  get(id: string): DeviceInfo | undefined {
    return this.devices.get(id);
  }

  list(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }
}
