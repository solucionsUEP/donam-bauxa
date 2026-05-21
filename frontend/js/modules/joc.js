/**
 * @module joc
 * @description Guessing Game module for Dona'm Bauxa SPA.
 * Supports named questionnaires (filtered by questionnaire ID) and a Random mix mode.
 */

import { t } from '../i18n.js';

/* ------------------------------------------------------------------ */
/*  Centralized game state                                             */
/* ------------------------------------------------------------------ */

export const gameState = {
  mode: null,           // 'random' | null (null when using a named questionnaire)
  questionnaire: null,  // the active questionnaire definition object
  length: null,         // 5 | 20
  questionnaires: [],   // all questionnaire defs loaded from JSON
  allQuestions: [],     // full question pool, cached after first fetch
  questions: [],        // shuffled subset for the active game
  currentIndex: 0,
  score: 0,
  answers: [],          // [{ questionId, category, chosen, correct, chosenLabel, correctLabel, isCorrect }]
  phase: 'setup'        // 'setup' | 'playing' | 'results'
};

/* ------------------------------------------------------------------ */
/*  Schema.org normalizers                                             */
/* ------------------------------------------------------------------ */

function normalizeQuestion(schemaQuestion) {
  const mediaType = schemaQuestion.associatedMedia?.['@type'];
  let type, src;

  if (mediaType === 'AudioObject') {
    type = 'music';
    const url = schemaQuestion.associatedMedia.contentUrl;
    const fmt = schemaQuestion.associatedMedia.encodingFormat || 'audio/mpeg';
    src  = { url, format: fmt };
  } else if (mediaType === 'ImageObject') {
    type = 'picture';
    src  = {};
    for (const enc of schemaQuestion.associatedMedia.encoding || []) {
      if (enc.encodingFormat === 'image/webp')  src.webp = enc.contentUrl;
      if (enc.encodingFormat === 'image/jpeg')  src.jpg  = enc.contentUrl;
    }
  } else if (mediaType === 'VideoObject') {
    type = 'video';
    src  = {};
    for (const enc of schemaQuestion.associatedMedia.encoding || []) {
      if (enc.encodingFormat === 'video/webm')  src.webm = enc.contentUrl;
      if (enc.encodingFormat === 'video/mp4')   src.mp4  = enc.contentUrl;
    }
  }

  const answers    = [...(schemaQuestion.suggestedAnswer || [])].sort((a, b) => a.position - b.position);
  const acceptedId = schemaQuestion.acceptedAnswer?.['@id'];

  return {
    id:       schemaQuestion['@id'],
    type,
    src,
    options:  answers.map(a => a.text),
    answer:   answers.findIndex(a => a['@id'] === acceptedId),
    category: schemaQuestion.about?.name ?? ''
  };
}

function normalizeQuestionnaire(schemaQuiz) {
  const imgEncodings = schemaQuiz.image?.encoding ?? [];
  return {
    id:          schemaQuiz['@id'],
    name:        schemaQuiz.name,
    badge:       schemaQuiz.badge,
    section:     schemaQuiz.section,
    color1:      schemaQuiz.color1,
    color2:      schemaQuiz.color2,
    image: {
      webp: imgEncodings.find(e => e.encodingFormat === 'image/webp')?.contentUrl ?? null,
      jpg:  imgEncodings.find(e => e.encodingFormat === 'image/jpeg')?.contentUrl ?? null
    },
    questionIds: (schemaQuiz.hasPart ?? []).map(ref => ref['@id'])
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = String(text);
  return div.innerHTML;
}

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function showPhase(phase) {
  document.getElementById('jocSetup').style.display   = phase === 'setup'   ? '' : 'none';
  document.getElementById('jocPlaying').style.display = phase === 'playing' ? '' : 'none';
  document.getElementById('jocResults').style.display = phase === 'results' ? '' : 'none';
  gameState.phase = phase;
}

function showWarning(message) {
  const el = document.getElementById('jocWarning');
  if (!el) return;
  el.textContent = message;
  el.style.display = message ? '' : 'none';
}

function getQuestionPool() {
  if (gameState.questionnaire) {
    const ids = new Set(gameState.questionnaire.questionIds);
    return gameState.allQuestions.filter(q => ids.has(q.id));
  }
  return [...gameState.allQuestions]; // random mode: use everything
}

/* ------------------------------------------------------------------ */
/*  Media rendering                                                    */
/* ------------------------------------------------------------------ */

function renderMedia(question) {
  const { type, src } = question;

  if (type === 'music') {
    return `
      <div class="joc-media-wrapper joc-media-wrapper--audio">
        <div class="joc-audio-icon" aria-hidden="true"><i class="bi bi-music-note-beamed"></i></div>
        <audio class="joc-audio" controls autoplay aria-label="${t('joc.musicFragment')}">
          <source src="${escapeHtml(src.url)}" type="${escapeHtml(src.format)}">
        </audio>
      </div>`;
  }

  if (type === 'picture') {
    return `
      <div class="joc-media-wrapper">
        <picture>
          ${src.webp ? `<source srcset="${escapeHtml(src.webp)}" type="image/webp">` : ''}
          <img src="${escapeHtml(src.jpg || src.png || '')}" alt="${t('joc.imageFragment')}" class="joc-media-img" loading="eager">
        </picture>
      </div>`;
  }

  if (type === 'video') {
    return `
      <div class="joc-media-wrapper">
        <video class="joc-media-video" controls autoplay playsinline muted aria-label="${t('joc.videoFragment')}">
          ${src.webm ? `<source src="${escapeHtml(src.webm)}" type="video/webm">` : ''}
          ${src.mp4  ? `<source src="${escapeHtml(src.mp4)}"  type="video/mp4">` : ''}
        </video>
      </div>`;
  }

  return '';
}

/* ------------------------------------------------------------------ */
/*  Setup phase                                                        */
/* ------------------------------------------------------------------ */

function questionnaireCount(qid) {
  return gameState.questionnaires.find(q => q.id === qid)?.questionIds?.length ?? 0;
}

function presetBtn({ mode = null, questionnaireId = null, length, label, ariaLabel }) {
  const count = questionnaireId
    ? questionnaireCount(questionnaireId)
    : gameState.allQuestions.length;
  const isDisabled = count < length;
  const disabledAttrs = isDisabled
    ? `disabled aria-disabled="true" title="${t('joc.notEnoughTitle', { count })}"`
    : '';
  const dataAttrs = questionnaireId
    ? `data-questionnaire="${questionnaireId}" data-length="${length}"`
    : `data-mode="${mode}" data-length="${length}"`;
  return `<button
      class="joc-preset-btn"
      ${dataAttrs}
      aria-label="${escapeHtml(ariaLabel)}"
      ${disabledAttrs}>
      ${escapeHtml(label)}
    </button>`;
}

function renderBannerCard(q) {
  const count = questionnaireCount(q.id);
  const hasImage = q.image?.jpg;

  // Background: image (when available) or gradient fallback
  const bgStyle = hasImage
    ? `background-image:url('${escapeHtml(q.image.jpg)}');background-size:cover;background-position:center;`
    : `background:linear-gradient(135deg,${q.color1} 0%,${q.color2} 100%);`;

  return `
    <article
      class="joc-banner-card"
      style="${bgStyle}"
      aria-labelledby="jocBanner-${q.id}">
      <div class="joc-banner-card__content">
        <span class="joc-banner-badge" aria-hidden="true">${escapeHtml(q.badge)}</span>
        <div class="joc-banner-card__bottom">
          <h3 id="jocBanner-${q.id}" class="joc-banner-card__title">${escapeHtml(q.name)}</h3>
          <p class="joc-banner-card__meta">
            <i class="bi bi-collection" aria-hidden="true"></i>
            <span aria-label="${t('joc.questionsAvailable', { count }, count)}">${t('joc.questionCount', { count })}</span>
          </p>
          <div class="joc-banner-card__actions" role="group" aria-label="Longitud de ${escapeHtml(q.name)}">
            ${presetBtn({ questionnaireId: q.id, length: 5,  label: 'Quick 5',  ariaLabel: `${q.name} · ${t('joc.questionCount', { count: 5 })}` })}
            ${presetBtn({ questionnaireId: q.id, length: 20, label: 'Full 20', ariaLabel: `${q.name} · ${t('joc.questionCount', { count: 20 })}` })}
          </div>
        </div>
      </div>
    </article>`;
}

function renderSetup() {
  const setup = document.getElementById('jocSetup');
  if (!setup) return;

  const SECTIONS = [
    { id: 'music',   label: t('joc.sectionMusic'),  icon: 'bi-music-note-beamed' },
    { id: 'picture', label: t('joc.sectionImage'),  icon: 'bi-image' },
    { id: 'video',   label: t('joc.sectionVideo'),  icon: 'bi-play-circle-fill' }
  ];

  const totalCount = gameState.allQuestions.length;

  const sectionsHtml = SECTIONS.map(sec => {
    const qs = gameState.questionnaires.filter(q => q.section === sec.id);
    if (!qs.length) return '';
    return `
      <section class="joc-section" aria-labelledby="jocSec-${sec.id}">
        <div class="joc-section__header">
          <span class="joc-section__icon" aria-hidden="true">
            <i class="bi ${sec.icon}"></i>
          </span>
          <h3 id="jocSec-${sec.id}" class="joc-section__title">${sec.label}</h3>
        </div>
        <div class="joc-scroll-row" role="list">
          ${qs.map(q => `
            <div class="joc-scroll-item" role="listitem">
              ${renderBannerCard(q)}
            </div>`).join('')}
        </div>
      </section>`;
  }).join('');

  setup.innerHTML = `
    <div
      id="jocWarning"
      class="alert alert-warning mb-4"
      role="alert"
      aria-live="polite"
      style="display:none;">
    </div>

    <!-- Compact random strip -->
    <div class="joc-random-strip mb-5" role="region" aria-label="${t('joc.modeRandom')}">
      <div class="joc-random-strip__left">
        <span class="joc-random-strip__icon" aria-hidden="true">
          <i class="bi bi-shuffle"></i>
        </span>
        <div class="joc-random-strip__text">
          <strong class="joc-random-strip__label">${t('joc.modeRandom')}</strong>
          <span class="joc-random-strip__desc">${t('joc.modeRandomCountDesc', { count: totalCount })}</span>
        </div>
      </div>
      <div class="joc-random-strip__actions" role="group" aria-label="Longitud del mode aleatori">
        ${presetBtn({ mode: 'random', length: 5,  label: 'Quick 5',  ariaLabel: `${t('joc.random')} · ${t('joc.questionCount', { count: 5 })}` })}
        ${presetBtn({ mode: 'random', length: 20, label: 'Full 20', ariaLabel: `${t('joc.random')} · ${t('joc.questionCount', { count: 20 })}` })}
      </div>
    </div>

    <!-- Three format sections -->
    ${sectionsHtml}`;
}

/* ------------------------------------------------------------------ */
/*  Playing phase                                                      */
/* ------------------------------------------------------------------ */

function renderQuestion() {
  const playing = document.getElementById('jocPlaying');
  if (!playing) return;

  const q = gameState.questions[gameState.currentIndex];
  const total = gameState.questions.length;
  const progress = (gameState.currentIndex / total) * 100;
  const LETTERS = ['A', 'B', 'C', 'D'];

  playing.innerHTML = `
    <div class="joc-hud mb-3">
      <span class="joc-score-chip" aria-live="polite" aria-label="${t('joc.score', { n: gameState.score })}">
        <i class="bi bi-star-fill me-1" aria-hidden="true"></i>${t('joc.score', { n: gameState.score })}
      </span>
      <span class="joc-counter" aria-label="${t('joc.questionCounter', { current: gameState.currentIndex + 1, total })}">
        ${t('joc.questionLabel')} <strong>${gameState.currentIndex + 1}</strong> / ${total}
      </span>
    </div>

    <div
      class="joc-progress-track mb-4"
      role="progressbar"
      aria-valuenow="${gameState.currentIndex}"
      aria-valuemin="0"
      aria-valuemax="${total}"
      aria-label="${t('joc.progressLabel')}">
      <div class="joc-progress-bar" style="width:${progress}%"></div>
    </div>

    <div class="joc-card mb-4">
      <p class="joc-category-tag mb-3">
        <i class="bi bi-tag me-1" aria-hidden="true"></i>
        <span>${escapeHtml(q.category)}</span>
      </p>
      ${renderMedia(q)}
    </div>

    <div class="joc-options" id="jocOptions" role="group" aria-label="${t('joc.answerOptions')}">
      ${q.options.map((opt, i) => `
        <button
          class="joc-option-btn"
          data-option-index="${i}"
          aria-label="${t('joc.optionLabel', { letter: LETTERS[i], text: opt })}">
          <span class="joc-option-letter" aria-hidden="true">${LETTERS[i]}</span>
          <span class="joc-option-text">${escapeHtml(opt)}</span>
        </button>`).join('')}
    </div>

    <div class="text-center mt-4">
      <button id="jocNextBtn" class="btn-bauxa px-4" style="display:none;">
        ${gameState.currentIndex + 1 < total
          ? `${t('joc.nextQuestion')} <i class="bi bi-arrow-right ms-1" aria-hidden="true"></i>`
          : `${t('joc.viewResults')} <i class="bi bi-trophy ms-1" aria-hidden="true"></i>`}
      </button>
    </div>`;

  document.getElementById('jocOptions')?.addEventListener('click', onOptionClick);
  document.getElementById('jocNextBtn')?.addEventListener('click', onNext);
}

function onOptionClick(e) {
  const btn = e.target.closest('[data-option-index]');
  if (!btn) return;

  const chosen = parseInt(btn.dataset.optionIndex, 10);
  const q = gameState.questions[gameState.currentIndex];
  const isCorrect = chosen === q.answer;

  if (isCorrect) gameState.score += 10;

  gameState.answers.push({
    questionId: q.id,
    category: q.category,
    chosen,
    correct: q.answer,
    chosenLabel: q.options[chosen],
    correctLabel: q.options[q.answer],
    isCorrect
  });

  document.querySelectorAll('#jocOptions .joc-option-btn').forEach(b => {
    b.disabled = true;
    b.setAttribute('aria-disabled', 'true');
    const idx = parseInt(b.dataset.optionIndex, 10);
    if (idx === q.answer) {
      b.classList.add('joc-option-btn--correct');
      b.setAttribute('aria-label', `${b.querySelector('.joc-option-text').textContent} — ${t('joc.correct')}`);
    }
    if (idx === chosen && !isCorrect) {
      b.classList.add('joc-option-btn--wrong');
      b.setAttribute('aria-label', `${b.querySelector('.joc-option-text').textContent} — ${t('joc.wrong')}`);
    }
  });

  const nextBtn = document.getElementById('jocNextBtn');
  nextBtn.style.display = '';
  nextBtn.focus();
}

function onNext() {
  gameState.currentIndex++;
  if (gameState.currentIndex >= gameState.questions.length) {
    renderResults();
    showPhase('results');
  } else {
    renderQuestion();
  }
}

/* ------------------------------------------------------------------ */
/*  Results phase                                                      */
/* ------------------------------------------------------------------ */

function renderResults() {
  const results = document.getElementById('jocResults');
  if (!results) return;

  const total = gameState.questions.length;
  const correct = gameState.answers.filter(a => a.isCorrect).length;
  const pct = Math.round((correct / total) * 100);

  let emoji = '😔';
  if (pct >= 80) emoji = '🏆';
  else if (pct >= 50) emoji = '👍';
  else if (pct >= 30) emoji = '🙂';

  const breakdown = gameState.answers.map((a, i) => `
    <div class="joc-result-row ${a.isCorrect ? 'joc-result-row--correct' : 'joc-result-row--wrong'}">
      <span class="joc-result-num" aria-hidden="true">${i + 1}</span>
      <div class="joc-result-detail">
        <span class="joc-result-category">${escapeHtml(a.category)}</span>
        <span class="joc-result-answer">
          ${a.isCorrect
            ? `<i class="bi bi-check-circle-fill text-success me-1" aria-hidden="true"></i>${escapeHtml(a.correctLabel)}`
            : `<i class="bi bi-x-circle-fill text-danger me-1" aria-hidden="true"></i>${escapeHtml(a.chosenLabel)}
               <span class="joc-result-correct-hint">${t('joc.correctHint', { text: escapeHtml(a.correctLabel) })}</span>`
          }
        </span>
      </div>
    </div>`).join('');

  const displayName = gameState.questionnaire?.name ?? t('joc.random');
  const displayBadge = gameState.questionnaire?.badge ?? t('joc.shuffle');

  results.innerHTML = `
    <div class="joc-card text-center mb-4" aria-live="polite">
      <div class="joc-result-emoji" role="img" aria-label="Resultat: ${pct}${t('joc.correctPct')}">${emoji}</div>
      <h3 class="joc-result-score">${correct} / ${total}</h3>
      <p class="joc-result-pct text-muted-custom">${pct}${t('joc.correctPct')}</p>
      <p class="joc-result-pts">
        <i class="bi bi-star-fill me-1" aria-hidden="true"></i>${t('joc.scoreTotals', { n: gameState.score })}
      </p>
      <p class="joc-result-meta">
        <span class="badge-genre">${escapeHtml(displayBadge)}</span>
        <span class="badge-genre">${escapeHtml(displayName)}</span>
        <span class="badge-genre">${t('joc.questionCount', { count: total })}</span>
      </p>
    </div>

    <div class="joc-breakdown mb-5" aria-label="${t('joc.resultsSummary')}">
      ${breakdown}
    </div>

    <div class="d-flex gap-3 justify-content-center flex-wrap">
      <button id="jocPlayAgainBtn" class="btn-bauxa px-4">
        <i class="bi bi-arrow-repeat me-1" aria-hidden="true"></i>${t('joc.playAgain')}
      </button>
      <button id="jocChangeModeBtn" class="btn-bauxa-outline px-4">
        <i class="bi bi-sliders me-1" aria-hidden="true"></i>${t('joc.changeQuestionnaire')}
      </button>
    </div>`;

  document.getElementById('jocPlayAgainBtn')?.addEventListener('click', () => startGame());
  document.getElementById('jocChangeModeBtn')?.addEventListener('click', () => {
    gameState.questionnaire = null;
    gameState.mode = null;
    gameState.length = null;
    resetToSetup();
  });
}

/* ------------------------------------------------------------------ */
/*  Game flow                                                          */
/* ------------------------------------------------------------------ */

function startGame() {
  const pool = getQuestionPool();

  if (pool.length < gameState.length) {
    showWarning(t('joc.notEnoughQuestions', { count: pool.length }));
    return;
  }

  showWarning('');
  gameState.questions = shuffle(pool).slice(0, gameState.length);
  gameState.currentIndex = 0;
  gameState.score = 0;
  gameState.answers = [];

  renderQuestion();
  showPhase('playing');
}

function resetToSetup() {
  renderSetup();
  showPhase('setup');
  attachSetupListeners();
}

function attachSetupListeners() {
  document.getElementById('jocSetup')?.addEventListener('click', e => {
    const btn = e.target.closest('.joc-preset-btn:not([disabled])');
    if (!btn) return;

    gameState.length = parseInt(btn.dataset.length, 10);

    if (btn.dataset.mode === 'random') {
      gameState.questionnaire = null;
      gameState.mode = 'random';
    } else if (btn.dataset.questionnaire) {
      gameState.questionnaire = gameState.questionnaires.find(q => q.id === btn.dataset.questionnaire) ?? null;
      gameState.mode = null;
    }

    startGame();
  });
}

/* ------------------------------------------------------------------ */
/*  Public entry point                                                 */
/* ------------------------------------------------------------------ */

export async function initJoc() {
  if (!gameState.allQuestions.length) {
    try {
      const [qData, qdData] = await Promise.all([
        fetch('data/questions.json').then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        }),
        fetch('data/questionnaires.json').then(r => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json();
        })
      ]);
      gameState.allQuestions   = (qData.itemListElement  ?? []).map(e => normalizeQuestion(e.item));
      gameState.questionnaires = (qdData.itemListElement ?? []).map(e => normalizeQuestionnaire(e.item));
    } catch (err) {
      console.error('[joc] Error carregant preguntes:', err);
      const setup = document.getElementById('jocSetup');
      if (setup) {
        setup.innerHTML = `<div class="alert alert-danger" role="alert">${t('joc.loadError')}</div>`;
        showPhase('setup');
      }
      return;
    }
  }

  resetToSetup();
}
