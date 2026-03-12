const GUIDE_PARAM_CARDS = Object.freeze([
  {
    name: 'Стабильность',
    color: '#ff3366',
    freq: '396 Hz',
    how: 'Собирается из признаков ритма, stressIndex и симметрии движения. Если пульсовой канал слабый или лицо теряется, шкала быстро теряет уверенность.',
    impact: 'Сильнее всего на неё влияют качество pulse-канала, спокойный кадр и устойчивое лицо в зоне трекинга.',
    read: 'Высокая стабильность означает более ровную и менее шумную сессию. Это не медицинская оценка нервной системы.',
    source: 'Камера -> HRV + stressIndex + symmetry',
  },
  {
    name: 'Поток',
    color: '#ff7a2e',
    freq: '417 Hz',
    how: 'Смотрит, насколько ритм меняется плавно и сколько живой вариативности остаётся в pulse- и motion-канале.',
    impact: 'Его просаживают рваный пульс, хаотичные движения и сильные прыжки ритма между кадрами.',
    read: 'Высокий поток ближе к ощущению согласованности и плавности, а не просто к “большей энергии”.',
    source: 'Камера -> hrDelta + pNN50 + motion entropy',
  },
  {
    name: 'Энергия',
    color: '#ffcc00',
    freq: '528 Hz',
    how: 'Опирается на рабочий диапазон пульса, голосовую активность и амплитуду движения. В silent mode сильнее сдвигается к камере и motion-каналу.',
    impact: 'Падает не только от слабого сигнала, но и от слишком шумной или суетливой сессии.',
    read: 'Это шкала общей активации. Сильный шум не равен высокой энергии.',
    source: 'Камера + микрофон + motion amplitude',
  },
  {
    name: 'Резонанс',
    color: '#00ff99',
    freq: '639 Hz',
    how: 'Сильнее остальных зависит от качества pulse-канала и собирается вокруг coherence и LF/HF-подобных признаков.',
    impact: 'Если `PULSE` ещё в warm-up/acquiring или лицо часто теряется, эта шкала обычно первая становится частичной.',
    read: 'Резонанс стоит читать только вместе с quality и confidence, а не как отдельный “точный” прибор.',
    source: 'Камера -> coherence + LF/HF',
  },
  {
    name: 'Вибрация',
    color: '#00ccff',
    freq: '741 Hz',
    how: 'При голосе использует тон и спектр речи. В тишине не уходит в ноль, а пересчитывается по ритму движения.',
    impact: 'На неё сильнее всего влияют микрофон, качество речи и частота motion-канала.',
    read: 'Это характеристика текущего ритма сессии. VoiceBio-подсветка ауры визуальна и не добавляет отдельный балл.',
    source: 'Микрофон -> pitch + centroid; silent mode -> motion frequency',
  },
  {
    name: 'Ясность',
    color: '#6677ff',
    freq: '852 Hz',
    how: 'Собирается из чистоты голоса и спокойствия motion-канала. В silent mode больше зависит от неподвижности и symmetry.',
    impact: 'Её чаще всего портят фоновые шумы, дрожащая картинка, слабый голос и потеря лица.',
    read: 'Если число скрыто, это чаще проблема confidence, а не обязательно ноль.',
    source: 'Микрофон -> HNR + jitter + formants; silent mode -> amplitude + symmetry',
  },
  {
    name: 'Целостность',
    color: '#bb44ff',
    freq: '963 Hz',
    how: 'Это итоговая сводка по первым шести шкалам и их уверенности. Отдельного сенсора у неё нет.',
    impact: 'Сильнее всего просаживается, когда скан частичный и параметры между собой расходятся.',
    read: 'Целостность показывает, насколько согласованно выглядит вся сессия, а не отдельный физиологический канал.',
    source: 'Расчёт -> agreement of parameters 1-6',
  },
]);

const GUIDE_STATUS_CARDS = Object.freeze([
  {
    label: 'CAM',
    title: 'Камера',
    text: 'Основной видеоканал. Если `CAM` не ready, скан не сможет нормально продолжиться.',
  },
  {
    label: 'MIC',
    title: 'Микрофон',
    text: 'Даёт вклад в энергию, вибрацию и ясность. При `MIC denied` скан остаётся частичным, но не ломается.',
  },
  {
    label: 'FACE',
    title: 'Лицо в кадре',
    text: 'Показывает, что лицо уверенно трекается. Потеря лица режет confidence и может очистить pulse/motion buffers.',
  },
  {
    label: 'PULSE',
    title: 'Пульсовой канал',
    text: 'Сначала прогревается, затем переходит в рабочий режим. Пока он слабый, часть шкал не стоит читать как окончательные.',
  },
  {
    label: 'FOCUS',
    title: 'Режим "Фокус"',
    text: 'Опциональная сегментация человека. Она чистит фон и иногда помогает дольше удерживать лицо, но не делает расчёт медицински точнее.',
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
  header.appendChild(createElement('div', 'guide-title', { text: 'Онбординг и guide' }));
  const closeBtn = createElement('button', 'guide-close', { text: '✕' });
  closeBtn.addEventListener('click', () => onClose?.());
  header.appendChild(closeBtn);
  inner.appendChild(header);

  inner.appendChild(createElement('p', 'guide-intro', {
    text: 'Сканер использует камеру и микрофон, чтобы собрать несколько простых сигналов и превратить их в 7 интерпретационных шкал. Сначала смотрите на качество сигнала и статусы, а уже потом на красивые столбики и ауру.',
  }));

  inner.appendChild(buildSection({
    title: '🚀 Перед стартом',
    paragraphs: [
      'Лучший результат получается при ровном свете на лицо, спокойной позе и 20-40 секундах непрерывного скана.',
      'Если говорить не хочется, скан всё равно можно пройти. В этом случае часть шкал уходит в silent-mode логику и сильнее зависит от камеры и motion-канала.',
    ],
    bullets: [
      'держите лицо целиком в кадре',
      'не делайте резких поворотов головой',
      'дайте pulse-каналу время прогреться',
      'разрешите микрофон, если нужен голосовой вклад',
    ],
  }));

  inner.appendChild(buildSection({
    title: '🧭 Как читать скан',
    paragraphs: [
      'Правильный порядок чтения: сначала CAM/FACE/PULSE, потом full/partial статус, потом confidence и только после этого сами 7 шкал.',
      'Если результат `partial`, это не ошибка приложения. Это честный сигнал, что часть каналов была шумной, недоступной или удерживалась от предыдущих стабильных кадров.',
    ],
    bullets: [
      'если число скрыто, это чаще проблема confidence, а не ноль',
      'retained parameters = рантайм удержал последнее стабильное значение',
      'самый чувствительный канал для качества результата — pulse',
    ],
  }));

  inner.appendChild(buildSection({
    title: '📶 Что значат статусы сверху',
    cards: GUIDE_STATUS_CARDS,
  }));

  inner.appendChild(buildSection({
    title: '📷 Камера: pulse и ритм',
    paragraphs: [
      'Камера следит за зоной лба и пытается поймать небольшие изменения цвета кожи. Из этого сканер оценивает пульс, вариативность ритма и качество самого pulse-канала.',
      'Этот канал сильнее всего влияет на стабильность, поток, резонанс и часть энергии.',
    ],
    bullets: [
      'слабый свет быстро ухудшает pulse-канал',
      'потеря лица режет доверие к результату',
      'резонанс сильнее остальных зависит именно от quality pulse-канала',
    ],
  }));

  inner.appendChild(buildSection({
    title: '🔬 Motion-канал',
    paragraphs: [
      'Отдельно сканер смотрит, насколько спокойно или шумно двигается лицо в кадре. Это browser heuristic по межкадровым изменениям яркости.',
      'Motion-канал помогает, когда голос слабый, и заметно влияет на стабильность, поток, вибрацию и ясность.',
    ],
    bullets: [
      'резкие движения делают скан более шумным',
      'дрожащая картинка режет confidence',
      'симметрия и спокойствие особенно важны для ясности и стабильности',
    ],
  }));

  inner.appendChild(buildSection({
    title: '🎤 Микрофон: голосовой вклад',
    paragraphs: [
      'Если микрофон доступен, сканер смотрит на громкость, тон, чистоту и устойчивость звучания.',
      'Если вы молчите, энергия, вибрация и ясность продолжают работать, но сильнее опираются на камеру и motion-канал.',
    ],
    bullets: [
      '`MIC denied` оставляет результат частичным, но не ломает скан',
      'шумная среда быстрее всего портит ясность',
      'голосовой вклад сильнее всего влияет на энергию, вибрацию и ясность',
    ],
  }));

  inner.appendChild(buildSection({
    title: '🪄 Режим "Фокус"',
    paragraphs: [
      'Кнопка `ФОКУС` включает сегментацию человека и размывает фон. Это делает картинку визуально чище и иногда помогает дольше удерживать лицо в сложном фоне.',
      'Важно: режим "Фокус" не меняет формулы шкал и не делает измерение медицински точнее. Это вспомогательный visual mode.',
    ],
    bullets: [
      'полезен, если фон шумный или отвлекающий',
      'не обязателен для нормального скана',
      'зависит от сети, потому что модель подгружается с CDN',
    ],
  }));

  inner.appendChild(buildSection({
    title: '💾 Экспорт',
    paragraphs: [
      'Кнопка `JSON` на live-экране сохраняет инженерный session export без перехода на итоговый экран.',
      'На result-экране можно сохранить `PNG` snapshot и тот же `JSON` export с итоговым snapshot, timeline и signal buffers.',
    ],
    bullets: [
      '`JSON` нужен для диагностики, replay и regression fixtures',
      'в экспорт пока не входят полный видеоряд и сырой аудиосигнал',
    ],
  }));

  inner.appendChild(createElement('div', 'guide-divider'));
  inner.appendChild(createElement('div', 'guide-subtitle', { text: '7 параметров и их расчёт' }));
  inner.appendChild(createElement('p', 'guide-section-text guide-mapping-intro', {
    text: 'Каждая шкала использует несколько источников сразу. Читайте её вместе со статусами CAM/MIC/FACE/PULSE/FOCUS и confidence, а не как автономный приборный вывод.',
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
        <span class="guide-param-label">Как считается:</span>
        <span>${param.how}</span>
      </div>
      <div class="guide-param-row">
        <span class="guide-param-label">Что сильнее влияет:</span>
        <span>${param.impact}</span>
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
    text: 'AWABAND Scanner — интерпретационный wellness-интерфейс. Он использует реальные сигналы камеры и микрофона, но не является медицинским прибором и не должен читаться без учёта quality, confidence и условий съёмки.',
  }));

  panel.appendChild(inner);
  overlay.appendChild(panel);
  return overlay;
}

function buildSection({ title, paragraphs = [], bullets = [], reference = '', cards = [] } = {}) {
  const section = createElement('div', 'guide-section');

  const titleEl = createElement('div', 'guide-section-title', { text: title });
  section.appendChild(titleEl);

  for (const paragraph of paragraphs) {
    section.appendChild(createElement('p', 'guide-section-text', { text: paragraph }));
  }

  if (cards.length) {
    const cardWrap = createElement('div', 'guide-status-grid');
    for (const card of cards) {
      const cardEl = createElement('div', 'guide-status-card');
      cardEl.innerHTML = `
        <div class="guide-status-head">
          <span class="guide-status-label">${card.label}</span>
          <span class="guide-status-title">${card.title}</span>
        </div>
        <div class="guide-status-text">${card.text}</div>
      `;
      cardWrap.appendChild(cardEl);
    }
    section.appendChild(cardWrap);
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
