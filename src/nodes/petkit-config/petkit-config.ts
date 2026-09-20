import { NodeAPI, NodeDef } from 'node-red';
import { PetkitCloudAPI } from '../../lib/petkit-api';

interface PetkitConfigNodeDef extends NodeDef {
  name: string;
}

export = function (RED: NodeAPI) {
  function PetkitConfigNode(this: any, config: PetkitConfigNodeDef) {
    RED.nodes.createNode(this, config);

    const creds = (this.credentials || {}) as {
      email?: string;
      password?: string;
      region?: string;
    };

    const api = new PetkitCloudAPI({
      email: creds.email || '',
      password: creds.password || '',
      region: creds.region || '',
    });

    this.getAPI = () => api;
  }

  RED.nodes.registerType('petkit-config', PetkitConfigNode, {
    credentials: {
      email: { type: 'text' },
      password: { type: 'password' },
      region: { type: 'text' },
    },
  });
};
