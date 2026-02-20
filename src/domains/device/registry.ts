import mitt, { type Emitter } from 'mitt';
import fs from 'fs/promises';
import path from 'path';
import type { StateRepository } from '../database/repositories/state-repository';

export type DeviceType = 'serial' | 'camera' | 'audio_in' | 'audio_out' | 'gpio';

/**
 * 简易异步互斥锁，用于 claim/release 并发控制
 */
class AsyncMutex {
  private locked = false;
  private queue: (() => void)[] = [];

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const tryAcquire = () => {
        if (!this.locked) {
          this.locked = true;
          resolve(() => {
            this.locked = false;
            const next = this.queue.shift();
            if (next) next();
          });
        } else {
          this.queue.push(tryAcquire);
        }
      };
      tryAcquire();
    });
  }
}

export interface DeviceInfo {
  id: string;          // e.g., "dev_serial_01" or alias
  type: DeviceType;
  path: string;        // e.g., "/dev/ttyUSB0"
  hardwareId: string;  // VID:PID or Serial Number
  status: 'available' | 'busy' | 'error';
  owner: string | null; // ID of the agent/process claiming the device
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
  'device:claimed': { id: string; owner: string };
  'device:released': { id: string; owner: string };
};

export interface DeviceClaim {
  deviceId: string;
  ownerId: string;
  claimedAt: number;
}

export class DeviceRegistry {
  private devices = new Map<string, DeviceInfo>();
  public readonly events: Emitter<DeviceRegistryEvents> = mitt<DeviceRegistryEvents>();
  private mappings: DeviceMapping[] = [];
  private pendingClaims = new Map<string, DeviceClaim>();
  // 每个设备一把互斥锁，防止并发 claim/release 竞态
  private claimLocks = new Map<string, AsyncMutex>();

  private getLock(deviceId: string): AsyncMutex {
    if (!this.claimLocks.has(deviceId)) {
      this.claimLocks.set(deviceId, new AsyncMutex());
    }
    return this.claimLocks.get(deviceId)!;
  }

  constructor(
    private configPath: string = path.join(process.cwd(), 'config', 'devices.json'),
    private stateRepo?: StateRepository
  ) {}

  async recover() {
    if (!this.stateRepo) return;
    const claims = await this.stateRepo.getByPrefix<DeviceClaim>('device:claim:');
    console.log(`[DeviceRegistry] Recovered ${claims.length} claims`);
    for (const { value: claim } of claims) {
      const device = this.devices.get(claim.deviceId);
      if (device) {
        device.owner = claim.ownerId;
        device.status = 'busy';
        this.events.emit('device:claimed', { id: claim.deviceId, owner: claim.ownerId });
      } else {
        this.pendingClaims.set(claim.deviceId, claim);
      }
    }
  }

  async loadConfig() {
    try {
      const content = await fs.readFile(this.configPath, 'utf-8');
      let config;
      try {
        config = JSON.parse(content);
      } catch (parseErr) {
        console.error(`[DeviceRegistry] Invalid JSON in config file ${this.configPath}:`, parseErr);
        return;
      }
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
    // Preserve existing owner/status if re-registering (e.g. metadata update)
    const existing = this.devices.get(device.id);
    if (existing) {
        device.owner = existing.owner;
        device.status = existing.status;
    } else {
        // Check pending claims
        const pending = this.pendingClaims.get(device.id);
        if (pending) {
            console.log(`[DeviceRegistry] Applying pending claim for ${device.id} to ${pending.ownerId}`);
            device.owner = pending.ownerId;
            device.status = 'busy';
            this.pendingClaims.delete(device.id);
        } else {
            device.owner = null;
            device.status = 'available';
        }
    }
    
    this.devices.set(device.id, device);
    console.log(`[DeviceRegistry] Registered ${device.id} (${device.type})`);
    this.events.emit('device:connected', device);
    
    if (device.owner && !existing) {
         // If we applied a pending claim, emit claimed event
         this.events.emit('device:claimed', { id: device.id, owner: device.owner });
    }
  }

  unregister(id: string) {
    if (this.devices.has(id)) {
      this.devices.delete(id);
      console.log(`[DeviceRegistry] Unregistered ${id}`);
      this.events.emit('device:disconnected', { id });
    }
  }

  async claim(deviceId: string, ownerId: string): Promise<boolean> {
    const release = await this.getLock(deviceId).acquire();
    try {
      const device = this.devices.get(deviceId);
      if (!device) {
          throw new Error(`Device ${deviceId} not found`);
      }

      if (device.status === 'busy' && device.owner !== ownerId) {
          throw new Error(`Device ${deviceId} is already claimed by ${device.owner}`);
      }

      if (device.status === 'error') {
          throw new Error(`Device ${deviceId} is in error state`);
      }

      device.status = 'busy';
      device.owner = ownerId;
      this.devices.set(deviceId, device);

      if (this.stateRepo) {
        await this.stateRepo.save(`device:claim:${deviceId}`, {
          deviceId,
          ownerId,
          claimedAt: Date.now()
        });
      }

      this.events.emit('device:claimed', { id: deviceId, owner: ownerId });
      console.log(`[DeviceRegistry] Device ${deviceId} claimed by ${ownerId}`);
      return true;
    } finally {
      release();
    }
  }

  async release(deviceId: string, ownerId: string): Promise<boolean> {
    const releaseLock = await this.getLock(deviceId).acquire();
    try {
      const device = this.devices.get(deviceId);
      if (!device) {
           if (this.pendingClaims.has(deviceId)) {
               const claim = this.pendingClaims.get(deviceId);
               if (claim && claim.ownerId === ownerId) {
                   this.pendingClaims.delete(deviceId);
                   if (this.stateRepo) {
                       await this.stateRepo.delete(`device:claim:${deviceId}`);
                   }
                   return true;
               }
           }
           throw new Error(`Device ${deviceId} not found`);
      }

      if (device.owner !== ownerId) {
          throw new Error(`Device ${deviceId} is not claimed by ${ownerId}`);
      }

      device.status = 'available';
      device.owner = null;
      this.devices.set(deviceId, device);

      if (this.stateRepo) {
        await this.stateRepo.delete(`device:claim:${deviceId}`);
      }

      this.events.emit('device:released', { id: deviceId, owner: ownerId });
      console.log(`[DeviceRegistry] Device ${deviceId} released by ${ownerId}`);
      return true;
    } finally {
      releaseLock();
    }
  }
  
  forceRelease(deviceId: string) {
      const device = this.devices.get(deviceId);
      if (device && device.owner) {
          const oldOwner = device.owner;
          device.status = 'available';
          device.owner = null;
          this.events.emit('device:released', { id: deviceId, owner: oldOwner });
          console.log(`[DeviceRegistry] Device ${deviceId} force released`);
      }
  }

  get(id: string): DeviceInfo | undefined {
    return this.devices.get(id);
  }

  list(): DeviceInfo[] {
    return Array.from(this.devices.values());
  }
}
