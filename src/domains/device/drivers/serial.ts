import { SerialPort } from 'serialport';
import { EventEmitter } from 'events';
import type { IDeviceDriver } from './types';

export class NativeSerialDriver extends EventEmitter implements IDeviceDriver {
  public id: string;
  public type: string = 'serial';
  
  private port: SerialPort | null = null;
  private path: string;

  constructor(deviceId: string, path: string) {
    super();
    this.id = deviceId;
    this.path = path;
  }

  async connect(options?: { baudRate?: number }): Promise<void> {
    const baudRate = options?.baudRate || 9600;
    
    return new Promise((resolve, reject) => {
      this.port = new SerialPort({
        path: this.path,
        baudRate: baudRate,
        autoOpen: false
      });

      this.port.open((err) => {
        if (err) reject(err);
        else resolve();
      });

      // Forward data events
      this.port.on('data', (data) => {
          this.emit('data', data);
      });
      
      this.port.on('error', (err) => {
          this.emit('error', err);
      });
      
      this.port.on('close', () => {
          this.emit('disconnected');
      });
    });
  }

  async write(data: Buffer | string | Uint8Array): Promise<void> {
    if (!this.port || !this.port.isOpen) throw new Error('Port not open');
    
    return new Promise((resolve, reject) => {
      this.port!.write(Buffer.from(data), (err) => {
        if (err) reject(err);
        else {
            this.port!.drain((err) => {
                if (err) reject(err);
                else resolve();
            });
        }
      });
    });
  }

  async disconnect(): Promise<void> {
    if (!this.port) return;
    
    return new Promise((resolve, reject) => {
      if (this.port?.isOpen) {
        this.port.close((err) => {
            if (err) reject(err);
            else {
                this.port = null;
                resolve();
            }
        });
      } else {
          this.port = null;
          resolve();
      }
    });
  }
}
