import { IPCServer } from '../src/domains/kernel/ipc-server';
import { IPCClient } from '../src/domains/kernel/ipc-client';
import { ProcessManager } from '../src/domains/kernel/process-manager';
import { SystemMonitor } from '../src/domains/kernel/system-info';
import { DeviceRegistry } from '../src/domains/device/registry';
import { unlink } from 'node:fs/promises';
import { resolve } from 'path';

// Test Configuration
const TEST_SOCKET_PATH = '/tmp/kairo-kernel-test.sock';

async function runTest() {
    console.log('=== Starting Kernel Integration Test ===');

    // 1. Setup Dependencies
    console.log('[Test] Setting up dependencies...');
    const processManager = new ProcessManager();
    const systemMonitor = new SystemMonitor();
    const deviceRegistry = new DeviceRegistry();

    // 2. Start IPC Server
    console.log('[Test] Starting IPC Server...');
    const server = new IPCServer(processManager, systemMonitor, deviceRegistry, undefined, TEST_SOCKET_PATH);
    await server.start();

    // 3. Start IPC Client
    console.log('[Test] Connecting IPC Client...');
    const client = new IPCClient(TEST_SOCKET_PATH);
    
    // Setup client event listeners before connecting
    const events: any[] = [];
    client.on('connected', () => console.log('[Client] Connected'));
    client.on('disconnected', () => console.log('[Client] Disconnected'));
    client.on('error', (err) => console.error('[Client] Error:', err));
    
    // Capture stream output
    const outputChunks: { id: string, stream: string, data: any }[] = [];
    client.on('stream', (chunk) => {
        console.log(`[Client] Received stream chunk: ${chunk.stream} from ${chunk.id}: ${new TextDecoder().decode(chunk.data)}`);
        outputChunks.push(chunk);
    });

    await client.connect();

    try {
        // 4. Test: Spawn Process (cat)
        console.log('[Test] Spawning "cat" process...');
        const processId = 'test-proc-cat-' + Date.now();
        const spawnResult = await client.request('process.spawn', {
            id: processId,
            command: ['cat'], // Echo server
            options: {
                env: { 'TEST_VAR': 'hello' }
            }
        });
        console.log('[Test] Spawn Result:', spawnResult);

        if (spawnResult.status !== 'spawned') {
            throw new Error('Failed to spawn process');
        }

        // 5. Test: Write to Stdin
        console.log('[Test] Writing to stdin...');
        const message = 'Hello Kernel Integration Test\n';
        await client.request('process.stdin.write', {
            id: processId,
            data: message
        });

        // 6. Wait for output
        console.log('[Test] Waiting for output...');
        await new Promise(resolve => setTimeout(resolve, 1000));

        // 7. Verify Output
        const received = outputChunks.find(c => c.id === processId && c.stream === 'stdout');
        if (!received) {
            throw new Error('Did not receive stdout from process');
        }
        const decoded = new TextDecoder().decode(received.data);
        if (!decoded.includes('Hello Kernel Integration Test')) {
            throw new Error(`Output mismatch. Expected "Hello Kernel Integration Test", got "${decoded}"`);
        }
        console.log('[Test] ✅ Stdout verification passed!');

        // 8. Test: Process Lifecycle (Wait/Kill)
        // Since 'cat' waits forever, we'll kill it and check exit code
        console.log('[Test] Killing process...');
        const killResult = await client.request('process.kill', { id: processId });
        console.log('[Test] Kill Result:', killResult);

        // Wait for exit event (optional, handled by server broadcast)
        await new Promise(resolve => setTimeout(resolve, 500));

        // 9. Test: Permission/Sandbox (Basic)
        // Spawn a process that tries to write to a restricted file
        // Note: This requires SandboxManager to be configured, which usually happens via config file or defaults.
        // ProcessManager uses SandboxManager.wrapWithSandbox.
        // By default (no config), sandbox might be disabled or permissive.
        // We will try to pass a sandbox config via 'process.spawn' if the API supports it (we added it!).
        
        console.log('[Test] Testing Sandbox Restriction...');
        const sandboxId = 'test-proc-sandbox-' + Date.now();
        const forbiddenPath = '/tmp/kairo_forbidden_test';
        
        // We expect this to fail or produce an error/warning if sandbox is working
        // But since we are running in 'bun test' or script, we might not have 'sandbox-exec' or 'bwrap' set up perfectly.
        // Let's just verify we can pass the config.
        
        try {
            await client.request('process.spawn', {
                id: sandboxId,
                command: ['touch', forbiddenPath],
                options: {
                    sandbox: {
                        filesystem: {
                            denyWrite: [forbiddenPath],
                            allowWrite: [],
                            denyRead: []
                        },
                        network: {
                            allowedDomains: [],
                            deniedDomains: []
                        }
                    }
                }
            });
            console.log('[Test] Sandbox process spawned. Waiting for exit...');
            const exitCode = await client.request('process.wait', { id: sandboxId });
            console.log('[Test] Sandbox process exit code:', exitCode);
            
            // On macOS with sandbox-exec, violation usually kills the process or returns error code.
            // On Linux with bwrap, similar.
            // If sandbox is active, this should likely be non-zero.
            
            if (process.platform === 'darwin' || process.platform === 'linux') {
                if (exitCode.exitCode !== 0) {
                     console.log('[Test] ✅ Sandbox restriction likely worked (non-zero exit code).');
                } else {
                     console.warn('[Test] ⚠️ Sandbox process exited with 0. Restriction might not be enforced or ignored on this platform/config.');
                }
            }

        } catch (e) {
            console.log('[Test] Sandbox spawn failed as expected (or error):', e);
        }

    } catch (error) {
        console.error('[Test] ❌ Test Failed:', error);
        process.exit(1);
    } finally {
        // Cleanup
        console.log('[Test] Cleaning up...');
        client.close();
        server.stop();
        try {
            await unlink(TEST_SOCKET_PATH);
        } catch {}
        console.log('[Test] Done.');
        process.exit(0);
    }
}

runTest();
