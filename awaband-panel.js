// AWABAND Panel - Vertical Equalizer HUD

const PARAM_COLORS = [
  '#ff3366', '#ff7a2e', '#ffcc00', '#00ff99',
  '#00ccff', '#6677ff', '#bb44ff',
];

const PARAM_NAMES = [
  'Стабильность', 'Поток', 'Энергия', 'Резонанс',
  'Вибрация', 'Ясность', 'Целостность',
];

const PARAM_SHORT = [
  'STAB', 'FLOW', 'ENRG', 'RSNC',
  'VIBR', 'CLRT', 'INTG',
];

const PARAM_KEYS = [
  'stability', 'flow', 'energy', 'resonance',
  'vibration', 'clarity', 'integrity',
];

const PARAM_LABEL_BY_KEY = Object.fromEntries(
  PARAM_KEYS.map((key, index) => [key, PARAM_NAMES[index]]),
);

const PARAM_DESCRIPTIONS = [
  {
    title: 'Стабильность',
    freq: '396 Hz',
    body: 'Надпочечники',
    studio: 'TerraPod',
    desc: 'Устойчивость нервной системы. HRV метрики RMSSD и SDNN + индекс стресса Баевского + симметрия микродвижений лица.',
    source: 'Камера → HRV (RMSSD + SDNN) + стресс-индекс + vibraimage',
    tip: 'Сидите спокойно, дышите ровно и глубоко. Минимум движений помогает получить более стабильный сигнал.',
  },
  {
    title: 'Поток',
    freq: '417 Hz',
    body: 'Крестец',
    studio: 'AquaFlow',
    desc: 'Плавность внутренних ритмов. Малая дельта между текущим и предыдущим HR + pNN50 + регулярность паттернов микродвижений.',
    source: 'Камера → delta-HR + pNN50 + vibraimage энтропия',
    tip: 'Поддерживайте ровный ритм: не задерживайте дыхание и не двигайтесь резко. Малая дельта HR повышает поток.',
  },
  {
    title: 'Энергия',
    freq: '528 Hz',
    body: 'Солнечное сплетение',
    studio: 'SolarCharge',
    desc: 'Общий уровень активации. Пульс в оптимальной зоне 60-85 уд/мин + громкость голоса + амплитуда микродвижений.',
    source: 'Камера → HR + vibraimage амплитуда + Микрофон → RMS',
    tip: 'Пульс 60-85 уд/мин и уверенный голос дают наиболее устойчивый вклад в энергию.',
  },
  {
    title: 'Резонанс',
    freq: '639 Hz',
    body: 'Тимус / сердце',
    studio: 'HeartOpen',
    desc: 'Когерентность сердечного ритма + баланс LF/HF спектра HRV. Оптимальный LF/HF ≈ 1.0-2.0 связан с более согласованным состоянием.',
    source: 'Камера → спектр HRV → когерентность + LF/HF',
    tip: 'Ровное дыхание и более длинный скан обычно улучшают оценку резонанса.',
  },
  {
    title: 'Вибрация',
    freq: '741 Hz',
    body: 'Горло',
    studio: 'SoundBirth',
    desc: 'Основной тон голоса (F0) + спектральный центроид + частота микротремора лица. В тихом режиме опора смещается в vibraimage.',
    source: 'Микрофон → pitch + центроид + vibraimage частота',
    tip: 'Если говорите, говорите ровно и достаточно отчетливо. В тишине показатель будет больше зависеть от камеры.',
  },
  {
    title: 'Ясность',
    freq: '852 Hz',
    body: 'Эпифиз / лоб',
    studio: 'SilencePod',
    desc: 'Чистота голоса (HNR), стабильность тона (jitter), форманты и спокойствие тела. В silent mode ясность строится в основном по неподвижности.',
    source: 'Микрофон → HNR + jitter + форманты + vibraimage амплитуда',
    tip: 'Четкая речь или спокойная неподвижность дают более высокую ясность.',
  },
  {
    title: 'Целостность',
    freq: '963 Hz',
    body: 'Темя',
    studio: 'UnityDome',
    desc: 'Согласованность всех 6 параметров. Чем ближе они друг к другу, тем выше итоговая целостность.',
    source: 'Расчет → дисперсия параметров 1-6',
    tip: 'Параметр растет, когда остальные шкалы не проваливаются и не расходятся слишком сильно.',
  },
];

export { PARAM_COLORS, PARAM_NAMES, PARAM_KEYS };

export class AwabandPanel {
  constructor(container) {
    this.container = container;
    this.cols = [];
    this.luminosityEl = null;
    this.statusEl = null;
    this.tooltip = null;
    this.activeTooltip = -1;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    this.container.className = 'awaband-panel';

    this.luminosityEl = document.createElement('div');
    this.luminosityEl.className = 'luminosity';
    this.container.appendChild(this.luminosityEl);

    this.statusEl = document.createElement('div');
    this.statusEl.className = 'awaband-status';
    this.statusEl.textContent = 'Качество сигнала: ожидание данных';
    this.container.appendChild(this.statusEl);

    const grid = document.createElement('div');
    grid.className = 'param-grid';

    for (let i = 0; i < 7; i++) {
      const col = document.createElement('div');
      col.className = 'param-col';

      const track = document.createElement('div');
      track.className = 'param-stick-track';

      const fill = document.createElement('div');
      fill.className = 'param-stick-fill';
      fill.style.background = `linear-gradient(to top, ${PARAM_COLORS[i]}44, ${PARAM_COLORS[i]})`;
      fill.style.color = PARAM_COLORS[i];
      track.appendChild(fill);
      col.appendChild(track);

      const label = document.createElement('div');
      label.className = 'param-label';
      label.textContent = PARAM_SHORT[i];
      col.appendChild(label);

      const val = document.createElement('div');
      val.className = 'param-val';
      val.textContent = '—';
      col.appendChild(val);

      col.addEventListener('click', (event) => {
        event.stopPropagation();
        this._toggleTooltip(i);
      });

      grid.appendChild(col);
      this.cols.push(col);
    }

    this.container.appendChild(grid);

    this.tooltip = document.createElement('div');
    this.tooltip.className = 'param-tooltip';
    this.tooltip.style.display = 'none';
    document.body.appendChild(this.tooltip);

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
      <div class="tooltip-source">Читать вместе с confidence и качеством сигнала.</div>
      ${info.tip ? `<div class="tooltip-tip">💡 ${info.tip}</div>` : ''}
    `;
    this.tooltip.style.display = 'block';
  }

  _hideTooltip() {
    this.tooltip.style.display = 'none';
    this.activeTooltip = -1;
  }

  update(params) {
    const conf = params.confidence || {};
    const quality = params.qualityFlags || null;

    PARAM_KEYS.forEach((key, index) => {
      const value = params[key];
      const safeValue = typeof value === 'number' ? value : 0;
      const fill = this.cols[index].querySelector('.param-stick-fill');
      const val = this.cols[index].querySelector('.param-val');
      const confidence = conf[key] ?? 1;

      fill.classList.remove('low-confidence', 'uncertain');
      fill.style.height = `${safeValue}%`;

      if (value === null || confidence < 0.3) {
        fill.classList.add('low-confidence');
        val.textContent = '--';
      } else if (confidence < 0.7) {
        fill.classList.add('uncertain');
        val.textContent = `${safeValue}`;
      } else {
        val.textContent = `${safeValue}`;
      }
    });

    if (this.luminosityEl) {
      this.luminosityEl.textContent = `СВЕТИМОСТЬ: ${params.luminosity}`;
      const hue = 160 + (params.luminosity / 100) * 20;
      const sat = 60 + (params.luminosity / 100) * 30;
      const light = 25 + (params.luminosity / 100) * 35;
      this.luminosityEl.style.color = `hsl(${hue}, ${sat}%, ${light}%)`;
    }

    if (this.statusEl) {
      const retained = quality?.retainedParameters?.length
        ? ` Удержано: ${quality.retainedParameters.map((key) => PARAM_LABEL_BY_KEY[key] || key).join(', ')}.`
        : '';
      this.statusEl.textContent = `${quality?.summary || 'Полный результат: все основные каналы доступны.'}${retained}`;
      this.statusEl.classList.toggle('partial', Boolean(quality?.partial));
    }
  }
}
