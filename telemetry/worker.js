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

async function sendTelegram(env, text) {
  return Boolean(await telegramApi(env, 'sendMessage', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    text,
    disable_web_page_preview: true,
  }));
}

const DASHBOARD_WIDTH = 960;
const DASHBOARD_HEIGHT = 720;
const DASHBOARD_FONT = {
  ' ': '00000 00000 00000 00000 00000 00000 00000',
  '-': '00000 00000 00000 11111 00000 00000 00000',
  '.': '00000 00000 00000 00000 00000 01100 01100',
  ':': '00000 01100 01100 00000 01100 01100 00000',
  '/': '00001 00010 00010 00100 01000 01000 10000',
  '0': '01110 10001 10011 10101 11001 10001 01110',
  '1': '00100 01100 00100 00100 00100 00100 01110',
  '2': '01110 10001 00001 00010 00100 01000 11111',
  '3': '11110 00001 00001 01110 00001 00001 11110',
  '4': '00010 00110 01010 10010 11111 00010 00010',
  '5': '11111 10000 10000 11110 00001 00001 11110',
  '6': '01110 10000 10000 11110 10001 10001 01110',
  '7': '11111 00001 00010 00100 01000 01000 01000',
  '8': '01110 10001 10001 01110 10001 10001 01110',
  '9': '01110 10001 10001 01111 00001 00001 01110',
  'A': '01110 10001 10001 11111 10001 10001 10001',
  'B': '11110 10001 10001 11110 10001 10001 11110',
  'C': '01110 10001 10000 10000 10000 10001 01110',
  'D': '11110 10001 10001 10001 10001 10001 11110',
  'E': '11111 10000 10000 11110 10000 10000 11111',
  'F': '11111 10000 10000 11110 10000 10000 10000',
  'G': '01110 10001 10000 10111 10001 10001 01110',
  'H': '10001 10001 10001 11111 10001 10001 10001',
  'I': '01110 00100 00100 00100 00100 00100 01110',
  'J': '00111 00010 00010 00010 00010 10010 01100',
  'K': '10001 10010 10100 11000 10100 10010 10001',
  'L': '10000 10000 10000 10000 10000 10000 11111',
  'M': '10001 11011 10101 10101 10001 10001 10001',
  'N': '10001 11001 10101 10011 10001 10001 10001',
  'O': '01110 10001 10001 10001 10001 10001 01110',
  'P': '11110 10001 10001 11110 10000 10000 10000',
  'Q': '01110 10001 10001 10001 10101 10010 01101',
  'R': '11110 10001 10001 11110 10100 10010 10001',
  'S': '01111 10000 10000 01110 00001 00001 11110',
  'T': '11111 00100 00100 00100 00100 00100 00100',
  'U': '10001 10001 10001 10001 10001 10001 01110',
  'V': '10001 10001 10001 10001 01010 01010 00100',
  'W': '10001 10001 10001 10101 10101 10101 01010',
  'X': '10001 10001 01010 00100 01010 10001 10001',
  'Y': '10001 10001 01010 00100 00100 00100 00100',
  'Z': '11111 00001 00010 00100 01000 10000 11111',
};

async function dashboardPng(title, subtitle, rows) {
  const pixels = new Uint8Array(DASHBOARD_WIDTH * DASHBOARD_HEIGHT * 4);
  const colors = {
    background: [12, 18, 32, 255],
    card: [22, 31, 49, 255],
    accent: [218, 181, 89, 255],
    text: [242, 238, 224, 255],
    muted: [151, 166, 185, 255],
    bar: [68, 132, 135, 255],
  };
  const fillRect = (x, y, width, height, color) => {
    const left = Math.max(0, Math.floor(x));
    const top = Math.max(0, Math.floor(y));
    const right = Math.min(DASHBOARD_WIDTH, Math.ceil(x + width));
    const bottom = Math.min(DASHBOARD_HEIGHT, Math.ceil(y + height));
    const row = new Uint8Array((right - left) * 4);
    for (let px = 0; px < right - left; px += 1) row.set(color, px * 4);
    for (let py = top; py < bottom; py += 1) {
      pixels.set(row, (py * DASHBOARD_WIDTH + left) * 4);
    }
  };
  const drawText = (value, x, y, scale, color, maxLength = 48) => {
    const text = String(value || '').toUpperCase().slice(0, maxLength);
    let cursor = x;
    for (const character of text) {
      const glyph = (DASHBOARD_FONT[character] || DASHBOARD_FONT['.']).replace(/\s/g, '');
      for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          if (glyph[row * 5 + column] === '1') {
            fillRect(cursor + column * scale, y + row * scale, scale, scale, color);
          }
        }
      }
      cursor += 6 * scale;
    }
  };

  fillRect(0, 0, DASHBOARD_WIDTH, DASHBOARD_HEIGHT, colors.background);
  fillRect(40, 36, DASHBOARD_WIDTH - 80, 5, colors.accent);
  drawText('SCV / ADMIN', 52, 62, 3, colors.accent, 24);
  drawText(title, 52, 108, 5, colors.text, 28);
  drawText(subtitle, 52, 158, 2, colors.muted, 70);

  const rowHeight = rows.length > 7 ? 42 : 64;
  const rowGap = rows.length > 7 ? 8 : 10;
  const startY = 204;
  rows.slice(0, 9).forEach((row, index) => {
    const y = startY + index * (rowHeight + rowGap);
    fillRect(42, y, DASHBOARD_WIDTH - 84, rowHeight, colors.card);
    fillRect(42, y, 5, rowHeight, colors.accent);
    drawText(row.label, 65, y + (rowHeight > 50 ? 10 : 4), 2, colors.muted, 52);
    drawText(row.value, 65, y + (rowHeight > 50 ? 31 : 20), 3, colors.text, 42);
    if (row.detail) drawText(row.detail, 630, y + (rowHeight > 50 ? 23 : 12), 2, colors.muted, 24);
    if (Number.isFinite(row.ratio)) {
      fillRect(630, y + rowHeight - 12, 260, 5, [44, 56, 72, 255]);
      fillRect(630, y + rowHeight - 12, Math.max(4, Math.min(260, row.ratio * 260)), 5, colors.bar);
    }
  });
  drawText('LIVE ANALYTICS', 52, DASHBOARD_HEIGHT - 32, 2, colors.muted, 30);

  const byteLength = DASHBOARD_WIDTH * 4;
  const scanlines = new Uint8Array((byteLength + 1) * DASHBOARD_HEIGHT);
  for (let y = 0; y < DASHBOARD_HEIGHT; y += 1) {
    const lineStart = y * (byteLength + 1);
    scanlines[lineStart] = 0;
    scanlines.set(pixels.subarray(y * byteLength, (y + 1) * byteLength), lineStart + 1);
  }
  return new Blob([await encodePng(scanlines, DASHBOARD_WIDTH, DASHBOARD_HEIGHT)], { type: 'image/png' });
}

async function dashboardTemplatePng(env, filename, values) {
  if (!env.ASSETS) throw new Error('Dashboard assets binding is not configured.');
  const response = await env.ASSETS.fetch(new Request(`https://assets/dashboard/${filename}`));
  if (!response.ok) throw new Error(`Dashboard template ${filename} could not be loaded: HTTP ${response.status}.`);
  const template = await decodePng(new Uint8Array(await response.arrayBuffer()));
  if (template.width !== 1448 || template.height !== 1086 || template.channels !== 3) {
    throw new Error(`Dashboard template ${filename} must be 1448x1086 RGB PNG.`);
  }

  const glyphs = Object.fromEntries(Object.entries(DASHBOARD_FONT)
    .map(([character, glyph]) => [character, glyph.replace(/\s/g, '')]));
  const drawNumber = (value, centerX, centerY) => {
    const text = String(Math.max(0, Math.floor(Number(value) || 0)));
    const scale = text.length > 3 ? 3 : 4;
    const charWidth = 6 * scale;
    let x = Math.round(centerX - (text.length * charWidth - scale) / 2);
    const y = Math.round(centerY - (7 * scale) / 2);
    for (const character of text) {
      const glyph = glyphs[character] || glyphs['0'];
      for (let row = 0; row < 7; row += 1) {
        for (let column = 0; column < 5; column += 1) {
          if (glyph[row * 5 + column] === '1') {
            fillRasterRect(template, x + column * scale, y + row * scale, scale, scale, [83, 55, 27]);
          }
        }
      }
      x += charWidth;
    }
  };

  const rowCenters = [257, 358, 459, 560, 660, 760, 861];
  const leftCenters = [300, 300, 300, 300, 300, 300, 300];
  const rightCenters = [1134, 1134, 1134, 1134, 1134, 1134, 1134];
  const barLeft = 379;
  const barWidth = 652;
  const maxCompleted = Math.max(1, ...values.map(row => row.completed));
  values.slice(0, rowCenters.length).forEach((row, index) => {
    const centerY = rowCenters[index];
    drawNumber(row.completed, leftCenters[index], centerY);
    drawNumber(row.online, rightCenters[index], centerY);
    const width = row.completed ? Math.max(5, Math.round((row.completed / maxCompleted) * barWidth)) : 0;
    if (width) fillRasterRect(template, barLeft, centerY + 10, width, 8, [161, 104, 41]);
  });

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
      `Новый запуск игры\nИгрок: ${notification.visitor_id.slice(0, 8)}\nСложность: ${notification.difficulty}\nВремя UTC: ${now}`,
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
  const label = STAGE_LABELS[locationId] || locationId;
  if (actId === 'prologue' || locationId === 'prologue') return label;
  return `${ACT_LABELS[actId] || actId || 'Акт не указан'} · ${label}`;
}

function dashboardKeyboard(view, page = 0, users = [], hasNextPage = false, visitorId = null, eventPage = 0, hasNextEvents = false) {
  if (view === 'users') {
    const userButtons = users.map(user => [{
      text: `${user.device_type === 'mobile' ? '📱' : user.device_type === 'tablet' ? '📟' : '🖥'} ${user.platform_name || 'Устройство'} · ${user.browser_name || 'браузер'} · ${user.visitor_id.slice(0, 8)}`.slice(0, 60),
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
  let title = 'OVERVIEW';
  let subtitle = 'ANONYMOUS WEBSITE AND GAME STATISTICS';
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
         ORDER BY last_seen DESC LIMIT 9`,
      ).all(),
    ]);
    title = 'ONLINE NOW';
    subtitle = 'VISIBLE BROWSER SESSIONS / LAST 2 MINUTES';
    caption = `🟢 Сейчас онлайн: ${active.players} браузеров, ${active.sessions} вкладок; в игре: ${active.in_game}. Активность оценивается по сигналам видимых вкладок.`;
    rows = results.map(session => ({
      label: `VISITOR ${session.visitor_id.slice(0, 8)}`,
      value: session.current_page === 'game' ? 'IN GAME' : 'ON SITE',
      detail: `${session.current_location || session.current_act || 'NO STAGE'} ${session.difficulty || ''}`,
    }));
    if (!rows.length) rows = [{ label: 'ONLINE BROWSERS', value: String(active.players), detail: 'NO RECENT SESSIONS' }];
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
    title = 'GAME STAGES';
    subtitle = '7 STAGES / COMPLETED VISITS AND CURRENT PLAYERS';
    caption = [
      '🗺 Этапы игры: завершения — зарегистрированные прохождения; онлайн — браузеры, у которых сейчас открыт этап.',
      ...stageStats.map(stage =>
        `${stage.label}: завершили ${stage.completed}, сейчас онлайн ${stage.online}`,
      ),
      'В шаблоне семь строк: Пролог и Скрипторий объединены в одну.',
    ].join('\n');
    rows = stageStats.map(stage => ({
      label: stage.label.replace(/[^a-z0-9 ]/gi, ' ').replace(/\s+/g, ' ').trim(),
      value: `DONE ${stage.completed}`,
      detail: `NOW ${stage.online}`,
    }));
    png = await dashboardTemplatePng(env, 'analytics.png', stageStats);
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
    const labels = {
      novice: 'NOVICE / FIRST VOYAGER',
      explorer: 'EXPLORER',
      keeper: 'KEEPER',
    };
    const total = new Map(results.map(row => [row.difficulty, row.sessions]));
    const online = new Map(active.results.map(row => [row.difficulty, row.players]));
    title = 'DIFFICULTY';
    subtitle = 'GAME STARTS AND ACTIVE PLAYERS';
    caption = '🎚 Выбор сложности: число запусков и число игроков, которые сейчас находятся в игре на этом уровне.';
    rows = Object.entries(labels).map(([id, label]) => ({
      label,
      value: `STARTS ${total.get(id) || 0}`,
      detail: `ONLINE ${online.get(id) || 0}`,
    }));
  } else if (view === 'users') {
    const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM visitors').first();
    const pages = Math.max(1, Math.ceil(total.count / 5));
    currentPage = Math.max(0, Math.min(Number.isInteger(page) ? page : 0, pages - 1));
    hasNextPage = currentPage + 1 < pages;
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, device_type, platform_name, browser_name, last_seen,
       game_starts, locations_completed
       FROM visitors ORDER BY last_seen DESC LIMIT 5 OFFSET ?`,
    ).bind(currentPage * 5).all();
    users = results;
    title = `PLAYERS ${currentPage + 1} OF ${pages}`;
    subtitle = `ANONYMOUS DEVICE PROFILES / ${total.count} TOTAL`;
    caption = total.count
      ? `👥 Браузеры ${currentPage * 5 + 1}–${currentPage * 5 + results.length} из ${total.count}. Нажми кнопку под изображением, чтобы открыть подробности игрока. Данные сортируются по последней активности.`
      : '👥 Пока нет зарегистрированных браузеров.';
    rows = results.map(user => ({
      label: `${user.device_type || 'DEVICE'} ${user.platform_name || 'UNKNOWN'}`,
      value: `VISITOR ${user.visitor_id.slice(0, 8)}`,
      detail: `${user.browser_name || 'BROWSER'} GAMES ${user.game_starts} STAGES ${user.locations_completed}`,
    }));
    if (!rows.length) rows = [{ label: 'NO VISITORS YET', value: '0', detail: 'WAITING FOR FIRST VISIT' }];
  } else if (view === 'user') {
    const user = await env.DB.prepare(
      `SELECT visitor_id, first_seen, last_seen, device_type, platform_name,
       browser_name, page_views, game_starts, quizzes_completed,
       locations_completed, runtime_errors, max_score
       FROM visitors WHERE visitor_id = ?`,
    ).bind(visitorId).first();
    if (!user) {
      title = 'PLAYER NOT FOUND';
      subtitle = 'THIS BROWSER PROFILE IS NO LONGER AVAILABLE';
      caption = 'Профиль игрока не найден или уже удалён.';
      rows = [{ label: 'VISITOR', value: visitorId.slice(0, 8), detail: 'NO DATA' }];
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
      title = `PLAYER ${visitorId.slice(0, 8)}`;
      subtitle = `${user.device_type || 'DEVICE'} / ${user.platform_name || 'UNKNOWN'} / ${user.browser_name || 'BROWSER'}`;
      caption = [
        `👤 Игрок ${visitorId.slice(0, 8)} · ${user.device_type || 'устройство не определено'} · ${user.platform_name || 'платформа неизвестна'} · ${user.browser_name || 'браузер неизвестен'}`,
        `Первый визит: ${user.first_seen} UTC · последняя активность: ${user.last_seen} UTC.`,
        `Страниц ${user.page_views}, запусков ${user.game_starts}, заданий ${user.quizzes_completed}, этапов ${user.locations_completed}, ошибок ${user.runtime_errors}, лучший счёт ${user.max_score}.`,
        `Страница истории ${eventPage + 1}/${eventPages}. Последние сессии: ${sessions.results.map(session => `${session.difficulty || 'сложность не выбрана'} / ${formatStage(session.current_act, session.current_location)} / ${session.last_seen} UTC`).join('; ') || 'нет'}.`,
      ].join('\n');
      rows = [
        { label: 'PAGE VIEWS / GAME STARTS', value: `${user.page_views} / ${user.game_starts}` },
        { label: 'QUIZZES / COMPLETED STAGES', value: `${user.quizzes_completed} / ${user.locations_completed}` },
        { label: 'RUNTIME ERRORS / BEST SCORE', value: `${user.runtime_errors} / ${user.max_score}` },
        ...events.results.map(event => {
          let metadata = {};
          try {
            metadata = JSON.parse(event.metadata_json);
          } catch (error) {
            console.warn('Skipping malformed event metadata in player dashboard:', error instanceof Error ? error.name : 'parse error');
          }
          const detail = metadata.location_id || metadata.quiz_id || metadata.difficulty || metadata.error_type || '';
          return {
            label: event.event_type.replace(/_/g, ' '),
            value: detail || event.created_at.slice(0, 16),
            detail: event.created_at.slice(0, 16),
          };
        }),
      ];
    }
  } else if (view === 'errors') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, created_at, metadata_json
       FROM events WHERE event_type = 'runtime_error'
       ORDER BY created_at DESC LIMIT 9`,
    ).all();
    title = 'RECENT ERRORS';
    subtitle = 'ERROR TYPE ONLY / NO TEXT OR STACK TRACE STORED';
    caption = results.length ? '⚠️ Последние технические ошибки: сохраняются только тип ошибки, дата и анонимный ID браузера.' : 'Ошибок пока нет.';
    rows = results.map(row => {
      const metadata = JSON.parse(row.metadata_json);
      return {
        label: `VISITOR ${row.visitor_id.slice(0, 8)}`,
        value: metadata.error_type,
        detail: row.created_at.slice(0, 16),
      };
    });
    if (!rows.length) rows = [{ label: 'ERRORS', value: '0', detail: 'NO RECENT ERRORS' }];
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
        `SELECT device_type, platform_name, browser_name, COUNT(*) AS visitors
         FROM visitors WHERE device_type IS NOT NULL OR platform_name IS NOT NULL OR browser_name IS NOT NULL
         GROUP BY device_type, platform_name, browser_name ORDER BY visitors DESC LIMIT 3`,
      ).all(),
    ]);
    title = 'SITE OVERVIEW';
    subtitle = 'CURRENT TRAFFIC / LIFETIME GAMEPLAY';
    caption = [
      `📊 «Слово через века» — ${active.players} браузеров онлайн (${active.in_game} в игре), ${active.sessions} активных вкладок.`,
      `За 24 часа: ${recent.users} браузеров, ${recentStarts.count} запусков, ${recentErrors.count} ошибок.`,
      `Всего: ${totals.users} браузеров, ${totals.page_views} просмотров, ${sessions.count} сессий, ${totals.game_starts} запусков, ${totals.quizzes} заданий, ${totals.locations} этапов.`,
      `Устройства: ${devices.results.map(item => `${item.device_type || 'неизвестно'} / ${item.platform_name || 'неизвестно'} / ${item.browser_name || 'неизвестно'} (${item.visitors})`).join('; ') || 'данных пока нет'}.`,
    ].join('\n');
    rows = [
      { label: 'ONLINE BROWSERS / IN GAME', value: `${active.players} / ${active.in_game}`, detail: `${active.sessions} TABS` },
      { label: 'VISITORS 24H / TOTAL', value: `${recent.users} / ${totals.users}` },
      { label: 'PAGE VIEWS / SESSIONS', value: `${totals.page_views} / ${sessions.count}` },
      { label: 'GAME STARTS / LAST 24H', value: `${totals.game_starts} / ${recentStarts.count}` },
      { label: 'QUIZZES / COMPLETED STAGES', value: `${totals.quizzes} / ${totals.locations}` },
      { label: 'RUNTIME ERRORS 24H', value: String(recentErrors.count) },
      ...devices.results.map(item => ({
        label: `${item.device_type || 'DEVICE'} ${item.platform_name || 'UNKNOWN'}`,
        value: `${item.browser_name || 'BROWSER'} ${item.visitors}`,
      })),
    ];
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
  return {
    png: png || await dashboardPng(title, subtitle, rows),
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
    return Boolean(await sendDashboardPhoto(env, dashboard.png, dashboard.caption, dashboard.keyboard));
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
