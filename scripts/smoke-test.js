#!/usr/bin/env node
// Manual smoke test against a real PetKit account. Reads credentials from
// .petkit-credentials.json (gitignored) at the repo root - never pass credentials
// on the command line or hardcode them here.
'use strict';

const fs = require('fs');
const path = require('path');
const { PetkitCloudAPI } = require('../dist/lib/petkit-api');

const credsPath = path.join(__dirname, '..', '.petkit-credentials.json');
const { email, password, region } = JSON.parse(fs.readFileSync(credsPath, 'utf8'));

async function main() {
  const api = new PetkitCloudAPI({ email, password, region });

  console.log(`Authenticating as ${email} (region: ${region})...`);
  await api.authenticate();
  console.log('Authenticated OK.');

  console.log('Fetching feeders...');
  const feeders = await api.getFeeders();
  console.log(`Found ${feeders.length} D4 feeder(s):`);
  console.log(JSON.stringify(feeders, null, 2));
}

main().catch(err => {
  console.error('Smoke test failed:', err.message);
  process.exit(1);
});
