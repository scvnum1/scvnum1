const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EVENT_TYPES = new Set([
  'page_view',
  'game_started',
  'quiz_completed',
  'location_completed',
  'runtime_error',
]);
const DIFFICULTIES = new Set(['novice', 'explorer', 'keeper']);
const ERROR_TYPES = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']);
const STAGE_LABELS = {
  prologue: 'Пролог: Кладовка',
  scriptorium: 'Скрипторий',
  birch_grove: 'Берёзовая роща',
  church: 'Церковь Кириллицы',
  courtyard: 'Монастырский двор',
  bell_tower: 'Колокольня',
  market: 'Торговая площадь',
  river_dock: 'Речная пристань',
};
const ACT_LABELS = {
  act1: 'Акт I: Древняя Русь',
  act2: 'Акт II: Печатный век',
  act3: 'Акт III: Золотой век литературы',
  act4: 'Акт IV: Язык народов и диалекты',
  act5: 'Акт V: Современность',
};
const DASHBOARD_EVENT_LABELS = {
  page_view: 'Просмотр сайта',
  game_started: 'Запуск игры',
  quiz_completed: 'Викторина',
  location_completed: 'Этап пройден',
  runtime_error: 'Ошибка',
};
const ERROR_LABELS = {
  Error: 'Ошибка',
  TypeError: 'Ошибка типа',
  ReferenceError: 'Ошибка ссылки',
  SyntaxError: 'Ошибка синтаксиса',
  RangeError: 'Ошибка диапазона',
};
const DIFFICULTY_LABELS = {
  novice: 'Новичок',
  explorer: 'Исследователь',
  keeper: 'Хранитель',
};
const DEVICE_LABELS = {
  desktop: 'Компьютер',
  mobile: 'Телефон',
  tablet: 'Планшет',
};
const DASHBOARD_KEYBOARD = {
  inline_keyboard: [
    [
      { text: '📊 Сводка', callback_data: 'scv:overview' },
      { text: '🟢 Онлайн', callback_data: 'scv:online' },
    ],
    [
      { text: '🗺 Этапы', callback_data: 'scv:stages' },
      { text: '🎚 Сложность', callback_data: 'scv:difficulty' },
    ],
    [
      { text: '👥 Игроки', callback_data: 'scv:users' },
      { text: '⚠️ Ошибки', callback_data: 'scv:errors' },
    ],
    [{ text: '🔄 Обновить', callback_data: 'scv:overview' }],
  ],
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  if (!origin || origin !== env.ALLOWED_ORIGIN) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function safeMetadata(type, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const result = {};

  const normalizeString = (value, allowedValues, maxLength) => {
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.length > maxLength) return null;
    if (allowedValues && !allowedValues.has(text)) return null;
    return text;
  };

  if (type === 'heartbeat') {
    if (!['landing', 'game'].includes(raw.page)) return null;
    if (raw.act_id != null && !/^prologue$|^act[1-5]$/.test(raw.act_id)) return null;
    if (raw.location_id != null && !/^[a-z0-9_-]{1,64}$/i.test(raw.location_id)) return null;
    result.page = raw.page;
    result.act_id = raw.act_id || null;
    result.location_id = raw.location_id || null;
  } else if (type === 'page_view') {
    if (!['landing', 'game'].includes(raw.page)) return null;
    result.page = raw.page;
  } else if (type === 'game_started') {
    if (!DIFFICULTIES.has(raw.difficulty)) return null;
    result.difficulty = raw.difficulty;
  } else if (type === 'quiz_completed') {
    if (typeof raw.quiz_id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(raw.quiz_id)) return null;
    if (!Number.isInteger(raw.score) || raw.score < 0 || raw.score > 10000) return null;
    result.quiz_id = raw.quiz_id;
    result.score = raw.score;
  } else if (type === 'location_completed') {
    if (typeof raw.location_id !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(raw.location_id)) return null;
    result.location_id = raw.location_id;
  } else if (type === 'runtime_error') {
    if (!ERROR_TYPES.has(raw.error_type)) return null;
    result.error_type = raw.error_type;
  }

  const deviceType = normalizeString(raw.device_type, new Set(['desktop', 'mobile', 'tablet']), 32);
  const platformName = normalizeString(raw.platform_name, null, 64);
  const browserName = normalizeString(raw.browser_name, null, 64);
  if (deviceType) result.device_type = deviceType;
  if (platformName) result.platform_name = platformName;
  if (browserName) result.browser_name = browserName;

  return result;
}

async function readJson(request, maxBytes) {
  const contentLength = Number(request.headers.get('Content-Length') || 0);
  if (contentLength > maxBytes) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > maxBytes) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    console.warn('Rejected malformed JSON request:', error instanceof Error ? error.name : 'parse error');
    return null;
  }
}

async function sendTelegram(env, text, keyboard = null) {
  return Boolean(await telegramApi(env, 'sendMessage', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    text,
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  }));
}

function russianCount(value, forms) {
  const count = Math.abs(Number(value) || 0);
  const lastTwo = count % 100;
  const last = count % 10;
  const form = lastTwo >= 11 && lastTwo <= 14 ? forms[2]
    : last === 1 ? forms[0]
      : last >= 2 && last <= 4 ? forms[1]
        : forms[2];
  return `${value} ${form}`;
}

function deviceLabel(deviceType) {
  return DEVICE_LABELS[deviceType] || 'Неизвестное устройство';
}

function formatDeviceSummary(devices) {
  const counts = new Map(devices.results.map(item => [item.device_type || 'unknown', item.visitors]));
  return [
    `${russianCount(counts.get('desktop') || 0, ['компьютер', 'компьютера', 'компьютеров'])}`,
    `${russianCount(counts.get('mobile') || 0, ['телефон', 'телефона', 'телефонов'])}`,
    `${russianCount(counts.get('tablet') || 0, ['планшет', 'планшета', 'планшетов'])}`,
    ...(counts.has('unknown') ? [`${russianCount(counts.get('unknown'), ['устройство', 'устройства', 'устройств'])} не определено`] : []),
  ].join(', ');
}

async function dashboardTemplatePng(env, filename, values, layout = 'overview', title = '') {
  if (!env.ASSETS) throw new Error('Dashboard assets binding is not configured.');
  const [response, fontResponse, fontDataResponse] = await Promise.all([
    env.ASSETS.fetch(new Request(`https://assets/dashboard/${filename}`)),
    env.ASSETS.fetch(new Request('https://assets/dashboard/font-atlas.png')),
    env.ASSETS.fetch(new Request('https://assets/dashboard/font-atlas.json')),
  ]);
  if (!response.ok) throw new Error(`Dashboard template ${filename} could not be loaded: HTTP ${response.status}.`);
  if (!fontResponse.ok) throw new Error(`Dashboard font atlas could not be loaded: HTTP ${fontResponse.status}.`);
  if (!fontDataResponse.ok) throw new Error(`Dashboard font metrics could not be loaded: HTTP ${fontDataResponse.status}.`);
  const template = await decodePng(new Uint8Array(await response.arrayBuffer()));
  if (template.width !== 1448 || template.height !== 1086 || template.channels !== 3) {
    throw new Error(`Dashboard template ${filename} must be 1448x1086 RGB PNG.`);
  }
  const fontData = await fontDataResponse.json();
  const fontAtlas = await decodePng(new Uint8Array(await fontResponse.arrayBuffer()));
  if (fontAtlas.width !== fontData.width || fontAtlas.height !== fontData.height || fontAtlas.channels !== 4) {
    throw new Error('Dashboard font atlas dimensions or color format are invalid.');
  }
  const drawText = (value, x, centerY, maxWidth, maxHeight, color, align = 'left') => {
    const text = String(value || '').toUpperCase();
    const glyphs = Array.from(text, character => fontData.glyphs[character] || fontData.glyphs['?']);
    const textWidth = glyphs.reduce((width, glyph) => width + glyph.advance, 0);
    const scale = Math.min(maxHeight / (fontData.ascent + fontData.descent), maxWidth / Math.max(1, textWidth));
    let cursor = align === 'left' ? x : Math.round(x - textWidth * scale / 2);
    const baseline = centerY + ((fontData.ascent - fontData.descent) / 2) * scale;

    glyphs.forEach(glyph => {
      if (glyph.width && glyph.height) {
        const drawX = cursor + glyph.offsetX * scale;
        const drawY = baseline + glyph.offsetY * scale;
        const width = Math.max(1, Math.ceil(glyph.width * scale));
        const height = Math.max(1, Math.ceil(glyph.height * scale));
        for (let py = 0; py < height; py += 1) {
          const sampleY = Math.max(0, Math.min(glyph.height - 1, (py + 0.5) * glyph.height / height - 0.5));
          const sourceY0 = Math.floor(sampleY);
          const sourceY1 = Math.min(glyph.height - 1, sourceY0 + 1);
          const weightY = sampleY - sourceY0;
          const targetY = Math.floor(drawY + py);
          if (targetY < 0 || targetY >= template.height) continue;
          for (let px = 0; px < width; px += 1) {
            const sampleX = Math.max(0, Math.min(glyph.width - 1, (px + 0.5) * glyph.width / width - 0.5));
            const sourceX0 = Math.floor(sampleX);
            const sourceX1 = Math.min(glyph.width - 1, sourceX0 + 1);
            const weightX = sampleX - sourceX0;
            const targetX = Math.floor(drawX + px);
            if (targetX < 0 || targetX >= template.width) continue;
            const alphaAt = (sourceX, sourceY) =>
              fontAtlas.pixels[((glyph.y + sourceY) * fontAtlas.width + glyph.x + sourceX) * 4 + 3] / 255;
            const topAlpha = alphaAt(sourceX0, sourceY0) * (1 - weightX) + alphaAt(sourceX1, sourceY0) * weightX;
            const bottomAlpha = alphaAt(sourceX0, sourceY1) * (1 - weightX) + alphaAt(sourceX1, sourceY1) * weightX;
            const alpha = topAlpha * (1 - weightY) + bottomAlpha * weightY;
            if (!alpha) continue;
            const targetIndex = (targetY * template.width + targetX) * 3;
            for (let channel = 0; channel < 3; channel += 1) {
              template.pixels[targetIndex + channel] = Math.round(
                color[channel] * alpha + template.pixels[targetIndex + channel] * (1 - alpha),
              );
            }
          }
        }
      }
      cursor += glyph.advance * scale;
    });
  };

  if (layout === 'overview') {
    const rowCenters = [259, 378, 500, 623, 745, 868];
    const labelColor = [40, 26, 14];
    const valueColor = [40, 26, 14];
    drawText(title, 724, 126, 1000, 62, [255, 221, 158], 'center');
    values.slice(0, rowCenters.length).forEach((row, index) => {
      drawText(row.label, 330, rowCenters[index] - (row.detail ? 12 : 0), 600, row.detail ? 31 : 42, labelColor);
      if (row.detail) drawText(row.detail, 330, rowCenters[index] + 21, 600, 22, [77, 58, 39]);
      drawText(row.value, 1000, rowCenters[index], 210, 48, valueColor, 'center');
    });
    return new Blob([await encodePng(encodeRaster(template), template.width, template.height)], { type: 'image/png' });
  }

  if (layout === 'users') {
    const rowCenters = [298, 446, 595, 744, 890];
    drawText(title, 724, 148, 1040, 58, [255, 221, 158], 'center');
    values.slice(0, rowCenters.length).forEach((row, index) => {
      const centerY = rowCenters[index];
      drawText(String(index + 1), 277, centerY, 55, 48, [72, 47, 27], 'center');
      drawText(row.label, 390, centerY - 18, 820, 34, [40, 26, 14]);
      drawText(row.detail, 390, centerY + 23, 820, 25, [77, 58, 39]);
    });
  } else if (layout === 'player') {
    const tileCenters = [
      [470, 311], [980, 311], [470, 456], [980, 456], [470, 601], [980, 601],
    ];
    drawText(title, 725, 132, 800, 52, [68, 46, 26], 'center');
    drawText(values.subtitle, 725, 176, 850, 32, [68, 46, 26], 'center');
    values.stats.forEach((stat, index) => {
      const [centerX, centerY] = tileCenters[index];
      drawText(stat.label, centerX, centerY - 17, 345, 26, [68, 46, 26], 'center');
      drawText(stat.value, centerX, centerY + 20, 345, 40, [40, 26, 14], 'center');
    });
    const eventCenters = [730, 798, 866, 934, 1002];
    values.events.forEach((event, index) => {
      drawText(event, 300, eventCenters[index], 1050, 29, [40, 26, 14]);
    });
  } else if (layout === 'stages') {
    drawText(title, 724, 126, 1000, 58, [255, 221, 158], 'center');
    const rowCenters = [257, 358, 459, 560, 660, 760, 861];
    const maxCompleted = Math.max(1, ...values.map(row => row.completed));
    values.slice(0, rowCenters.length).forEach((row, index) => {
      const centerY = rowCenters[index];
      drawText(String(row.completed), 300, centerY, 90, 40, [40, 26, 14], 'center');
      drawText(row.label, 705, centerY - 18, 640, 28, [40, 26, 14], 'center');
      drawText(String(row.online), 1134, centerY, 90, 40, [40, 26, 14], 'center');
      const width = row.completed ? Math.max(5, Math.round((row.completed / maxCompleted) * 652)) : 0;
      if (width) fillRasterRect(template, 379, centerY + 17, width, 7, [161, 104, 41]);
    });
  }

  return new Blob([await encodePng(encodeRaster(template), template.width, template.height)], { type: 'image/png' });
}

function fillRasterRect(image, x, y, width, height, color) {
  const left = Math.max(0, Math.floor(x));
  const top = Math.max(0, Math.floor(y));
  const right = Math.min(image.width, Math.ceil(x + width));
  const bottom = Math.min(image.height, Math.ceil(y + height));
  const row = new Uint8Array((right - left) * image.channels);
  for (let pixel = 0; pixel < right - left; pixel += 1) row.set(color, pixel * image.channels);
  for (let py = top; py < bottom; py += 1) {
    image.pixels.set(row, (py * image.width + left) * image.channels);
  }
}

function paethPredictor(left, above, upperLeft) {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= aboveDistance && leftDistance <= upperLeftDistance) return left;
  if (aboveDistance <= upperLeftDistance) return above;
  return upperLeft;
}

async function decodePng(bytes) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('Dashboard template is not a PNG file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const compressedParts = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    if (offset + length + 12 > bytes.length) throw new Error('Dashboard template has a truncated PNG chunk.');
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      bitDepth = data[8];
      colorType = data[9];
      if (data[10] !== 0 || data[11] !== 0 || data[12] !== 0) {
        throw new Error('Dashboard template uses an unsupported PNG encoding.');
      }
    } else if (type === 'IDAT') {
      compressedParts.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += length + 12;
  }
  if (!width || !height || bitDepth !== 8 || ![2, 6].includes(colorType) || !compressedParts.length) {
    throw new Error('Dashboard template must be an 8-bit RGB or RGBA PNG.');
  }

  const channels = colorType === 6 ? 4 : 3;
  const compressedLength = compressedParts.reduce((sum, part) => sum + part.length, 0);
  const compressed = new Uint8Array(compressedLength);
  let compressedOffset = 0;
  for (const part of compressedParts) {
    compressed.set(part, compressedOffset);
    compressedOffset += part.length;
  }
  const decompressed = new Uint8Array(await new Response(
    new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate')),
  ).arrayBuffer());
  const stride = width * channels;
  if (decompressed.length !== (stride + 1) * height) throw new Error('Dashboard template PNG pixel data has an unexpected size.');

  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y += 1) {
    const filter = decompressed[y * (stride + 1)];
    const inputOffset = y * (stride + 1) + 1;
    const rowOffset = y * stride;
    const previousOffset = rowOffset - stride;
    if (filter > 4) throw new Error(`Dashboard template uses unsupported PNG filter ${filter}.`);
    for (let x = 0; x < stride; x += 1) {
      const raw = decompressed[inputOffset + x];
      const left = x >= channels ? pixels[rowOffset + x - channels] : 0;
      const above = y > 0 ? pixels[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[previousOffset + x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = above;
      else if (filter === 3) predictor = Math.floor((left + above) / 2);
      else if (filter === 4) predictor = paethPredictor(left, above, upperLeft);
      pixels[rowOffset + x] = (raw + predictor) & 0xff;
    }
  }
  return { width, height, channels, pixels };
}

function encodeRaster(image) {
  const stride = image.width * image.channels;
  const scanlines = new Uint8Array((stride + 1) * image.height);
  for (let y = 0; y < image.height; y += 1) {
    const offset = y * (stride + 1);
    scanlines[offset] = 0;
    scanlines.set(image.pixels.subarray(y * stride, (y + 1) * stride), offset + 1);
  }
  return scanlines;
}

async function encodePng(scanlines, width, height) {
  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const crcTable = new Uint32Array(256);
  for (let index = 0; index < crcTable.length; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ (0xedb88320 & -(value & 1));
    }
    crcTable[index] = value >>> 0;
  }
  const header = new Uint8Array(13);
  const headerView = new DataView(header.buffer);
  headerView.setUint32(0, width);
  headerView.setUint32(4, height);
  header[8] = 8;
  header[9] = 2;

  const chunk = (name, data) => {
    const type = new TextEncoder().encode(name);
    const output = new Uint8Array(data.length + 12);
    const view = new DataView(output.buffer);
    view.setUint32(0, data.length);
    output.set(type, 4);
    output.set(data, 8);
    let crc = 0xffffffff;
    for (let index = 4; index < data.length + 8; index += 1) {
      crc = crcTable[(crc ^ output[index]) & 0xff] ^ (crc >>> 8);
    }
    view.setUint32(data.length + 8, (crc ^ 0xffffffff) >>> 0);
    return output;
  };
  const concatenate = parts => {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const result = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      result.set(part, offset);
      offset += part.length;
    }
    return result;
  };
  const compressed = new Blob([scanlines]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Response(compressed).arrayBuffer().then(data =>
    concatenate([signature, chunk('IHDR', header), chunk('IDAT', new Uint8Array(data)), chunk('IEND', new Uint8Array())]),
  );
}

async function sendDashboardPhoto(env, png, caption, keyboard) {
  const form = new FormData();
  form.set('chat_id', env.TELEGRAM_ADMIN_ID);
  form.set('photo', png, 'scv-dashboard.png');
  form.set('caption', caption.slice(0, 1000));
  form.set('reply_markup', JSON.stringify(keyboard));
  return telegramApi(env, 'sendPhoto', form);
}

async function editDashboardPhoto(env, messageId, png, caption, keyboard) {
  const form = new FormData();
  form.set('chat_id', env.TELEGRAM_ADMIN_ID);
  form.set('message_id', String(messageId));
  form.set('media', JSON.stringify({
    type: 'photo',
    media: 'attach://scv-dashboard.png',
    caption: caption.slice(0, 1000),
  }));
  form.set('reply_markup', JSON.stringify(keyboard));
  form.set('scv-dashboard.png', png, 'scv-dashboard.png');
  return telegramApi(env, 'editMessageMedia', form);
}

async function telegramApi(env, method, payload) {
  const isForm = payload instanceof FormData;
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: isForm ? {} : { 'Content-Type': 'application/json' },
    body: isForm ? payload : JSON.stringify(payload),
  });
  const body = await response.json();
  const result = body && typeof body === 'object' ? body : {};
  if (!result.ok) {
    console.error('Telegram API call failed:', {
      method,
      httpStatus: response.status,
      errorCode: result.error_code || null,
      description: typeof result.description === 'string' ? result.description.slice(0, 300) : 'No error description returned.',
    });
    return false;
  }
  return result;
}

async function deliverGameStartNotification(env, sessionId) {
  const notification = await env.DB.prepare(
    `SELECT visitor_id, difficulty FROM telegram_notifications
     WHERE session_id = ? AND status = 'pending'`,
  ).bind(sessionId).first();
  if (!notification) return true;

  const claim = await env.DB.prepare(
    `UPDATE telegram_notifications
     SET status = 'sending', attempts = attempts + 1, last_attempt = ?
     WHERE session_id = ? AND status = 'pending'`,
  ).bind(new Date().toISOString(), sessionId).run();
  if (!claim.meta?.changes) return false;

  const now = new Date().toISOString();
  let sent = false;
  try {
    sent = await sendTelegram(
      env,
      `Новый запуск игры\nИгрок: ${notification.visitor_id.slice(0, 8)}\nСложность: ${DIFFICULTY_LABELS[notification.difficulty] || 'не выбрана'}\nВремя UTC: ${now}`,
    );
  } catch (error) {
    console.error('Telegram notification request failed:', error instanceof Error ? error.name : 'unknown error');
  }
  await env.DB.prepare(
    `UPDATE telegram_notifications SET status = ?
     WHERE session_id = ? AND status = 'sending'`,
  ).bind(sent ? 'sent' : 'pending', sessionId).run();
  return sent;
}

async function handleEvent(request, env) {
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: 'origin_not_allowed' }, 403);

  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  const payload = await readJson(request, 2048);
  if (!payload
    || typeof payload.event_id !== 'string'
    || !UUID_PATTERN.test(payload.event_id)
    || typeof payload.visitor_id !== 'string'
    || !UUID_PATTERN.test(payload.visitor_id)
    || typeof payload.session_id !== 'string'
    || !UUID_PATTERN.test(payload.session_id)
    || (!EVENT_TYPES.has(payload.type) && payload.type !== 'heartbeat')) {
    return json({ error: 'invalid_event' }, 400, headers);
  }

  const metadata = safeMetadata(payload.type, payload.metadata);
  if (!metadata) return json({ error: 'invalid_metadata' }, 400, headers);

  const now = new Date().toISOString();
  const visitorId = payload.visitor_id.toLowerCase();
  const sessionId = payload.session_id.toLowerCase();
  const eventId = payload.event_id.toLowerCase();

  if (payload.type === 'heartbeat') {
    const existingSession = await env.DB.prepare(
      `SELECT last_seen, current_page, current_act, current_location
       FROM sessions WHERE session_id = ? AND visitor_id = ?`,
    ).bind(sessionId, visitorId).first();
    if (existingSession
      && existingSession.current_page === metadata.page
      && existingSession.current_act === metadata.act_id
      && existingSession.current_location === metadata.location_id
      && Date.now() - Date.parse(existingSession.last_seen) < 45000) {
      return json({ ok: true, throttled: true }, 200, headers);
    }
  }

  const recent = await env.DB.prepare(
    `SELECT COUNT(*) AS count FROM events
     WHERE visitor_id = ? AND datetime(created_at) >= datetime('now', '-1 minute')`,
  ).bind(visitorId).first();
  if (recent && recent.count >= 60) return json({ error: 'rate_limited' }, 429, headers);

  const deviceType = metadata.device_type || null;
  const platformName = metadata.platform_name || null;
  const browserName = metadata.browser_name || null;

  await env.DB.prepare(
    `INSERT INTO visitors(visitor_id, first_seen, last_seen, device_type, platform_name, browser_name)
     VALUES(?, ?, ?, ?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET
       last_seen = excluded.last_seen,
       device_type = COALESCE(excluded.device_type, visitors.device_type),
       platform_name = COALESCE(excluded.platform_name, visitors.platform_name),
       browser_name = COALESCE(excluded.browser_name, visitors.browser_name)`,
  ).bind(visitorId, now, now, deviceType, platformName, browserName).run();

  await env.DB.prepare(
    `INSERT INTO sessions(session_id, visitor_id, started_at, last_seen)
     VALUES(?, ?, ?, ?)
     ON CONFLICT(session_id) DO UPDATE SET last_seen = excluded.last_seen`,
  ).bind(sessionId, visitorId, now, now).run();

  if (payload.type === 'heartbeat') {
    await env.DB.prepare(
      `UPDATE sessions SET current_page = ?, current_act = ?, current_location = ?
       WHERE session_id = ? AND visitor_id = ?`,
    ).bind(metadata.page, metadata.act_id, metadata.location_id, sessionId, visitorId).run();
    return json({ ok: true }, 200, headers);
  }

  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO events(event_id, visitor_id, session_id, event_type, created_at, metadata_json)
     VALUES(?, ?, ?, ?, ?, ?)`,
  ).bind(eventId, visitorId, sessionId, payload.type, now, JSON.stringify(metadata)).run();

  if (!inserted.meta?.changes) {
    if (payload.type === 'game_started') {
      await env.DB.prepare(
        `INSERT OR IGNORE INTO telegram_notifications
         (session_id, visitor_id, difficulty, created_at)
         VALUES(?, ?, ?, ?)`,
      ).bind(sessionId, visitorId, metadata.difficulty, now).run();
      await deliverGameStartNotification(env, sessionId);
    }
    return json({ ok: true, duplicate: true }, 200, headers);
  }

  const counters = {
    page_view: ['page_views', 1],
    game_started: ['game_starts', 1],
    quiz_completed: ['quizzes_completed', 1],
    location_completed: ['locations_completed', 1],
    runtime_error: ['runtime_errors', 1],
  };
  const [counter, increment] = counters[payload.type];
  await env.DB.prepare(
    `UPDATE visitors SET ${counter} = ${counter} + ?,
       max_score = MAX(max_score, ?), last_seen = ? WHERE visitor_id = ?`,
  ).bind(increment, metadata.score || 0, now, visitorId).run();
  await env.DB.prepare(
    `UPDATE sessions SET ${counter} = ${counter} + ?,
       max_score = MAX(max_score, ?), last_seen = ?,
       difficulty = COALESCE(?, difficulty)
     WHERE session_id = ? AND visitor_id = ?`,
  ).bind(
    increment,
    metadata.score || 0,
    now,
    metadata.difficulty || null,
    sessionId,
    visitorId,
  ).run();
  if (payload.type === 'page_view') {
    await env.DB.prepare(
      `UPDATE sessions SET current_page = ? WHERE session_id = ? AND visitor_id = ?`,
    ).bind(metadata.page, sessionId, visitorId).run();
  }

  if (payload.type === 'game_started') {
    await env.DB.prepare(
      'UPDATE sessions SET game_started = 1 WHERE session_id = ? AND visitor_id = ?',
    ).bind(sessionId, visitorId).run();
    await env.DB.prepare(
      `INSERT OR IGNORE INTO telegram_notifications
       (session_id, visitor_id, difficulty, created_at)
       VALUES(?, ?, ?, ?)`,
    ).bind(sessionId, visitorId, metadata.difficulty, now).run();
    const sent = await deliverGameStartNotification(env, sessionId);
    return json({ ok: true, notification_sent: sent }, 200, headers);
  }

  return json({ ok: true }, 200, headers);
}

async function handleForget(request, env) {
  const headers = corsHeaders(request, env);
  if (!headers) return json({ error: 'origin_not_allowed' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, headers);

  const payload = await readJson(request, 256);
  if (!payload || typeof payload.visitor_id !== 'string' || !UUID_PATTERN.test(payload.visitor_id)) {
    return json({ error: 'invalid_request' }, 400, headers);
  }

  const visitorId = payload.visitor_id.toLowerCase();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE visitor_id = ?').bind(visitorId),
    env.DB.prepare('DELETE FROM telegram_notifications WHERE visitor_id = ?').bind(visitorId),
    env.DB.prepare('DELETE FROM sessions WHERE visitor_id = ?').bind(visitorId),
    env.DB.prepare('DELETE FROM visitors WHERE visitor_id = ?').bind(visitorId),
  ]);
  return json({ ok: true }, 200, headers);
}

function formatStage(actId, locationId) {
  if (!locationId) return 'не выбран';
  const label = STAGE_LABELS[locationId] || 'Другое место';
  if (actId === 'prologue' || locationId === 'prologue') return label;
  return `${ACT_LABELS[actId] || 'Акт не указан'} · ${label}`;
}

function dashboardKeyboard(view, page = 0, users = [], hasNextPage = false, visitorId = null, eventPage = 0, hasNextEvents = false) {
  if (view === 'users') {
    const userButtons = users.map(user => [{
      text: `${user.device_type === 'mobile' ? '📱' : user.device_type === 'tablet' ? '📟' : '🖥'} ${deviceLabel(user.device_type)} · ${user.browser_name || 'браузер'} · ${user.visitor_id.slice(0, 8)}`.slice(0, 60),
      callback_data: `scv:user:${user.visitor_id}:${page}:0`,
    }]);
    const navigation = [];
    if (page > 0) navigation.push({ text: '⬅️ Назад', callback_data: `scv:users:${page - 1}` });
    if (hasNextPage) navigation.push({ text: 'Дальше ➡️', callback_data: `scv:users:${page + 1}` });
    return {
      inline_keyboard: [
        ...userButtons,
        ...(navigation.length ? [navigation] : []),
        [{ text: '↩️ Главное меню', callback_data: 'scv:overview' }],
      ],
    };
  }
  if (view === 'user') {
    const eventNavigation = [];
    if (eventPage > 0) {
      eventNavigation.push({
        text: '⬅️ Раньше',
        callback_data: `scv:user:${visitorId}:${page}:${eventPage - 1}`,
      });
    }
    if (hasNextEvents) {
      eventNavigation.push({
        text: 'Позже ➡️',
        callback_data: `scv:user:${visitorId}:${page}:${eventPage + 1}`,
      });
    }
    return {
      inline_keyboard: [
        ...(eventNavigation.length ? [eventNavigation] : []),
        [{ text: '⬅️ К списку игроков', callback_data: `scv:users:${page}` }],
        [{ text: '↩️ Главное меню', callback_data: 'scv:overview' }],
      ],
    };
  }
  return DASHBOARD_KEYBOARD;
}

async function renderDashboard(env, view, page = 0, visitorId = null, eventPage = 0) {
  let title = 'Сводка';
  let subtitle = 'Статистика сайта и игры';
  let caption = '';
  let rows = [];
  let png = null;
  let users = [];
  let currentPage = page;
  let hasNextPage = false;
  let hasNextEvents = false;

  if (view === 'online') {
    const [active, { results }] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT visitor_id) AS players, COUNT(*) AS sessions,
         COUNT(DISTINCT CASE WHEN current_page = 'game' THEN visitor_id END) AS in_game
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')`,
      ).first(),
      env.DB.prepare(
        `SELECT visitor_id, current_page, current_act, current_location, difficulty
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')
         ORDER BY last_seen DESC LIMIT 6`,
      ).all(),
    ]);
    title = 'Сейчас онлайн';
    subtitle = 'Активность за последние две минуты';
    caption = `🟢 Сейчас онлайн ${russianCount(active.players, ['игрок', 'игрока', 'игроков'])} в ${russianCount(active.sessions, ['вкладке', 'вкладках', 'вкладках'])}; в игре ${russianCount(active.in_game, ['игрок', 'игрока', 'игроков'])}. Активность определяется по сигналам открытых вкладок.`;
    rows = results.map(session => ({
      label: `Игрок ${session.visitor_id.slice(0, 8)}`,
      value: session.current_page === 'game' ? 'В игре' : 'На сайте',
      detail: `${STAGE_LABELS[session.current_location] || 'Этап не выбран'} · ${DIFFICULTY_LABELS[session.difficulty] || ''}`,
    }));
    if (!rows.length) rows = [{ label: 'Сейчас никто не играет', value: String(active.players), detail: 'Нет активных вкладок' }];
    png = await dashboardTemplatePng(env, 'overview.png', rows, 'overview', title);
  } else if (view === 'stages') {
    const [active, completed] = await Promise.all([
      env.DB.prepare(
        `SELECT current_location, COUNT(DISTINCT visitor_id) AS players
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')
         AND current_location IS NOT NULL GROUP BY current_location`,
      ).all(),
      env.DB.prepare(
        `SELECT json_extract(metadata_json, '$.location_id') AS location_id, COUNT(*) AS completed
         FROM events WHERE event_type = 'location_completed'
         GROUP BY json_extract(metadata_json, '$.location_id')`,
      ).all(),
    ]);
    const activeByStage = new Map(active.results.map(row => [row.current_location, row.players]));
    const completedByStage = new Map(completed.results.map(row => [row.location_id, row.completed]));
    const stageGroups = [
      { ids: ['prologue', 'scriptorium'], label: 'Пролог и Скрипторий' },
      { ids: ['birch_grove'], label: STAGE_LABELS.birch_grove },
      { ids: ['church'], label: STAGE_LABELS.church },
      { ids: ['courtyard'], label: STAGE_LABELS.courtyard },
      { ids: ['bell_tower'], label: STAGE_LABELS.bell_tower },
      { ids: ['market'], label: STAGE_LABELS.market },
      { ids: ['river_dock'], label: STAGE_LABELS.river_dock },
    ];
    const stageStats = stageGroups.map(group => ({
      ...group,
      completed: group.ids.reduce((sum, id) => sum + (completedByStage.get(id) || 0), 0),
      online: group.ids.reduce((sum, id) => sum + (activeByStage.get(id) || 0), 0),
    }));
    title = 'Этапы игры';
    subtitle = 'Завершения и игроки онлайн';
    caption = [
      '🗺 Этапы игры: завершения — зарегистрированные прохождения; онлайн — браузеры, у которых сейчас открыт этап.',
      ...stageStats.map(stage =>
        `${stage.label}: завершили ${stage.completed}, сейчас онлайн ${stage.online}`,
      ),
      'В шаблоне семь строк: Пролог и Скрипторий объединены в одну.',
    ].join('\n');
    rows = stageStats.map(stage => ({
      label: stage.label,
      value: `Пройдено: ${stage.completed}`,
      detail: `Онлайн: ${stage.online}`,
    }));
    png = await dashboardTemplatePng(env, 'analytics.png', stageStats, 'stages', title);
  } else if (view === 'difficulty') {
    const [{ results }, active] = await Promise.all([
      env.DB.prepare(
        `SELECT difficulty, COUNT(*) AS sessions FROM sessions
         WHERE game_started = 1 GROUP BY difficulty`,
      ).all(),
      env.DB.prepare(
        `SELECT difficulty, COUNT(DISTINCT visitor_id) AS players FROM sessions
         WHERE game_started = 1 AND datetime(last_seen) >= datetime('now', '-2 minutes')
         GROUP BY difficulty`,
      ).all(),
    ]);
    const total = new Map(results.map(row => [row.difficulty, row.sessions]));
    const online = new Map(active.results.map(row => [row.difficulty, row.players]));
    title = 'Уровни сложности';
    subtitle = 'Запуски игры и игроки онлайн';
    caption = '🎚 Выбор сложности: число запусков и число игроков, которые сейчас находятся в игре на этом уровне.';
    rows = Object.entries(DIFFICULTY_LABELS).map(([id, label]) => ({
      label,
      value: `Запусков: ${total.get(id) || 0}`,
      detail: `Онлайн: ${online.get(id) || 0}`,
    }));
    png = await dashboardTemplatePng(env, 'overview.png', rows, 'overview', title);
  } else if (view === 'users') {
    const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM visitors').first();
    const pages = Math.max(1, Math.ceil(total.count / 5));
    currentPage = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
    hasNextPage = currentPage + 1 < pages;
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, device_type, browser_name, last_seen,
       game_starts, locations_completed
       FROM visitors ORDER BY last_seen DESC LIMIT 5 OFFSET ?`,
    ).bind(currentPage * 5).all();
    users = results;
    title = `Игроки · страница ${currentPage + 1} из ${pages}`;
    subtitle = `Всего ${russianCount(total.count, ['игрок', 'игрока', 'игроков'])}`;
    caption = total.count
      ? `👥 Браузеры ${currentPage * 5 + 1}–${currentPage * 5 + results.length} из ${total.count}. Нажми кнопку под изображением, чтобы открыть подробности игрока. Данные сортируются по последней активности.`
      : '👥 Пока нет зарегистрированных браузеров.';
    rows = results.map(user => ({
      label: `${deviceLabel(user.device_type)} · ${user.browser_name || 'браузер'}`,
      value: user.visitor_id.slice(0, 8),
      detail: `Запусков: ${user.game_starts} · этапов пройдено: ${user.locations_completed}`,
    }));
    if (!rows.length) rows = [{ label: 'Пока нет игроков', value: '0', detail: 'Ожидаем первый визит' }];
    png = await dashboardTemplatePng(env, 'users.png', rows, 'users', title);
  } else if (view === 'user') {
    const user = await env.DB.prepare(
      `SELECT visitor_id, first_seen, last_seen, device_type,
       browser_name, page_views, game_starts, quizzes_completed,
       locations_completed, runtime_errors, max_score
       FROM visitors WHERE visitor_id = ?`,
    ).bind(visitorId).first();
    if (!user) {
      title = 'Игрок не найден';
      subtitle = 'Профиль браузера больше недоступен';
      caption = 'Профиль игрока не найден или уже удалён.';
      rows = [{ label: 'ИГРОК', value: visitorId.slice(0, 8), detail: 'Нет данных' }];
      png = await dashboardTemplatePng(env, 'player.png', {
        subtitle: 'Профиль недоступен',
        stats: [
          { label: 'Страницы', value: '0' },
          { label: 'Запуски', value: '0' },
          { label: 'Викторины', value: '0' },
          { label: 'Этапы', value: '0' },
          { label: 'Ошибки', value: '0' },
          { label: 'Лучший счёт', value: '0' },
        ],
        events: ['Нет данных'],
      }, 'player', title);
    } else {
      const [sessions, eventCount] = await Promise.all([
        env.DB.prepare(
          `SELECT last_seen, game_started, difficulty, current_act, current_location
           FROM sessions WHERE visitor_id = ? ORDER BY last_seen DESC LIMIT 3`,
        ).bind(visitorId).all(),
        env.DB.prepare(
          'SELECT COUNT(*) AS count FROM events WHERE visitor_id = ?',
        ).bind(visitorId).first(),
      ]);
      const totalEvents = eventCount?.count || 0;
      const eventPages = Math.max(1, Math.ceil(totalEvents / 5));
      eventPage = Math.max(0, Math.min(Number.isInteger(eventPage) ? eventPage : 0, eventPages - 1));
      hasNextEvents = eventPage + 1 < eventPages;
      const events = await env.DB.prepare(
        `SELECT event_type, created_at, metadata_json FROM events
         WHERE visitor_id = ? ORDER BY created_at DESC LIMIT 5 OFFSET ?`,
      ).bind(visitorId, eventPage * 5).all();
      title = `Игрок ${visitorId.slice(0, 8)}`;
      subtitle = `${deviceLabel(user.device_type)} · ${user.browser_name || 'браузер'}`;
      caption = [
        `👤 Игрок ${visitorId.slice(0, 8)} · ${deviceLabel(user.device_type)} · ${user.browser_name || 'браузер не определён'}.`,
        `Первый визит: ${user.first_seen} UTC · последняя активность: ${user.last_seen} UTC.`,
        `${russianCount(user.page_views, ['просмотр страницы', 'просмотра страниц', 'просмотров страниц'])}, ${russianCount(user.game_starts, ['запуск игры', 'запуска игры', 'запусков игры'])}, ${russianCount(user.quizzes_completed, ['викторина', 'викторины', 'викторин'])}, ${russianCount(user.locations_completed, ['пройденный этап', 'пройденных этапа', 'пройденных этапов'])}, ${russianCount(user.runtime_errors, ['ошибка', 'ошибки', 'ошибок'])}, лучший счёт: ${user.max_score}.`,
        `История: страница ${eventPage + 1} из ${eventPages}. Последние сессии: ${sessions.results.map(session => `${DIFFICULTY_LABELS[session.difficulty] || 'сложность не выбрана'} · ${formatStage(session.current_act, session.current_location)} · ${session.last_seen} UTC`).join('; ') || 'нет'}.`,
      ].join('\n');
      const eventRows = events.results.map(event => {
        let metadata = {};
        try {
          metadata = JSON.parse(event.metadata_json);
        } catch (error) {
          console.warn('Skipping malformed event metadata in player dashboard:', error instanceof Error ? error.name : 'parse error');
        }
        const detail = STAGE_LABELS[metadata.location_id]
          || DIFFICULTY_LABELS[metadata.difficulty]
          || (metadata.quiz_id ? 'Задание' : '')
          || ERROR_LABELS[metadata.error_type]
          || '';
        return `${DASHBOARD_EVENT_LABELS[event.event_type] || 'Событие'} · ${detail} · ${event.created_at.slice(0, 16)}`;
      });
      const playerStats = [
        { label: 'Просмотры', value: String(user.page_views) },
        { label: 'Запуски игры', value: String(user.game_starts) },
        { label: 'Викторины', value: String(user.quizzes_completed) },
        { label: 'Этапы пройдены', value: String(user.locations_completed) },
        { label: 'Ошибки', value: String(user.runtime_errors) },
        { label: 'Лучший счёт', value: String(user.max_score) },
      ];
      rows = playerStats;
      png = await dashboardTemplatePng(env, 'player.png', {
        subtitle,
        stats: playerStats,
        events: eventRows.length ? eventRows : ['Событий пока нет'],
      }, 'player', title);
    }
  } else if (view === 'errors') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, created_at, metadata_json
       FROM events WHERE event_type = 'runtime_error'
       ORDER BY created_at DESC LIMIT 6`,
    ).all();
    title = 'Последние ошибки';
    subtitle = 'Сохраняются только тип и дата ошибки';
    caption = results.length ? '⚠️ Последние технические ошибки: сохраняются только тип ошибки, дата и анонимный ID браузера.' : 'Ошибок пока нет.';
    rows = results.map(row => {
      const metadata = JSON.parse(row.metadata_json);
      return {
        label: `Игрок ${row.visitor_id.slice(0, 8)}`,
        value: ERROR_LABELS[metadata.error_type] || 'Ошибка',
        detail: row.created_at.slice(0, 16),
      };
    });
    if (!rows.length) rows = [{ label: 'Ошибок нет', value: '0', detail: 'Новых ошибок не было' }];
    png = await dashboardTemplatePng(env, 'overview.png', rows, 'overview', title);
  } else {
    const [totals, sessions, active, recent, recentStarts, recentErrors, devices] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS users, COALESCE(SUM(page_views), 0) AS page_views,
         COALESCE(SUM(game_starts), 0) AS game_starts,
         COALESCE(SUM(quizzes_completed), 0) AS quizzes,
         COALESCE(SUM(locations_completed), 0) AS locations FROM visitors`,
      ).first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first(),
      env.DB.prepare(
        `SELECT COUNT(DISTINCT visitor_id) AS players, COUNT(*) AS sessions,
         COUNT(DISTINCT CASE WHEN current_page = 'game' THEN visitor_id END) AS in_game
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')`,
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS users FROM visitors
         WHERE datetime(last_seen) >= datetime('now', '-1 day')`,
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE event_type = 'game_started' AND datetime(created_at) >= datetime('now', '-1 day')`,
      ).first(),
      env.DB.prepare(
        `SELECT COUNT(*) AS count FROM events
         WHERE event_type = 'runtime_error' AND datetime(created_at) >= datetime('now', '-1 day')`,
      ).first(),
      env.DB.prepare(
        `SELECT device_type, COUNT(*) AS visitors
         FROM visitors GROUP BY device_type ORDER BY visitors DESC`,
      ).all(),
    ]);
    title = 'Сводка сайта';
    subtitle = 'Текущая активность и общая статистика';
    caption = [
      `📊 «Слово через века»: онлайн ${russianCount(active.players, ['браузер', 'браузера', 'браузеров'])} (${active.in_game} в игре), ${russianCount(active.sessions, ['активная вкладка', 'активные вкладки', 'активных вкладок'])}.`,
      `За 24 часа: ${russianCount(recent.users, ['посетитель', 'посетителя', 'посетителей'])}, ${russianCount(recentStarts.count, ['запуск игры', 'запуска игры', 'запусков игры'])}, ${russianCount(recentErrors.count, ['ошибка', 'ошибки', 'ошибок'])}.`,
      `Всего: ${russianCount(totals.users, ['браузер', 'браузера', 'браузеров'])}, ${russianCount(totals.page_views, ['просмотр', 'просмотра', 'просмотров'])}, ${russianCount(sessions.count, ['сессия', 'сессии', 'сессий'])}, ${russianCount(totals.game_starts, ['запуск игры', 'запуска игры', 'запусков игры'])}, ${russianCount(totals.quizzes, ['викторина', 'викторины', 'викторин'])}, ${russianCount(totals.locations, ['пройденный этап', 'пройденных этапа', 'пройденных этапов'])}.`,
      `Устройства: ${formatDeviceSummary(devices)}.`,
    ].join('\n');
    rows = [
      { label: 'Онлайн / в игре', value: `${active.players} / ${active.in_game}`, detail: russianCount(active.sessions, ['вкладка', 'вкладки', 'вкладок']) },
      { label: 'Посетители за сутки / всего', value: `${recent.users} / ${totals.users}` },
      { label: 'Просмотры / сессии', value: `${totals.page_views} / ${sessions.count}` },
      { label: 'Запуски за сутки / всего', value: `${recentStarts.count} / ${totals.game_starts}` },
      { label: 'Викторины / пройдено этапов', value: `${totals.quizzes} / ${totals.locations}` },
      { label: 'Ошибки за сутки', value: String(recentErrors.count) },
    ];
    png = await dashboardTemplatePng(env, 'overview.png', [
      { label: 'Онлайн / в игре', value: `${active.players} / ${active.in_game}`, detail: russianCount(active.sessions, ['вкладка', 'вкладки', 'вкладок']) },
      { label: 'Посетители за сутки / всего', value: `${recent.users} / ${totals.users}` },
      { label: 'Просмотры / сессии', value: `${totals.page_views} / ${sessions.count}` },
      { label: 'Запуски за сутки / всего', value: `${recentStarts.count} / ${totals.game_starts}` },
      { label: 'Викторины / пройдено этапов', value: `${totals.quizzes} / ${totals.locations}` },
      { label: 'Ошибки за сутки', value: String(recentErrors.count) },
    ], 'overview', title);
  }

  const keyboard = dashboardKeyboard(
    view,
    currentPage,
    users,
    hasNextPage,
    visitorId,
    eventPage,
    hasNextEvents,
  );
  if (!png) throw new Error(`Dashboard view "${view}" did not render a template image.`);
  return {
    png,
    caption,
    keyboard,
    page: currentPage,
    users,
  };
}

function isAdminPrivateChat(env, user, chat) {
  return chat?.type === 'private'
    && user
    && String(user.id) === String(env.TELEGRAM_ADMIN_ID)
    && String(chat.id) === String(env.TELEGRAM_ADMIN_ID);
}

async function telegramMessage(env, message) {
  if (!message?.text) return;
  const [rawCommand, argument] = message.text.trim().split(/\s+/, 2);
  const command = rawCommand.split('@')[0];
  if (!isAdminPrivateChat(env, message.from, message.chat)) {
    if (command === '/start' && message.chat?.type === 'private' && message.chat.id === message.from?.id) {
      return Boolean(await telegramApi(env, 'sendMessage', {
        chat_id: message.chat.id,
        text: 'Бот доступен только администратору. Проверьте, что TELEGRAM_ADMIN_ID в Cloudflare совпадает с вашим числовым Telegram ID.',
        disable_web_page_preview: true,
      }));
    }
    return;
  }
  if (command === '/stats' || command === '/menu' || command === '/start') {
    const dashboard = await renderDashboard(env, 'overview');
    const sent = await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard);
    if (sent) return true;
    return Boolean(await sendTelegram(env, dashboard.caption, dashboard.keyboard));
  } else if (command === '/users') {
    const dashboard = await renderDashboard(env, 'users');
    return Boolean(await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard));
  } else if (command === '/user') {
    if (!/^[0-9a-f-]{4,36}$/i.test(argument || '')) {
      return Boolean(await sendTelegram(env, 'Укажи начало ID браузера из списка игроков: /user <ID>'));
    }
    const matches = await env.DB.prepare(
      'SELECT visitor_id FROM visitors WHERE visitor_id LIKE ? ORDER BY last_seen DESC LIMIT 2',
    ).bind(`${argument.toLowerCase()}%`).all();
    if (!matches.results.length) return Boolean(await sendTelegram(env, 'Игрок с таким ID не найден.'));
    if (matches.results.length > 1) return Boolean(await sendTelegram(env, 'Найдено несколько игроков. Укажи больше символов ID или выбери игрока кнопкой в списке.'));
    const dashboard = await renderDashboard(env, 'user', 0, matches.results[0].visitor_id);
    return Boolean(await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard));
  } else if (command === '/errors') {
    const dashboard = await renderDashboard(env, 'errors');
    return Boolean(await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard));
  } else {
    return Boolean(await sendTelegram(env, 'Админ-панель: /stats или /menu. Также доступны /users, /user <ID>, /errors.'));
  }
}

async function telegramCallback(env, callback) {
  const message = callback?.message;
  if (!callback?.id || !message || !isAdminPrivateChat(env, callback.from, message.chat)) return;
  const data = callback.data || '';
  let view = '';
  let page = 0;
  let eventPage = 0;
  let visitorId = null;
  if (['overview', 'online', 'stages', 'difficulty', 'errors'].includes(data.slice(4)) && data.startsWith('scv:')) {
    view = data.slice(4);
  } else if (data === 'scv:users' || /^scv:users:\d{1,5}$/.test(data)) {
    view = 'users';
    page = data === 'scv:users' ? 0 : Number(data.slice('scv:users:'.length));
  } else if (/^scv:user:[0-9a-f-]{36}:\d{1,5}:\d{1,5}$/i.test(data)) {
    view = 'user';
    const match = data.match(/^scv:user:([0-9a-f-]{36}):(\d{1,5}):(\d{1,5})$/i);
    visitorId = match[1].toLowerCase();
    page = Number(match[2]);
    eventPage = Number(match[3]);
  }
  if (!view) {
    await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callback.id, text: 'Кнопка устарела. Открой /start заново.' });
    return;
  }

  const acknowledged = await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callback.id });
  if (!acknowledged) return;
  const dashboard = await renderDashboard(env, view, page, visitorId, eventPage);
  if (message.photo?.length) {
    await editDashboardPhoto(env, message.message_id, dashboard.png, dashboard.caption, dashboard.keyboard);
  } else {
    await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard);
  }
}

async function handleTelegram(request, env) {
  if (!env.WEBHOOK_SECRET
    || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  const update = await readJson(request, 32768);
  if (!update) return new Response('Bad Request', { status: 400 });
  try {
    if (update.callback_query) await telegramCallback(env, update.callback_query);
    else await telegramMessage(env, update.message);
  } catch (error) {
    console.error('Telegram command failed:', error instanceof Error ? error.name : 'unknown error');
    return new Response('Temporary failure', { status: 500 });
  }
  return new Response('OK');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/events') return handleEvent(request, env);
    if (url.pathname === '/api/forget') return handleForget(request, env);
    if (url.pathname === '/telegram') return handleTelegram(request, env);
    if (url.pathname === '/health' && request.method === 'GET') return json({ ok: true });
    return new Response('Not Found', { status: 404 });
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      env.DB.batch([
        env.DB.prepare(`DELETE FROM events WHERE datetime(created_at) < datetime('now', '-180 days')`),
        env.DB.prepare(`DELETE FROM telegram_notifications WHERE datetime(created_at) < datetime('now', '-180 days')`),
        env.DB.prepare(`DELETE FROM sessions WHERE datetime(last_seen) < datetime('now', '-180 days')`),
        env.DB.prepare(
          `DELETE FROM visitors WHERE NOT EXISTS (
             SELECT 1 FROM sessions WHERE sessions.visitor_id = visitors.visitor_id
           )`,
        ),
        env.DB.prepare(
          `UPDATE telegram_notifications SET status = 'pending'
           WHERE status = 'sending' AND datetime(last_attempt) < datetime('now', '-5 minutes')`,
        ),
      ]).then(async () => {
        const { results } = await env.DB.prepare(
          `SELECT session_id FROM telegram_notifications
           WHERE status = 'pending' ORDER BY created_at LIMIT 10`,
        ).all();
        for (const row of results) await deliverGameStartNotification(env, row.session_id);
      }).catch(error => {
        console.error('Telemetry scheduled maintenance failed:', error instanceof Error ? error.name : 'unknown error');
      }),
    );
  },
};
