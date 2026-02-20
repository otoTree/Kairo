import { EventEmitter } from 'node:events';
import type { EventBus } from '../events/types';
import { rootLogger } from '../observability/logger';

/**
 * D-Bus 信号到 Kairo 事件的映射规则
 */
interface SignalMapping {
  /** D-Bus 接口名 */
  interface: string;
  /** D-Bus 信号名 */
  signal: string;
  /** 映射到的 Kairo 事件类型 */
  kairoEventType: string;
  /** 数据转换函数 */
  transform?: (args: any[]) => Record<string, any>;
}

/**
 * D-Bus → EventBus 桥接器
 *
 * 职责：
 * 1. 连接系统 D-Bus
 * 2. 监听关键信号（设备、网络、电源、systemd）
 * 3. 将 D-Bus 信号转换为 Kairo 事件并发布到 EventBus
 * 4. 提供 systemd 服务控制和 NetworkManager 查询接口
 */
export class DBusBridge extends EventEmitter {
  private bus: any = null;
  private connected = false;
  private eventBus?: EventBus;

  /** 默认信号映射表 */
  private readonly signalMappings: SignalMapping[] = [
    {
      interface: 'org.freedesktop.UDisks2.Manager',
      signal: 'InterfacesAdded',
      kairoEventType: 'kairo.system.device.connected',
      transform: (args) => ({
        path: args[0],
        interfaces: Object.keys(args[1] || {}),
      }),
    },
    {
      interface: 'org.freedesktop.UDisks2.Manager',
      signal: 'InterfacesRemoved',
      kairoEventType: 'kairo.system.device.disconnected',
      transform: (args) => ({
        path: args[0],
        interfaces: args[1] || [],
      }),
    },
    {
      interface: 'org.freedesktop.NetworkManager',
      signal: 'StateChanged',
      kairoEventType: 'kairo.system.network.changed',
      transform: (args) => ({
        state: this.mapNetworkState(args[0]),
        rawState: args[0],
      }),
    },
    {
      interface: 'org.freedesktop.login1.Manager',
      signal: 'PrepareForShutdown',
      kairoEventType: 'kairo.system.power.shutdown',
      transform: (args) => ({
        preparing: args[0],
      }),
    },
    {
      interface: 'org.freedesktop.login1.Manager',
      signal: 'PrepareForSleep',
      kairoEventType: 'kairo.system.power.sleep',
      transform: (args) => ({
        preparing: args[0],
      }),
    },
  ];

  /**
   * 连接到系统 D-Bus 并开始监听
   */
  async connect(eventBus: EventBus): Promise<void> {
    this.eventBus = eventBus;

    try {
      // 动态导入 dbus-next（仅 Linux 可用）
      const dbus = await import('dbus-next').catch(() => null);
      if (!dbus) {
        rootLogger.warn('[DBusBridge] dbus-next 不可用，使用模拟模式');
        this.connected = false;
        return;
      }

      this.bus = dbus.systemBus();
      this.connected = true;

      // 注册信号监听
      await this.setupSignalListeners();

      rootLogger.info('[DBusBridge] 已连接到系统 D-Bus');
    } catch (err) {
      rootLogger.warn('[DBusBridge] 连接 D-Bus 失败（可能不在 Linux 环境）:', err);
      this.connected = false;
    }
  }

  /**
   * 设置 D-Bus 信号监听器
   */
  private async setupSignalListeners(): Promise<void> {
    if (!this.bus) return;

    try {
      // 监听 systemd 服务状态变化
      const systemd = await this.bus.getProxyObject(
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1'
      ).catch(() => null);

      if (systemd) {
        const manager = systemd.getInterface('org.freedesktop.systemd1.Manager');
        manager.on('UnitNew', (name: string, path: string) => {
          this.publishEvent('kairo.system.service.new', { name, path });
        });
        manager.on('UnitRemoved', (name: string, path: string) => {
          this.publishEvent('kairo.system.service.removed', { name, path });
        });
        manager.on('JobRemoved', (id: number, path: string, unit: string, result: string) => {
          this.publishEvent('kairo.system.service.job_done', { id, path, unit, result });
        });
        rootLogger.info('[DBusBridge] 已订阅 systemd 信号');
      }

      // 监听 NetworkManager 状态变化
      const nm = await this.bus.getProxyObject(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager'
      ).catch(() => null);

      if (nm) {
        const nmIface = nm.getInterface('org.freedesktop.NetworkManager');
        nmIface.on('StateChanged', (state: number) => {
          this.publishEvent('kairo.system.network.changed', {
            state: this.mapNetworkState(state),
            rawState: state,
          });
        });
        rootLogger.info('[DBusBridge] 已订阅 NetworkManager 信号');
      }

      // 监听 login1（电源管理）
      const login = await this.bus.getProxyObject(
        'org.freedesktop.login1',
        '/org/freedesktop/login1'
      ).catch(() => null);

      if (login) {
        const loginMgr = login.getInterface('org.freedesktop.login1.Manager');
        loginMgr.on('PrepareForShutdown', (preparing: boolean) => {
          this.publishEvent('kairo.system.power.shutdown', { preparing });
        });
        loginMgr.on('PrepareForSleep', (preparing: boolean) => {
          this.publishEvent('kairo.system.power.sleep', { preparing });
        });
        rootLogger.info('[DBusBridge] 已订阅 login1 信号');
      }
    } catch (err) {
      rootLogger.warn('[DBusBridge] 设置信号监听失败:', err);
    }
  }

  // ========== Systemd 服务控制 ==========

  /**
   * 启动 systemd 服务
   */
  async startUnit(unitName: string): Promise<{ jobPath: string }> {
    return this.callSystemd('StartUnit', unitName, 'replace');
  }

  /**
   * 停止 systemd 服务
   */
  async stopUnit(unitName: string): Promise<{ jobPath: string }> {
    return this.callSystemd('StopUnit', unitName, 'replace');
  }

  /**
   * 重启 systemd 服务
   */
  async restartUnit(unitName: string): Promise<{ jobPath: string }> {
    return this.callSystemd('RestartUnit', unitName, 'replace');
  }

  /**
   * 查询 systemd 服务状态
   */
  async getUnitStatus(unitName: string): Promise<{
    activeState: string;
    subState: string;
    description: string;
  }> {
    if (!this.connected || !this.bus) {
      return { activeState: 'unknown', subState: 'unknown', description: 'D-Bus not connected' };
    }

    try {
      const systemd = await this.bus.getProxyObject(
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1'
      );
      const manager = systemd.getInterface('org.freedesktop.systemd1.Manager');
      const unitPath = await manager.GetUnit(unitName);

      const unit = await this.bus.getProxyObject('org.freedesktop.systemd1', unitPath);
      const props = unit.getInterface('org.freedesktop.DBus.Properties');

      const activeState = await props.Get('org.freedesktop.systemd1.Unit', 'ActiveState');
      const subState = await props.Get('org.freedesktop.systemd1.Unit', 'SubState');
      const description = await props.Get('org.freedesktop.systemd1.Unit', 'Description');

      return {
        activeState: activeState.value,
        subState: subState.value,
        description: description.value,
      };
    } catch (err) {
      return { activeState: 'error', subState: 'error', description: String(err) };
    }
  }

  // ========== NetworkManager 查询 ==========

  /**
   * 查询网络连接状态
   */
  async getNetworkState(): Promise<{
    state: string;
    connectivity: string;
    connections: Array<{ id: string; type: string; active: boolean }>;
  }> {
    if (!this.connected || !this.bus) {
      return { state: 'unknown', connectivity: 'unknown', connections: [] };
    }

    try {
      const nm = await this.bus.getProxyObject(
        'org.freedesktop.NetworkManager',
        '/org/freedesktop/NetworkManager'
      );
      const props = nm.getInterface('org.freedesktop.DBus.Properties');

      const state = await props.Get('org.freedesktop.NetworkManager', 'State');
      const connectivity = await props.Get('org.freedesktop.NetworkManager', 'Connectivity');

      return {
        state: this.mapNetworkState(state.value),
        connectivity: this.mapConnectivity(connectivity.value),
        connections: [], // 简化：完整实现需遍历 ActiveConnections
      };
    } catch (err) {
      return { state: 'error', connectivity: 'error', connections: [] };
    }
  }

  // ========== 内部方法 ==========

  private async callSystemd(method: string, unitName: string, mode: string): Promise<{ jobPath: string }> {
    if (!this.connected || !this.bus) {
      throw new Error('D-Bus not connected');
    }

    const systemd = await this.bus.getProxyObject(
      'org.freedesktop.systemd1',
      '/org/freedesktop/systemd1'
    );
    const manager = systemd.getInterface('org.freedesktop.systemd1.Manager');
    const jobPath = await manager[method](unitName, mode);
    return { jobPath };
  }

  private publishEvent(type: string, data: Record<string, any>): void {
    if (!this.eventBus) return;
    this.eventBus.publish({
      type,
      source: 'kernel:dbus-bridge',
      data,
    });
  }

  private mapNetworkState(state: number): string {
    const states: Record<number, string> = {
      0: 'unknown', 10: 'asleep', 20: 'disconnected',
      30: 'disconnecting', 40: 'connecting',
      50: 'connected_local', 60: 'connected_site',
      70: 'connected_global',
    };
    return states[state] || 'unknown';
  }

  private mapConnectivity(value: number): string {
    const map: Record<number, string> = {
      0: 'unknown', 1: 'none', 2: 'portal', 3: 'limited', 4: 'full',
    };
    return map[value] || 'unknown';
  }

  /**
   * 断开 D-Bus 连接
   */
  disconnect(): void {
    if (this.bus) {
      this.bus.disconnect();
      this.bus = null;
    }
    this.connected = false;
    rootLogger.info('[DBusBridge] 已断开 D-Bus 连接');
  }

  get isConnected(): boolean {
    return this.connected;
  }
}
