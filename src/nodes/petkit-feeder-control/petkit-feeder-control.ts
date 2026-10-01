import { NodeAPI, NodeDef } from 'node-red';
import { PetkitBackend } from '../../types/petkit';

interface PetkitFeederControlNodeDef extends NodeDef {
  config: string;
  deviceId: string;
  amount: number;
}

// Accepts seconds since midnight (as petkit-feeder reports in feedState.feedTimes) or
// an "HH:MM" string, which is what most flows will have to hand.
function parseFeedTime(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }
  const match = typeof value === 'string' ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
    throw new Error(`Invalid feed time ${JSON.stringify(value)}. Use seconds since midnight or "HH:MM"`);
  }
  return Number(match[1]) * 3600 + Number(match[2]) * 60;
}

function formatFeedTime(seconds: number): string {
  const hh = String(Math.floor(seconds / 3600)).padStart(2, '0');
  const mm = String(Math.floor((seconds % 3600) / 60)).padStart(2, '0');
  return `${hh}:${mm}`;
}

export = function (RED: NodeAPI) {
  function PetkitFeederControlNode(this: any, config: PetkitFeederControlNodeDef) {
    RED.nodes.createNode(this, config);

    const configNode = RED.nodes.getNode(config.config) as any;

    this.on('input', async (msg: any) => {
      const api: PetkitBackend = configNode.getAPI();
      const deviceId: number = Number(msg.payload?.deviceId ?? config.deviceId);

      try {
        if (msg.payload?.skipFeedTime !== undefined) {
          const skipFeedTime = parseFeedTime(msg.payload.skipFeedTime);
          await api.skipScheduledFeed(deviceId, skipFeedTime);
          this.status({ fill: 'green', shape: 'dot', text: `skipped: ${formatFeedTime(skipFeedTime)}` });
          msg.payload = { deviceId, skipFeedTime };
        } else if (msg.payload?.restoreFeedTime !== undefined) {
          const restoreFeedTime = parseFeedTime(msg.payload.restoreFeedTime);
          await api.restoreScheduledFeed(deviceId, restoreFeedTime);
          this.status({ fill: 'green', shape: 'dot', text: `restored: ${formatFeedTime(restoreFeedTime)}` });
          msg.payload = { deviceId, restoreFeedTime };
        } else if (msg.payload?.settingKey !== undefined) {
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
