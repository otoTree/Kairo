import { DeviceRegistry, type DeviceInfo, type DeviceType } from './registry';
// import usbDetect from 'usb-detection';
import { SerialPort } from 'serialport';

export class DeviceMonitor {
  constructor(private registry: DeviceRegistry) {}

  async start() {
    console.log('[DeviceMonitor] Starting monitoring... (usb-detection disabled)');
    
    // Load config first
    await this.registry.loadConfig();

    // Start usb-detection
    // usbDetect.startMonitoring();

    // Initial scan
    await this.scanConnectedDevices();

    // Event listeners
    // usbDetect.on('add', (device) => this.handleDeviceAdd(device));
    // usbDetect.on('remove', (device) => this.handleDeviceRemove(device));
  }

  stop() {
    console.log('[DeviceMonitor] Stopping monitoring...');
    // usbDetect.stopMonitoring();
  }

  private async scanConnectedDevices() {
    console.log('[DeviceMonitor] Skipping scanConnectedDevices because usb-detection is disabled');
    /*
    const devices = await new Promise<any[]>((resolve, reject) => {
        usbDetect.find((err, devices) => {
            if (err) reject(err);
            else resolve(devices);
        });
    });

    for (const device of devices) {
        await this.handleDeviceAdd(device);
    }
    */
  }

  private async handleDeviceAdd(usbDevice: any) {
      // usbDevice: { locationId, vendorId, productId, deviceName, manufacturer, serialNumber, deviceAddress }
      // Note: usb-detection returns vendorId/productId as integers
      
      const vid = usbDevice.vendorId;
      const pid = usbDevice.productId;
      const serialNumber = usbDevice.serialNumber;

      const mapping = this.registry.resolveMapping(vid, pid);
      
      // If we have a mapping, we definitely want to register it.
      // If not, we might skip it or register as generic "usb_device".
      // For Kairo, let's prioritize mapped devices to avoid noise, 
      // but maybe log unknown ones.
      
      if (mapping) {
          let path = '';
          
          if (mapping.type === 'serial') {
             path = await this.findSerialPath(vid, pid, serialNumber);
          } else {
             // For other types, path might be implied or different
             // e.g. camera might be /dev/video0, but usb-detection won't tell us easily without other tools
             path = `usb://${vid}:${pid}`; 
          }

          const deviceInfo: DeviceInfo = {
              id: mapping.alias,
              type: mapping.type,
              path: path,
              hardwareId: `${vid}:${pid}:${serialNumber || ''}`,
              status: 'available',
              metadata: {
                  ...usbDevice,
                  description: mapping.alias
              }
          };

          this.registry.register(deviceInfo);
      } else {
          // Optional: Register unknown devices
          // console.log(`[DeviceMonitor] Ignored unknown device: ${usbDevice.deviceName} (${vid}:${pid})`);
      }
  }

  private async handleDeviceRemove(usbDevice: any) {
      const vid = usbDevice.vendorId;
      const pid = usbDevice.productId;
      const mapping = this.registry.resolveMapping(vid, pid);

      if (mapping) {
          this.registry.unregister(mapping.alias);
      }
  }

  private async findSerialPath(vid: number, pid: number, serialNumber?: string): Promise<string> {
      try {
          const ports = await SerialPort.list();
          // SerialPort returns vid/pid as lowercase hex strings usually
          const vidHex = vid.toString(16).toLowerCase().padStart(4, '0');
          const pidHex = pid.toString(16).toLowerCase().padStart(4, '0');

          const found = ports.find(p => {
              return (p.vendorId?.toLowerCase() === vidHex && p.productId?.toLowerCase() === pidHex);
              // Note: serialNumber matching can be tricky if not reported consistently
          });

          return found ? found.path : '';
      } catch (e) {
          console.error('[DeviceMonitor] Failed to list serial ports:', e);
          return '';
      }
  }
}
