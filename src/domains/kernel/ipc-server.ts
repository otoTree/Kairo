import { listen, type Socket } from 'bun';
import { unlink } from 'node:fs/promises';
import { Protocol, PacketType, type Packet } from './protocol';
import type { ProcessManager } from './process-manager';
import type { SystemMonitor } from './system-info';
import type { DeviceRegistry } from '../device/registry';

export class IPCServer {
  private socketPath: string;
  private server: any; // Bun server instance
  private connections = new Set<Socket>();
  private buffers = new Map<Socket, Buffer>();

  constructor(
    private processManager: ProcessManager,
    private systemMonitor: SystemMonitor,
    private deviceRegistry: DeviceRegistry,
    socketPath: string = '/tmp/kairo-kernel.sock'
  ) {
    this.socketPath = socketPath;
    this.setupProcessEvents();
  }

  private setupProcessEvents() {
    this.processManager.on('output', ({ id, type, data }) => {
        this.broadcast(PacketType.STREAM_CHUNK, { id, stream: type, data });
    });

    this.processManager.on('exit', ({ id, code }) => {
        this.broadcast(PacketType.EVENT, { topic: 'process.exit', data: { id, code } });
    });
  }

  async start() {
    // Try to remove existing socket file
    try {
      await unlink(this.socketPath);
    } catch (e) {
      // Ignore if not exists
    }
    
    this.server = listen({
      unix: this.socketPath,
      socket: {
        data: (socket, data) => {
          this.handleData(socket, data);
        },
        open: (socket) => {
          console.log('[IPC] Client connected');
          this.connections.add(socket);
          this.buffers.set(socket, Buffer.alloc(0));
        },
        close: (socket) => {
          console.log('[IPC] Client disconnected');
          this.connections.delete(socket);
          this.buffers.delete(socket);
        },
        error: (socket, error) => {
           console.error('[IPC] Socket error:', error);
           this.connections.delete(socket);
           this.buffers.delete(socket);
        }
      },
    });

    console.log(`[IPC] Server listening on ${this.socketPath}`);
  }

  private handleData(socket: Socket, data: Buffer) {
    let buffer = this.buffers.get(socket) || Buffer.alloc(0);
    buffer = Buffer.concat([buffer, data]);
    
    try {
      while (true) {
        const result = Protocol.decode(buffer);
        if (!result) break;
        
        const { packet, consumed } = result;
        buffer = buffer.subarray(consumed);
        
        this.processPacket(socket, packet);
      }
    } catch (e) {
      console.error('[IPC] Protocol error:', e);
      socket.close(); // Close on protocol error
    }
    
    this.buffers.set(socket, buffer);
  }

  private async processPacket(socket: Socket, packet: Packet) {
    // console.log('[IPC] Received packet:', packet);
    
    if (packet.type === PacketType.REQUEST) {
       const { id, method, params } = packet.payload;
       let result: any = null;
       let error: string | undefined;

       try {
         switch (method) {
            case 'system.get_metrics':
                result = await this.systemMonitor.getMetrics();
                break;
            
            case 'process.spawn':
                if (!params?.id || !params?.command) throw new Error('Missing params: id, command');
                await this.processManager.spawn(params.id, params.command, params.options);
                result = { status: 'spawned', id: params.id };
                break;
            
            case 'process.kill':
                if (!params?.id) throw new Error('Missing params: id');
                this.processManager.kill(params.id);
                result = { status: 'killed', id: params.id };
                break;
            
            case 'process.stdin.write':
                if (!params?.id || params?.data === undefined) throw new Error('Missing params: id, data');
                this.processManager.writeToStdin(params.id, params.data);
                result = { status: 'written', id: params.id };
                break;

            case 'process.wait':
                if (!params?.id) throw new Error('Missing params: id');
                const exitCode = await this.processManager.wait(params.id);
                result = { status: 'exited', id: params.id, exitCode };
                break;

            case 'process.pause':
                if (!params?.id) throw new Error('Missing params: id');
                const paused = this.processManager.pause(params.id);
                result = { status: paused ? 'paused' : 'failed', id: params.id };
                break;

            case 'process.resume':
                if (!params?.id) throw new Error('Missing params: id');
                const resumed = this.processManager.resume(params.id);
                result = { status: resumed ? 'resumed' : 'failed', id: params.id };
                break;

            case 'device.list':
                result = this.deviceRegistry.list();
                break;
            
            default:
                throw new Error(`Unknown method: ${method}`);
         }
       } catch (e: any) {
           error = e.message || String(e);
       }

       const responsePayload = {
         id,
         result,
         error
       };
       
       const response = Protocol.encode(PacketType.RESPONSE, responsePayload);
       socket.write(response);
    }
  }

  private broadcast(type: PacketType, payload: any) {
      const packet = Protocol.encode(type, payload);
      for (const socket of this.connections) {
          try {
              socket.write(packet);
          } catch (e) {
              console.error('[IPC] Broadcast error:', e);
              this.connections.delete(socket);
          }
      }
  }

  stop() {
    if (this.server) {
      this.server.stop();
      this.connections.clear();
      this.buffers.clear();
    }
  }
}
