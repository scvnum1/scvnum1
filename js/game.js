// ─── Constants ────────────────────────────────────────────────────────────────
const SAVE_KEY = 'scv_save';

const BASE = (() => {
  const p = location.pathname;
  if (p.includes('/slovo_cherez_veka')) return '/slovo_cherez_veka';
  // local: derive base from current path (strip filename if any)
  return p.replace(/\/[^/]*$/, '');
})();
function asset(path) { return BASE + '/' + path.replace(/^\//, ''); }

const DIFF_LABELS = {
  novice:   'Первопроходец',
  explorer: 'Исследователь',
  keeper:   'Хранитель',
};

const ACHIEVEMENTS = [
  { id: 'first_word',   name: 'Первая грамота',       desc: 'Найди первое слово',          icon: 'scroll-text', color: '#c9a84c', bg: 'rgba(201,168,76,0.12)' },
  { id: 'act1_done',    name: 'Знаток Скриптория',    desc: 'Пройди Акт I',                icon: 'feather',     color: '#81c784', bg: 'rgba(100,200,100,0.12)' },
  { id: 'words_5',      name: 'Собиратель слов',      desc: 'Найди 5 слов',                icon: 'library',     color: '#64b5f6', bg: 'rgba(100,150,200,0.12)' },
  { id: 'score_50',     name: 'Острый ум',            desc: 'Набери 50 очков',             icon: 'zap',         color: '#ffb74d', bg: 'rgba(255,180,80,0.12)'  },
  { id: 'glagolica',    name: 'Знаток Глаголицы',     desc: 'Пройди Акт II',               icon: 'type',        color: '#f48fb1', bg: 'rgba(240,140,180,0.12)' },
  { id: 'dialects',     name: 'Покоритель Диалектов', desc: 'Пройди Акт IV',               icon: 'globe',       color: '#80cbc4', bg: 'rgba(100,200,190,0.12)' },
  { id: 'words_15',     name: 'Мастер Словесности',   desc: 'Найди 15 слов',               icon: 'award',       color: '#b39ddb', bg: 'rgba(150,100,200,0.12)' },
  { id: 'all_acts',     name: 'Летопись Единства',    desc: 'Пройди все 5 актов',          icon: 'crown',       color: '#f0d080', bg: 'rgba(240,210,80,0.12)'  },
];

// ─── State ────────────────────────────────────────────────────────────────────
let gameData = null;
let state = {
  score: 0,
  foundWords: [],
  completedLocations: [],
  unlockedAchievements: [],
  difficulty: 'explorer',
  currentDialogueId: null,
  currentLocation: null,
  currentDialogue: null,
  dialogueHistory: [],
  lastScreen: 'game',
  previousScreen: 'game',
};
window.SCVGameDifficulty = () => state.difficulty;
window.SCVGameReady = false;

// ─── Save / Load ──────────────────────────────────────────────────────────────
function saveProgress() {
  localStorage.setItem(SAVE_KEY, JSON.stringify({
    score: state.score,
    foundWords: state.foundWords,
    completedLocations: state.completedLocations,
    unlockedAchievements: state.unlockedAchievements,
    difficulty: state.difficulty,
    currentDialogueId: state.currentDialogueId,
    currentLocationId: state.currentLocation?.id,
    currentLocationActId: state.currentLocation?.actId,
  }));
}

function loadProgress() {
  const saved = localStorage.getItem(SAVE_KEY);
  if (!saved) return;
  const d = JSON.parse(saved);
  state.score = d.score ?? 0;
  state.foundWords = d.foundWords ?? [];
  state.completedLocations = d.completedLocations ?? [];
  state.unlockedAchievements = d.unlockedAchievements ?? [];
  state.difficulty = d.difficulty ?? 'explorer';
  state._savedDialogueId = d.currentDialogueId ?? null;
  state._savedLocationId = d.currentLocationId ?? null;
  state._savedLocationActId = d.currentLocationActId ?? null;

  if (state.completedLocations.includes('act1')) {
    const act1 = gameData?.acts?.find(act => act.id === 'act1');
    const completedCount = state.completedLocations.length;
    act1?.locations.forEach(location => {
      if (!state.completedLocations.includes(location.id)) {
        state.completedLocations.push(location.id);
      }
    });
    if (state.completedLocations.length !== completedCount) saveProgress();
  }
}

function hasSave() {
  return !!localStorage.getItem(SAVE_KEY);
}

// ─── Screens ──────────────────────────────────────────────────────────────────
const GAME_SCREENS = ['game', 'map', 'inventory'];

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById(`screen-${name}`);
  if (el) el.classList.add('active');

  const isGame = GAME_SCREENS.includes(name);
  document.getElementById('game-topbar').style.display = isGame ? 'flex' : 'none';

  if (name === 'map') { renderMap(); state.previousScreen = state.lastScreen; state.lastScreen = 'map'; }
  if (name === 'inventory') { renderInventory(); state.previousScreen = state.lastScreen; state.lastScreen = 'inventory'; }
  if (name === 'game') state.lastScreen = 'game';

  // кнопка назад к диалогу — видна только на карте если есть активный диалог
  const backBtn = document.getElementById('btn-back-to-game');
  if (backBtn) {
    backBtn.style.display = (name === 'map' && state.currentDialogue && state.currentDialogueId) ? 'flex' : 'none';
  }

  lucide.createIcons();
}

// ─── Difficulty ───────────────────────────────────────────────────────────────
function _syncDiffCards(containerSelector, diff) {
  document.querySelectorAll(containerSelector + ' .diff-card').forEach(c => {
    const sel = c.dataset.diff === diff;
    c.classList.toggle('selected', sel);
    // handle both landing (check-icon-*) and modal (mcheck-icon-*) prefixes
    c.querySelectorAll('[id*="check-icon-"]').forEach(ic => {
      ic.style.display = sel ? 'block' : 'none';
    });
  });
}

function selectDifficulty(diff) {
  state.difficulty = diff;
  _syncDiffCards('#difficulty', diff);
  document.getElementById('diff-badge').textContent = DIFF_LABELS[diff];
  saveProgress();
  lucide.createIcons();
}

function selectDifficultyModal(diff) {
  state.difficulty = diff;
  _syncDiffCards('#modal-diff-grid', diff);
  document.getElementById('diff-badge').textContent = DIFF_LABELS[diff];
  saveProgress();
  lucide.createIcons();
}

function openDifficultyModal() {
  // sync modal cards to current state
  _syncDiffCards('#modal-diff-grid', state.difficulty);
  lucide.createIcons();
  document.getElementById('modal-difficulty').classList.add('open');
}

function closeDifficultyModal() {
  document.getElementById('modal-difficulty').classList.remove('open');
}

// ─── Landing helpers ──────────────────────────────────────────────────────────
function scrollToSection(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
}

function continueGame() {
  if (state.currentDialogue && state.currentDialogueId) {
    showScreen('game');
    showDialogue(state.currentDialogueId);
  } else {
    showScreen('map');
  }
}

// ─── Intro cutscene ───────────────────────────────────────────────────────────
let introVideoPlayAttempt = null;

function startIntro(playPromise) {
  showScreen('intro');
  const video = document.getElementById('intro-video');
  const placeholder = document.getElementById('intro-placeholder');
  const skipBtn = document.getElementById('btn-skip-intro');
  let done = false;

  function showFallback() {
    if (done) return;
    if (video) {
      video.pause();
      video.style.display = 'none';
    }
    placeholder.style.display = 'flex';
    const timer = setTimeout(finish, 4500);
    skipBtn.onclick = () => { clearTimeout(timer); finish(); };
  }

  function finish() {
    if (done) return;
    done = true;
    if (video) video.pause();
    launchGame();
  }

  skipBtn.onclick = finish;

  if (!video) { showFallback(); return; }

  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.onended = finish;
  video.onerror = showFallback;

  const attemptPlay = () => {
    const p = video.play();
    if (p && typeof p.then === 'function') {
      p.catch(showFallback);
    }
  };

  if (playPromise && typeof playPromise.then === 'function') {
    playPromise.catch(showFallback);
    return;
  }

  if (video.readyState >= 2) {
    attemptPlay();
  } else {
    video.addEventListener('loadeddata', attemptPlay, { once: true });
  }
}

function launchGame() {
  showActSplash('Пролог', 'Слово через века', 'Начало путешествия', startPrologue);
}

// ─── Act Splash ───────────────────────────────────────────────────────────────
function showActSplash(eyebrow, title, sub, onDone) {
  const splash = document.getElementById('act-splash');
  document.getElementById('act-splash-eyebrow').textContent = eyebrow;
  document.getElementById('act-splash-title').textContent = title;
  document.getElementById('act-splash-sub').textContent = sub;
  splash.classList.add('visible');
  setTimeout(() => {
    splash.style.transition = 'opacity 0.8s ease';
    splash.style.opacity = '0';
    setTimeout(() => {
      splash.classList.remove('visible');
      splash.style.opacity = '';
      splash.style.transition = '';
      onDone?.();
    }, 800);
  }, 2200);
}

// ─── Background crossfade ─────────────────────────────────────────────────────
let bgFadeTimer = null;

function setGameBg(value) {
  const bg = document.getElementById('game-bg');
  const next = document.getElementById('game-bg-next');
  if (!bg || !next) return;

  const resolved = (value && (value.startsWith('assets') || value.startsWith('alenushka'))) ? asset(value) : value;
  const css = resolved ? `url('${resolved}') center/cover no-repeat` : resolved;

  const applyNewBg = () => {
    bg.style.background = css;
    next.style.opacity = '0';
  };

  if (bgFadeTimer) clearTimeout(bgFadeTimer);
  next.style.background = css;
  next.style.opacity = '1';
  bgFadeTimer = setTimeout(applyNewBg, 240);
}
function startPrologue() {
  if (!gameData?.prologue) { console.error('[startPrologue] gameData not ready'); return; }
  const p = gameData.prologue;
  state.currentDialogue = p.dialogue;
  state.currentDialogueId = p.dialogue[0].id;
  state.currentLocation = { id: 'prologue', title: p.title, actId: 'prologue' };
  state.dialogueHistory = [];
  document.getElementById('location-title').textContent = '';
  setGameBg(p.background);
  showScreen('game');
  showDialogue(state.currentDialogueId);
}

// ─── Аленушка sprite ────────────────────────────────────────────────────────
const ALENUSHKA_SPRITES = {
  default:  'alenushka/alenushka_full.png',
  happy:    'alenushka/alenushka_happy.png',
  idea:     'alenushka/alenushka_idea.png',
  pout:     'alenushka/alenushka_pout.png',
  shock:    'alenushka/alenushka_shock.png',
  confused: 'alenushka/alenushka_confused.png',
  funny:    'alenushka/alenushka_funny.png',
  none:     null,
};

const ALENUSHKA_FALLBACKS = {
  shock:    'alenushka/alenushka_full.png',
  confused: 'alenushka/alenushka_full.png',
  funny:    'alenushka/alenushka_idea.png',
};

function setAlenushkaEmotion(emotion) {
  const container = document.querySelector('.alenushka-container');
  const img = document.getElementById('alenushka-sprite');
  if (emotion === 'none') {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';
  const src = asset(ALENUSHKA_SPRITES[emotion] || ALENUSHKA_SPRITES.default);
  if (img.src === src) return;
  img.classList.add('fade-out');
  setTimeout(() => {
    img.src = src;
    img.onerror = () => {
      img.src = asset(ALENUSHKA_FALLBACKS[emotion] || ALENUSHKA_SPRITES.default);
      img.onerror = null;
    };
    img.classList.remove('fade-out');
  }, 200);
}

// ─── Dialogue engine ──────────────────────────────────────────────────────────
function getDialogueNode(id) {
  return state.currentDialogue.find(d => d.id === id);
}

function getNodeText(node) {
  const d = state.difficulty;
  if (d === 'explorer' && node.text_explorer) return node.text_explorer;
  if (d === 'keeper'   && node.text_keeper)   return node.text_keeper;
  return node.text || '';
}

function getChoiceText(choice) {
  const d = state.difficulty;
  if (d === 'explorer' && choice.text_explorer) return choice.text_explorer;
  if (d === 'keeper'   && choice.text_keeper)   return choice.text_keeper;
  return choice.text || '';
}

function showDialogue(nodeId, fromHistory = false) {
  const node = getDialogueNode(nodeId);
  if (!node) return;
  state.currentDialogueId = nodeId;

  // пишем историю только при движении вперёд
  if (!fromHistory) {
    state.dialogueHistory.push(nodeId);
  }
  updateDialogueNavBtns();
  lucide.createIcons();

  // сохраняем позицию диалога
  saveProgress();
  setAlenushkaEmotion(node.emotion || 'default');
  // switch background if node specifies one
  if (node.bg) {
    setGameBg(node.bg);
  }
  const speakerEl = document.getElementById('speaker-name');
  speakerEl.textContent = node.speaker || '';
  speakerEl.style.display = node.speaker ? 'inline-block' : 'none';
  document.getElementById('choices-container').innerHTML = '';

  // показываем картинку если есть
  const imgEl = document.getElementById('dialogue-image-wrap');
  if (node.image) {
    imgEl.innerHTML = `
      <div class="dlg-img-inner">
        <img src="${asset(node.image)}" alt="" class="dlg-img" />
        ${node.image_caption ? `<div class="dlg-img-caption">${node.image_caption}</div>` : ''}
      </div>`;
    imgEl.style.display = 'block';
  } else {
    imgEl.innerHTML = '';
    imgEl.style.display = 'none';
  }

  typeText(getNodeText(node), () => renderChoices(node));
}

function updateDialogueNavBtns() {
  const wrap = document.getElementById('dlg-nav-btns');
  if (!wrap) return;
  const len = state.dialogueHistory.length;
  wrap.style.display = len > 1 ? 'flex' : 'none';
  document.getElementById('dlg-btn-first').disabled = len <= 1;
  document.getElementById('dlg-btn-prev').disabled  = len <= 1;
}

function dialogueGoBack() {
  if (state.dialogueHistory.length <= 1) return;
  state.dialogueHistory.pop(); // убираем текущую
  const prevId = state.dialogueHistory[state.dialogueHistory.length - 1];
  showDialogue(prevId, true);
}

function dialogueGoFirst() {
  if (state.dialogueHistory.length <= 1) return;
  const firstId = state.dialogueHistory[0];
  state.dialogueHistory = [firstId];
  showDialogue(firstId, true);
}

let activeTypeTimer = null;

function typeText(text, onDone) {
  const el = document.getElementById('dialogue-text');
  if (activeTypeTimer) {
    clearInterval(activeTypeTimer);
    activeTypeTimer = null;
  }
  el.textContent = '';
  if (!text) { onDone?.(); return; }
  let i = 0;
  activeTypeTimer = setInterval(() => {
    el.textContent += text[i++];
    if (i >= text.length) {
      clearInterval(activeTypeTimer);
      activeTypeTimer = null;
      onDone?.();
    }
  }, 22);
  el.onclick = () => {
    if (activeTypeTimer) {
      clearInterval(activeTypeTimer);
      activeTypeTimer = null;
    }
    el.textContent = text;
    el.onclick = null;
    onDone?.();
  };
}

function renderChoices(node) {
  const c = document.getElementById('choices-container');
  c.innerHTML = '';

  if (node.reward) applyReward(node.reward);
  if (node.action === 'complete_location') completeLocation();
  if (node.action === 'complete_act1') { showAct1Finale(); return; }
  if (node.action === 'quiz') {
    const btn = document.createElement('button');
    btn.className = 'choice-btn choice-btn--continue';
    btn.innerHTML = '<i data-lucide="scroll-text" style="width:14px;height:14px;display:inline;vertical-align:middle"></i> Перейти к заданию';
    btn.onclick = () => startQuiz(node.quiz_id);
    c.appendChild(btn);
    lucide.createIcons();
    return;
  }
  if (node.action === 'start_act1') { showScreen('map'); return; }

  if (node.choices?.length) {
    node.choices.forEach((choice, idx) => {
      const btn = document.createElement('button');
      btn.className = 'choice-btn';
      btn.style.animationDelay = `${idx * 80}ms`;
      btn.textContent = getChoiceText(choice);
      btn.onclick = () => {
        state.score += choice.score || 0;
        updateScoreUI();
        saveProgress();
        checkAchievements();
        showDialogue(choice.next);
      };
      c.appendChild(btn);
    });
  } else if (node.next) {
    const btn = document.createElement('button');
    btn.className = 'choice-btn choice-btn--continue';
    btn.innerHTML = 'Продолжить <i data-lucide="arrow-right" style="width:14px;height:14px;display:inline;vertical-align:middle"></i>';
    btn.onclick = () => { showDialogue(node.next); lucide.createIcons(); };
    c.appendChild(btn);
    lucide.createIcons();
  } else {
    const btn = document.createElement('button');
    btn.className = 'choice-btn choice-btn--continue';
    btn.innerHTML = '<i data-lucide="map" style="width:14px;height:14px;display:inline;vertical-align:middle"></i> Открыть карту';
    btn.onclick = () => showScreen('map');
    c.appendChild(btn);
    lucide.createIcons();
  }
}

// ─── Quiz engine ─────────────────────────────────────────────────────────────
// ─── Quiz helpers ───────────────────────────────────────────────────────────
function showPisaloSuccess(wordForm) {
  const el = document.createElement('div');
  el.className = 'pisalo-success';
  el.innerHTML = `<img src="${asset('assets/images/act1/items/item_pisalo.png')}" alt=""><div class="pisalo-success-text">+ ${wordForm}</div>`;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function quizScrollWrap(inner) {
  return `<div class="quiz-scroll-wrap">
    <img class="quiz-scroll-bg" src="${asset('assets/images/act1/items/birch_scroll_empty.png')}" alt="" />
    <div class="quiz-scroll-content">${inner}</div>
  </div>`;
}

function startQuiz(quizId) {
  let quiz = gameData.quizzes[quizId];
  if (!quiz) return;
  // подменяем квиз на версию для сложности
  if (state.difficulty === 'explorer' && quiz.explorer_quiz_id) {
    quiz = gameData.quizzes[quiz.explorer_quiz_id] || quiz;
  } else if (state.difficulty === 'keeper' && quiz.keeper_quiz_id) {
    quiz = gameData.quizzes[quiz.keeper_quiz_id] || quiz;
  }
  document.getElementById('quiz-bg').style.background =
    `url('${asset('assets/images/act1/backgrounds/bg_scriptorium_desk.png')}') center/cover no-repeat`;
  showScreen('quiz');
  // чистим оставшуюся кнопку от предыдущего квиза
  document.querySelectorAll('#screen-quiz > .quiz-continue-btn').forEach(b => b.remove());
  const c = document.getElementById('quiz-container');
  c.innerHTML = '';
  if (quiz.type === 'choice')      renderChoiceQuiz(quiz, c);
  else if (quiz.type === 'fill')   renderFillQuiz(quiz, c);
  else if (quiz.type === 'match')  renderMatchQuiz(quiz, c);
  else if (quiz.type === 'odd_one_out') renderOddOneOutQuiz(quiz, c);
  else if (quiz.type === 'fill_rule')   renderFillRuleQuiz(quiz, c);
}

function quizDone(quiz, correct) {
  const alreadyDone = state.completedLocations.includes(quiz.location_id);
  if (correct && !alreadyDone) {
    const wordIds = quiz.reward_words || (quiz.reward_word ? [quiz.reward_word] : []);
    wordIds.forEach(id => {
      if (!state.foundWords.includes(id)) {
        state.foundWords.push(id);
        showWordToast(gameData.words[id]?.form || id);
      }
    });
    state.score += quiz.score || 0;
    updateScoreUI();
    updateInventoryCount();
    saveProgress();
    checkAchievements();
    if (typeof quiz.id === 'string') {
      window.SCVTelemetry?.trackQuizCompleted(quiz.id, state.score);
    }
  } else if (correct && alreadyDone) {
    updateInventoryCount();
  }
  if (correct) {
    // показываем кнопку «Продолжить» поверх результата
    setTimeout(() => {
      const c = document.getElementById('quiz-container');
      if (!c) return;
      const existing = c.querySelector('.quiz-continue-btn');
      if (existing) return;
      const btn = document.createElement('button');
      btn.className = 'choice-btn choice-btn--continue quiz-continue-btn';
      btn.style.cssText = 'margin:1rem auto 0;display:block';
      btn.innerHTML = 'Продолжить <i data-lucide="arrow-right" style="width:14px;height:14px;display:inline;vertical-align:middle"></i>';
      btn.onclick = () => {
        const dlg = gameData.post_quiz_dialogues[quiz.next_dialogue];
        if (dlg) {
          state.currentDialogue = dlg;
          state.currentDialogueId = dlg[0].id;
          showScreen('game');
          showDialogue(dlg[0].id);
        } else {
          showScreen('map');
        }
        lucide.createIcons();
      };
      // вставляем кнопку вне scroll-контейнера, прямо в screen-quiz
      const screen = document.getElementById('screen-quiz');
      screen.appendChild(btn);
      lucide.createIcons();
    }, 800);
  } else {
    // неверный ответ — ничего не делаем, игрок пробует снова
  }
}

function renderChoiceQuiz(quiz, c) {
  c.innerHTML = `
    <div class="quiz-eyebrow">${quiz.title}</div>
    ${quiz.word_highlight ? `<div class="quiz-word-highlight">${quiz.word_highlight}</div>` : ''}
    ${quizScrollWrap(`
      <div class="quiz-question">${quiz.question}</div>
      <div class="quiz-options" id="quiz-opts"></div>
      <div class="quiz-result" id="quiz-result">
        <div class="quiz-result-icon"><i data-lucide="star" style="width:2.2rem;height:2.2rem;color:var(--gold)"></i></div>
        <div class="quiz-result-text">Правильно! +${quiz.score} очков</div>
      </div>
    `)}
    <div class="quiz-alenushka-hint" id="quiz-hint" style="display:none">
      <img src="${asset('alenushka/alenushka_pout.png')}" class="quiz-alenushka-hint-img" alt="" />
      <div class="quiz-alenushka-hint-bubble">${quiz.hint}</div>
    </div>`;
  const opts = document.getElementById('quiz-opts');
  const shuffledOpts = [...quiz.options].sort(() => Math.random() - 0.5);
  shuffledOpts.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.innerHTML = `<i data-lucide="circle" class="opt-icon" style="width:16px;height:16px"></i><span>${opt.text}</span>`;
    btn.onclick = () => {
      opts.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
      if (opt.correct) {
        btn.classList.add('correct');
        const icon = btn.querySelector('svg') || btn.querySelector('i');
        if (icon) icon.setAttribute('data-lucide', 'check-circle');
        lucide.createIcons();
        document.getElementById('quiz-hint').style.display = 'none';
        document.getElementById('quiz-result').classList.add('visible');
        const wid = quiz.reward_word || quiz.reward_words?.[0];
        if (wid) showPisaloSuccess(gameData.words[wid]?.form || wid);
        quizDone(quiz, true);
      } else {
        btn.classList.add('wrong');
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => {
          btn.classList.remove('wrong');
          opts.querySelectorAll('.quiz-option').forEach(b => b.disabled = false);
        }, 600);
      }
    };
    opts.appendChild(btn);
  });
  lucide.createIcons();
}

function renderFillQuiz(quiz, c) {
  const letters = quiz.word_template.split('');
  c.innerHTML = `
    <div class="quiz-eyebrow">${quiz.title}</div>
    ${quizScrollWrap(`
      <div class="quiz-question">${quiz.question}</div>
      <div class="quiz-fill-word">${
        letters.map((l, i) => i === quiz.missing_index
          ? `<span class="quiz-fill-blank" id="fill-blank">_</span>`
          : `<span class="quiz-fill-letter">${l}</span>`
        ).join('')
      }</div>
      <div class="quiz-fill-options" id="fill-opts"></div>
      <div class="quiz-result" id="quiz-result">
        <div class="quiz-result-icon"><i data-lucide="star" style="width:2.2rem;height:2.2rem;color:var(--gold)"></i></div>
        <div class="quiz-result-text">Правильно! +${quiz.score} очков</div>
      </div>
    `)}
    <div class="quiz-alenushka-hint" id="quiz-hint" style="display:none">
      <img src="${asset('alenushka/alenushka_pout.png')}" class="quiz-alenushka-hint-img" alt="" />
      <div class="quiz-alenushka-hint-bubble">${quiz.hint}</div>
    </div>`;
  const opts = document.getElementById('fill-opts');
  const shuffledFill = [...quiz.options].sort(() => Math.random() - 0.5);
  shuffledFill.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'quiz-fill-btn';
    btn.textContent = letter;
    btn.onclick = () => {
      const blank = document.getElementById('fill-blank');
      blank.textContent = letter;
      opts.querySelectorAll('.quiz-fill-btn').forEach(b => b.disabled = true);
      if (letter === quiz.correct_option) {
        blank.classList.add('filled-correct');
        document.getElementById('quiz-hint').style.display = 'none';
        document.getElementById('quiz-result').classList.add('visible');
        const wid = quiz.reward_word || quiz.reward_words?.[0];
        if (wid) showPisaloSuccess(gameData.words[wid]?.form || wid);
        quizDone(quiz, true);
      } else {
        blank.classList.add('filled-wrong');
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => {
          blank.textContent = '_';
          blank.classList.remove('filled-wrong');
          opts.querySelectorAll('.quiz-fill-btn').forEach(b => b.disabled = false);
        }, 600);
      }
    };
    opts.appendChild(btn);
  });
  lucide.createIcons();
}

function renderFillRuleQuiz(quiz, c) {
  // Шаг 1: вставь букву. Шаг 2: выбери правило.
  const letters = quiz.word_template.split('');
  let step = 1;
  c.innerHTML = `
    <div class="quiz-eyebrow">${quiz.title}</div>
    ${quizScrollWrap(`
      <div class="quiz-question" id="fr-question">${quiz.question}</div>
      <div class="quiz-fill-word" id="fr-word">${
        letters.map((l, i) => i === quiz.missing_index
          ? `<span class="quiz-fill-blank" id="fill-blank">_</span>`
          : `<span class="quiz-fill-letter">${l}</span>`
        ).join('')
      }</div>
      <div class="quiz-fill-options" id="fill-opts"></div>
      <div class="quiz-rule-options" id="rule-opts" style="display:none"></div>
      <div class="quiz-result" id="quiz-result">
        <div class="quiz-result-icon"><i data-lucide="star" style="width:2.2rem;height:2.2rem;color:var(--gold)"></i></div>
        <div class="quiz-result-text" id="fr-result-text">Правильно! +${quiz.score} очков</div>
      </div>
    `)}
    <div class="quiz-alenushka-hint" id="quiz-hint" style="display:none">
      <img src="${asset('alenushka/alenushka_pout.png')}" class="quiz-alenushka-hint-img" alt="" />
      <div class="quiz-alenushka-hint-bubble" id="fr-hint-text">${quiz.hint_grade || quiz.hint}</div>
    </div>`;

  const fillOpts = document.getElementById('fill-opts');
  const ruleOpts = document.getElementById('rule-opts');

  // Шаг 1: вставь букву
  quiz.options.forEach(letter => {
    const btn = document.createElement('button');
    btn.className = 'quiz-fill-btn';
    btn.textContent = letter;
    btn.onclick = () => {
      const blank = document.getElementById('fill-blank');
      blank.textContent = letter;
      fillOpts.querySelectorAll('.quiz-fill-btn').forEach(b => b.disabled = true);
      if (letter === quiz.correct_option) {
        blank.classList.add('filled-correct');
        document.getElementById('quiz-hint').style.display = 'none';
        // Переходим к шагу 2
        setTimeout(() => {
          document.getElementById('fr-question').textContent = quiz.rule_question;
          fillOpts.style.display = 'none';
          ruleOpts.style.display = '';
          document.getElementById('fr-word').style.opacity = '0.4';
        }, 500);
      } else {
        blank.classList.add('filled-wrong');
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => {
          blank.textContent = '_';
          blank.classList.remove('filled-wrong');
          fillOpts.querySelectorAll('.quiz-fill-btn').forEach(b => b.disabled = false);
        }, 700);
      }
    };
    fillOpts.appendChild(btn);
  });

  // Шаг 2: выбери правило
  quiz.rule_options.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.innerHTML = `<i data-lucide="circle" class="opt-icon" style="width:16px;height:16px"></i><span>${opt.text}</span>`;
    btn.onclick = () => {
      ruleOpts.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
      if (opt.correct) {
        btn.classList.add('correct');
        document.getElementById('quiz-hint').style.display = 'none';
        const res = document.getElementById('quiz-result');
        res.classList.add('visible');
        document.getElementById('fr-result-text').innerHTML =
          `Правильно! +${quiz.score} очков<br><small style="opacity:.8;font-size:.8em">${quiz.explanation || ''}</small>`;
        const wid = quiz.reward_word || quiz.reward_words?.[0];
        if (wid) showPisaloSuccess(gameData.words[wid]?.form || wid);
        quizDone(quiz, true);
      } else {
        btn.classList.add('wrong');
        document.getElementById('fr-hint-text').textContent = quiz.hint_grade || quiz.hint;
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => {
          btn.classList.remove('wrong');
          ruleOpts.querySelectorAll('.quiz-option').forEach(b => b.disabled = false);
        }, 700);
      }
    };
    ruleOpts.appendChild(btn);
  });
  lucide.createIcons();
}

function renderOddOneOutQuiz(quiz, c) {
  const shuffled = [...quiz.options].sort(() => Math.random() - 0.5);
  c.innerHTML = `
    <div class="quiz-eyebrow">${quiz.title}</div>
    ${quiz.word_highlight ? `<div class="quiz-word-highlight">${quiz.word_highlight}</div>` : ''}
    ${quizScrollWrap(`
      <div class="quiz-question">${quiz.question}</div>
      <div class="quiz-options" id="quiz-opts"></div>
      <div class="quiz-result" id="quiz-result" style="display:none">
        <div class="quiz-result-icon"><i data-lucide="star" style="width:2.2rem;height:2.2rem;color:var(--gold)"></i></div>
        <div class="quiz-result-text" id="quiz-result-text"></div>
      </div>
    `)}
    <div class="quiz-alenushka-hint" id="quiz-hint" style="display:none">
      <img src="${asset('alenushka/alenushka_pout.png')}" class="quiz-alenushka-hint-img" alt="" />
      <div class="quiz-alenushka-hint-bubble">${quiz.hint_grade || quiz.hint}</div>
    </div>`;
  const opts = document.getElementById('quiz-opts');
  shuffled.forEach(opt => {
    const btn = document.createElement('button');
    btn.className = 'quiz-option';
    btn.innerHTML = `<i data-lucide="circle" class="opt-icon" style="width:16px;height:16px"></i><span>${opt.text}</span>`;
    btn.onclick = () => {
      opts.querySelectorAll('.quiz-option').forEach(b => b.disabled = true);
      if (opt.correct) {
        btn.classList.add('correct');
        document.getElementById('quiz-hint').style.display = 'none';
        const res = document.getElementById('quiz-result');
        res.style.display = '';
        res.classList.add('visible');
        document.getElementById('quiz-result-text').innerHTML =
          `Правильно! +${quiz.score} очков<br><small style="opacity:.8;font-size:.8em">${quiz.explanation || ''}</small>`;
        const wid = quiz.reward_word || quiz.reward_words?.[0];
        if (wid) showPisaloSuccess(gameData.words[wid]?.form || wid);
        quizDone(quiz, true);
      } else {
        btn.classList.add('wrong');
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => {
          btn.classList.remove('wrong');
          opts.querySelectorAll('.quiz-option').forEach(b => b.disabled = false);
        }, 700);
      }
    };
    opts.appendChild(btn);
  });
  lucide.createIcons();
}

function renderMatchQuiz(quiz, c) {
  const pairs = quiz.pairs;
  const shuffledModern = [...pairs].sort(() => Math.random() - 0.5);
  const pairColors = ['#e7b84f', '#62c6b0', '#a991e8', '#e88478', '#91bf68', '#df83ad', '#70a9d6'];
  let selectedPairIndex = null;
  let matchedCount = 0;
  c.innerHTML = `
    <div class="quiz-eyebrow">${quiz.title}</div>
    ${quizScrollWrap(`
      <div class="quiz-question">${quiz.question}</div>
      <div class="quiz-match">
        <svg class="quiz-match-connections" aria-hidden="true"></svg>
        <div class="quiz-match-col" id="match-ancient">
          <div class="quiz-match-heading">Древнее слово</div>
        </div>
        <div class="quiz-match-col" id="match-modern">
          <div class="quiz-match-heading">Современное значение</div>
        </div>
      </div>
      <div class="quiz-result" id="quiz-result">
        <div class="quiz-result-icon"><i data-lucide="star" style="width:2.2rem;height:2.2rem;color:var(--gold)"></i></div>
        <div class="quiz-result-text">Все пары совпали! +${quiz.score} очков</div>
      </div>
    `)}
    <div class="quiz-alenushka-hint" id="quiz-hint" style="display:none">
      <img src="${asset('alenushka/alenushka_pout.png')}" class="quiz-alenushka-hint-img" alt="" />
      <div class="quiz-alenushka-hint-bubble">${quiz.hint}</div>
    </div>`;
  const ancientCol = document.getElementById('match-ancient');
  const modernCol  = document.getElementById('match-modern');
  const matchRoot = ancientCol.parentElement;
  const connections = matchRoot.querySelector('.quiz-match-connections');
  const matchedPairs = new Set();
  const setPairTint = (element, index, alpha) => {
    const color = pairColors[index % pairColors.length];
    element.style.color = color;
    element.style.borderColor = color;
    element.style.backgroundColor = `${color}${alpha}`;
  };
  const clearPairTint = element => {
    element.style.removeProperty('color');
    element.style.removeProperty('border-color');
    element.style.removeProperty('background-color');
  };

  const drawConnections = () => {
    if (!matchRoot.isConnected) {
      resizeObserver.disconnect();
      return;
    }
    const rootRect = matchRoot.getBoundingClientRect();
    connections.setAttribute('viewBox', `0 0 ${rootRect.width} ${rootRect.height}`);
    connections.replaceChildren();
    matchedPairs.forEach(index => {
      const ancient = ancientCol.querySelector(`[data-pair-index="${index}"]`);
      const modern = modernCol.querySelector(`[data-pair-index="${index}"]`);
      if (!ancient || !modern) return;
      const ancientRect = ancient.getBoundingClientRect();
      const modernRect = modern.getBoundingClientRect();
      const x1 = ancientRect.right - rootRect.left;
      const y1 = ancientRect.top + ancientRect.height / 2 - rootRect.top;
      const x2 = modernRect.left - rootRect.left;
      const y2 = modernRect.top + modernRect.height / 2 - rootRect.top;
      const bend = Math.max(18, (x2 - x1) * 0.42);
      const color = pairColors[index % pairColors.length];
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('class', 'quiz-match-connection');
      path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
      path.style.setProperty('--pair-color', color);
      connections.appendChild(path);
      [ [x1, y1], [x2, y2] ].forEach(([x, y]) => {
        const node = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        node.setAttribute('class', 'quiz-match-connection-node');
        node.setAttribute('cx', x);
        node.setAttribute('cy', y);
        node.setAttribute('r', '4');
        node.style.setProperty('--pair-color', color);
        connections.appendChild(node);
      });
    });
  };
  const resizeObserver = new ResizeObserver(drawConnections);
  resizeObserver.observe(matchRoot);

  pairs.forEach((pair, index) => {
    const btn = document.createElement('div');
    btn.className = 'quiz-match-item';
    btn.textContent = pair.ancient;
    btn.dataset.ancient = pair.ancient;
    btn.dataset.pairIndex = index;
    btn.style.setProperty('--pair-color', pairColors[index % pairColors.length]);
    btn.onclick = () => {
      if (btn.classList.contains('matched')) return;
      ancientCol.querySelectorAll('.quiz-match-item').forEach(b => {
        if (!b.classList.contains('matched')) {
          b.classList.remove('selected');
          clearPairTint(b);
        }
      });
      btn.classList.add('selected');
      setPairTint(btn, index, '24');
      selectedPairIndex = index;
    };
    ancientCol.appendChild(btn);
  });
  shuffledModern.forEach(pair => {
    const index = pairs.indexOf(pair);
    const btn = document.createElement('div');
    btn.className = 'quiz-match-item';
    btn.textContent = pair.modern;
    btn.dataset.modern = pair.modern;
    btn.dataset.pairIndex = index;
    btn.style.setProperty('--pair-color', pairColors[index % pairColors.length]);
    btn.onclick = () => {
      if (selectedPairIndex === null || btn.classList.contains('matched')) return;
      if (selectedPairIndex === index) {
        btn.classList.add('matched');
        const ancient = ancientCol.querySelector(`[data-pair-index="${selectedPairIndex}"]`);
        ancient.classList.remove('selected');
        ancient.classList.add('matched');
        setPairTint(ancient, index, '20');
        setPairTint(btn, index, '20');
        matchedPairs.add(index);
        selectedPairIndex = null;
        matchedCount++;
        drawConnections();
        if (matchedCount === pairs.length) {
          document.getElementById('quiz-result').classList.add('visible');
          showPisaloSuccess('Все слова!');
          quizDone(quiz, true);
        }
      } else {
        btn.classList.add('wrong-flash');
        const ancient = ancientCol.querySelector(`[data-pair-index="${selectedPairIndex}"]`);
        ancient?.classList.remove('selected');
        if (ancient) clearPairTint(ancient);
        selectedPairIndex = null;
        document.getElementById('quiz-hint').style.display = 'flex';
        setTimeout(() => { btn.classList.remove('wrong-flash'); }, 600);
      }
    };
    modernCol.appendChild(btn);
  });
  drawConnections();
}

// ─── Act I Finale ─────────────────────────────────────────────────────────────
function showAct1Finale() {
  const act1 = gameData.acts.find(act => act.id === 'act1');
  act1?.locations.forEach(location => {
    if (!state.completedLocations.includes(location.id)) {
      state.completedLocations.push(location.id);
      window.SCVTelemetry?.trackLocationCompleted(location.id);
    }
  });
  if (!state.completedLocations.includes('act1')) state.completedLocations.push('act1');

  const el = document.getElementById('act-finale');
  document.getElementById('finale-title').textContent = 'Акт I завершён';
  document.getElementById('finale-sub').textContent = 'Первые слова уже в твоих руках';
  document.getElementById('finale-stats').innerHTML = `
    <div class="finale-stat">
      <div class="finale-stat-num">${state.foundWords.length}</div>
      <div class="finale-stat-label">слов</div>
    </div>
    <div class="finale-stat">
      <div class="finale-stat-num">${state.score}</div>
      <div class="finale-stat-label">очков</div>
    </div>
    <div class="finale-stat">
      <div class="finale-stat-num">${state.completedLocations.filter(id => id !== 'act1').length}</div>
      <div class="finale-stat-label">локации</div>
    </div>`;
  const act2 = gameData.acts.find(a => a.id === 'act2');
  if (act2) act2.unlocked = true;
  checkAchievements();
  saveProgress();
  el.classList.add('visible');
  lucide.createIcons();
  document.getElementById('finale-btn').onclick = () => {
    el.classList.remove('visible');
    showActSplash('Акт II', 'Печатный век', 'В разработке...', () => showScreen('map'));
  };
}

// ─── Rewards & Achievements ───────────────────────────────────────────────────
function applyReward(reward) {
  if (reward.type === 'word' && !state.foundWords.includes(reward.word.id)) {
    state.foundWords.push(reward.word.id);
    saveProgress();
    showWordToast(reward.word.form);
    updateInventoryCount();
    checkAchievements();
  }
}

function completeLocation() {
  const id = state.currentLocation?.id;
  if (id && !state.completedLocations.includes(id)) {
    state.completedLocations.push(id);
    window.SCVTelemetry?.trackLocationCompleted(id);
    saveProgress();
    checkAchievements();
  }
}

function checkAchievements() {
  const unlock = (id) => {
    if (!state.unlockedAchievements.includes(id)) {
      state.unlockedAchievements.push(id);
      saveProgress();
      const ach = ACHIEVEMENTS.find(a => a.id === id);
      if (ach) showAchievementToast(ach.name);
    }
  };
  if (state.foundWords.length >= 1)  unlock('first_word');
  if (state.foundWords.length >= 5)  unlock('words_5');
  if (state.foundWords.length >= 15) unlock('words_15');
  if (state.score >= 50)             unlock('score_50');
  if (state.completedLocations.includes('scriptorium')) unlock('act1_done');
}

// ─── UI Updates ───────────────────────────────────────────────────────────────
function updateScoreUI() {
  document.getElementById('score-display').textContent = state.score;
}

function updateInventoryCount() {
  document.getElementById('inv-count').textContent = state.foundWords.length;
}

// ─── Toasts ───────────────────────────────────────────────────────────────────
function showWordToast(word) {
  const toast = document.getElementById('word-toast');
  document.getElementById('toast-word').textContent = word;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3200);
}

function showAchievementToast(name) {
  const ach = ACHIEVEMENTS.find(a => a.name === name);
  const icon = ach?.icon || 'trophy';
  const color = ach?.color || 'var(--gold)';
  setTimeout(() => {
    const el = document.createElement('div');
    el.className = 'achievement-toast';
    el.innerHTML = `
      <div class="achievement-toast-icon" style="color:${color}">
        <i data-lucide="${icon}" style="width:18px;height:18px"></i>
      </div>
      <div class="achievement-toast-body">
        <div class="achievement-toast-label">Награда получена</div>
        <div class="achievement-toast-name">${name}</div>
      </div>`;
    document.body.appendChild(el);
    lucide.createIcons();
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }, 600);
}

// ─── Map ──────────────────────────────────────────────────────────────────────

// Позиции маркеров на карте (% от ширины/высоты картинки)
const MAP_POSITIONS = {
  act1: { x: 36, y: 38, icon: 'map_marker_village.png',    label: 'Древняя Русь' },
  act2: { x: 55, y: 32, icon: 'map_marker_monastery.png',  label: 'Печатный век' },
  act3: { x: 48, y: 55, icon: 'map_marker_locked.png',     label: 'Золотой век' },
  act4: { x: 62, y: 48, icon: 'map_marker_locked.png',     label: 'Языки народов' },
  act5: { x: 70, y: 40, icon: 'map_marker_locked.png',     label: 'Современность' },
};

function renderMap() {
  const markersEl = document.getElementById('map-markers');
  markersEl.innerHTML = '';

  gameData.acts.forEach(act => {
    const pos = MAP_POSITIONS[act.id];
    if (!pos) return;

    const marker = document.createElement('div');
    marker.className = `map-marker ${act.unlocked ? 'active-act' : 'locked'}`;
    marker.style.left = pos.x + '%';
    marker.style.top  = pos.y + '%';
    marker.dataset.act = act.id;

    marker.innerHTML = `
      <div class="map-marker-icon">
        <img src="${asset('assets/images/map/' + pos.icon)}" alt="" />
      </div>
      <div class="map-marker-pin"></div>
      <div class="map-marker-label">${pos.label}</div>`;

    if (act.unlocked) {
      marker.onclick = () => openMapPanel(act);
      marker.onmouseenter = (e) => showMapTooltip(e, act);
      marker.onmouseleave = () => hideMapTooltip();
    }

    markersEl.appendChild(marker);
  });

  // Панель закрыта по умолчанию
  document.getElementById('map-panel').classList.remove('open');
  document.getElementById('map-panel-close').onclick = () => {
    document.getElementById('map-panel').classList.remove('open');
  };

  lucide.createIcons();
}

function showMapTooltip(e, act) {
  const tip = document.getElementById('map-tooltip');
  const done = act.locations.filter(l => state.completedLocations.includes(l.id)).length;
  const total = act.locations.length;
  document.getElementById('map-tooltip-title').textContent = act.title;
  document.getElementById('map-tooltip-desc').textContent = total ? `${done}/${total} локаций` : 'В разработке...';
  const statusEl = document.getElementById('map-tooltip-status');
  statusEl.textContent = act.unlocked ? 'Открыто' : 'Закрыто';
  statusEl.className = 'map-tooltip-status' + (act.unlocked ? '' : ' locked');
  tip.style.left = (e.clientX + 14) + 'px';
  tip.style.top  = (e.clientY - 10) + 'px';
  tip.classList.add('visible');
}

function hideMapTooltip() {
  document.getElementById('map-tooltip').classList.remove('visible');
}

function openMapPanel(act) {
  hideMapTooltip();
  const panel = document.getElementById('map-panel');
  document.getElementById('map-panel-title').textContent = act.title;
  document.getElementById('map-panel-desc').textContent = act.locations.length
    ? 'Выбери локацию:'
    : 'Эта эпоха ещё не открыта.';

  const locsEl = document.getElementById('map-panel-locs');
  locsEl.innerHTML = '';

  act.locations.forEach((loc, idx) => {
    const done = state.completedLocations.includes(loc.id);
    const prevDone = idx === 0 || state.completedLocations.includes(act.locations[idx - 1].id);
    const locked = !prevDone;
    const btn = document.createElement('button');
    btn.className = `map-loc-btn ${done ? 'completed' : ''}`;
    if (locked) btn.disabled = true;
    btn.innerHTML = `
      <div class="map-loc-btn-icon">
        <i data-lucide="${done ? 'check-circle' : locked ? 'lock' : 'map-pin'}" style="width:15px;height:15px"></i>
      </div>
      <div class="map-loc-btn-text">
        <div class="map-loc-btn-name">${loc.title}</div>
        <div class="map-loc-btn-sub">${locked ? 'Сначала заверши предыдущую локацию' : loc.description}</div>
      </div>`;
    btn.onclick = () => {
      panel.classList.remove('open');
      startLocation(act.id, loc.id);
    };
    locsEl.appendChild(btn);
  });

  if (!act.locations.length) {
    locsEl.innerHTML = `<div style="color:var(--text-dim);font-size:0.85rem;font-style:italic;padding:1rem 0;text-align:center">В разработке...</div>`;
  }

  panel.classList.add('open');
  lucide.createIcons();
}

function startLocation(actId, locId) {
  const act = gameData.acts.find(a => a.id === actId);
  const loc = act?.locations.find(l => l.id === locId);
  if (!loc) return;
  state.currentLocation = { ...loc, actId };
  state.currentDialogue = loc.dialogue;
  state.currentDialogueId = loc.dialogue[0].id;
  state.dialogueHistory = [];
  document.getElementById('location-title').textContent = loc.title;
  setGameBg(loc.background);
  showScreen('game');
  showDialogue(state.currentDialogueId);
}

// ─── Inventory ────────────────────────────────────────────────────────────────
const WORDS_PER_PAGE = 6;
let archivePage = 0;

function renderInventory() {
  document.getElementById('archive-count').textContent = `${state.foundWords.length} слов`;
  renderArchivePage(0, 'none');
}

function renderArchivePage(page, direction) {
  const pages = document.getElementById('archive-pages');
  const dotsEl = document.getElementById('archive-dots');
  const infoEl = document.getElementById('archive-page-info');
  const words = state.foundWords;
  const totalPages = Math.max(1, Math.ceil(words.length / WORDS_PER_PAGE));
  page = Math.max(0, Math.min(page, totalPages - 1));
  archivePage = page;

  // dots
  dotsEl.innerHTML = Array.from({ length: totalPages }, (_, i) =>
    `<button class="archive-dot${i === page ? ' active' : ''}" onclick="goArchivePage(${i})"></button>`
  ).join('');

  infoEl.textContent = totalPages > 1 ? `${page + 1} / ${totalPages}` : '';
  document.getElementById('archive-prev').style.visibility = page > 0 ? 'visible' : 'hidden';
  document.getElementById('archive-next').style.visibility = page < totalPages - 1 ? 'visible' : 'hidden';

  const slice = words.slice(page * WORDS_PER_PAGE, (page + 1) * WORDS_PER_PAGE);

  // remove old page
  const old = pages.querySelector('.archive-page');
  if (old) {
    if (direction !== 'none') {
      old.classList.add(direction === 'right' ? 'page-exit-left' : 'page-exit-right');
      setTimeout(() => old.remove(), 350);
    } else {
      old.remove();
    }
  }

  const div = document.createElement('div');
  div.className = 'archive-page';

  if (!slice.length) {
    div.innerHTML = `<div class="archive-empty">
      <i data-lucide="book-open" style="width:40px;height:40px;opacity:0.3"></i>
      <p>Ты ещё не нашёл ни одного слова.<br>Исследуй локации!</p>
    </div>`;
  } else {
    div.innerHTML = slice.map((id, idx) => {
      const w = gameData.words[id];
      if (!w) return '';
      const num = String(page * WORDS_PER_PAGE + idx + 1).padStart(2, '0');
      return `<div class="word-card">
        <div class="word-card-num">#${num}</div>
        <div class="word-form">${w.form}</div>
        <div class="word-modern">→ ${w.modern}</div>
        <div class="word-era">${w.era}</div>
        <div class="word-divider"></div>
        <p class="word-desc">${w.description}</p>
      </div>`;
    }).join('');
  }

  if (direction !== 'none') {
    div.classList.add(direction === 'right' ? 'page-enter-right' : 'page-enter-left');
    setTimeout(() => div.classList.add('page-active'), 20);
  } else {
    div.classList.add('page-active');
  }

  pages.appendChild(div);
  // sync pages container height to content on mobile
  pages.style.height = '';
  lucide.createIcons();
}

function goArchivePage(page) {
  const direction = page > archivePage ? 'right' : 'left';
  renderArchivePage(page, direction);
}

// ─── Achievements ─────────────────────────────────────────────────────────────
function renderAchievements() {
  const grid = document.getElementById('achievements-grid');
  grid.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = state.unlockedAchievements.includes(a.id);
    return `<div class="ach-card ${unlocked ? 'unlocked' : 'locked'}">
      <div class="ach-icon" style="background:${a.bg};border:1px solid ${a.color}40">
        <i data-lucide="${a.icon}" style="width:24px;height:24px;color:${a.color}"></i>
      </div>
      <div class="ach-name">${a.name}</div>
      <div class="ach-desc">${unlocked ? a.desc : '???'}</div>
    </div>`;
  }).join('');
  lucide.createIcons();
}

function openAchievements() {
  renderAchievements();
  document.getElementById('modal-achievements').classList.add('open');
}

function closeAchievements() {
  document.getElementById('modal-achievements').classList.remove('open');
}

// ─── Init (game.html) ─────────────────────────────────────────────────────────
async function init() {
  const res = await fetch(asset('data/gameData.json'));
  gameData = await res.json();

  loadProgress();
  window.SCVGameReady = true;
  window.SCVTelemetry?.trackGameStart(state.difficulty);
  updateScoreUI();
  updateInventoryCount();
  document.getElementById('diff-badge').textContent = DIFF_LABELS[state.difficulty];

  // Game topbar
  document.getElementById('btn-map').onclick = () => showScreen('map');
  document.getElementById('btn-inventory').onclick = () => showScreen('inventory');
  document.getElementById('btn-achievements').onclick = openAchievements;
  document.getElementById('btn-back-to-game').onclick = () => showScreen('game');

  // Map / Inventory back
  document.getElementById('btn-back-map').onclick = () => {
    const prev = state.previousScreen;
    if (prev === 'game' && state.currentDialogue && state.currentDialogueId) {
      showScreen('game');
    } else {
      showScreen('game');
    }
  };
  document.getElementById('btn-back-inv').onclick = () => {
    const last = state.lastScreen;
    if (last === 'map') { showScreen('map'); return; }
    if (state.currentDialogue && state.currentDialogueId) {
      showScreen('game');
    } else {
      showScreen('map');
    }
  };
  document.getElementById('archive-prev').onclick = () => goArchivePage(archivePage - 1);
  document.getElementById('archive-next').onclick = () => goArchivePage(archivePage + 1);

  // Achievements modal close
  document.getElementById('btn-close-achievements').onclick = closeAchievements;
  document.getElementById('modal-achievements').onclick = (e) => {
    if (e.target === e.currentTarget) closeAchievements();
  };

  // Читаем флаг из localStorage
  let save = {};
  try { save = JSON.parse(localStorage.getItem(SAVE_KEY)) || {}; } catch {}

  if (save.freshStart) {
    // пришли с лендинга — запускаем интро + пролог заново
    delete save.freshStart;
    // сбрасываем игровой прогресс но сохраняем сложность
    state.score = 0;
    state.foundWords = [];
    state.completedLocations = [];
    state.unlockedAchievements = [];
    state.currentDialogue = null;
    state.currentDialogueId = null;
    saveProgress();
    updateScoreUI();
    updateInventoryCount();
    const video = document.getElementById('intro-video');
    if (video) video.currentTime = 0;
    const playPromise = video ? video.play() : null;
    if (playPromise) playPromise.catch(() => {});
    startIntro(playPromise);
  } else if (state._savedDialogueId && state._savedLocationId) {
    // восстанавливаем диалог из сохранения
    const savedLocId = state._savedLocationId;
    const savedActId = state._savedLocationActId;
    const savedDlgId = state._savedDialogueId;

    if (savedActId === 'prologue') {
      state.currentDialogue = gameData.prologue.dialogue;
      state.currentLocation = { id: 'prologue', title: gameData.prologue.title, actId: 'prologue' };
      setGameBg(gameData.prologue.background);
      document.getElementById('location-title').textContent = '';
    } else {
      // ищем в post_quiz_dialogues
      const postDlg = gameData.post_quiz_dialogues[savedDlgId];
      if (postDlg) {
        state.currentDialogue = postDlg;
      } else {
        // ищем локацию в актах
        let found = false;
        for (const act of gameData.acts) {
          const loc = act.locations.find(l => l.id === savedLocId);
          if (loc) {
            state.currentLocation = { ...loc, actId: act.id };
            state.currentDialogue = loc.dialogue;
            setGameBg(loc.background);
            document.getElementById('location-title').textContent = loc.title;
            found = true;
            break;
          }
        }
        if (!found) { showScreen('map'); return; }
      }
    }
    state.currentDialogueId = savedDlgId;
    showScreen('game');
    showDialogue(savedDlgId);
  } else if (state.completedLocations.length > 0) {
    // прогресс есть но диалог не сохранён — открываем карту
    showScreen('map');
  } else {
    // нет прогресса — запускаем пролог
    showScreen('game');
    showActSplash('Пролог', 'Слово через века', 'Начало путешествия', startPrologue);
  }

  lucide.createIcons();
}

document.addEventListener('DOMContentLoaded', init);

// ─── 3D Coverflow Carousel ──────────────────────────────────────────
function initCarousel() {
  const slides = Array.from(document.querySelectorAll('.carousel-slide'));
  const dotsContainer = document.getElementById('carousel-dots');
  if (!slides.length || !dotsContainer) return;

  const total = slides.length;
  let current = 0;
  let autoTimer = null;
  let dragStartX = 0;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'carousel-dot';
    dot.setAttribute('aria-label', `Слайд ${i + 1}`);
    dot.onclick = () => goTo(i);
    dotsContainer.appendChild(dot);
  });

  function applyPositions() {
    const leftIdx  = ((current - 1) + total) % total;
    const rightIdx = (current + 1) % total;
    slides.forEach((slide, i) => {
      slide.classList.remove('pos-center', 'pos-left', 'pos-right');
      if (i === current)        slide.classList.add('pos-center');
      else if (i === leftIdx)   slide.classList.add('pos-left');
      else if (i === rightIdx)  slide.classList.add('pos-right');
    });
    Array.from(dotsContainer.children).forEach((d, i) => {
      d.classList.toggle('active', i === current);
    });
    lucide.createIcons();
  }

  function goTo(idx) {
    current = ((idx % total) + total) % total;
    applyPositions();
    resetAuto();
  }

  function resetAuto() {
    clearInterval(autoTimer);
    autoTimer = setInterval(() => goTo(current + 1), 3800);
  }

  document.getElementById('carousel-prev').onclick = () => goTo(current - 1);
  document.getElementById('carousel-next').onclick = () => goTo(current + 1);

  slides.forEach((slide, i) => {
    slide.addEventListener('click', () => { if (i !== current) goTo(i); });
  });

  const track = document.getElementById('carousel-track');
  track.addEventListener('mousedown',  e => { dragStartX = e.clientX; });
  track.addEventListener('mouseup',    e => {
    const dx = e.clientX - dragStartX;
    if (Math.abs(dx) > 50) goTo(dx < 0 ? current + 1 : current - 1);
  });
  track.addEventListener('touchstart', e => { dragStartX = e.touches[0].clientX; }, { passive: true });
  track.addEventListener('touchend',   e => {
    const dx = e.changedTouches[0].clientX - dragStartX;
    if (Math.abs(dx) > 40) goTo(dx < 0 ? current + 1 : current - 1);
  });

  applyPositions();
  resetAuto();
}

document.addEventListener('DOMContentLoaded', initCarousel);