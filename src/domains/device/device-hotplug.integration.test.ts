import { describe, it, expect, beforeEach } from 'bun:test';
import { DeviceRegistry, type DeviceInfo } from './registry';

describe('DeviceRegistry 并发控制与热插拔', () => {
  let registry: DeviceRegistry;

  beforeEach(() => {
    registry = new DeviceRegistry(undefined, undefined);
  });

  const mockDevice: DeviceInfo = {
    id: 'test_serial_01',
    type: 'serial',
    path: '/dev/ttyUSB0',
    hardwareId: '1234:5678',
    status: 'available',
    owner: null,
    metadata: { mock: true },
  };

  it('应支持并发 claim 互斥（只有一个成功）', async () => {
    registry.register({ ...mockDevice });

    // 同时发起两个 claim
    const results = await Promise.allSettled([
      registry.claim('test_serial_01', 'agent-a'),
      registry.claim('test_serial_01', 'agent-b'),
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');

    // 只有一个成功
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });

  it('应在设备注册时触发 connected 事件', async () => {
    const events: string[] = [];
    registry.events.on('device:connected', (d) => events.push(d.id));

    registry.register({ ...mockDevice });

    expect(events).toContain('test_serial_01');
  });

  it('应在设备注销时触发 disconnected 事件', async () => {
    registry.register({ ...mockDevice });

    const events: string[] = [];
    registry.events.on('device:disconnected', (d) => events.push(d.id));

    registry.unregister('test_serial_01');

    expect(events).toContain('test_serial_01');
  });

  it('应在 claim 时触发 claimed 事件', async () => {
    registry.register({ ...mockDevice });

    const events: { id: string; owner: string }[] = [];
    registry.events.on('device:claimed', (e) => events.push(e));

    await registry.claim('test_serial_01', 'agent-x');

    expect(events.length).toBe(1);
    expect(events[0].owner).toBe('agent-x');
  });

  it('应在 release 时触发 released 事件', async () => {
    registry.register({ ...mockDevice });
    await registry.claim('test_serial_01', 'agent-x');

    const events: { id: string; owner: string }[] = [];
    registry.events.on('device:released', (e) => events.push(e));

    await registry.release('test_serial_01', 'agent-x');

    expect(events.length).toBe(1);
    expect(events[0].owner).toBe('agent-x');
  });

  it('应拒绝非所有者释放设备', async () => {
    registry.register({ ...mockDevice });
    await registry.claim('test_serial_01', 'agent-a');

    await expect(registry.release('test_serial_01', 'agent-b')).rejects.toThrow('not claimed by');
  });

  it('应支持模拟热插拔流程', async () => {
    const eventLog: string[] = [];
    registry.events.on('device:connected', () => eventLog.push('connected'));
    registry.events.on('device:disconnected', () => eventLog.push('disconnected'));
    registry.events.on('device:claimed', () => eventLog.push('claimed'));
    registry.events.on('device:released', () => eventLog.push('released'));

    // 设备插入
    registry.register({ ...mockDevice });
    // Agent 声明
    await registry.claim('test_serial_01', 'agent-a');
    // Agent 释放
    await registry.release('test_serial_01', 'agent-a');
    // 设备拔出
    registry.unregister('test_serial_01');

    expect(eventLog).toEqual(['connected', 'claimed', 'released', 'disconnected']);
  });
});
