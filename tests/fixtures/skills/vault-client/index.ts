import { connect } from "bun";
import { pack, unpack } from "msgpackr";

// Simplified Protocol implementation for the client
const MAGIC = 0x4B41;
const VERSION = 1;
enum PacketType { REQUEST = 0x01, RESPONSE = 0x02 }

function encode(type: PacketType, payload: any): Buffer {
    const body = pack(payload);
    const header = Buffer.alloc(8);
    header.writeUInt16BE(MAGIC, 0);
    header.writeUInt8(VERSION, 2);
    header.writeUInt8(type, 3);
    header.writeUInt32BE(body.length, 4);
    return Buffer.concat([header, body]);
}

function decode(buffer: Buffer) {
    if (buffer.length < 8) return null;
    const length = buffer.readUInt32BE(4);
    if (buffer.length < 8 + length) return null;
    const payload = unpack(buffer.subarray(8, 8 + length));
    return { payload, consumed: 8 + length };
}

async function main() {
    const socketPath = process.env.KAIRO_IPC_SOCKET;
    const token = process.env.KAIRO_RUNTIME_TOKEN;
    const handle = process.env.MY_API_KEY;

    if (!socketPath || !token || !handle) {
        console.error("Missing env vars");
        process.exit(1);
    }

    console.log(`Connecting to ${socketPath}`);
    const socket = await connect({
        unix: socketPath,
        socket: {
            data(socket, data) {
                const result = decode(Buffer.from(data));
                if (result) {
                    const { payload } = result;
                    if (payload.result && payload.result.value) {
                        console.log(`Resolved Secret: ${payload.result.value}`);
                        socket.end();
                        process.exit(0);
                    } else {
                        console.error("Failed to resolve:", payload.error);
                        process.exit(1);
                    }
                }
            },
            open(socket) {
                const req = {
                    id: "req-1",
                    method: "vault.get",
                    params: { token, handle }
                };
                socket.write(encode(PacketType.REQUEST, req));
            },
            error(socket, error) {
                console.error("Socket error:", error);
                process.exit(1);
            }
        }
    });
}

main();
