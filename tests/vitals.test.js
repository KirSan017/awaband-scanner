import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateBaevskySI,
  calculateBreathingRate,
  calculateCoherence,
  calculateHRV,
  calculateLFHF,
} from '../vitals.js';

test('calculateHRV returns metrics for a simple pulse fixture', () => {
  const pulseSignal = new Array(220).fill(0);
  [10, 40, 71, 101, 132, 164, 195].forEach((idx) => {
    pulseSignal[idx] = 1;
  });

  const result = calculateHRV(pulseSignal, 30);
  assert.ok(result);
  assert.ok(result.rmssd >= 0);
  assert.ok(result.sdnn >= 0);
  assert.ok(result.pnn50 >= 0);
  assert.ok(result.ibis.length >= 2);
});

test('vitals helpers return null on insufficient data', () => {
  assert.equal(calculateBreathingRate([1000, 1010, 980]), null);
  assert.equal(calculateLFHF([1000, 980, 1020, 995]), null);
  assert.equal(calculateCoherence([1000, 980, 1020, 995]), null);
  assert.equal(calculateBaevskySI([1000, 1000, 1000]), null);
});
