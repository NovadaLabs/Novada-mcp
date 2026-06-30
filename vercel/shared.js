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
    _track('copy_url_clicked', { text: text.slice(0, 60) });
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
    _track('install_tab_changed', { client: target });
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
    _track('framework_tab_changed', { framework: ft });
    return;
  }

  // Copy buttons (.copy-btn with data-copy)
  var copyBtn = e.target.closest('.copy-btn');
  if (copyBtn && copyBtn.dataset.copy) {
    copyText(copyBtn.dataset.copy, copyBtn);
  }
});

/* ── Analytics ─────────────────────────────────────────────────── */
// NOV-604: Microsoft Clarity — heatmaps + session recordings
// Replace CLARITY_PROJECT_ID with your 10-char ID from clarity.microsoft.com
(function(c,l,a,r,i,t,y){
  c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
  t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
  y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
})(window,document,"clarity","script","CLARITY_PROJECT_ID");

// NOV-605: PostHog — product analytics + funnel tracking
// Replace POSTHOG_API_KEY with phc_xxxx key from posthog.com
(function(){
  var POSTHOG_KEY = 'POSTHOG_API_KEY';
  var POSTHOG_HOST = 'https://us.i.posthog.com';
  if (POSTHOG_KEY === 'POSTHOG_API_KEY') return; // skip when not configured

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]);t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init(POSTHOG_KEY, { api_host: POSTHOG_HOST, person_profiles: 'identified_only' });
})();

/** Track a PostHog event (no-op if PostHog not loaded). */
function _track(event, props) {
  if (typeof posthog !== 'undefined' && typeof posthog.capture === 'function') {
    posthog.capture(event, props || {});
  }
}

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
