import { EventEmitter } from 'node:events';
import { ProcessManager, type ProcessOptions } from './process-manager';
import { rootLogger } from '../observability/logger';

/**
 * 健康检查配置
 */
export interface HealthCheckConfig {
  /** 检查类型：tcp 端口探测 / http 请求 / file 文件存在性 */
  type: 'tcp' | 'http' | 'file';
  /** 检查目标：端口号、URL 或文件路径 */
  target: string;
  /** 检查间隔（毫秒） */
  intervalMs: number;
  /** 单次检查超时（毫秒） */
  timeoutMs?: number;
}

/**
 * 重启策略配置
 */
export interface RestartPolicy {
  /** 是否启用自动重启 */
  enabled: boolean;
  /** 最大重启次数 */
  maxAttempts: number;
  /** 退避间隔序列（毫秒），超出长度后使用最后一个值 */
  backoffMs: number[];
}

/**
 * 服务定义
 */
export interface ServiceDefinition {
  /** 服务唯一标识 */
  id: string;
  /** 启动命令 */
  command: string[];
  /** 依赖的服务 ID 列表 */
  dependencies: string[];
  /** 进程选项 */
  options?: ProcessOptions;
  /** 健康检查配置 */
  healthCheck?: HealthCheckConfig;
  /** 重启策略 */
  restart?: RestartPolicy;
}

/**
 * 服务运行时状态
 */
export interface ServiceStatus {
  id: string;
  state: 'pending' | 'starting' | 'running' | 'stopping' | 'stopped' | 'failed';
  pid?: number;
  restartCount: number;
  lastStartTime?: number;
  lastExitCode?: number;
  healthStatus: 'healthy' | 'unhealthy' | 'unknown';
}

/**
 * ServiceManager — 服务依赖图解析、启动编排、健康检查、自动重启
 *
 * 核心职责：
 * 1. 按拓扑排序启动服务（依赖图）
 * 2. 定期健康检查
 * 3. 崩溃后自动重启（指数退避，最多 N 次）
 */
export class ServiceManager extends EventEmitter {
  private definitions = new Map<string, ServiceDefinition>();
  private statuses = new Map<string, ServiceStatus>();
  private restartAttempts = new Map<string, number>();
  private healthTimers = new Map<string, ReturnType<typeof setInterval>>();

  constructor(private processManager: ProcessManager) {
    super();
    // 监听进程退出事件，触发重启逻辑
    this.processManager.on('exit', (event: { id: string; code: number }) => {
      this.handleProcessExit(event.id, event.code);
    });
  }

  /**
   * 注册服务定义
   */
  registerService(def: ServiceDefinition): void {
    this.definitions.set(def.id, def);
    this.statuses.set(def.id, {
      id: def.id,
      state: 'pending',
      restartCount: 0,
      healthStatus: 'unknown',
    });
  }

  /**
   * 按依赖拓扑排序启动所有服务
   */
  async startAll(): Promise<void> {
    const order = this.topologicalSort();
    rootLogger.info(`[ServiceManager] 启动顺序: ${order.join(' → ')}`);

    for (const id of order) {
      await this.startService(id);
    }
  }

  /**
   * 启动单个服务（等待其依赖就绪）
   */
  async startService(id: string): Promise<void> {
    const def = this.definitions.get(id);
    if (!def) throw new Error(`服务 ${id} 未注册`);

    const status = this.statuses.get(id)!;
    if (status.state === 'running' || status.state === 'starting') return;

    // 等待依赖服务就绪
    for (const depId of def.dependencies) {
      const depStatus = this.statuses.get(depId);
      if (!depStatus || depStatus.state !== 'running') {
        rootLogger.warn(`[ServiceManager] 服务 ${id} 的依赖 ${depId} 未就绪，尝试启动`);
        await this.startService(depId);
      }
    }

    status.state = 'starting';
    status.lastStartTime = Date.now();
    this.emit('service:starting', { id });

    try {
      const serviceProcessId = `svc:${id}`;
      await this.processManager.spawn(serviceProcessId, def.command, def.options || {});

      const procStatus = this.processManager.getStatus(serviceProcessId);
      status.pid = procStatus.pid;
      status.state = 'running';
      status.healthStatus = 'unknown';

      this.emit('service:started', { id, pid: status.pid });
      rootLogger.info(`[ServiceManager] 服务 ${id} 已启动 (PID: ${status.pid})`);

      // 启动健康检查
      if (def.healthCheck) {
        this.startHealthCheck(id, def.healthCheck);
      }
    } catch (err) {
      status.state = 'failed';
      rootLogger.error(`[ServiceManager] 服务 ${id} 启动失败:`, err);
      this.emit('service:failed', { id, error: err });
    }
  }

  /**
   * 停止单个服务
   */
  async stopService(id: string): Promise<void> {
    const status = this.statuses.get(id);
    if (!status || status.state !== 'running') return;

    status.state = 'stopping';
    this.stopHealthCheck(id);

    try {
      this.processManager.kill(`svc:${id}`);
      status.state = 'stopped';
      this.emit('service:stopped', { id });
      rootLogger.info(`[ServiceManager] 服务 ${id} 已停止`);
    } catch (err) {
      rootLogger.error(`[ServiceManager] 停止服务 ${id} 失败:`, err);
    }
  }

  /**
   * 重启服务
   */
  async restartService(id: string): Promise<void> {
    await this.stopService(id);
    this.restartAttempts.set(id, 0); // 手动重启时重置计数
    await this.startService(id);
  }

  /**
   * 停止所有服务（逆序）
   */
  async stopAll(): Promise<void> {
    const order = this.topologicalSort().reverse();
    for (const id of order) {
      await this.stopService(id);
    }
    // 清理所有健康检查定时器
    for (const [id] of this.healthTimers) {
      this.stopHealthCheck(id);
    }
  }

  /**
   * 查询服务状态
   */
  getServiceStatus(id: string): ServiceStatus | undefined {
    return this.statuses.get(id);
  }

  /**
   * 列出所有服务状态
   */
  listServices(): ServiceStatus[] {
    return Array.from(this.statuses.values());
  }

  // ========== 内部方法 ==========

  /**
   * 拓扑排序：按依赖关系确定启动顺序
   * 使用 Kahn 算法，检测循环依赖
   */
  private topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const [id, def] of this.definitions) {
      if (!inDegree.has(id)) inDegree.set(id, 0);
      if (!adjacency.has(id)) adjacency.set(id, []);

      for (const dep of def.dependencies) {
        if (!adjacency.has(dep)) adjacency.set(dep, []);
        adjacency.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);

      for (const neighbor of adjacency.get(current) || []) {
        const newDegree = (inDegree.get(neighbor) || 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    if (result.length !== this.definitions.size) {
      const missing = [...this.definitions.keys()].filter(id => !result.includes(id));
      throw new Error(`检测到循环依赖: ${missing.join(', ')}`);
    }

    return result;
  }

  /**
   * 进程退出处理：根据重启策略决定是否重启
   */
  private async handleProcessExit(processId: string, exitCode: number): Promise<void> {
    // 只处理 svc: 前缀的服务进程
    if (!processId.startsWith('svc:')) return;
    const serviceId = processId.slice(4);

    const def = this.definitions.get(serviceId);
    const status = this.statuses.get(serviceId);
    if (!def || !status) return;

    // 如果是主动停止，不触发重启
    if (status.state === 'stopping' || status.state === 'stopped') return;

    status.state = 'failed';
    status.lastExitCode = exitCode;
    status.healthStatus = 'unhealthy';
    this.stopHealthCheck(serviceId);
    this.emit('service:exited', { id: serviceId, exitCode });
    rootLogger.warn(`[ServiceManager] 服务 ${serviceId} 退出 (code: ${exitCode})`);

    // 检查重启策略
    const policy = def.restart;
    if (!policy || !policy.enabled) return;

    const attempts = this.restartAttempts.get(serviceId) || 0;
    if (attempts >= policy.maxAttempts) {
      rootLogger.error(`[ServiceManager] 服务 ${serviceId} 已达最大重启次数 (${policy.maxAttempts})，放弃重启`);
      this.emit('service:restart_exhausted', { id: serviceId, attempts });
      return;
    }

    // 计算退避延迟
    const delayIndex = Math.min(attempts, policy.backoffMs.length - 1);
    const delay = policy.backoffMs[delayIndex];
    this.restartAttempts.set(serviceId, attempts + 1);
    status.restartCount = attempts + 1;

    rootLogger.info(`[ServiceManager] 服务 ${serviceId} 将在 ${delay}ms 后重启 (第 ${attempts + 1}/${policy.maxAttempts} 次)`);

    await new Promise(resolve => setTimeout(resolve, delay));

    // 重启前再次检查状态（可能已被手动停止）
    const currentStatus = this.statuses.get(serviceId);
    if (currentStatus && currentStatus.state !== 'stopped') {
      await this.startService(serviceId);
    }
  }

  /**
   * 启动健康检查定时器
   */
  private startHealthCheck(serviceId: string, config: HealthCheckConfig): void {
    this.stopHealthCheck(serviceId); // 清理旧的

    const timer = setInterval(async () => {
      const healthy = await this.performHealthCheck(config);
      const status = this.statuses.get(serviceId);
      if (!status) return;

      const prevHealth = status.healthStatus;
      status.healthStatus = healthy ? 'healthy' : 'unhealthy';

      if (prevHealth !== status.healthStatus) {
        this.emit('service:health_changed', {
          id: serviceId,
          healthStatus: status.healthStatus,
        });
      }
    }, config.intervalMs);

    this.healthTimers.set(serviceId, timer);
  }

  /**
   * 停止健康检查定时器
   */
  private stopHealthCheck(serviceId: string): void {
    const timer = this.healthTimers.get(serviceId);
    if (timer) {
      clearInterval(timer);
      this.healthTimers.delete(serviceId);
    }
  }

  /**
   * 执行单次健康检查
   */
  private async performHealthCheck(config: HealthCheckConfig): Promise<boolean> {
    const timeout = config.timeoutMs || 3000;

    try {
      switch (config.type) {
        case 'file': {
          const fs = await import('fs/promises');
          await fs.access(config.target);
          return true;
        }
        case 'tcp': {
          return await this.checkTcp(config.target, timeout);
        }
        case 'http': {
          return await this.checkHttp(config.target, timeout);
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  /**
   * TCP 端口探测
   */
  private checkTcp(target: string, timeoutMs: number): Promise<boolean> {
    return new Promise((resolve) => {
      const [host, portStr] = target.includes(':') ? target.split(':') : ['localhost', target];
      const port = parseInt(portStr, 10);
      if (isNaN(port)) { resolve(false); return; }

      const net = require('net');
      const socket = new net.Socket();
      const timer = setTimeout(() => { socket.destroy(); resolve(false); }, timeoutMs);

      socket.connect(port, host, () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(true);
      });
      socket.on('error', () => {
        clearTimeout(timer);
        socket.destroy();
        resolve(false);
      });
    });
  }

  /**
   * HTTP 健康检查
   */
  private async checkHttp(url: string, timeoutMs: number): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      return response.ok;
    } catch {
      return false;
    }
  }
}
