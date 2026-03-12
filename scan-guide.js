const GUIDE_PARAM_CARDS = Object.freeze([
  {
    name: 'Стабильность',
    color: '#ff3366',
    freq: '396 Hz',
    how: 'Смотрит, насколько ровно выглядит ритм, спокойно ли ведёт себя motion-канал и не разваливается ли сигнал.',
    read: 'Высокая стабильность означает более ровную сессию. Это не диагноз и не медицинская оценка.',
    source: 'Камера -> HRV + stressIndex + symmetry',
  },
  {
    name: 'Поток',
    color: '#ff7a2e',
    freq: '417 Hz',
    how: 'Смотрит, насколько ритм и движение меняются плавно, без лишних рывков и хаоса.',
    read: 'Высокий поток ближе к ощущению согласованности и плавности, а не просто к “большей силе”.',
    source: 'Камера -> hrDelta + pNN50 + vibra entropy',
  },
  {
    name: 'Энергия',
    color: '#ffcc00',
    freq: '528 Hz',
    how: 'Собирает общую активность из рабочего пульса, голоса и амплитуды движений. При тишине сильнее опирается на камеру и motion-канал.',
    read: 'Это шкала общей активации. Шум и суета могут ухудшать её так же, как и слишком слабый сигнал.',
    source: 'Камера + микрофон + vibra amplitude',
  },
  {
    name: 'Резонанс',
    color: '#00ff99',
    freq: '639 Hz',
    how: 'Сильнее остальных зависит от того, успел ли пульсовой канал стать стабильным и качественным.',
    read: 'Если pulse-канал ещё греется или слабый, эту шкалу нельзя читать отдельно от confidence и диагностики.',
    source: 'Камера -> coherence + LF/HF',
  },
  {
    name: 'Вибрация',
    color: '#00ccff',
    freq: '741 Hz',
    how: 'При голосе смотрит на тон и спектр речи, а в тишине переходит на ритм движения.',
    read: 'В silent mode шкала продолжает работать. VoiceBio-подсветка ауры визуальна и не добавляет отдельный балл.',
    source: 'Микрофон -> pitch + centroid; silent mode -> vibra frequency',
  },
  {
    name: 'Ясность',
    color: '#6677ff',
    freq: '852 Hz',
    how: 'Смотрит, насколько чисто звучит голос и насколько спокойно выглядит картинка без лишнего шума.',
    read: 'Если число скрыто, чаще всего проблема не в “нуле”, а в слабом confidence у голоса или motion-канала.',
    source: 'Микрофон -> HNR + jitter + formants; silent mode -> amplitude + symmetry',
  },
  {
    name: 'Целостность',
    color: '#bb44ff',
    freq: '963 Hz',
    how: 'Сводит вместе первые шесть шкал и проверяет, насколько они согласованы между собой.',
    read: 'Это итоговая сводка по остальным параметрам, а не отдельный сенсорный канал.',
    source: 'Расчёт -> dispersion / agreement of parameters 1-6',
  },
]);

export function buildGuideOverlay({ onClose } = {}) {
  const overlay = createElement('div', 'guide-overlay');
  overlay.id = 'guide-overlay';

  const backdrop = createElement('div', 'guide-backdrop');
  backdrop.addEventListener('click', () => onClose?.());
  overlay.appendChild(backdrop);

  const panel = createElement('div', 'guide-panel');
  const inner = createElement('div', 'guide-scroll');

  const header = createElement('div', 'guide-header');
  header.appendChild(createElement('div', 'guide-title', { text: 'Как сканер собирает результат' }));
  const closeBtn = createElement('button', 'guide-close', { text: '✕' });
  closeBtn.addEventListener('click', () => onClose?.());
  header.appendChild(closeBtn);
  inner.appendChild(header);

  inner.appendChild(createElement('p', 'guide-intro', {
    text: 'AWABAND Scanner использует камеру и микрофон, чтобы собрать несколько простых сигналов и превратить их в 7 интерпретационных шкал. Если качество сигнала плохое, часть шкал становится частичной, скрывается или удерживается от предыдущего стабильного кадра.',
  }));

  inner.appendChild(buildSection({
    title: '📷 Камера: pulse и HRV',
    paragraphs: [
      'Камера следит за зоной лба и пытается поймать мелкие изменения цвета кожи. Из этого сканер оценивает пульс и ритм.',
      'Этот канал особенно важен для стабильности, потока и резонанса.',
    ],
    bullets: [
      'pulse warming/acquiring = часть шкал ещё недоступна',
      'weak pulse = confidence режется даже если число уже появилось',
      'резонанс сильнее остальных зависит от качества pulse-канала',
    ],
    reference: 'Ориентиры по методикам: CHROM rPPG, HRV Task Force, coherence/LFHF heuristics.',
  }));

  inner.appendChild(buildSection({
    title: '🔬 Камера: motion-канал',
    paragraphs: [
      'Отдельно сканер смотрит, насколько спокойно или шумно двигается лицо в кадре.',
      'Этот канал помогает, когда голос слабый, и заметно влияет на устойчивость части шкал.',
    ],
    bullets: [
      'motion-канал помогает даже при тихом скане',
      'автоэкспозиция, шум матрицы и потеря лица сильно искажают результат',
      'symmetry особенно влияет на стабильность и ясность',
    ],
    reference: 'Это runtime heuristic по яркостным diff-кадрам, а не лабораторная метрика.',
  }));

  inner.appendChild(buildSection({
    title: '🎤 Микрофон: voice metrics',
    paragraphs: [
      'Если микрофон доступен, сканер смотрит на громкость, тон, чистоту и устойчивость звучания.',
      'Если вы молчите, vibration, clarity и часть energy не исчезают, а сильнее опираются на камеру и motion-канал.',
    ],
    bullets: [
      'microphone denied = результат остаётся частичным',
      'voiceBioCenter используется только для подсветки ауры',
      'shimmer сейчас остаётся служебной метрикой и не влияет на biofield напрямую',
    ],
    reference: 'Ориентиры по DSP: базовые голосовые признаки и спектральные оценки через Web Audio.',
  }));

  inner.appendChild(buildSection({
    title: '🎵 VoiceBio и аура',
    paragraphs: [
      'VoiceBio-слой визуально сопоставляет текущий тон речи с одним из 7 слоёв ауры. Это часть художественной интерпретации интерфейса, а не отдельная доказательная числовая метрика.',
      'Сакральная геометрия реагирует на уже посчитанные параметры, но сама не участвует в формуле.',
    ],
    bullets: [
      'аура и геометрия не влияют обратно на расчёт',
      'numeric output приходит из camera/motion/voice каналов и quality gate',
    ],
  }));

  inner.appendChild(createElement('div', 'guide-divider'));
  inner.appendChild(createElement('div', 'guide-subtitle', { text: '7 параметров био-поля' }));
  inner.appendChild(createElement('p', 'guide-section-text guide-mapping-intro', {
    text: 'Каждая шкала использует несколько источников сразу. Читайте её вместе со статусами CAM/MIC/FACE/PULSE/HD и confidence, а не как автономный приборный вывод.',
  }));

  for (const param of GUIDE_PARAM_CARDS) {
    const card = createElement('div', 'guide-param');
    card.style.borderLeftColor = param.color;
    card.innerHTML = `
      <div class="guide-param-head">
        <span class="guide-param-dot" style="background:${param.color};box-shadow:0 0 8px ${param.color}"></span>
        <span class="guide-param-name">${param.name}</span>
        <span class="guide-param-freq">${param.freq}</span>
      </div>
      <div class="guide-param-row">
        <span class="guide-param-label">Что учитывает:</span>
        <span>${param.how}</span>
      </div>
      <div class="guide-param-row">
        <span class="guide-param-label">Как читать:</span>
        <span>${param.read}</span>
      </div>
      <div class="guide-param-source">${param.source}</div>
    `;
    inner.appendChild(card);
  }

  inner.appendChild(createElement('p', 'guide-disclaimer', {
    text: 'AWABAND Scanner — интерпретационный wellness-интерфейс Awaterra 2225. Он использует реальные сигналы камеры и микрофона, но не является медицинским прибором, не ставит диагноз и должен читаться вместе с индикаторами качества сигнала.',
  }));

  panel.appendChild(inner);
  overlay.appendChild(panel);
  return overlay;
}

function buildSection({ title, paragraphs = [], bullets = [], reference = '' } = {}) {
  const section = createElement('div', 'guide-section');

  const titleEl = createElement('div', 'guide-section-title', { text: title });
  section.appendChild(titleEl);

  for (const paragraph of paragraphs) {
    section.appendChild(createElement('p', 'guide-section-text', { text: paragraph }));
  }

  if (bullets.length) {
    const list = createElement('ul', 'guide-list');
    for (const bullet of bullets) {
      const item = createElement('li');
      item.textContent = bullet;
      list.appendChild(item);
    }
    section.appendChild(list);
  }

  if (reference) {
    section.appendChild(createElement('p', 'guide-ref', { text: reference }));
  }

  return section;
}

function createElement(tag, cls, attrs) {
  const element = document.createElement(tag);
  if (cls) element.className = cls;
  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (key === 'text') {
        element.textContent = value;
      } else if (key === 'html') {
        element.innerHTML = value;
      } else {
        element.setAttribute(key, value);
      }
    }
  }
  return element;
}
