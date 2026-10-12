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

  if (type === 'page_view') {
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
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_ADMIN_ID,
      text,
      disable_web_page_preview: true,
    }),
  });
  if (!response.ok) {
    console.error('Telegram notification failed with HTTP status:', response.status);
    return false;
  }
  const result = await response.json();
  if (!result.ok) {
    console.error('Telegram notification was rejected by Telegram.');
    return false;
  }
  return true;
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
    || !EVENT_TYPES.has(payload.type)) {
    return json({ error: 'invalid_event' }, 400, headers);
  }

  const metadata = safeMetadata(payload.type, payload.metadata);
  if (!metadata) return json({ error: 'invalid_metadata' }, 400, headers);

  const now = new Date().toISOString();
  const visitorId = payload.visitor_id.toLowerCase();
  const sessionId = payload.session_id.toLowerCase();
  const eventId = payload.event_id.toLowerCase();

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

async function telegramMessage(env, message) {
  if (!message || message.chat?.type !== 'private' || !message.from || !message.text) return;
  if (String(message.from.id) !== String(env.TELEGRAM_ADMIN_ID)
    || String(message.chat.id) !== String(env.TELEGRAM_ADMIN_ID)) return;

  const [command, argument] = message.text.trim().split(/\s+/, 2);
  let text = 'Команды: /stats, /users, /user <ID игрока>, /errors';

  if (command === '/stats') {
    const [totals, allSessions, recent, recentStarts, errors] = await Promise.all([
      env.DB.prepare(
        `SELECT COUNT(*) AS users, COALESCE(SUM(page_views), 0) AS page_views,
         COALESCE(SUM(game_starts), 0) AS game_starts,
         COALESCE(SUM(quizzes_completed), 0) AS quizzes,
         COALESCE(SUM(locations_completed), 0) AS locations,
         COALESCE(SUM(runtime_errors), 0) AS errors FROM visitors`,
      ).first(),
      env.DB.prepare('SELECT COUNT(*) AS count FROM sessions').first(),
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
    text = [
      'Статистика проекта',
      `Анонимных браузеров: ${totals.users}`,
      `Просмотров страниц: ${totals.page_views}`,
      `Сессий: ${allSessions.count}`,
      `Запусков игры: ${totals.game_starts}`,
      `Завершённых заданий: ${totals.quizzes}`,
      `Завершённых локаций: ${totals.locations}`,
      `Ошибок за 24 часа: ${errors.count}`,
      `Активных игроков за 24 часа: ${recent.users}`,
      `Запусков игры за 24 часа: ${recentStarts.count}`,
    ].join('\n');
  } else if (command === '/users') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, first_seen, last_seen, game_starts, quizzes_completed,
       locations_completed, runtime_errors, max_score
       FROM visitors ORDER BY last_seen DESC LIMIT 10`,
    ).all();
    text = results.length
      ? ['Недавно активные (ID — первые 8 символов):', ...results.map(user =>
        `${user.visitor_id.slice(0, 8)} · запусков ${user.game_starts} · заданий ${user.quizzes_completed} · локаций ${user.locations_completed} · ошибок ${user.runtime_errors} · баллы ${user.max_score}`,
      )].join('\n')
      : 'Пока нет игроков с согласием на статистику.';
  } else if (command === '/user') {
    if (!argument || !/^[0-9a-f-]{4,36}$/i.test(argument)) {
      text = 'Укажи ID из /users, например: /user 1234abcd';
    } else {
      const user = await env.DB.prepare(
        `SELECT visitor_id, first_seen, last_seen, page_views, game_starts,
         quizzes_completed, locations_completed, runtime_errors, max_score
         FROM visitors WHERE visitor_id LIKE ? LIMIT 1`,
      ).bind(`${argument.toLowerCase()}%`).first();
      if (!user) {
        text = 'Игрок с таким ID не найден.';
      } else {
        const { results } = await env.DB.prepare(
          `SELECT session_id, started_at, last_seen, game_started, page_views,
           quizzes_completed, locations_completed, runtime_errors, max_score, difficulty
           FROM sessions WHERE visitor_id = ? ORDER BY last_seen DESC LIMIT 10`,
        ).bind(user.visitor_id).all();
        text = [
          `Игрок ${user.visitor_id}`,
          `Первый визит: ${user.first_seen} UTC`,
          `Последняя активность: ${user.last_seen} UTC`,
          `Просмотров: ${user.page_views}; запусков: ${user.game_starts}`,
          `Заданий: ${user.quizzes_completed}; локаций: ${user.locations_completed}`,
          `Ошибок: ${user.runtime_errors}; максимальный счёт: ${user.max_score}`,
          'Последние сессии:',
          ...results.map(session =>
            `${session.session_id.slice(0, 8)} · ${session.started_at} · ${session.difficulty || 'не выбрана'} · заданий ${session.quizzes_completed} · ошибок ${session.runtime_errors}`,
          ),
        ].join('\n');
      }
    }
  } else if (command === '/errors') {
    const { results } = await env.DB.prepare(
      `SELECT visitor_id, session_id, created_at, metadata_json
       FROM events WHERE event_type = 'runtime_error'
       ORDER BY created_at DESC LIMIT 10`,
    ).all();
    text = results.length
      ? ['Последние ошибки (сохраняется только тип, без текста или стека):',
        ...results.map(row => {
          const metadata = JSON.parse(row.metadata_json);
          return `${row.created_at} UTC · игрок ${row.visitor_id.slice(0, 8)} · ${metadata.error_type}`;
        })].join('\n')
      : 'Ошибок пока нет.';
  }

  await sendTelegram(env, text.slice(0, 3900));
}

async function handleTelegram(request, env) {
  if (!env.WEBHOOK_SECRET
    || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
    return new Response('Forbidden', { status: 403 });
  }
  const update = await readJson(request, 32768);
  if (!update) return new Response('Bad Request', { status: 400 });
  try {
    await telegramMessage(env, update.message);
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
      Promise.all([
        env.DB.prepare(`DELETE FROM events WHERE datetime(created_at) < datetime('now', '-180 days')`).run(),
        env.DB.prepare(
          `UPDATE telegram_notifications SET status = 'pending'
           WHERE status = 'sending' AND datetime(last_attempt) < datetime('now', '-5 minutes')`,
        ).run(),
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
