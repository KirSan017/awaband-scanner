import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResultDiagnosticsMarkup } from '../scan-diagnostics.js';

test('buildResultDiagnosticsMarkup renders empty state without quality flags', () => {
  const markup = buildResultDiagnosticsMarkup();

  assert.equal(markup.partial, false);
  assert.match(markup.html, /Нет сохраненного состояния скана/);
});

test('buildResultDiagnosticsMarkup exposes retained parameters and service metrics', () => {
  const markup = buildResultDiagnosticsMarkup({
    qualityFlags: {
      partial: true,
      summary: 'Частичный результат: пульсовой сигнал прогревается.',
      detailLines: ['пульсовой сигнал прогревается'],
      retainedParameters: ['resonance'],
      diagnosticsOnlyMetrics: ['voiceMetrics.shimmer'],
      parameterStates: {
        stability: 'partial',
        resonance: 'retained',
      },
    },
    simulationMode: 'fake-camera+fake-mic',
    paramLabels: {
      resonance: 'Резонанс',
      stability: 'Стабильность',
    },
  });

  assert.equal(markup.partial, true);
  assert.match(markup.html, /Частичный результат/);
  assert.match(markup.html, /Удержанные параметры: Резонанс/);
  assert.match(markup.html, /Служебные метрики: voiceMetrics\.shimmer/);
  assert.match(markup.html, /Simulation: fake-camera\+fake-mic/);
  assert.match(markup.html, /При частичном результате часть шкал может быть скрыта или удержана/);
});
