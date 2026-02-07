import { SerialPort } from 'serialport';
import type { SerialPort as ISerialPort } from '../protocols/serial';

export class NativeSerialDriver implements ISerialPort {
  private port: SerialPort | null = null;
  private path: string;

  constructor(path: string) {
    this.path = path;
  }

  async open(baudRate: number): Promise<void> {
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
          // data is Buffer, compatible with Uint8Array
          this.emitData(data);
      });
    });
  }

  async write(data: Uint8Array): Promise<void> {
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

  async read(length?: number): Promise<Uint8Array> {
     // This is a bit tricky with event-based SerialPort.
     // Typically we use 'data' event. If we need strict read(length), we need to buffer.
     // For now, let's implement a simple one-shot read if data is available, or throw.
     // But strictly speaking, serial ports are stream-based.
     // The interface definition suggests `read` OR `on('data')`. 
     // Let's rely on `on('data')` primarily.
     throw new Error('Method not implemented. Use on("data") listener.');
  }

  async close(): Promise<void> {
    if (!this.port) return;
    
    return new Promise((resolve, reject) => {
      this.port!.close((err) => {
        if (err) reject(err);
        else {
            this.port = null;
            resolve();
        }
      });
    });
  }

  private listeners: ((data: Uint8Array) => void)[] = [];

  on(event: 'data', listener: (data: Uint8Array) => void): void {
    if (event === 'data') {
        this.listeners.push(listener);
    }
  }

  private emitData(data: Buffer) {
      const uint8 = new Uint8Array(data);
      for (const listener of this.listeners) {
          listener(uint8);
      }
  }
}
