import type { GPIO as IGPIO } from '../protocols/gpio';

export class GPIODriver implements IGPIO {
  private pins: Map<number, any> = new Map();
  private Gpio: any;

  constructor() {
    try {
      // Try to require onoff (Linux only)
      this.Gpio = require('onoff').Gpio;
    } catch (e) {
      console.warn('[GPIODriver] "onoff" not available (not on Linux?). Using Mock driver.');
    }
  }

  async setMode(pin: number, mode: 'input' | 'output'): Promise<void> {
    if (this.Gpio) {
      const direction = mode === 'input' ? 'in' : 'out';
      // Cleanup existing if any
      if (this.pins.has(pin)) {
        this.pins.get(pin).unexport();
      }
      this.pins.set(pin, new this.Gpio(pin, direction));
    } else {
      console.log(`[GPIODriver-Mock] setMode(${pin}, ${mode})`);
      this.pins.set(pin, { mode, value: 0 });
    }
  }

  async write(pin: number, value: 0 | 1): Promise<void> {
    const p = this.pins.get(pin);
    if (!p) throw new Error(`Pin ${pin} not initialized`);

    if (this.Gpio) {
      await p.write(value);
    } else {
      console.log(`[GPIODriver-Mock] write(${pin}, ${value})`);
      p.value = value;
    }
  }

  async read(pin: number): Promise<0 | 1> {
    const p = this.pins.get(pin);
    if (!p) throw new Error(`Pin ${pin} not initialized`);

    if (this.Gpio) {
      return await p.read();
    } else {
      console.log(`[GPIODriver-Mock] read(${pin}) -> ${p.value}`);
      return p.value;
    }
  }

  on(event: 'change', listener: (pin: number, value: 0 | 1) => void): void {
     // Mock implementation for event listener registration
     // Real implementation would need to attach listeners to specific pins
     console.log(`[GPIODriver] Event '${event}' listener registered (Not fully implemented for all pins)`);
  }
}
