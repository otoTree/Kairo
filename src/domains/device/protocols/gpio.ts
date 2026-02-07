export interface GPIO {
  setMode(pin: number, mode: 'input' | 'output'): Promise<void>;
  write(pin: number, value: 0 | 1): Promise<void>;
  read(pin: number): Promise<0 | 1>;
  on(event: 'change', listener: (pin: number, value: 0 | 1) => void): void;
}
