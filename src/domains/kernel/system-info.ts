import os from 'node:os';
import mitt, { type Emitter } from 'mitt';
import si from 'systeminformation';

export interface SystemMetrics {
  cpu: {
    usage: number; // 0-100
    temperature?: number;
  };
  memory: {
    total: number;
    used: number;
    free: number;
  };
  battery?: {
    level: number;
    charging: boolean;
  };
}

export interface ISystemMonitor {
  getMetrics(): Promise<SystemMetrics>;
  subscribe(event: 'critical_battery' | 'high_load', callback: () => void): void;
}

type SystemMonitorEvents = {
  'critical_battery': void;
  'high_load': void;
};

export class SystemMonitor implements ISystemMonitor {
  private lastCpuUsage: { idle: number; total: number } | null = null;
  public readonly events: Emitter<SystemMonitorEvents> = mitt<SystemMonitorEvents>();
  private timer: Timer | null = null;

  async getMetrics(): Promise<SystemMetrics> {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    
    // CPU Usage Calculation
    const cpuUsage = this.calculateCpuUsage();
    
    // Get real data from systeminformation
    let temperature: number | undefined;
    try {
      const temp = await si.cpuTemperature();
      if (temp.main > 0) {
        temperature = temp.main;
      }
    } catch (e) {
      // 温度传感器在某些平台不可用（如虚拟机），记录调试信息
      console.debug("[SystemMonitor] Temperature sensor unavailable:", (e as Error).message);
    }

    let battery: { level: number; charging: boolean } | undefined;
    try {
      const bat = await si.battery();
      if (bat.hasBattery) {
        battery = {
          level: bat.percent,
          charging: bat.isCharging
        };
      }
    } catch (e) {
      // 电池信息在桌面设备上不可用，记录调试信息
      console.debug("[SystemMonitor] Battery info unavailable:", (e as Error).message);
    }

    return {
      cpu: {
        usage: cpuUsage,
        temperature
      },
      memory: {
        total: Math.round(totalMem / 1024 / 1024), // MB
        used: Math.round(usedMem / 1024 / 1024), // MB
        free: Math.round(freeMem / 1024 / 1024), // MB
      },
      battery
    };
  }

  startPolling(intervalMs: number = 5000) {
    if (this.timer) clearInterval(this.timer);
    
    console.log(`[SystemMonitor] Started polling every ${intervalMs}ms`);
    this.timer = setInterval(async () => {
      const metrics = await this.getMetrics();
      
      if (metrics.cpu.usage > 80) {
        this.events.emit('high_load');
      }
      
      if (metrics.battery && metrics.battery.level < 20 && !metrics.battery.charging) {
        this.events.emit('critical_battery');
      }
    }, intervalMs);
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private calculateCpuUsage(): number {
    const cpus = os.cpus();
    let idle = 0;
    let total = 0;

    for (const cpu of cpus) {
      for (const type in cpu.times) {
        total += (cpu.times as any)[type];
      }
      idle += cpu.times.idle;
    }

    let usage = 0;
    if (this.lastCpuUsage) {
      const idleDiff = idle - this.lastCpuUsage.idle;
      const totalDiff = total - this.lastCpuUsage.total;
      if (totalDiff > 0) {
        usage = 100 - Math.round(100 * idleDiff / totalDiff);
      }
    }

    this.lastCpuUsage = { idle, total };
    return usage;
  }

  subscribe(event: 'critical_battery' | 'high_load', callback: () => void): void {
    this.events.on(event, callback);
    console.log(`[SystemMonitor] Subscribed to ${event}`);
  }
}
