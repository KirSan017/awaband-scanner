// AWABAND Panel — Vertical Equalizer HUD
// Biophotonic Medical Interface

const PARAM_COLORS = [
  '#ff3366', '#ff7a2e', '#ffcc00', '#00ff99',
  '#00ccff', '#6677ff', '#bb44ff'
];

const PARAM_NAMES = [
  'Стабильность', 'Поток', 'Энергия', 'Резонанс',
  'Вибрация', 'Ясность', 'Целостность'
];

const PARAM_SHORT = [
  'STAB', 'FLOW', 'ENRG', 'RSNC',
  'VIBR', 'CLRT', 'INTG'
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

export { PARAM_COLORS, PARAM_NAMES, PARAM_KEYS };

export class AwabandPanel {
  constructor(container) {
    this.container = container;
    this.cols = [];
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

    // Vertical equalizer grid
    const grid = document.createElement('div');
    grid.className = 'param-grid';

    for (let i = 0; i < 7; i++) {
      const col = document.createElement('div');
      col.className = 'param-col';

      // Vertical stick track
      const track = document.createElement('div');
      track.className = 'param-stick-track';

      const fill = document.createElement('div');
      fill.className = 'param-stick-fill';
      fill.style.background = `linear-gradient(to top, ${PARAM_COLORS[i]}44, ${PARAM_COLORS[i]})`;
      fill.style.color = PARAM_COLORS[i];
      track.appendChild(fill);
      col.appendChild(track);

      // Label
      const label = document.createElement('div');
      label.className = 'param-label';
      label.textContent = PARAM_SHORT[i];
      col.appendChild(label);

      // Value
      const val = document.createElement('div');
      val.className = 'param-val';
      val.textContent = '—';
      col.appendChild(val);

      col.addEventListener('click', (e) => {
        e.stopPropagation();
        this._toggleTooltip(i);
      });

      grid.appendChild(col);
      this.cols.push(col);
    }

    this.container.appendChild(grid);

    // Tooltip element — appended to body to escape clip-path
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'param-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);

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
      <div class="tooltip-meta">${info.body} \u00b7 \u0421\u0442\u0443\u0434\u0438\u044f ${info.studio}</div>
      <div class="tooltip-desc">${info.desc}</div>
      <div class="tooltip-source">\u0418\u0441\u0442\u043e\u0447\u043d\u0438\u043a: ${info.source}</div>
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
      const fill = this.cols[i].querySelector('.param-stick-fill');
      const val = this.cols[i].querySelector('.param-val');
      fill.style.height = `${value}%`;
      val.textContent = `${value}`;
    });

    if (this.luminosityEl) {
      this.luminosityEl.textContent = `\u0421\u0412\u0415\u0422\u0418\u041c\u041e\u0421\u0422\u042c: ${params.luminosity}`;
      const hue = 160 + (params.luminosity / 100) * 20;
      const sat = 60 + (params.luminosity / 100) * 30;
      const light = 25 + (params.luminosity / 100) * 35;
      this.luminosityEl.style.color = `hsl(${hue}, ${sat}%, ${light}%)`;
    }
  }
}
