import { NodeAPI, NodeDef } from 'node-red';
import { Feeder, PetkitBackend } from '../../types/petkit';

interface PetkitFeederNodeDef extends NodeDef {
  config: string;
  pollInterval: number;
}

function feederSummary(f: Feeder): string {
  const bits = [`desiccant ${f.state.desiccantLeftDays}d`];
  if (f.settings.manualLock === 1) {
    bits.push('locked');
  }
  return `${f.name} (${bits.join(', ')})`;
}

export = function (RED: NodeAPI) {
  function PetkitFeederNode(this: any, config: PetkitFeederNodeDef) {
    RED.nodes.createNode(this, config);

    const configNode = RED.nodes.getNode(config.config) as any;
    const intervalMs = (config.pollInterval ?? 60) * 1000;
    let timer: ReturnType<typeof setInterval> | null = null;

    this.poll = async () => {
      const api: PetkitBackend = configNode.getAPI();
      try {
        const feeders = await api.getFeeders();
        for (const feeder of feeders) {
          this.send({ payload: feeder });
        }

        let summary: string;
        if (feeders.length === 0) {
          summary = 'no feeders';
        } else if (feeders.length <= 2) {
          summary = feeders.map(feederSummary).join(', ');
        } else {
          summary = `${feeders.length} feeders`;
        }
        this.status({ fill: 'green', shape: 'dot', text: summary });
      } catch (err: any) {
        this.status({ fill: 'red', shape: 'ring', text: err.message });
        this.error(err.message);
      }
    };

    this.on('input', () => this.poll());

    if (intervalMs > 0) {
      this.poll();
      timer = setInterval(() => this.poll(), intervalMs);
    }

    this.on('close', () => {
      if (timer) clearInterval(timer);
    });

    this.status({ fill: 'yellow', shape: 'ring', text: 'idle' });
  }

  RED.nodes.registerType('petkit-feeder', PetkitFeederNode);
};
