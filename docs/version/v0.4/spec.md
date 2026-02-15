# v0.4 Technical Specification: Device & HAL

## 1. 核心功能规范 (Core Features)

### 1.1 设备注册与发现 (Registry & Discovery)
- **DeviceRegistry**: 维护系统内所有可用设备列表。
- **Discovery**: 支持静态配置和动态扫描（如 USB 热插拔监听）。
- **Mocking**: 开发环境支持 Mock 设备注入。

### 1.2 设备占用 (Claim/Release)
- **Exclusive Access**: 关键设备（如串口、摄像头）同一时间只能被一个 Process 占用。
- **Lease**: 支持带租期的占用，防止进程崩溃导致设备死锁。
- **Force Release**: Kernel 可强制释放设备。

### 1.3 统一 I/O 流 (Unified I/O)
- **Stream Interface**: 统一封装 Serial, USB, Network 设备为 Readable/Writable Stream。
- **Event Bridge**: 设备数据流可桥接到 EventBus，供多个观察者订阅（在非独占模式下）。

## 2. 接口与协议 (Interfaces & Protocols)

### 2.1 Device Methods
- `device.list(filter?: object): DeviceInfo[]`
- `device.claim(deviceId: string, exclusive: boolean): Promise<string>` (返回 leaseId)
- `device.release(leaseId: string): Promise<void>`
- `device.write(leaseId: string, data: Buffer): Promise<void>`

### 2.2 Device Events
- `kairo.device.connected`: `{ deviceId, type, metadata }`
- `kairo.device.disconnected`: `{ deviceId }`
- `kairo.device.data`: `{ deviceId, data }` (需开启流转发)

## 3. 模块交互 (Module Interactions)

### 3.1 设备争用场景
1. Process A 调用 `device.claim(dev1)` -> Success.
2. Process B 调用 `device.claim(dev1)` -> Error (Device Busy).
3. Process A 崩溃 -> Kernel 检测到连接断开 -> 自动 Release dev1.
4. Process B 重试 `device.claim(dev1)` -> Success.

## 4. 数据模型 (Data Models)

### 4.1 DeviceInfo
```typescript
interface DeviceInfo {
  id: string;
  type: 'serial' | 'usb' | 'camera' | 'gpio';
  status: 'available' | 'busy' | 'error';
  metadata: Record<string, any>;
  ownerId?: string; // 当前占用者
}
```

## 5. 异常处理 (Error Handling)
- **Device Lost**: 运行中设备拔出，抛出 `E_DEVICE_LOST`，触发 `disconnected` 事件。
- **Permission Denied**: 未声明设备权限的 Process 尝试 Claim，拒绝访问。

## 6. 测试策略 (Testing Strategy)
- **Mock Driver**: 使用虚拟串口驱动进行测试，不依赖真实硬件。
- **Concurrency Test**: 模拟多进程并发争抢设备，验证锁机制。
- **Hotplug Test**: 模拟设备插入/拔出，验证事件触发和状态更新。
