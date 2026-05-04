import { PermissionsAndroid, Platform } from 'react-native';
import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
import type { Types } from '@meshtastic/core';

const SERVICE_UUID = '6ba1b218-15a8-461f-9fa8-5dcae273eafd';
const TO_RADIO_UUID = 'f75c76d2-129e-4dad-a1dd-7866124401e7';
const FROM_RADIO_UUID = '2c55e69e-4993-11ed-b878-0242ac120002';
const FROM_NUM_UUID = 'ed9da18c-a800-4f66-a670-aa7547e34453';

type LogFn = (message: string, level?: 'info' | 'ok' | 'err') => void;

export type BleDeviceInfo = {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
};

export class MeshtasticBleTransport implements Types.Transport {
  private readonly manager: BleManager;
  private readonly device: Device;
  private readonly log: LogFn;
  private readonly fromNumSubscription: Subscription;
  private fromDeviceController?: ReadableStreamDefaultController<Types.DeviceOutput>;
  private isFirstWrite = true;

  public readonly toDevice: WritableStream<Uint8Array>;
  public readonly fromDevice: ReadableStream<Types.DeviceOutput>;

  static async scan(log: LogFn, durationMs = 12_000): Promise<BleDeviceInfo[]> {
    await this.requestAndroidPermissions();

    const manager = new BleManager();
    const devices = new Map<string, BleDeviceInfo>();

    log('Scanning for Meshtastic BLE nodes...');

    return new Promise<BleDeviceInfo[]>((resolve, reject) => {
      const finish = () => {
        manager.stopDeviceScan();
        manager.destroy();
        const list = Array.from(devices.values()).sort((a, b) => {
          const ar = a.rssi ?? -999;
          const br = b.rssi ?? -999;
          return br - ar;
        });
        log(`BLE scan finished. Found ${list.length} Meshtastic node(s).`, list.length ? 'ok' : 'err');
        resolve(list);
      };

      const timeout = setTimeout(finish, durationMs);

      manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, found) => {
        if (error) {
          clearTimeout(timeout);
          manager.stopDeviceScan();
          manager.destroy();
          reject(error);
          return;
        }

        if (!found) return;

        const info: BleDeviceInfo = {
          id: found.id,
          name: found.name ?? null,
          localName: found.localName ?? null,
          rssi: found.rssi ?? null
        };

        devices.set(found.id, info);
        log(`Found BLE: ${info.name ?? info.localName ?? info.id}${info.rssi != null ? ` RSSI ${info.rssi}` : ''}`);
      });
    });
  }

  static async create(log: LogFn, deviceId?: string): Promise<MeshtasticBleTransport> {
    await this.requestAndroidPermissions();

    let manager = new BleManager();
    let device: Device;

    if (deviceId) {
      log(`Connecting to selected BLE node ${deviceId}...`);
      device = await manager.connectToDevice(deviceId, {
        autoConnect: false,
        timeout: 15_000
      });
    } else {
      log('Scanning for Meshtastic BLE node...');

      device = await new Promise<Device>((resolve, reject) => {
        const timeout = setTimeout(() => {
          manager.stopDeviceScan();
          reject(new Error('Meshtastic BLE scan timeout'));
        }, 20_000);

        manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, found) => {
          if (error) {
            clearTimeout(timeout);
            manager.stopDeviceScan();
            reject(error);
            return;
          }

          if (!found) return;

          clearTimeout(timeout);
          manager.stopDeviceScan();
          resolve(found);
        });
      });

      log(`Connecting to ${device.name ?? device.localName ?? device.id}...`);
      device = await manager.connectToDevice(device.id, {
        autoConnect: false,
        timeout: 15_000
      });
    }

    try {
      device = await device.requestMTU(512);
    } catch (e) {
      log(`MTU 512 request warning: ${String((e as Error)?.message ?? e)}`, 'err');
    }

    await device.discoverAllServicesAndCharacteristics();
    log(`Connected to ${device.name ?? device.localName ?? device.id}`, 'ok');

    return new MeshtasticBleTransport(manager, device, log);
  }

  private static async requestAndroidPermissions(): Promise<void> {
    if (Platform.OS !== 'android') return;

    const apiLevel = Number(Platform.Version);

    if (apiLevel >= 31) {
      const result = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT
      ]);

      const scan = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
      const connect = result[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];

      if (
        scan !== PermissionsAndroid.RESULTS.GRANTED ||
        connect !== PermissionsAndroid.RESULTS.GRANTED
      ) {
        throw new Error('Bluetooth permissions were not granted');
      }
      return;
    }

    const location = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION
    );

    if (location !== PermissionsAndroid.RESULTS.GRANTED) {
      throw new Error('Location permission is required for BLE scan on this Android version');
    }
  }

  private constructor(manager: BleManager, device: Device, log: LogFn) {
    this.manager = manager;
    this.device = device;
    this.log = log;

    this.fromDevice = new ReadableStream<Types.DeviceOutput>({
      start: (controller) => {
        this.fromDeviceController = controller;
      }
    });

    this.toDevice = new WritableStream<Uint8Array>({
      write: async (chunk) => {
        const base64 = Buffer.from(chunk).toString('base64');
        await this.device.writeCharacteristicWithResponseForService(
          SERVICE_UUID,
          TO_RADIO_UUID,
          base64
        );

        if (this.isFirstWrite && this.fromDeviceController) {
          this.isFirstWrite = false;
          setTimeout(() => {
            void this.readFromRadio(this.fromDeviceController!);
          }, 50);
        }
      }
    });

    this.fromNumSubscription = this.device.monitorCharacteristicForService(
      SERVICE_UUID,
      FROM_NUM_UUID,
      (error) => {
        if (error) {
          this.log(`BLE notify error: ${error.message}`, 'err');
          return;
        }
        if (this.fromDeviceController) {
          void this.readFromRadio(this.fromDeviceController);
        }
      }
    );
  }

  async disconnect(): Promise<void> {
    this.fromNumSubscription.remove();
    try {
      await this.manager.cancelDeviceConnection(this.device.id);
    } finally {
      this.manager.destroy();
    }
  }

  private async readFromRadio(
    controller: ReadableStreamDefaultController<Types.DeviceOutput>
  ): Promise<void> {
    while (true) {
      const characteristic = await this.device.readCharacteristicForService(
        SERVICE_UUID,
        FROM_RADIO_UUID
      );

      const value = characteristic.value;
      if (!value) break;

      const data = new Uint8Array(Buffer.from(value, 'base64'));
      if (data.byteLength === 0) break;

      controller.enqueue({ type: 'packet', data });
    }
  }
}
