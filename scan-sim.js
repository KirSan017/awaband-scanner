const SIMULATION_TOKENS = Object.freeze([
  'camera-denied',
  'mic-denied',
  'fake-camera',
  'fake-mic',
  'face-loss',
  'pulse-weak',
]);

export function normalizeSimulationTokens(value = '') {
  const seen = new Set();

  return `${value}`
    .split(/[+, ]+/)
    .map((token) => token.trim().toLowerCase())
    .filter((token) => SIMULATION_TOKENS.includes(token))
    .filter((token) => {
      if (seen.has(token)) return false;
      seen.add(token);
      return true;
    });
}

export function parseSimulationSearch(search = '') {
  const normalizedSearch = `${search}`.startsWith('?') ? `${search}` : `?${search}`;
  const params = new URLSearchParams(normalizedSearch);
  return normalizeSimulationTokens(params.get('sim') || '');
}

export function createSimulationDescriptor(search = '') {
  const tokens = parseSimulationSearch(search);
  const tokenSet = new Set(tokens);

  return Object.freeze({
    active: tokens.length > 0,
    tokens,
    label: tokens.length ? tokens.join('+') : 'off',
    cameraDenied: tokenSet.has('camera-denied'),
    microphoneDenied: tokenSet.has('mic-denied'),
    fakeCamera: tokenSet.has('fake-camera'),
    fakeMicrophone: tokenSet.has('fake-mic'),
    faceLoss: tokenSet.has('face-loss'),
    pulseWeak: tokenSet.has('pulse-weak'),
  });
}

export function installScanSimulation({
  locationRef = globalThis.location,
  navigatorRef = globalThis.navigator,
  windowRef = globalThis.window,
} = {}) {
  const simulation = createSimulationDescriptor(locationRef?.search || '');

  if (windowRef) {
    windowRef.__AWABAND_SIM__ = simulation;
  }

  const mediaDevices = navigatorRef?.mediaDevices;
  if (!simulation.active || !mediaDevices || typeof mediaDevices.getUserMedia !== 'function') {
    return simulation;
  }

  if (mediaDevices.__awabandSimState?.active) {
    return mediaDevices.__awabandSimState;
  }

  const originalGetUserMedia = mediaDevices.getUserMedia.bind(mediaDevices);
  const originalEnumerateDevices = typeof mediaDevices.enumerateDevices === 'function'
    ? mediaDevices.enumerateDevices.bind(mediaDevices)
    : null;

  mediaDevices.getUserMedia = async (constraints = {}) => {
    const wantsVideo = wantsMedia(constraints.video);
    const wantsAudio = wantsMedia(constraints.audio);
    const streams = [];

    if (wantsVideo && simulation.cameraDenied) {
      throw createDeniedError('Camera');
    }
    if (wantsAudio && simulation.microphoneDenied) {
      throw createDeniedError('Microphone');
    }

    try {
      if (wantsVideo) {
        streams.push(
          simulation.fakeCamera
            ? createFakeCameraStream(windowRef, simulation)
            : await originalGetUserMedia({ video: constraints.video, audio: false }),
        );
      }

      if (wantsAudio) {
        streams.push(
          simulation.fakeMicrophone
            ? createFakeMicrophoneStream(windowRef)
            : await originalGetUserMedia({ audio: constraints.audio, video: false }),
        );
      }
    } catch (error) {
      stopStreams(streams);
      throw error;
    }

    if (!streams.length) {
      return originalGetUserMedia(constraints);
    }

    return mergeStreams(windowRef, streams);
  };

  if (originalEnumerateDevices) {
    mediaDevices.enumerateDevices = async () => {
      const devices = await originalEnumerateDevices();
      const extras = [];

      if (simulation.fakeCamera) {
        extras.push(createFakeDevice('videoinput', 'Awaband Sim Camera', 'awaband-sim-video'));
      }
      if (simulation.fakeMicrophone) {
        extras.push(createFakeDevice('audioinput', 'Awaband Sim Microphone', 'awaband-sim-audio'));
      }

      return [...devices, ...extras];
    };
  }

  mediaDevices.__awabandSimState = simulation;
  return simulation;
}

function wantsMedia(value) {
  return value !== undefined && value !== null && value !== false;
}

function createDeniedError(label) {
  return new DOMException(`${label} denied by Awaband simulation`, 'NotAllowedError');
}

function mergeStreams(windowRef, streams) {
  const merged = new windowRef.MediaStream();
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      merged.addTrack(track);
    }
  }
  return merged;
}

function stopStreams(streams) {
  for (const stream of streams) {
    for (const track of stream.getTracks()) {
      track.stop();
    }
  }
}

function createFakeDevice(kind, label, deviceId) {
  return {
    deviceId,
    kind,
    groupId: 'awaband-sim',
    label,
    toJSON() {
      return {
        deviceId,
        kind,
        groupId: 'awaband-sim',
        label,
      };
    },
  };
}

function createFakeCameraStream(windowRef, simulation) {
  const documentRef = windowRef?.document;
  const canvas = documentRef?.createElement?.('canvas');
  if (!canvas || typeof canvas.captureStream !== 'function') {
    throw new Error('Canvas captureStream is not available for fake camera simulation');
  }

  canvas.width = 640;
  canvas.height = 480;
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
  documentRef.body?.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  let frameId = null;
  let stopped = false;
  const startedAt = windowRef.performance?.now?.() ?? Date.now();

  const renderFrame = (now) => {
    if (stopped) return;
    const elapsedMs = (now ?? Date.now()) - startedAt;
    drawFakeCameraFrame(ctx, canvas.width, canvas.height, elapsedMs, simulation);
    frameId = windowRef.requestAnimationFrame(renderFrame);
  };

  renderFrame(startedAt);

  const stream = canvas.captureStream(30);
  const originalStops = stream.getTracks().map((track) => track.stop.bind(track));
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    if (frameId !== null) {
      windowRef.cancelAnimationFrame(frameId);
    }
    originalStops.forEach((stop) => stop());
    canvas.remove();
  };

  stream.getTracks().forEach((track) => {
    track.stop = cleanup;
  });

  return stream;
}

function drawFakeCameraFrame(ctx, width, height, elapsedMs, simulation) {
  const t = elapsedMs / 1000;
  const pulse = Math.sin(t * Math.PI * 2 * 1.2);
  const bob = Math.sin(t * 1.7) * 4;
  const drift = Math.sin(t * 0.45) * 10;
  const hideFace = simulation.faceLoss && (elapsedMs % 12000) > 7000;
  const pulseGain = simulation.pulseWeak ? 1.4 : 4.2;
  const faceX = width * 0.5 + drift;
  const faceY = height * 0.46 + bob;
  const faceWidth = 215;
  const faceHeight = 265;
  const faceColor = {
    r: clamp(198 + pulse * pulseGain),
    g: clamp(156 + pulse * pulseGain * 1.8),
    b: clamp(138 + pulse * 0.8),
  };

  ctx.clearRect(0, 0, width, height);
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#0a1119');
  bg.addColorStop(1, '#04070d');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = 'rgba(13, 34, 46, 0.28)';
  for (let i = 0; i < 7; i += 1) {
    ctx.fillRect(0, i * 70 + ((elapsedMs / 45) % 70), width, 1);
  }

  if (hideFace) {
    ctx.fillStyle = 'rgba(68, 133, 168, 0.12)';
    ctx.beginPath();
    ctx.arc(width * 0.5, height * 0.55, 82, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  ctx.save();
  ctx.translate(0, bob);

  ctx.fillStyle = 'rgba(18, 26, 34, 0.6)';
  ctx.beginPath();
  ctx.ellipse(faceX, faceY + 185, 132, 74, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgb(${faceColor.r}, ${faceColor.g}, ${faceColor.b})`;
  ctx.beginPath();
  ctx.ellipse(faceX, faceY, faceWidth / 2, faceHeight / 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = `rgba(${clamp(faceColor.r + 8)}, ${clamp(faceColor.g + 10)}, ${clamp(faceColor.b + 6)}, 0.92)`;
  ctx.beginPath();
  ctx.ellipse(faceX, faceY - 46, 60, 34, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(32, 40, 52, 0.82)';
  ctx.beginPath();
  ctx.arc(faceX - 38, faceY - 10, 10, 0, Math.PI * 2);
  ctx.arc(faceX + 38, faceY - 10, 10, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(110, 64, 64, 0.6)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(faceX, faceY + 44, 24, 0.15 * Math.PI, 0.85 * Math.PI);
  ctx.stroke();

  ctx.restore();
}

function createFakeMicrophoneStream(windowRef) {
  const AudioContextCtor = windowRef?.AudioContext || windowRef?.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error('AudioContext is not available for fake microphone simulation');
  }

  const audioCtx = new AudioContextCtor();
  const destination = audioCtx.createMediaStreamDestination();
  const primary = audioCtx.createOscillator();
  const harmonic = audioCtx.createOscillator();
  const lfo = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const harmonicGain = audioCtx.createGain();
  const lfoGain = audioCtx.createGain();

  primary.type = 'sine';
  primary.frequency.value = 182;
  harmonic.type = 'triangle';
  harmonic.frequency.value = 364;
  lfo.type = 'sine';
  lfo.frequency.value = 1.8;

  gain.gain.value = 0.08;
  harmonicGain.gain.value = 0.025;
  lfoGain.gain.value = 0.02;

  lfo.connect(lfoGain).connect(gain.gain);
  primary.connect(gain);
  harmonic.connect(harmonicGain);
  gain.connect(destination);
  harmonicGain.connect(destination);

  primary.start();
  harmonic.start();
  lfo.start();

  const stream = destination.stream;
  const originalStops = stream.getTracks().map((track) => track.stop.bind(track));
  let stopped = false;
  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    try {
      primary.stop();
      harmonic.stop();
      lfo.stop();
    } catch {
      // Oscillators may already be stopped by browser cleanup.
    }
    originalStops.forEach((stop) => stop());
    Promise.resolve(audioCtx.close()).catch(() => {});
  };

  stream.getTracks().forEach((track) => {
    track.stop = cleanup;
  });

  return stream;
}

function clamp(value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}
