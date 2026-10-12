(() => {
  const endpoint = window.SCV_TELEMETRY_ENDPOINT;
  const FORGET_ENDPOINT = endpoint ? endpoint.replace(/\/api\/events\/?$/, '/api/forget') : '';
  const CONSENT_KEY = 'scv_analytics_consent';
  const VISITOR_KEY = 'scv_analytics_visitor';
  const SESSION_KEY = 'scv_analytics_session';
  const SESSION_ACTIVITY_KEY = 'scv_analytics_last_activity';
  const STARTED_KEY = 'scv_analytics_game_started';
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;
  const PAGE_NAMES = { 'game.html': 'game' };
  let consentPromptShown = false;
  let gameStartRequest = null;
  let presenceTimer = null;

  if (typeof endpoint !== 'string' || !endpoint.trim()) return;

  function createId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    if (!globalThis.crypto?.getRandomValues) {
      console.error('Anonymous analytics IDs require a secure random number generator.');
      return null;
    }
    const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function getOrCreate(storage, key) {
    let id = storage.getItem(key);
    if (!id) {
      id = createId();
      if (!id) return null;
      storage.setItem(key, id);
    }
    return id;
  }

  function getSessionId() {
    const now = Date.now();
    const lastActivity = Number(sessionStorage.getItem(SESSION_ACTIVITY_KEY) || 0);
    if (now - lastActivity > SESSION_IDLE_MS) {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(STARTED_KEY);
    }
    const id = getOrCreate(sessionStorage, SESSION_KEY);
    if (id) sessionStorage.setItem(SESSION_ACTIVITY_KEY, String(now));
    return id;
  }

  function isConsented() {
    return localStorage.getItem(CONSENT_KEY) === 'yes';
  }

  function send(type, metadata = {}) {
    if (!isConsented()) return Promise.resolve(false);
    const visitorId = getOrCreate(localStorage, VISITOR_KEY);
    const sessionId = getSessionId();
    const eventId = createId();
    if (!visitorId || !sessionId || !eventId) return Promise.resolve(false);

    return fetch(endpoint, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_id: eventId,
        visitor_id: visitorId,
        session_id: sessionId,
        type,
        metadata,
      }),
    }).then(response => {
      if (!response.ok) console.warn(`Anonymous analytics request failed: HTTP ${response.status}.`);
      return response.ok;
    }).catch(error => {
      console.warn('Anonymous analytics is temporarily unavailable:', error instanceof Error ? error.name : 'network error');
      return false;
    });
  }

  function currentPage() {
    const file = location.pathname.split('/').pop();
    return PAGE_NAMES[file] || 'landing';
  }

  function trackPageView() {
    send('page_view', { page: currentPage() });
  }

  function refreshPresence() {
    if (!isConsented()) return;
    const stage = currentPage() === 'game' && typeof window.SCVGameCurrentStage === 'function'
      ? window.SCVGameCurrentStage()
      : null;
    send('heartbeat', {
      page: currentPage(),
      act_id: stage?.actId || null,
      location_id: stage?.locationId || null,
    });
  }

  function startPresenceUpdates() {
    if (presenceTimer) return;
    refreshPresence();
    presenceTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refreshPresence();
    }, HEARTBEAT_INTERVAL_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshPresence();
    });
  }

  function trackGameStart(difficulty) {
    if (!isConsented()) return Promise.resolve(false);
    const sessionId = getSessionId();
    if (!sessionId || sessionStorage.getItem(STARTED_KEY) === sessionId) return Promise.resolve(false);
    if (gameStartRequest) return gameStartRequest;
    gameStartRequest = send('game_started', { difficulty }).then(sent => {
      if (sent) sessionStorage.setItem(STARTED_KEY, sessionId);
      gameStartRequest = null;
      return sent;
    });
    return gameStartRequest;
  }

  function removeConsentPanel() {
    document.getElementById('scv-telemetry-consent')?.remove();
  }

  function closeConsentPanel() {
    removeConsentPanel();
    if (document.getElementById('scv-telemetry-settings')) return;
    const settings = document.createElement('button');
    settings.id = 'scv-telemetry-settings';
    settings.className = 'scv-telemetry-settings';
    settings.type = 'button';
    settings.textContent = 'Настройки приватности';
    settings.addEventListener('click', showConsentPanel);
    document.body.appendChild(settings);
  }

  function showConsentPanel() {
    removeConsentPanel();
    consentPromptShown = true;
    const panel = document.createElement('section');
    panel.id = 'scv-telemetry-consent';
    panel.className = 'scv-telemetry-consent';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-labelledby', 'scv-telemetry-title');
    panel.innerHTML = `
      <div class="scv-telemetry-copy">
        <strong id="scv-telemetry-title">Помогите улучшить игру</strong>
        <p>Можно отправлять сведения без имени: посещения, этапы прохождения, активность открытой вкладки и типы технических ошибок. Ответы и текст ошибок не отправляются. Случайный ID связывает визиты только в этом браузере. Отказ не влияет на игру.</p>
      </div>
      <div class="scv-telemetry-actions">
        <button type="button" data-telemetry-action="allow">Разрешить</button>
        <button type="button" data-telemetry-action="deny">Не сейчас</button>
        <button type="button" data-telemetry-action="forget">Удалить мои данные</button>
      </div>`;
    panel.querySelector('[data-telemetry-action="allow"]').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'yes');
      closeConsentPanel();
      trackPageView();
      startPresenceUpdates();
      if (currentPage() === 'game' && window.SCVGameReady && typeof window.SCVGameDifficulty === 'function') {
        window.SCVTelemetry.trackGameStart(window.SCVGameDifficulty());
        refreshPresence();
      }
    });
    panel.querySelector('[data-telemetry-action="deny"]').addEventListener('click', () => {
      localStorage.setItem(CONSENT_KEY, 'no');
      closeConsentPanel();
    });
    panel.querySelector('[data-telemetry-action="forget"]').addEventListener('click', async () => {
      const visitorId = localStorage.getItem(VISITOR_KEY);
      try {
        if (visitorId) {
          const response = await fetch(FORGET_ENDPOINT, {
            method: 'POST',
            mode: 'cors',
            credentials: 'omit',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ visitor_id: visitorId }),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
        }
        localStorage.removeItem(VISITOR_KEY);
        localStorage.removeItem(CONSENT_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        sessionStorage.removeItem(SESSION_ACTIVITY_KEY);
        sessionStorage.removeItem(STARTED_KEY);
        localStorage.setItem(CONSENT_KEY, 'no');
        closeConsentPanel();
      } catch (error) {
        console.error('Could not delete anonymous analytics data:', error instanceof Error ? error.message : 'request failed');
      }
    });
    document.body.appendChild(panel);
    document.getElementById('scv-telemetry-settings')?.remove();
  }

  window.SCVTelemetry = {
    trackPageView,
    trackGameStart,
    trackStage() {
      refreshPresence();
    },
    trackQuizCompleted(quizId, score) {
      send('quiz_completed', { quiz_id: quizId, score });
    },
    trackLocationCompleted(locationId) {
      send('location_completed', { location_id: locationId });
    },
  };

  function reportRuntimeError(error) {
    const allowedNames = new Set(['Error', 'TypeError', 'ReferenceError', 'SyntaxError', 'RangeError']);
    const name = error && allowedNames.has(error.name) ? error.name : 'Error';
    send('runtime_error', { error_type: name });
  }

  window.addEventListener('error', event => reportRuntimeError(event.error));
  window.addEventListener('unhandledrejection', event => reportRuntimeError(event.reason));

  function initialize() {
    if (isConsented()) {
      closeConsentPanel();
      trackPageView();
      startPresenceUpdates();
    } else if (localStorage.getItem(CONSENT_KEY) !== 'no' && !consentPromptShown) {
      showConsentPanel();
    } else {
      closeConsentPanel();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
