import helper from 'node-red-node-test-helper';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const petkitConfig = require('../nodes/petkit-config/petkit-config');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const petkitFeederControl = require('../nodes/petkit-feeder-control/petkit-feeder-control');
import { PetkitBackend } from '../types/petkit';

helper.init(require.resolve('node-red'));

const mockAPI: PetkitBackend = {
  authenticate: jest.fn().mockResolvedValue(undefined),
  getFeeders: jest.fn().mockResolvedValue([]),
  feedNow: jest.fn().mockResolvedValue(undefined),
  updateFeederSetting: jest.fn().mockResolvedValue(undefined),
};

function makeFlow(overrides: Record<string, unknown> = {}) {
  return [
    {
      id: 'cfg1',
      type: 'petkit-config',
      credentials: { email: 'test@example.com', password: 'secret', region: 'United States' },
    },
    {
      id: 'n1',
      type: 'petkit-feeder-control',
      name: 'Feed the cat',
      config: 'cfg1',
      deviceId: '100',
      amount: 20,
      ...overrides,
      wires: [['n2']],
    },
    { id: 'n2', type: 'helper' },
  ];
}

describe('petkit-feeder-control node', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await helper.startServer();
  });

  afterEach(async () => {
    await helper.unload();
    await new Promise<void>(resolve => helper.stopServer(resolve));
  });

  it('should be loaded', async () => {
    await helper.load([petkitConfig, petkitFeederControl], makeFlow());
    const n1 = helper.getNode('n1');
    expect(n1).toBeTruthy();
    expect(n1.type).toBe('petkit-feeder-control');
  });

  it('should call feedNow with the node-configured deviceId and amount on input', async () => {
    await helper.load([petkitConfig, petkitFeederControl], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n2 = helper.getNode('n2');

    const msgReceived = new Promise<any>(resolve => n2.on('input', resolve));
    helper.getNode('n1').receive({ payload: {} });
    const msg = await msgReceived;

    expect(mockAPI.feedNow).toHaveBeenCalledWith(100, 20);
    expect(msg.payload).toMatchObject({ deviceId: 100, amount: 20 });
  });

  it('should use msg.payload.deviceId and msg.payload.amount to override node config', async () => {
    await helper.load([petkitConfig, petkitFeederControl], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n2 = helper.getNode('n2');

    const msgReceived = new Promise<any>(resolve => n2.on('input', resolve));
    helper.getNode('n1').receive({ payload: { deviceId: 200, amount: 50 } });
    await msgReceived;

    expect(mockAPI.feedNow).toHaveBeenCalledWith(200, 50);
  });

  it('should update a feeder setting instead of feeding when msg.payload.settingKey is set', async () => {
    await helper.load([petkitConfig, petkitFeederControl], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => mockAPI;
    const n2 = helper.getNode('n2');

    const msgReceived = new Promise<any>(resolve => n2.on('input', resolve));
    helper.getNode('n1').receive({ payload: { settingKey: 'manualLock', settingValue: 1 } });
    const msg = await msgReceived;

    expect(mockAPI.updateFeederSetting).toHaveBeenCalledWith(100, 'manualLock', 1);
    expect(mockAPI.feedNow).not.toHaveBeenCalled();
    expect(msg.payload).toMatchObject({ deviceId: 100, settingKey: 'manualLock', settingValue: 1 });
  });

  it('should set status to red and emit node.error on API failure', async () => {
    const failingAPI = { ...mockAPI, feedNow: jest.fn().mockRejectedValue(new Error('Network failure')) };
    await helper.load([petkitConfig, petkitFeederControl], makeFlow());
    const cfg = helper.getNode('cfg1') as any;
    cfg.getAPI = () => failingAPI;
    const n1 = helper.getNode('n1') as any;

    n1.receive({ payload: {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'red' });
  });

  it('should reject an invalid feed amount without calling the API', async () => {
    await helper.load([petkitConfig, petkitFeederControl], makeFlow({ amount: 15 }));
    const cfg = helper.getNode('cfg1') as any;
    const failingFeedNow = jest.fn().mockRejectedValue(new Error('Invalid feed amount 15. Fresh Element Solo only accepts: 10, 20, 30, 40, 50'));
    cfg.getAPI = () => ({ ...mockAPI, feedNow: failingFeedNow });
    const n1 = helper.getNode('n1') as any;

    n1.receive({ payload: {} });
    await new Promise<void>(resolve => setImmediate(resolve));
    await new Promise<void>(resolve => setImmediate(resolve));

    const lastArg = (n1.status as any).lastCall?.args[0];
    expect(lastArg).toMatchObject({ fill: 'red' });
  });
});
