import { MeshDevice, Types } from '@meshtastic/core';
import { BleDeviceInfo, MeshtasticBleTransport } from './MeshtasticBleTransport';
import { MESH_CHANNEL_SLOT, MESH_BROADCAST_DESTINATION } from '../constants';

type MessageHandler = (packet: Types.PacketMetadata<string>) => void;
type LogFn = (message: string, level?: 'info' | 'ok' | 'err') => void;

export type { BleDeviceInfo };

export class MeshClient {
  private transport?: MeshtasticBleTransport;
  private device?: MeshDevice;
  private subscribed = false;

  async scan(log: LogFn): Promise<BleDeviceInfo[]> {
    return MeshtasticBleTransport.scan(log);
  }

  async connect(deviceId: string, log: LogFn, onMessage: MessageHandler): Promise<void> {
    this.transport = await MeshtasticBleTransport.create(log, deviceId);
    this.device = new MeshDevice(this.transport);

    if (!this.subscribed) {
      this.device.events.onMessagePacket.subscribe(onMessage);
      this.subscribed = true;
    }

    const configurePromise = this.device
      .configure()
      .then(() => {
        log('Mesh configure completed', 'ok');
      })
      .catch((e: unknown) => {
        log(`Mesh configure warning: ${String((e as Error)?.message ?? e)}`, 'err');
      });

    // Some @meshtastic/core configure() flows keep waiting after the device already
    // emitted a valid config id. Do not block the UI/Init button forever.
    await new Promise<void>((resolve) => {
      let finished = false;

      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        log('Mesh configure is still running; enabling Init after BLE handshake.');
        finish();
      }, 1800);

      void configurePromise.finally(finish);
    });
  }

  async disconnect(): Promise<void> {
    this.device?.complete?.();
    await this.transport?.disconnect();
    this.transport = undefined;
    this.device = undefined;
    this.subscribed = false;
  }

  async sendText(text: string, replyId?: number | null): Promise<void> {
    if (!this.device) {
      throw new Error('Meshtastic is not connected');
    }

    await this.device.sendText(
      text,
      MESH_BROADCAST_DESTINATION,
      false,
      MESH_CHANNEL_SLOT as any,
      replyId ?? undefined
    );
  }
}
