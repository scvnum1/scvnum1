(() => {
  const endpoint = window.SCV_TELEMETRY_ENDPOINT;
  const VISITOR_KEY = 'scv_analytics_visitor';
  const SESSION_KEY = 'scv_analytics_session';
  const SESSION_ACTIVITY_KEY = 'scv_analytics_last_activity';
  const STARTED_KEY = 'scv_analytics_game_started';
  const NOTICE_ACCEPTED_KEY = 'scv_telemetry_notice_accepted_v2';
  const SESSION_IDLE_MS = 30 * 60 * 1000;
  const HEARTBEAT_INTERVAL_MS = 60 * 1000;
  const PAGE_NAMES = { 'game.html': 'game' };
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

  function detectDeviceProfile() {
    const ua = navigator.userAgent || '';
    const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(ua)
      || (/Android/i.test(ua) && !/Mobile/i.test(ua));
    const isMobile = !isTablet && /Android|iPhone|iPod|Mobile/i.test(ua);
    const browserName = /EdgA?\//.test(ua)
      ? 'Edge'
      : /OPR\//.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\//.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'unknown';
    const platformName = /Windows/i.test(ua)
      ? 'Windows'
      : /Android/i.test(ua)
        ? 'Android'
        : /iPhone|iPad|iPod/i.test(ua)
          ? 'iOS'
          : /Mac/i.test(ua)
            ? 'macOS'
            : /Linux/i.test(ua)
              ? 'Linux'
              : 'unknown';

    return {
      device_type: isTablet ? 'tablet' : isMobile ? 'mobile' : 'desktop',
      platform_name: platformName,
      browser_name: browserName,
    };
  }

  function send(type, metadata = {}) {
    const visitorId = getOrCreate(localStorage, VISITOR_KEY);
    const sessionId = getSessionId();
    const eventId = createId();
    if (!visitorId || !sessionId || !eventId) return Promise.resolve(false);
    const deviceProfile = detectDeviceProfile();

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
        metadata: {
          ...metadata,
          device_type: metadata.device_type || deviceProfile.device_type,
          platform_name: metadata.platform_name || deviceProfile.platform_name,
          browser_name: metadata.browser_name || deviceProfile.browser_name,
        },
        user_agent: navigator.userAgent.slice(0, 512),
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

  function removeNotice() {
    document.getElementById('scv-telemetry-consent')?.remove();
  }

  function dismissNotice() {
    removeNotice();
    document.getElementById('scv-telemetry-settings')?.remove();
  }

  function showTelemetryNotice() {
    removeNotice();
    if (localStorage.getItem(NOTICE_ACCEPTED_KEY) === 'yes') {
      dismissNotice();
      return;
    }
    const panel = document.createElement('section');
    panel.id = 'scv-telemetry-consent';
    panel.className = 'scv-telemetry-consent';
    panel.setAttribute('role', 'status');
    panel.setAttribute('aria-labelledby', 'scv-telemetry-title');
    panel.innerHTML = `
      <div class="scv-telemetry-copy">
        <strong id="scv-telemetry-title">Техническая статистика</strong>
        <p>Учитываются посещения, устройство и браузер, этапы игры и технические ошибки; случайный ID связывает визиты в этом браузере. Имя и ответы не собираются. <a href="privacy.html">Правила конфиденциальности</a>.</p>
      </div>
      <div class="scv-telemetry-actions">
        <button type="button" data-telemetry-action="accept">Понятно</button>
      </div>`;
    panel.querySelector('[data-telemetry-action="accept"]').addEventListener('click', () => {
      localStorage.setItem(NOTICE_ACCEPTED_KEY, 'yes');
      dismissNotice();
    });
    document.body.appendChild(panel);
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
    if (localStorage.getItem(NOTICE_ACCEPTED_KEY) === 'yes') {
      dismissNotice();
    } else {
      showTelemetryNotice();
    }
    trackPageView();
    startPresenceUpdates();
  }

  window.addEventListener('storage', event => {
    if (event.key === NOTICE_ACCEPTED_KEY && event.newValue === 'yes') dismissNotice();
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize, { once: true });
  } else {
    initialize();
  }
})();
