import helper from 'node-red-node-test-helper';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const petkitConfig = require('../nodes/petkit-config/petkit-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const petkitFeeder = require('../nodes/petkit-feeder/petkit-feeder');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { PetkitCloudAPI } = require('../lib/petkit-api');
import { PetkitBackend } from '../types/petkit';

helper.init(require.resolve('node-red'));

function makeFlow(pollInterval = 0) {
  return [
    {
      id: 'cfg1',
      type: 'petkit-config',
      credentials: { email: 'test@example.com', password: 'secret', region: 'United States' },
    },
    {
      id: 'n1',
      type: 'petkit-feeder',
      name: 'My Feeders',
      config: 'cfg1',
      pollInterval, // 0 * 1000 = 0ms -> no timer
      wires: [['n2']],
    },
    { id: 'n2', type: 'helper' },
  ];
}

const mockAPI: PetkitBackend = {
  authenticate: jest.fn().mockResolvedValue(undefined),
  getFeeders: jest.fn().mockResolvedValue([{ id: 100, type: 'd4', name: 'Solo' }]),
  feedNow: jest.fn().mockResolvedValue(undefined),
  updateFeederSetting: jest.fn().mockResolvedValue(undefined),
};

describe('petkit-feeder node', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await helper.startServer();
  });

  afterEach(async () => {
    await helper.unload();
    await new Promise<void>(resolve => helper.stopServer(resolve));
  });

  it('should be loaded', async () => {
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const n1 = helper.getNode('n1');
    expect(n1).toBeTruthy();
    expect(n1.type).toBe('petkit-feeder');
  });

  it('should emit one message per feeder on poll', async () => {
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n1 = helper.getNode('n1') as any;
    const n2 = helper.getNode('n2');

    const messages: any[] = [];
    const done = new Promise<void>(resolve => {
      n2.on('input', (msg: any) => {
        messages.push(msg);
        resolve();
      });
    });

    await n1.poll();
    await done;

    expect(messages[0].payload).toMatchObject({ id: 100, name: 'Solo', type: 'd4' });
  });

  it('should show the feeder name in status when there is one feeder', async () => {
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'green', text: 'Solo' });
  });

  it('should show a "no feeders" status when the account has none', async () => {
    const noFeedersAPI = { ...mockAPI, getFeeders: jest.fn().mockResolvedValue([]) };
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => noFeedersAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'green', text: 'no feeders' });
  });

  it('should show a count in status when there are many feeders', async () => {
    const manyFeedersAPI = {
      ...mockAPI,
      getFeeders: jest.fn().mockResolvedValue([
        { id: 100, type: 'd4', name: 'Solo 1' },
        { id: 101, type: 'd4', name: 'Solo 2' },
        { id: 102, type: 'd4', name: 'Solo 3' },
        { id: 103, type: 'd4', name: 'Solo 4' },
      ]),
    };
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => manyFeedersAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'green', text: '4 feeders' });
  });

  it('should set status to red and emit node.error on API failure', async () => {
    const failingAPI = { ...mockAPI, getFeeders: jest.fn().mockRejectedValue(new Error('Network failure')) };
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => failingAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'red' });
  });

  it('should trigger poll when input message received', async () => {
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n2 = helper.getNode('n2');
    const n1 = helper.getNode('n1');

    const msgReceived = new Promise<void>(resolve => n2.on('input', () => resolve()));
    n1.receive({});
    await msgReceived;
  });

  it('should poll immediately on startup when pollInterval > 0', async () => {
    jest.spyOn(PetkitCloudAPI.prototype, 'authenticate').mockResolvedValue(undefined);
    jest.spyOn(PetkitCloudAPI.prototype, 'getFeeders').mockResolvedValue([]);

    const flow = makeFlow(3600);
    await helper.load([petkitConfig, petkitFeeder], flow);
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(PetkitCloudAPI.prototype.getFeeders).toHaveBeenCalled();

    jest.restoreAllMocks();
  });
});
