import type { EventBus } from '../events/types';
import type { DeviceRegistry } from '../device/registry';
import type { SystemMonitor } from './system-info';

export class KernelEventBridge {
  constructor(
    private eventBus: EventBus,
    private deviceRegistry: DeviceRegistry,
    private systemMonitor: SystemMonitor
  ) {}

  start() {
    // Bridge Device Events
    this.deviceRegistry.events.on('device:connected', (device) => {
      this.eventBus.publish({
        type: 'kairo.system.device.connected',
        source: 'kernel:device-registry',
        data: device
      });
    });

    this.deviceRegistry.events.on('device:disconnected', (payload) => {
      this.eventBus.publish({
        type: 'kairo.system.device.disconnected',
        source: 'kernel:device-registry',
        data: payload
      });
    });

    // Bridge System Monitor Events
    this.systemMonitor.events.on('critical_battery', () => {
      this.eventBus.publish({
        type: 'kairo.system.power.critical',
        source: 'kernel:system-monitor',
        data: { level: 5, status: 'discharging' } // Mock data for now as event doesn't carry payload yet
      });
    });

    this.systemMonitor.events.on('high_load', () => {
      // Potentially handle high load event if needed
      console.log('[KernelEventBridge] High system load detected');
    });
    
    console.log('[KernelEventBridge] Started bridging kernel events to global bus');
  }
}
