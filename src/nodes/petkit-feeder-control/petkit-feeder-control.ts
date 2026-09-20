import { NodeAPI, NodeDef } from 'node-red';
import { PetkitBackend } from '../../types/petkit';

interface PetkitFeederControlNodeDef extends NodeDef {
  config: string;
  deviceId: string;
  amount: number;
}

export = function (RED: NodeAPI) {
  function PetkitFeederControlNode(this: any, config: PetkitFeederControlNodeDef) {
    RED.nodes.createNode(this, config);

    const configNode = RED.nodes.getNode(config.config) as any;

    this.on('input', async (msg: any) => {
      const api: PetkitBackend = configNode.getAPI();
      const deviceId: number = Number(msg.payload?.deviceId ?? config.deviceId);

      try {
        if (msg.payload?.settingKey !== undefined) {
          const settingKey: string = msg.payload.settingKey;
          const settingValue: number = msg.payload.settingValue;
          await api.updateFeederSetting(deviceId, settingKey, settingValue);
          this.status({ fill: 'green', shape: 'dot', text: `${settingKey}: ${settingValue}` });
          msg.payload = { deviceId, settingKey, settingValue };
        } else {
          const amount: number = Number(msg.payload?.amount ?? config.amount);
          await api.feedNow(deviceId, amount);
          this.status({ fill: 'green', shape: 'dot', text: `fed: ${amount}` });
          msg.payload = { deviceId, amount };
        }
        this.send(msg);
      } catch (err: any) {
        this.status({ fill: 'red', shape: 'ring', text: err.message });
        this.error(err.message, msg);
      }
    });

    this.status({ fill: 'yellow', shape: 'ring', text: 'idle' });
  }

  RED.nodes.registerType('petkit-feeder-control', PetkitFeederControlNode);
};
