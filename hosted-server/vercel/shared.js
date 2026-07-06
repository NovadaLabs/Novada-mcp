/* ── PostHog Analytics ──────────────────────────────────────────── */
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+" (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagPayload isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init('phc_p3YQ5ajryLVBxrRQPx2bcGA8Vp8Nq6AXyN867hvVy848', {
  api_host: 'https://eu.i.posthog.com',
  person_profiles: 'identified_only',
});

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
// NOV-605: PostHog — single platform for events + funnels + heatmaps + session recordings
// Replace POSTHOG_API_KEY with phc_xxxx key from posthog.com (free at posthog.com)
// Covers everything: click tracking, funnels, heatmaps (toolbar), session replay
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

/* ── Pixel hotbar interactions ─────────────────────────────── */

// Hotbar slot keyboard shortcuts (1-8)
document.addEventListener('keydown', function(e) {
  var num = parseInt(e.key);
  if (num >= 1 && num <= 8) {
    var slots = document.querySelectorAll('.hotbar-slot');
    if (slots[num - 1]) {
      slots.forEach(function(s) { s.classList.remove('active'); });
      slots[num - 1].classList.add('active');
      // Show tooltip
      showPixelTooltip(slots[num - 1]);
    }
  }
});

// Hotbar slot click
document.addEventListener('click', function(e) {
  var slot = e.target.closest('.hotbar-slot');
  if (slot) {
    document.querySelectorAll('.hotbar-slot').forEach(function(s) { s.classList.remove('active'); });
    slot.classList.add('active');
    showPixelTooltip(slot);
  }
});

// Minecraft-style tooltip data
var TOOL_TOOLTIPS = {
  'novada_search':   { rarity:'rare',     lore:'Queries the overworld. Returns structured loot.', stat:'Cooldown: none · Engines: 5' },
  'novada_extract':  { rarity:'uncommon', lore:'Mines content from any URL.', stat:'Auto-escalates: static → render → browser' },
  'novada_crawl':    { rarity:'uncommon', lore:'Explores entire site dungeons (max 20 pages).', stat:'Modes: BFS · DFS' },
  'novada_research': { rarity:'epic',     lore:'Deep multi-source synthesis with citations.', stat:'Durability: ∞ · Depth: auto' },
  'novada_map':      { rarity:'common',   lore:'Discovers all URLs in a domain dungeon.', stat:'Via: sitemap.xml · BFS crawl' },
  'novada_scrape':   { rarity:'rare',     lore:'Extracts structured loot from known platforms.', stat:'Platforms: 13 · Ops: ~78' },
  'novada_browser':  { rarity:'epic',     lore:'Pilots a cloud browser via CDP — click, type, snapshot.', stat:'Hosted: cloud CDP · one-shot per call' },
  'novada_proxy':    { rarity:'rare',     lore:'Hands your client residential/ISP/mobile proxy creds.', stat:'Types: 6 · 195+ countries' },
};

var RARITY_COLORS = { common:'#9d9d9d', uncommon:'#3df0ff', rare:'#9d7bff', epic:'#ff5cf0' };

function showPixelTooltip(slot) {
  var toolName = slot.getAttribute('title');
  var data = TOOL_TOOLTIPS[toolName];
  if (!data) return;

  // Remove existing tooltip
  var old = document.getElementById('pixel-tooltip');
  if (old) old.remove();

  var tip = document.createElement('div');
  tip.id = 'pixel-tooltip';
  tip.style.cssText = [
    'position:fixed', 'z-index:9999', 'pointer-events:none',
    'background:#12002e', 'border-left:4px solid ' + (RARITY_COLORS[data.rarity] || '#9d7bff'),
    'box-shadow:0 0 0 2px #0d0d14,0 4px 20px rgba(108,64,226,0.5)',
    'padding:12px 16px', 'min-width:240px', 'max-width:320px'
  ].join(';');

  var rarityColor = RARITY_COLORS[data.rarity] || '#9d7bff';
  tip.innerHTML =
    '<div style="font-family:\'Press Start 2P\',monospace;font-size:9px;color:#e8e4f5;margin-bottom:6px">' + toolName + '</div>' +
    '<div style="font-family:\'Press Start 2P\',monospace;font-size:8px;color:' + rarityColor + ';margin-bottom:8px;text-transform:uppercase">' + data.rarity + '</div>' +
    '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#9d7bff;margin-bottom:8px;font-style:italic">' + data.lore + '</div>' +
    '<div style="font-family:\'JetBrains Mono\',monospace;font-size:11px;color:#4a1fb0">' + data.stat + '</div>';

  document.body.appendChild(tip);

  // Position near slot
  var rect = slot.getBoundingClientRect();
  var tipTop = rect.top - tip.offsetHeight - 12;
  if (tipTop < 8) tipTop = rect.bottom + 8;
  var tipLeft = rect.left + rect.width / 2 - 120;
  if (tipLeft < 8) tipLeft = 8;
  if (tipLeft + 320 > window.innerWidth - 8) tipLeft = window.innerWidth - 328;

  tip.style.top = tipTop + 'px';
  tip.style.left = tipLeft + 'px';

  // Auto-hide after 3s
  setTimeout(function() {
    var t = document.getElementById('pixel-tooltip');
    if (t) t.remove();
  }, 3000);
}

/* ── Achievement toast ─────────────────────────────────────── */
function showAchievement(title, desc) {
  var el = document.createElement('div');
  el.className = 'achievement-toast';
  el.innerHTML =
    '<div style="font-family:\'Press Start 2P\',monospace;font-size:8px;color:#3df0ff;margin-bottom:4px">ACHIEVEMENT UNLOCKED</div>' +
    '<div style="font-family:\'Press Start 2P\',monospace;font-size:9px;color:#e8e4f5;margin-bottom:4px">' + title + '</div>' +
    '<div style="font-family:\'JetBrains Mono\',monospace;font-size:12px;color:#9d7bff">' + desc + '</div>';
  document.body.appendChild(el);
  setTimeout(function() { el.classList.add('show'); }, 100);
  setTimeout(function() { el.classList.remove('show'); setTimeout(function() { el.remove(); }, 400); }, 3500);
}

// Show achievement when user copies endpoint URL
var _origCopyText = copyText;
window.copyText = function(text, btn) {
  _origCopyText(text, btn);
  if (text && text.includes('mcp.novada.com')) {
    setTimeout(function() {
      showAchievement('ENDPOINT COPIED', 'Paste into your MCP client config.');
    }, 200);
  }
};

/* ── Scanlines overlay ─────────────────────────────────────── */
(function() {
  var s = document.createElement('div');
  s.className = 'scanlines';
  s.style.cssText = 'position:fixed;inset:0;z-index:9998;pointer-events:none';
  document.body.appendChild(s);
})();
