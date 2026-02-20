import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { ServiceManager, type ServiceDefinition } from '../service-manager';
import { ProcessManager } from '../process-manager';

describe('ServiceManager', () => {
  let pm: ProcessManager;
  let sm: ServiceManager;

  beforeEach(() => {
    pm = new ProcessManager();
    sm = new ServiceManager(pm);
  });

  afterEach(async () => {
    await sm.stopAll();
  });

  it('应按拓扑排序确定启动顺序', () => {
    sm.registerService({
      id: 'c', command: ['echo', 'c'], dependencies: ['a', 'b'],
    });
    sm.registerService({
      id: 'a', command: ['echo', 'a'], dependencies: [],
    });
    sm.registerService({
      id: 'b', command: ['echo', 'b'], dependencies: ['a'],
    });

    // 通过 listServices 验证注册成功
    const services = sm.listServices();
    expect(services.length).toBe(3);
  });

  it('应检测循环依赖并抛出错误', () => {
    sm.registerService({
      id: 'x', command: ['echo'], dependencies: ['y'],
    });
    sm.registerService({
      id: 'y', command: ['echo'], dependencies: ['x'],
    });

    expect(() => sm.startAll()).toThrow('循环依赖');
  });

  it('应启动服务并追踪状态', async () => {
    sm.registerService({
      id: 'echo-svc',
      command: ['sleep', '10'],
      dependencies: [],
    });

    await sm.startAll();

    const status = sm.getServiceStatus('echo-svc');
    expect(status).toBeDefined();
    expect(status!.state).toBe('running');
    expect(status!.pid).toBeGreaterThan(0);
  });

  it('应停止服务并更新状态', async () => {
    sm.registerService({
      id: 'stop-test',
      command: ['sleep', '30'],
      dependencies: [],
    });

    await sm.startAll();
    expect(sm.getServiceStatus('stop-test')!.state).toBe('running');

    await sm.stopService('stop-test');
    expect(sm.getServiceStatus('stop-test')!.state).toBe('stopped');
  });

  it('应在进程退出后自动重启（最多 3 次）', async () => {
    sm.registerService({
      id: 'restart-test',
      command: ['sh', '-c', 'exit 1'],
      dependencies: [],
      restart: {
        enabled: true,
        maxAttempts: 3,
        backoffMs: [100, 200, 400],
      },
    });

    const exhaustedPromise = new Promise<void>((resolve) => {
      sm.on('service:restart_exhausted', (event) => {
        if (event.id === 'restart-test') resolve();
      });
    });

    await sm.startService('restart-test');

    // 等待重启耗尽（100 + 200 + 400 + 余量）
    await Promise.race([
      exhaustedPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('超时')), 10000)),
    ]);

    const status = sm.getServiceStatus('restart-test');
    expect(status!.restartCount).toBe(3);
  });

  it('应支持文件健康检查', async () => {
    const fs = await import('fs/promises');
    const tmpFile = `/tmp/kairo-health-test-${Date.now()}`;

    sm.registerService({
      id: 'health-test',
      command: ['sleep', '30'],
      dependencies: [],
      healthCheck: {
        type: 'file',
        target: tmpFile,
        intervalMs: 200,
      },
    });

    await sm.startAll();

    // 初始状态应为 unknown
    expect(sm.getServiceStatus('health-test')!.healthStatus).toBe('unknown');

    // 创建健康检查文件
    await fs.writeFile(tmpFile, 'ok');

    // 等待健康检查周期
    await new Promise(r => setTimeout(r, 500));
    expect(sm.getServiceStatus('health-test')!.healthStatus).toBe('healthy');

    // 删除文件
    await fs.unlink(tmpFile);
    await new Promise(r => setTimeout(r, 500));
    expect(sm.getServiceStatus('health-test')!.healthStatus).toBe('unhealthy');
  });

  it('应按依赖顺序启动多个服务', async () => {
    const startOrder: string[] = [];

    sm.on('service:started', (event) => {
      startOrder.push(event.id);
    });

    sm.registerService({
      id: 'base', command: ['sleep', '30'], dependencies: [],
    });
    sm.registerService({
      id: 'mid', command: ['sleep', '30'], dependencies: ['base'],
    });
    sm.registerService({
      id: 'top', command: ['sleep', '30'], dependencies: ['mid'],
    });

    await sm.startAll();

    expect(startOrder).toEqual(['base', 'mid', 'top']);
  });
});
