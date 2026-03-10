// dashboard/public/scanner/awaband-panel.js

const PARAM_COLORS = [
  '#ff6b8a', '#ff9f5a', '#ffd06b', '#5ae8b0',
  '#5ac8ff', '#8b8aff', '#c77dff'
];

const PARAM_NAMES = [
  'Стабильность', 'Поток', 'Энергия', 'Резонанс',
  'Вибрация', 'Ясность', 'Целостность'
];

const PARAM_KEYS = [
  'stability', 'flow', 'energy', 'resonance',
  'vibration', 'clarity', 'integrity'
];

const PARAM_DESCRIPTIONS = [
  {
    title: 'Стабильность',
    freq: '396 Hz',
    body: 'Надпочечники',
    studio: 'TerraPod',
    desc: 'Устойчивость нервной системы. Вычисляется из вариабельности сердечного ритма (HRV) — чем стабильнее интервалы между ударами сердца, тем выше показатель.',
    source: 'Камера → пульс → HRV (RMSSD)'
  },
  {
    title: 'Поток',
    freq: '417 Hz',
    body: 'Крестец',
    studio: 'AquaFlow',
    desc: 'Плавность внутренних ритмов. Анализирует, насколько равномерно меняется пульс — без резких скачков и провалов.',
    source: 'Камера → сглаженный пульс'
  },
  {
    title: 'Энергия',
    freq: '528 Hz',
    body: 'Солнечное сплетение',
    studio: 'SolarCharge',
    desc: 'Общий уровень активации. Комбинация частоты пульса (оптимум 60-80 уд/мин) и громкости голоса.',
    source: 'Камера → пульс + Микрофон → громкость'
  },
  {
    title: 'Резонанс',
    freq: '639 Hz',
    body: 'Тимус / сердце',
    studio: 'HeartOpen',
    desc: 'Когерентность сердечного ритма — насколько упорядочена вариабельность пульса. Высокий резонанс = гармоничное состояние. Методология HeartMath.',
    source: 'Камера → пульс → спектр HRV → пик ~0.1 Hz'
  },
  {
    title: 'Вибрация',
    freq: '741 Hz',
    body: 'Горло',
    studio: 'SoundBirth',
    desc: 'Звуковая выразительность. Анализирует основной тон голоса (pitch) и богатство обертонов (спектральный центроид).',
    source: 'Микрофон → pitch (F0) + спектральный центроид'
  },
  {
    title: 'Ясность',
    freq: '852 Hz',
    body: 'Эпифиз / лоб',
    studio: 'SilencePod',
    desc: 'Чистота и стабильность голоса. Высокий HNR (соотношение гармоник к шуму) и низкий jitter (дрожание тона) = высокая ясность.',
    source: 'Микрофон → HNR + jitter'
  },
  {
    title: 'Целостность',
    freq: '963 Hz',
    body: 'Темя',
    studio: 'UnityDome',
    desc: 'Согласованность всех параметров между собой. Чем меньше разброс значений остальных 6 параметров, тем выше целостность.',
    source: 'Расчёт → дисперсия параметров 1-6'
  }
];

export class AwabandPanel {
  constructor(container) {
    this.container = container;
    this.bars = [];
    this.luminosityEl = null;
    this.tooltip = null;
    this.activeTooltip = -1;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.className = 'awaband-panel';

    // Luminosity header
    this.luminosityEl = document.createElement('div');
    this.luminosityEl.className = 'luminosity';
    this.container.appendChild(this.luminosityEl);

    // 7 bars
    const grid = document.createElement('div');
    grid.className = 'param-grid';

    for (let i = 0; i < 7; i++) {
      const row = document.createElement('div');
      row.className = 'param-row';
      row.innerHTML = `
        <span class="param-name">${PARAM_NAMES[i]}</span>
        <div class="param-bar-track">
          <div class="param-bar-fill" style="background:${PARAM_COLORS[i]}"></div>
        </div>
        <span class="param-value">—</span>
      `;
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleTooltip(i);
      });
      grid.appendChild(row);
      this.bars.push(row);
    }

    this.container.appendChild(grid);

    // Tooltip element
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'param-tooltip';
    this.tooltip.style.display = 'none';
    this.container.appendChild(this.tooltip);

    // Close tooltip on outside click
    document.addEventListener('click', () => this._hideTooltip());
  }

  _toggleTooltip(index) {
    if (this.activeTooltip === index) {
      this._hideTooltip();
      return;
    }
    this.activeTooltip = index;
    const info = PARAM_DESCRIPTIONS[index];
    this.tooltip.innerHTML = `
      <div class="tooltip-header">
        <span class="tooltip-color" style="background:${PARAM_COLORS[index]}"></span>
        <span class="tooltip-title">${info.title}</span>
        <span class="tooltip-freq">${info.freq}</span>
      </div>
      <div class="tooltip-meta">${info.body} · Студия ${info.studio}</div>
      <div class="tooltip-desc">${info.desc}</div>
      <div class="tooltip-source">Источник: ${info.source}</div>
    `;
    this.tooltip.style.display = 'block';
  }

  _hideTooltip() {
    this.tooltip.style.display = 'none';
    this.activeTooltip = -1;
  }

  update(params) {
    PARAM_KEYS.forEach((key, i) => {
      const value = params[key];
      const fill = this.bars[i].querySelector('.param-bar-fill');
      const label = this.bars[i].querySelector('.param-value');
      fill.style.width = `${value}%`;
      label.textContent = `${value}`;
    });

    if (this.luminosityEl) {
      this.luminosityEl.textContent = `Светимость: ${params.luminosity}`;
      const hue = 80 + (params.luminosity / 100) * 40;
      const sat = 40 + (params.luminosity / 100) * 40;
      const light = 30 + (params.luminosity / 100) * 30;
      this.luminosityEl.style.color = `hsl(${hue}, ${sat}%, ${light}%)`;
    }
  }
}
