import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSimulationDescriptor,
  normalizeSimulationTokens,
  parseSimulationSearch,
} from '../scan-sim.js';

test('normalizeSimulationTokens keeps only known unique flags', () => {
  assert.deepEqual(
    normalizeSimulationTokens('fake-camera+mic-denied+fake-camera+unknown+face-loss'),
    ['fake-camera', 'mic-denied', 'face-loss'],
  );
});

test('parseSimulationSearch reads sim query parameter', () => {
  assert.deepEqual(
    parseSimulationSearch('?foo=1&sim=fake-camera,pulse-weak+fake-mic'),
    ['fake-camera', 'pulse-weak', 'fake-mic'],
  );
});

test('createSimulationDescriptor exposes stable runtime flags', () => {
  const simulation = createSimulationDescriptor('?sim=fake-camera+fake-mic+face-loss');

  assert.equal(simulation.active, true);
  assert.equal(simulation.label, 'fake-camera+fake-mic+face-loss');
  assert.equal(simulation.fakeCamera, true);
  assert.equal(simulation.fakeMicrophone, true);
  assert.equal(simulation.faceLoss, true);
  assert.equal(simulation.cameraDenied, false);
  assert.equal(simulation.microphoneDenied, false);
});
