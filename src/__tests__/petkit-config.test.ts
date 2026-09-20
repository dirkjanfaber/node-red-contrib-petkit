import helper from 'node-red-node-test-helper';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const petkitConfig = require('../nodes/petkit-config/petkit-config');

helper.init(require.resolve('node-red'));

describe('petkit-config node', () => {
  beforeEach(async () => { await helper.startServer(); });
  afterEach(async () => {
    await helper.unload();
    await new Promise<void>(resolve => helper.stopServer(resolve));
  });

  it('should be registered as a config node', async () => {
    const flow = [
      {
        id: 'cfg1',
        type: 'petkit-config',
        name: 'My Feeder Account',
        credentials: { email: 'test@example.com', password: 'secret', region: 'United States' },
      },
    ];
    await helper.load(petkitConfig, flow);
    const cfg = helper.getNode('cfg1');
    expect(cfg).toBeTruthy();
    expect(cfg.name).toBe('My Feeder Account');
  });

  it('should expose a getAPI() method', async () => {
    const flow = [
      {
        id: 'cfg1',
        type: 'petkit-config',
        credentials: { email: 'test@example.com', password: 'secret', region: 'United States' },
      },
    ];
    await helper.load(petkitConfig, flow);
    const cfg = helper.getNode('cfg1') as any;
    expect(typeof cfg.getAPI).toBe('function');
  });

  it('getAPI() returns a PetkitCloudAPI instance', async () => {
    const flow = [
      {
        id: 'cfg1',
        type: 'petkit-config',
        credentials: { email: 'test@example.com', password: 'secret', region: 'United States' },
      },
    ];
    await helper.load(petkitConfig, flow);
    const cfg = helper.getNode('cfg1') as any;
    const api = cfg.getAPI();
    expect(typeof api.authenticate).toBe('function');
    expect(typeof api.getFeeders).toBe('function');
    expect(typeof api.feedNow).toBe('function');
    expect(typeof api.updateFeederSetting).toBe('function');
  });
});
