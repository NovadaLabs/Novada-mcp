/**
 * shared.js — Reusable UI logic for Novada MCP landing pages.
 *
 * Auto-runs on load:
 *   - Theme init (reads localStorage, sets data-theme)
 *   - Language init (reads localStorage, sets body class)
 *   - Tab click handlers (delegated on document)
 *   - Copy button handlers (delegated on document)
 *
 * Global functions (called via onclick in HTML):
 *   toggleTheme()  — toggle light/dark
 *   toggleLang()   — toggle en/zh
 *   copyText(t,btn) — programmatic copy
 *   initScrollAnimations() — call after GSAP loads
 */

/* ── Theme ─────────────────────────────────────────────────────── */

// Early init: apply saved theme before first paint (also inlined in <head>)
(function () {
  var t = localStorage.getItem('theme') ||
    (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  document.documentElement.setAttribute('data-theme', t);
})();

/** Toggle between light and dark theme. */
function toggleTheme() {
  var h = document.documentElement;
  var next = h.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  h.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
}

/* ── Language ───────────────────────────────────────────────────── */

(function () {
  var saved = localStorage.getItem('lang');
  if (saved === 'zh') {
    document.body.classList.remove('lang-en');
    document.body.classList.add('lang-zh');
  }
  // Default is lang-en (set on <body> in HTML)
})();

/** Toggle between English and Chinese. */
function toggleLang() {
  var body = document.body;
  var btn = document.getElementById('lang-toggle');
  if (body.classList.contains('lang-en')) {
    body.classList.remove('lang-en');
    body.classList.add('lang-zh');
    localStorage.setItem('lang', 'zh');
    if (btn) btn.textContent = 'EN / \u4e2d';
  } else {
    body.classList.remove('lang-zh');
    body.classList.add('lang-en');
    localStorage.setItem('lang', 'en');
    if (btn) btn.textContent = '\u4e2d / EN';
  }
}

/* ── Copy to clipboard ─────────────────────────────────────────── */

var _toastTimer;

function _showToast(msg) {
  var el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(function () { el.classList.remove('show'); }, 1500);
}

/** Copy text to clipboard and flash the button. */
function copyText(text, btn) {
  navigator.clipboard.writeText(text).then(function () {
    if (btn) {
      var orig = btn.textContent;
      btn.textContent = 'Copied \u2713';
      btn.classList.add('copied');
      setTimeout(function () {
        btn.textContent = orig;
        btn.classList.remove('copied');
      }, 1500);
    }
    _showToast('Copied \u2713');
  }).catch(function () {
    _showToast('Copy failed');
  });
}

/* ── Tab switching (delegated) ─────────────────────────────────── */

document.addEventListener('click', function (e) {
  // Install tabs (.tab-btn → .tab-panel)
  var tabBtn = e.target.closest('.tab-btn');
  if (tabBtn) {
    var target = tabBtn.dataset.tab;
    document.querySelectorAll('.tab-btn').forEach(function (b) {
      b.classList.toggle('active', b === tabBtn);
    });
    document.querySelectorAll('.tab-panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.panel === target);
    });
    return;
  }

  // Framework tabs (.ftab-btn → .ftab-panel)
  var ftabBtn = e.target.closest('.ftab-btn');
  if (ftabBtn) {
    var ft = ftabBtn.dataset.ftab;
    document.querySelectorAll('.ftab-btn').forEach(function (b) {
      b.classList.toggle('active', b === ftabBtn);
    });
    document.querySelectorAll('.ftab-panel').forEach(function (p) {
      p.classList.toggle('active', p.dataset.fpanel === ft);
    });
    return;
  }

  // Copy buttons (.copy-btn with data-copy)
  var copyBtn = e.target.closest('.copy-btn');
  if (copyBtn && copyBtn.dataset.copy) {
    copyText(copyBtn.dataset.copy, copyBtn);
  }
});

/* ── GSAP scroll animations ────────────────────────────────────── */

/** Call after GSAP + ScrollTrigger are loaded. */
function initScrollAnimations() {
  if (typeof gsap === 'undefined') return;

  document.body.classList.add('js-anim');
  gsap.registerPlugin(ScrollTrigger);

  // Section fade-up on scroll
  gsap.utils.toArray('.sf').forEach(function (el) {
    gsap.fromTo(el,
      { y: 30, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.7, ease: 'power2.out',
        scrollTrigger: { trigger: el, start: 'top 88%', toggleActions: 'play none none none' } }
    );
  });

  // Hero entrance — staggered on load
  gsap.fromTo('.hero-animate',
    { y: 22, opacity: 0 },
    { y: 0, opacity: 1, duration: 0.65, ease: 'power2.out', stagger: 0.13, delay: 0.15 }
  );
}
