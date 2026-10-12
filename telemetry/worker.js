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

async function telegramApi(env, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    console.error('Telegram notification failed with HTTP status:', response.status);
    return false;
  }
  const result = await response.json();
  if (!result.ok) {
    console.error('Telegram API call was rejected:', method);
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

  await env.DB.prepare(
    `INSERT INTO visitors(visitor_id, first_seen, last_seen)
     VALUES(?, ?, ?)
     ON CONFLICT(visitor_id) DO UPDATE SET last_seen = excluded.last_seen`,
  ).bind(visitorId, now, now).run();

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

async function renderDashboard(env, view) {
  if (view === 'online') {
    const [active, { results }] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(DISTINCT visitor_id) AS players, COUNT(*) AS sessions
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')`,
      ).first(),
      env.DB.prepare(
        `SELECT visitor_id, current_page, current_act, current_location, last_seen, difficulty
         FROM sessions WHERE datetime(last_seen) >= datetime('now', '-2 minutes')
         ORDER BY last_seen DESC LIMIT 12`,
      ).all(),
    ]);
    return [
      '🟢 Активность сайта',
      `Активных браузеров за 2 минуты: ${active.players}`,
      `Активных сессий вкладок: ${active.sessions}`,
      'Онлайн — оценка по сигналам видимых вкладок; посетитель определяется случайным ID этого браузера.',
      '',
      ...(results.length ? results.map(session =>
        `${session.visitor_id.slice(0, 8)} · ${session.current_page === 'game' ? 'Игра' : 'Сайт'} · ${formatStage(session.current_act, session.current_location)} · ${session.difficulty || 'сложность не выбрана'}`,
      ) : ['Сейчас активных посетителей не видно.']),
    ].join('\n');
  }

  if (view === 'stages') {
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
    const stages = Object.entries(STAGE_LABELS).map(([id, label]) =>
      `${label} · завершили ${completedByStage.get(id) || 0} · сейчас ${activeByStage.get(id) || 0}`,
    );
    return [
      '🗺 Этапы прохождения',
      'Завершили — число событий завершения. Сейчас — активные браузеры, у которых открыт этап.',
      '',
      ...stages,
    ].join('\n');
  }

  if (view === 'difficulty') {
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
      novice: 'Первопроходец',
      explorer: 'Исследователь',
      keeper: 'Хранитель',
    };
    const total = new Map(results.map(row => [row.difficulty, row.sessions]));
    const online = new Map(active.results.map(row => [row.difficulty, row.players]));
    return [
      '🎚 Сложность игры',
      ...Object.entries(labels).map(([id, label]) =>
        `${label} · запусков ${total.get(id) || 0} · активны ${online.get(id) || 0}`,
      ),
    ].join('\n');
  }

  if (view === 'users') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, first_seen, last_seen, game_starts, quizzes_completed,
       locations_completed, runtime_errors, max_score
       FROM visitors ORDER BY last_seen DESC LIMIT 10`,
    ).all();
    return results.length
      ? ['👥 Последние активные браузеры (ID — первые 8 символов):', ...results.map(user =>
        `${user.visitor_id.slice(0, 8)} · запусков ${user.game_starts} · заданий ${user.quizzes_completed} · локаций ${user.locations_completed} · ошибок ${user.runtime_errors} · баллы ${user.max_score}`,
      )].join('\n')
      : 'Пока нет данных о посетителях.';
  }

  if (view === 'errors') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, created_at, metadata_json
       FROM events WHERE event_type = 'runtime_error'
       ORDER BY created_at DESC LIMIT 10`,
    ).all();
    return results.length
      ? ['⚠️ Последние ошибки (сохраняется только тип, без текста и стека):',
        ...results.map(row => {
          const metadata = JSON.parse(row.metadata_json);
          return `${row.created_at} UTC · игрок ${row.visitor_id.slice(0, 8)} · ${metadata.error_type}`;
        })].join('\n')
      : 'Ошибок пока нет.';
  }

  const [totals, sessions, active, recent, recentStarts, recentErrors] = await Promise.all([
    env.DB.prepare(
      `SELECT COUNT(*) AS users, COALESCE(SUM(page_views), 0) AS page_views,
       COALESCE(SUM(game_starts), 0) AS game_starts,
       COALESCE(SUM(quizzes_completed), 0) AS quizzes,
       COALESCE(SUM(locations_completed), 0) AS locations
       FROM visitors`,
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
  ]);
  return [
    '📊 Админ-панель «Слово через века»',
    `🟢 Сейчас активны: ${active.players} браузеров (${active.in_game} в игре), ${active.sessions} вкладок`,
    `👀 Активных браузеров за 24 часа: ${recent.users}`,
    '',
    `🌐 Анонимных браузеров: ${totals.users}`,
    `Просмотров страниц: ${totals.page_views} · сессий: ${sessions.count}`,
    `🎮 Запусков игры: ${totals.game_starts} (за 24 ч: ${recentStarts.count})`,
    `Заданий завершено: ${totals.quizzes} · локаций: ${totals.locations}`,
    `⚠️ Ошибок за 24 часа: ${recentErrors.count}`,
    '',
    'Для детализации выбери раздел кнопками ниже.',
  ].join('\n');
}

async function renderUser(env, argument) {
  if (!argument || !/^[0-9a-f-]{4,36}$/i.test(argument)) {
    return 'Укажи начало ID игрока из раздела «Игроки», например: /user 1234abcd';
  }
  const user = await env.DB.prepare(
    `SELECT visitor_id, first_seen, last_seen, page_views, game_starts,
     quizzes_completed, locations_completed, runtime_errors, max_score
     FROM visitors WHERE visitor_id LIKE ? LIMIT 1`,
  ).bind(`${argument.toLowerCase()}%`).first();
  if (!user) return 'Игрок с таким ID не найден.';

  const { results } = await env.DB.prepare(
    `SELECT session_id, started_at, last_seen, game_started, page_views,
     quizzes_completed, locations_completed, runtime_errors, max_score, difficulty,
     current_act, current_location
     FROM sessions WHERE visitor_id = ? ORDER BY last_seen DESC LIMIT 10`,
  ).bind(user.visitor_id).all();
  return [
    `Игрок ${user.visitor_id}`,
    `Первый визит: ${user.first_seen} UTC`,
    `Последняя активность: ${user.last_seen} UTC`,
    `Просмотров: ${user.page_views}; запусков: ${user.game_starts}`,
    `Заданий: ${user.quizzes_completed}; локаций: ${user.locations_completed}`,
    `Ошибок: ${user.runtime_errors}; максимальный счёт: ${user.max_score}`,
    'Последние сессии:',
    ...results.map(session =>
      `${session.session_id.slice(0, 8)} · ${session.started_at} · ${session.difficulty || 'не выбрана'} · ${formatStage(session.current_act, session.current_location)} · заданий ${session.quizzes_completed} · ошибок ${session.runtime_errors}`,
    ),
  ].join('\n');
}

function isAdminPrivateChat(env, user, chat) {
  return chat?.type === 'private'
    && user
    && String(user.id) === String(env.TELEGRAM_ADMIN_ID)
    && String(chat.id) === String(env.TELEGRAM_ADMIN_ID);
}

async function telegramMessage(env, message) {
  if (!message?.text || !isAdminPrivateChat(env, message.from, message.chat)) return;
  const [rawCommand, argument] = message.text.trim().split(/\s+/, 2);
  const command = rawCommand.split('@')[0];
  let text;
  if (command === '/stats' || command === '/menu' || command === '/start') {
    text = await renderDashboard(env, 'overview');
  } else if (command === '/users') {
    text = await renderDashboard(env, 'users');
  } else if (command === '/user') {
    text = await renderUser(env, argument);
  } else if (command === '/errors') {
    text = await renderDashboard(env, 'errors');
  } else {
    text = 'Админ-панель: /stats или /menu. Также доступны /users, /user <ID>, /errors.';
  }

  const result = await telegramApi(env, 'sendMessage', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
    reply_markup: DASHBOARD_KEYBOARD,
  });
  return Boolean(result);
}

async function telegramCallback(env, callback) {
  const message = callback?.message;
  if (!callback?.id || !message || !isAdminPrivateChat(env, callback.from, message.chat)) return;
  const view = callback.data?.startsWith('scv:') ? callback.data.slice(4) : '';
  const allowedViews = new Set(['overview', 'online', 'stages', 'difficulty', 'users', 'errors']);
  if (!allowedViews.has(view)) return;

  await telegramApi(env, 'answerCallbackQuery', { callback_query_id: callback.id });
  const text = await renderDashboard(env, view);
  await telegramApi(env, 'editMessageText', {
    chat_id: env.TELEGRAM_ADMIN_ID,
    message_id: message.message_id,
    text: text.slice(0, 3900),
    disable_web_page_preview: true,
    reply_markup: DASHBOARD_KEYBOARD,
  });
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
