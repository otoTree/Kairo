import type { DeviceType } from '../device/registry';

export interface DeviceConnectedPayload {
  id: string;
  type: DeviceType;
  path: string;
  hardwareId?: string;
}

export interface DeviceDisconnectedPayload {
  id: string;
}

export interface PowerCriticalPayload {
  level: number;
  status: 'discharging' | 'charging' | 'full';
}

declare module "../events/types" {
  export interface KairoEventMap {
    "kairo.system.device.connected": DeviceConnectedPayload;
    "kairo.system.device.disconnected": DeviceDisconnectedPayload;
    "kairo.system.power.critical": PowerCriticalPayload;
  }
}
