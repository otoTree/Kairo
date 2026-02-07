import { connect, type Socket } from 'bun';
import { Protocol, PacketType } from './protocol';

export class IPCClient {
  private socketPath: string;
  private socket: Socket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private responseHandlers = new Map<string, (data: any) => void>();

  constructor(socketPath: string = '/tmp/kairo-kernel.sock') {
    this.socketPath = socketPath;
  }

  async connect() {
    this.socket = await connect({
      unix: this.socketPath,
      socket: {
        data: (socket, data) => this.handleData(data),
        open: (socket) => {},
        close: (socket) => console.log('[Client] Disconnected'),
        error: (socket, error) => console.error(error),
      }
    });
  }

  private handleData(data: Buffer) {
    this.buffer = Buffer.concat([this.buffer, data]);
    
    while (true) {
      const result = Protocol.decode(this.buffer);
      if (!result) break;
      
      const { packet, consumed } = result;
      this.buffer = this.buffer.subarray(consumed);
      
      if (packet.type === PacketType.RESPONSE) {
         if (packet.payload.id && this.responseHandlers.has(packet.payload.id)) {
             this.responseHandlers.get(packet.payload.id)!(packet.payload);
             this.responseHandlers.delete(packet.payload.id);
         }
      }
    }
  }

  async request(payload: any): Promise<any> {
    if (!this.socket) throw new Error('Not connected');
    
    const id = Math.random().toString(36).substring(7);
    const req = { ...payload, id };
    
    const packet = Protocol.encode(PacketType.REQUEST, req);
    this.socket.write(packet);
    
    return new Promise((resolve) => {
        this.responseHandlers.set(id, resolve);
    });
  }
  
  close() {
      if (this.socket) {
          this.socket.end();
          this.socket = null;
      }
  }
}
