import { EventEmitter } from 'events';
import { Duplex } from 'stream';

export interface IDeviceDriver extends EventEmitter {
  id: string;
  type: string;
  
  connect(options?: any): Promise<void>;
  disconnect(): Promise<void>;
  
  write(data: Buffer | string | Uint8Array): Promise<void>;
  
  // Optional: access underlying stream if available (for piping)
  getStream?(): Duplex;
}

export interface DeviceDriverFactory {
  create(deviceId: string, path: string, options?: any): IDeviceDriver;
}
