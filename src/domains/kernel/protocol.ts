import { pack, unpack } from 'msgpackr';

export const MAGIC = 0x4B41; // 'KA'
export const VERSION = 1;

export enum PacketType {
  REQUEST = 0x01,
  RESPONSE = 0x02,
  EVENT = 0x03,
  STREAM_CHUNK = 0x04,
}

export interface Packet {
  type: PacketType;
  payload: any;
}

const HEADER_SIZE = 8; // Magic(2) + Version(1) + Type(1) + Length(4)

export class Protocol {
  static encode(type: PacketType, payload: any): Buffer {
    const body = pack(payload);
    const length = body.length;
    const header = Buffer.alloc(HEADER_SIZE);
    
    header.writeUInt16BE(MAGIC, 0);
    header.writeUInt8(VERSION, 2);
    header.writeUInt8(type, 3);
    header.writeUInt32BE(length, 4);
    
    return Buffer.concat([header, body]);
  }

  static decode(buffer: Buffer): { packet: Packet, consumed: number } | null {
    if (buffer.length < HEADER_SIZE) return null;
    
    const magic = buffer.readUInt16BE(0);
    if (magic !== MAGIC) {
      throw new Error('Invalid magic bytes');
    }
    
    const version = buffer.readUInt8(2);
    if (version !== VERSION) {
      throw new Error(`Unsupported version: ${version}`);
    }
    
    const type = buffer.readUInt8(3);
    const length = buffer.readUInt32BE(4);
    
    if (buffer.length < HEADER_SIZE + length) {
      return null; // Not enough data
    }
    
    const payloadBuffer = buffer.subarray(HEADER_SIZE, HEADER_SIZE + length);
    const payload = unpack(payloadBuffer);
    
    return {
      packet: { type, payload },
      consumed: HEADER_SIZE + length
    };
  }
}
