export function buildResultDiagnosticsMarkup({
  qualityFlags = null,
  simulationMode = 'off',
  paramLabels = {},
} = {}) {
  if (!qualityFlags) {
    return {
      partial: false,
      html: '<div class="result-diagnostics-title">Диагностика скана</div><div class="result-diagnostics-summary">Нет сохраненного состояния скана.</div>',
    };
  }

  const details = qualityFlags.detailLines?.length
    ? `<div class="result-diagnostics-details">${qualityFlags.detailLines.join(' · ')}</div>`
    : '';
  const retained = qualityFlags.retainedParameters?.length
    ? `<div class="result-diagnostics-details">Удержанные параметры: ${qualityFlags.retainedParameters.map((key) => paramLabels[key] || key).join(', ')}</div>`
    : '';
  const diagnosticsOnly = qualityFlags.diagnosticsOnlyMetrics?.length
    ? `<div class="result-diagnostics-details">Служебные метрики: ${qualityFlags.diagnosticsOnlyMetrics.join(', ')}</div>`
    : '';
  const parameterStates = qualityFlags.parameterStates
    ? `<div class="result-diagnostics-details">Состояния параметров: ${formatParameterStates(qualityFlags.parameterStates, paramLabels)}</div>`
    : '';
  const simulation = simulationMode !== 'off'
    ? `<div class="result-diagnostics-details">Simulation: ${simulationMode}</div>`
    : '';
  const copyNote = qualityFlags.partial
    ? '<div class="result-diagnostics-details">При частичном результате часть шкал может быть скрыта или удержана от предыдущего стабильного кадра.</div>'
    : '<div class="result-diagnostics-details">Числа на итоговом экране читаются вместе с качеством сигнала и confidence по шкалам.</div>';

  return {
    partial: Boolean(qualityFlags.partial),
    html: `
      <div class="result-diagnostics-title">${qualityFlags.partial ? 'Частичный результат' : 'Полный результат'}</div>
      <div class="result-diagnostics-summary">${qualityFlags.summary}</div>
      ${details}
      ${retained}
      ${diagnosticsOnly}
      ${parameterStates}
      ${copyNote}
      ${simulation}
    `,
  };
}

function formatParameterStates(parameterStates, paramLabels) {
  return Object.entries(parameterStates)
    .map(([key, value]) => `${paramLabels[key] || key}: ${value}`)
    .join(' · ');
}
