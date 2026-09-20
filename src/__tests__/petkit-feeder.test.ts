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

// Shape confirmed against a real D4 device_detail response (see CLAUDE.md).
const SOLO_FEEDER = {
  id: 100,
  type: 'd4' as const,
  name: 'Solo',
  serialNumber: '20260627G10283',
  firmware: '1.267',
  desc: 'Next Dispense: 17:30',
  settings: { manualLock: 0, lightMode: 1, feedSound: 1, foodWarn: 0 },
  state: {
    food: 1, batteryPower: 0, batteryStatus: 0, desiccantLeftDays: 27, feeding: 0,
    feedState: {
      realAmountTotal: 50, planAmountTotal: 60, addAmountTotal: 10, planRealAmountTotal: 40,
      times: 3, feedTimes: { '24300': 1, '43200': 1, '63000': 3, '82800': 3 },
    },
  },
};

const mockAPI: PetkitBackend = {
  authenticate: jest.fn().mockResolvedValue(undefined),
  getFeeders: jest.fn().mockResolvedValue([SOLO_FEEDER]),
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

    expect(messages[0].payload).toEqual(SOLO_FEEDER);
  });

  it('should show the feeder name and desiccant days left in status when there is one feeder', async () => {
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'green', text: 'Solo (desiccant 27d)' });
  });

  it('should note when a feeder\'s child lock is on', async () => {
    const lockedAPI = {
      ...mockAPI,
      getFeeders: jest.fn().mockResolvedValue([
        { ...SOLO_FEEDER, settings: { ...SOLO_FEEDER.settings, manualLock: 1 } },
      ]),
    };
    await helper.load([petkitConfig, petkitFeeder], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => lockedAPI;
    const n1 = helper.getNode('n1') as any;

    await n1.poll();

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'green', text: 'Solo (desiccant 27d, locked)' });
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
        { ...SOLO_FEEDER, id: 100, name: 'Solo 1' },
        { ...SOLO_FEEDER, id: 101, name: 'Solo 2' },
        { ...SOLO_FEEDER, id: 102, name: 'Solo 3' },
        { ...SOLO_FEEDER, id: 103, name: 'Solo 4' },
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
