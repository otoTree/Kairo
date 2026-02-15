import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { DeviceRegistry } from './registry';
import { DeviceMonitor } from './monitor';
import { DeviceManager } from './manager';

describe('Device Integration Tests (Mock)', () => {
    let registry: DeviceRegistry;
    let monitor: DeviceMonitor;
    let manager: DeviceManager;

    beforeAll(async () => {
        // Force mock mode
        process.env.KAIRO_MOCK_DEVICES = 'true';
        
        registry = new DeviceRegistry();
        monitor = new DeviceMonitor(registry);
        manager = new DeviceManager(registry);
        
        await monitor.start();
    });

    afterAll(() => {
        monitor.stop();
        delete process.env.KAIRO_MOCK_DEVICES;
    });

    it('should discover mock device', async () => {
        const devices = registry.list();
        expect(devices.length).toBeGreaterThan(0);
        const mockDevice = devices.find(d => d.id === 'mock_serial_01');
        expect(mockDevice).toBeDefined();
        expect(mockDevice?.status).toBe('available');
    });

    it('should claim device', () => {
        const success = registry.claim('mock_serial_01', 'test_agent');
        expect(success).toBe(true);
        
        const device = registry.get('mock_serial_01');
        expect(device?.status).toBe('busy');
        expect(device?.owner).toBe('test_agent');
    });

    it('should fail to claim already claimed device', () => {
        expect(() => {
            registry.claim('mock_serial_01', 'another_agent');
        }).toThrow();
    });

    it('should get driver and communicate', async () => {
        const driver = await manager.getDriver('mock_serial_01');
        expect(driver).toBeDefined();
        
        // Test communication
        const responsePromise = new Promise<string>(resolve => {
            driver.on('data', (data) => resolve(data.toString()));
        });
        
        await driver.write('PING');
        const response = await responsePromise;
        expect(response).toBe('PONG');
    });

    it('should release device', async () => {
        await manager.releaseDriver('mock_serial_01');
        
        const success = registry.release('mock_serial_01', 'test_agent');
        expect(success).toBe(true);
        
        const device = registry.get('mock_serial_01');
        expect(device?.status).toBe('available');
        expect(device?.owner).toBeNull();
    });
});
