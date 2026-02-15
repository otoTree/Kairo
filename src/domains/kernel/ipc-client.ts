import { connect, type Socket } from 'bun';
import { Protocol, PacketType } from './protocol';
import { EventEmitter } from 'node:events';

export class IPCClient extends EventEmitter {
  private socketPath: string;
  private socket: Socket<any> | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private responseHandlers = new Map<string, (data: any) => void>();

  constructor(socketPath: string = '/tmp/kairo-kernel.sock') {
    super();
    this.socketPath = socketPath;
  }

  async connect() {
    this.socket = await connect({
      unix: this.socketPath,
      socket: {
        data: (socket, data) => {
            this.buffer = Buffer.concat([this.buffer, data]);
            this.processBuffer();
        },
        open: (socket) => {
            this.emit('connected');
        },
        close: (socket) => {
            console.log('[Client] Disconnected');
            this.emit('disconnected');
        },
        error: (socket, error) => {
            console.error(error);
            this.emit('error', error);
        },
      }
    });
  }

  private processBuffer() {
    while (true) {
      const result = Protocol.decode(this.buffer);
      if (!result) break;
      
      const { packet, consumed } = result;
      this.buffer = this.buffer.subarray(consumed);
      
      if (packet.type === PacketType.RESPONSE) {
         if (packet.payload.id && this.responseHandlers.has(packet.payload.id)) {
             const handler = this.responseHandlers.get(packet.payload.id);
             if (handler) {
                 handler(packet.payload);
                 this.responseHandlers.delete(packet.payload.id);
             }
         }
      } else if (packet.type === PacketType.EVENT) {
          this.emit('event', packet.payload);
      } else if (packet.type === PacketType.STREAM_CHUNK) {
          this.emit('stream', packet.payload);
      }
    }
  }

  async request(method: string, params: any = {}): Promise<any> {
    if (!this.socket) throw new Error('Not connected');
    
    const id = Math.random().toString(36).substring(7);
    const req = { id, method, params };
    
    const packet = Protocol.encode(PacketType.REQUEST, req);
    this.socket.write(packet);
    
    return new Promise((resolve, reject) => {
        // Set a timeout to avoid hanging indefinitely
        const timeout = setTimeout(() => {
            this.responseHandlers.delete(id);
            reject(new Error('Request timed out'));
        }, 5000);

        this.responseHandlers.set(id, (response) => {
            clearTimeout(timeout);
            if (response.error) {
                reject(new Error(response.error));
            } else {
                resolve(response.result);
            }
        });
    });
  }
  
  close() {
      if (this.socket) {
          this.socket.end();
          this.socket = null;
      }
  }
}
