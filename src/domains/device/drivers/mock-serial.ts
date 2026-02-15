import { EventEmitter } from 'events';
import { Duplex, PassThrough } from 'stream';
import type { IDeviceDriver } from './types';

export interface MockScenarioStep {
  match: string | RegExp;
  reply: string | Buffer;
  delay?: number;
}

export class MockSerialDriver extends EventEmitter implements IDeviceDriver {
  public id: string;
  public type: string = 'mock-serial';
  
  private stream: Duplex;
  private isConnected: boolean = false;
  private scenario: MockScenarioStep[] = [];

  constructor(deviceId: string, scenario: MockScenarioStep[] = []) {
    super();
    this.id = deviceId;
    this.scenario = scenario;
    this.stream = new PassThrough(); // Or just use events
    
    // If using PassThrough, we might want to pipe it somewhere?
    // For now, let's just stick to event emitting for simplicity
  }

  async connect(options?: any): Promise<void> {
    console.log(`[MockSerialDriver:${this.id}] Connecting...`);
    await new Promise(resolve => setTimeout(resolve, 100)); // Simulate delay
    this.isConnected = true;
    console.log(`[MockSerialDriver:${this.id}] Connected`);
    this.emit('connected');
  }

  async disconnect(): Promise<void> {
    console.log(`[MockSerialDriver:${this.id}] Disconnecting...`);
    this.isConnected = false;
    this.emit('disconnected');
  }

  async write(data: Buffer | string | Uint8Array): Promise<void> {
    if (!this.isConnected) {
      throw new Error(`Device ${this.id} is not connected`);
    }

    const input = data.toString();
    console.log(`[MockSerialDriver:${this.id}] Written: "${input.trim()}"`);
    
    // Check scenario for auto-reply
    for (const step of this.scenario) {
      if ((typeof step.match === 'string' && input.includes(step.match)) ||
          (step.match instanceof RegExp && step.match.test(input))) {
        
        const delay = step.delay || 100;
        setTimeout(() => {
          if (this.isConnected) {
            console.log(`[MockSerialDriver:${this.id}] Auto-reply: "${step.reply.toString().trim()}"`);
            this.emit('data', Buffer.from(step.reply));
          }
        }, delay);
        break; // Only trigger first match? Or all? Let's say first match.
      }
    }
  }
  
  // Method to simulate incoming data from device (for testing unsolicited messages)
  simulateIncoming(data: string | Buffer) {
      if (this.isConnected) {
          console.log(`[MockSerialDriver:${this.id}] Simulate incoming: "${data.toString().trim()}"`);
          this.emit('data', Buffer.from(data));
      }
  }
}
