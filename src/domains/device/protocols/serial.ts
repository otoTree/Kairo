export interface SerialPort {
  open(baudRate: number): Promise<void>;
  write(data: Uint8Array): Promise<void>;
  read(length?: number): Promise<Uint8Array>; // Or via EventStream
  close(): Promise<void>;
  on(event: 'data', listener: (data: Uint8Array) => void): void;
}
