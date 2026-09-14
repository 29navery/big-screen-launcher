const api = window.launcher;
let state = {
  view: 'library',
  settings: null,
  games: [],
  pending: [],
  selectedGame: null,
  selected: new Set(),
  importProgress: null,
  status: 'Ready',
  appVersion: '178',
  themesList: null,
  themesListOpen: false,
  themesListLoading: false,
  librarySizeLoading: false,
  systemStats: null,
  systemStatsLoading: false,
  systemStatsRequested: false,
  downloadsSort: 'default',
  librarySort: 'default',
  librarySearch: '',
  downloadsSearch: '',
  downloadsCatalog: null,
  downloadsLoading: false,
  serverStatus: 'connecting',
  installProgress: null,
  downloadQueue: [],
  activeDownloadId: null,
  railMode: false,
  hadConnectivityIssue: false,
  runningGames: new Set(),
  launchingGames: new Set(),
  lastAnimatedView: '',
  didUpdateCheck: false,
  controllerHintTextTimer: null,
  controllerHintPendingText: ''
};
const DOWNLOAD_FINISHED_CLEAR_MS = 1000;
let viewAnimationTimer = null;
const $ = (s) => document.querySelector(s);
function art(a, t, hero = false) {
  const img = hero ? a.heroUrl || a.gridUrl : a.gridUrl;
  return (
    '<div class="art ' +
    (hero ? 'hero' : '') +
    '" style="--accent:' +
    a.color +
    '">' +
    (img ? '<img src="' + img + '">' : '<span class="init">' + a.initials + '</span>') +
    '<p>' +
    esc(t) +
    '</p></div>'
  );
}
function esc(s) {
  return String(s || '').replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
  );
}
function applyImportedTheme() {
  const link = document.getElementById('customThemeStylesheet');
  if (!link) return;
  const url = state.settings?.themeCssUrl || '';
  const backgroundUrl = state.settings?.themeBackgroundUrl || '';
  const iconUrl = state.settings?.themeIconUrl || '';
  if (url) {
    link.setAttribute('href', url);
    link.dataset.themeName = state.settings?.themeCssName || 'Custom theme';
  } else if (link.getAttribute('href')) {
    link.removeAttribute('href');
    delete link.dataset.themeName;
  }
  const favicon = document.querySelector('link[rel="icon"]');
  if (favicon) favicon.setAttribute('href', iconUrl || 'assets/app-icon.png');
  const mark = document.querySelector('.titlebar-mark');
  if (mark) {
    if (iconUrl) mark.innerHTML = '<img src="' + esc(iconUrl) + '" alt="">';
    else mark.textContent = '✦';
  }
  document.body.classList.toggle('custom-theme-active', !!url);
  document.documentElement.classList.toggle('custom-theme-active', !!url);
  document.body.classList.toggle('custom-background-active', !!backgroundUrl);
  document.documentElement.classList.toggle('custom-background-active', !!backgroundUrl);
  document.body.classList.toggle('package-background-locked', !!state.settings?.themeBackgroundLocked);
  document.documentElement.classList.toggle(
    'package-background-locked',
    !!state.settings?.themeBackgroundLocked
  );
  if (backgroundUrl) {
    document.documentElement.style.setProperty(
      '--bsl-custom-background-image',
      'url("' + backgroundUrl.replace(/"/g, '%22') + '")'
    );
  } else {
    document.documentElement.style.removeProperty('--bsl-custom-background-image');
  }
  document.documentElement.dataset.themeName = url ? state.settings?.themeCssName || 'custom' : '';
}
function inlineMarkdown(text) {
  return esc(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
function markdownToHtml(md) {
  const lines = String(md || '')
    .replace(/\r/g, '')
    .split('\n');
  let html = '',
    inCode = false,
    code = [],
    inList = false;
  const closeList = () => {
    if (inList) {
      html += '</ul>';
      inList = false;
    }
  };
  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) {
        html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
        code = [];
        inCode = false;
      } else {
        closeList();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      code.push(line);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) {
      closeList();
      html += '<h' + h[1].length + '>' + inlineMarkdown(h[2]) + '</h' + h[1].length + '>';
      continue;
    }
    const li = line.match(/^[-*]\s+(.+)$/);
    if (li) {
      if (!inList) {
        html += '<ul>';
        inList = true;
      }
      html += '<li>' + inlineMarkdown(li[1]) + '</li>';
      continue;
    }
    closeList();
    html += '<p>' + inlineMarkdown(line) + '</p>';
  }
  closeList();
  if (inCode) html += '<pre><code>' + esc(code.join('\n')) + '</code></pre>';
  return html;
}
async function showThemeDocs() {
  try {
    const md = await api.themes.getDocs();
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop docs-backdrop';
    overlay.innerHTML =
      '<div class="docs-modal"><div class="docs-modal-head"><h2>Theme Docs</h2><button data-focusable class="cmd" id="closeDocs">Close</button></div><div class="docs-body">' +
      markdownToHtml(md) +
      '</div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#closeDocs').onclick = () => overlay.remove();
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    setTimeout(() => overlay.querySelector('#closeDocs')?.focus(), 0);
  } catch (e) {
    setStatus('Could not load theme docs: ' + e.message);
  }
}
function updateMorphFocus() {
  const box = document.getElementById('morphFocus');
  const el = document.activeElement;
  if (
    !state.settings?.enableGamepad ||
    !box ||
    !el ||
    !el.matches ||
    !el.matches('[data-focusable]') ||
    el.offsetParent === null
  ) {
    if (box) box.classList.remove('visible');
    return;
  }
  const r = el.getBoundingClientRect();
  box.style.left = r.left - 7 + 'px';
  box.style.top = r.top - 7 + 'px';
  box.style.width = r.width + 14 + 'px';
  box.style.height = r.height + 14 + 'px';
  box.style.borderRadius =
    Math.min(18, Math.max(10, parseFloat(getComputedStyle(el).borderRadius) || 10)) + 7 + 'px';
  box.classList.add('visible');
}
document.addEventListener('focusin', () => requestAnimationFrame(updateMorphFocus));
window.addEventListener('resize', () => requestAnimationFrame(updateMorphFocus));
function setFaceActive(name, active) {
  const el = document.querySelector('.face-' + name);
  if (!el) return null;
  const wasActive = el.classList.contains('active');
  el.classList.toggle('active', !!active);
  return wasActive && !active ? el : null;
}
function isActionableElement(el) {
  if (!el) return false;
  const action = el.closest?.('[data-focusable],button,a,input,label,[role=button]');
  return !!(action && !action.disabled && action.getAttribute?.('aria-disabled') !== 'true');
}
function measureControllerHintText(hint, text) {
  if (!text) return 0;
  const canvas =
    measureControllerHintText.canvas ||
    (measureControllerHintText.canvas = document.createElement('canvas'));
  const ctx = canvas.getContext('2d');
  const cs = getComputedStyle(hint);
  ctx.font = [cs.fontStyle, cs.fontVariant, cs.fontWeight, cs.fontSize, cs.fontFamily]
    .filter(Boolean)
    .join(' ');
  return Math.ceil(ctx.measureText(text).width) + 2;
}
function applyControllerHintText(hint, nextText) {
  const width = measureControllerHintText(hint, nextText);
  const currentWidth = Math.max(
    0,
    Math.ceil(hint.getBoundingClientRect().width || hint.scrollWidth || 0)
  );
  hint.style.width = currentWidth + 'px';
  hint.textContent = nextText;
  hint.classList.toggle('empty', !nextText);
  requestAnimationFrame(() => {
    hint.style.width = width + 'px';
  });
}
function afterFaceFade(elements, done) {
  const faces = (elements || []).filter(Boolean);
  if (!faces.length || state.settings?.reduceMotion) {
    setTimeout(done, 0);
    return;
  }
  let finished = false;
  let remaining = faces.length;
  const cleanups = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanups.forEach((fn) => fn());
    done();
  };
  faces.forEach((face) => {
    const onEnd = (e) => {
      if (e.target !== face || e.propertyName !== 'opacity') return;
      if (--remaining <= 0) finish();
    };
    face.addEventListener('transitionend', onEnd);
    cleanups.push(() => face.removeEventListener('transitionend', onEnd));
  });
  state.controllerHintTextTimer = setTimeout(finish, 210);
}
function setControllerHintText(hint, nextText, waitFaces = []) {
  const current = hint.textContent || '';
  const pending = state.controllerHintPendingText || '';
  if (nextText === current && pending === '') return;
  if (pending === nextText && state.controllerHintTextTimer) return;
  if (state.controllerHintTextTimer) {
    clearTimeout(state.controllerHintTextTimer);
    state.controllerHintTextTimer = null;
  }
  const isRemoving = nextText.length < current.length;
  state.controllerHintPendingText = nextText;
  const commit = () => {
    applyControllerHintText(hint, state.controllerHintPendingText);
    state.controllerHintPendingText = '';
    state.controllerHintTextTimer = null;
  };
  if (isRemoving) afterFaceFade(waitFaces, commit);
  else commit();
}
function updateControllerHint() {
  const hint = document.querySelector('.hint-copy');
  if (!hint) return;
  let labels = { a: 'Select', b: 'Back', x: 'Favorite', y: 'Menu' };
  let active = { a: true, b: state.view !== 'library', x: true, y: true };
  if (state.settings?.useGamepadCursor) {
    const target = digitalCursorTarget();
    const targetGame = gameFromElement(target);
    labels = { a: 'Click', b: 'Back', x: 'Favorite', y: '' };
    active = {
      a: isActionableElement(target),
      b: state.view !== 'library',
      x: !!targetGame,
      y: false
    };
  } else if (state.railMode) {
    labels = { a: 'Open', b: 'Back', x: '', y: '' };
    active = {
      a: isActionableElement(document.activeElement),
      b: state.view !== 'library',
      x: false,
      y: false
    };
  } else if (state.view === 'details') {
    const g = game();
    labels = {
      a: g && state.runningGames.has(g.id) ? 'Stop' : 'Launch',
      b: 'Back',
      x: 'Favorite',
      y: 'Menu'
    };
    active = { a: true, b: true, x: !!g, y: !!g };
  } else {
    const focused = document.activeElement;
    active = {
      a: isActionableElement(focused),
      b: state.view !== 'library',
      x: !!gameFromElement(focused),
      y: !!gameFromElement(focused)
    };
  }
  const fadingFaces = [
    setFaceActive('a', active.a),
    setFaceActive('b', active.b),
    setFaceActive('x', active.x),
    setFaceActive('y', active.y)
  ].filter(Boolean);
  const nextText = [
    active.a ? 'A ' + labels.a : '',
    active.b ? 'B ' + labels.b : '',
    active.x ? 'X ' + labels.x : '',
    active.y ? 'Y ' + labels.y : ''
  ]
    .filter(Boolean)
    .join('  •  ');
  setControllerHintText(hint, nextText, fadingFaces);
}
function normalizedTitle(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
function normalizedUrl(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}
function pathBase(value) {
  return (
    String(value || '')
      .split(/[\\/]/)
      .filter(Boolean)
      .pop() || ''
  );
}
function themeListHtml() {
  const items = state.themesList || [];
  const active = String(state.settings?.themeCssPath || '').toLowerCase();
  const body = state.themesListOpen
    ? state.themesListLoading
      ? '<div class="theme-list-empty">Loading themes...</div>'
      : items.length
        ? '<div class="theme-list">' +
          items
            .map((t) => {
              const isActive = String(t.path || '').toLowerCase() === active;
              return (
                '<button data-focusable class="theme-list-item ' +
                (isActive ? 'active' : '') +
                '" data-theme-apply="' +
                esc(t.path || '') +
                '" type="button"><strong>' +
                esc(t.name || t.fileName) +
                '</strong><small>' +
                esc(t.fileName || '') +
                '</small>' +
                (isActive ? '<em>Active</em>' : '') +
                '</button>'
              );
            })
            .join('') +
          '</div>'
        : '<div class="theme-list-empty">No CSS themes in the Themes folder yet.</div>'
    : '';
  return (
    '<div class="theme-browser ' +
    (state.themesListOpen ? 'open' : 'collapsed') +
    '"><button data-focusable class="theme-browser-toggle" id="themesToggle" type="button" aria-expanded="' +
    (state.themesListOpen ? 'true' : 'false') +
    '"><span>Stored themes</span><b>' +
    items.length +
    '</b></button>' +
    (state.themesListOpen ? '<div class="theme-browser-body">' + body + '</div>' : '') +
    '</div>'
  );
}
async function loadThemeList() {
  if (!api.themes?.list) return;
  state.themesListLoading = true;
  render();
  try {
    state.themesList = await api.themes.list();
  } catch (e) {
    state.themesList = [];
    setStatus('Could not load themes: ' + e.message);
  } finally {
    state.themesListLoading = false;
    if (state.view === 'settings') render();
  }
}
function versionParts(value) {
  return (
    String(value || '')
      .match(/\d+/g)
      ?.map(Number) || []
  );
}
function compareGameVersions(a, b) {
  const av = versionParts(a),
    bv = versionParts(b);
  for (let i = 0; i < Math.max(av.length, bv.length); i++) {
    const d = (av[i] || 0) - (bv[i] || 0);
    if (d) return d;
  }
  return 0;
}
function findLibraryGame(title, url = '') {
  const t = normalizedTitle(title);
  const u = normalizedUrl(url);
  return (
    state.games.find((g) => {
      const names = [
        g.title,
        g.sourceDownloadTitle,
        g.downloadTitle,
        pathBase(g.installDir),
        pathBase(g.executablePath)
      ];
      if (names.some((n) => normalizedTitle(n) === t)) return true;
      const urls = [g.sourceDownloadUrl, g.downloadUrl].map(normalizedUrl).filter(Boolean);
      return !!(u && urls.includes(u));
    }) || null
  );
}
function hasLibraryGame(title, url = '') {
  return !!findLibraryGame(title, url);
}
function formatVersion(value) {
  return 'v' + String(value || '').replace(/^v/i, '');
}
async function checkLauncherUpdate(manual = false) {
  if (!api.appInfo?.checkUpdate) return;
  try {
    if (manual) setStatus('Checking for updates...');
    const info = await api.appInfo.checkUpdate();
    const version = document.querySelector('.titlebar-version');
    state.appVersion = info.currentVersion;
    if (version) version.textContent = formatVersion(info.currentVersion);
    const shouldNotify = manual || state.settings?.showUpdateNotifications !== false;
    if (info.updateAvailable && shouldNotify) {
      const prompt = document.getElementById('updatePrompt');
      const text = document.getElementById('updateText');
      const download = document.getElementById('updateDownload');
      const changelog = document.getElementById('updateChangelog');
      const later = document.getElementById('updateLater');
      if (text)
        text.textContent =
          formatVersion(info.remoteVersion) +
          " is available. It's highly recommended that you update.";
      if (prompt) prompt.hidden = false;
      if (download) download.onclick = () => api.appInfo.openDownloadPage();
      if (changelog) changelog.onclick = () => showChangelogModal();
      if (later)
        later.onclick = () => {
          prompt.hidden = true;
        };
      if (manual) setStatus('Update available.');
    } else if (manual) {
      setStatus('No updates found.');
    }
  } catch (e) {
    console.warn('Update check failed', e);
    if (manual) setStatus('Could not check for updates.');
  }
}
function dismissStickyNotice() {
  const box = document.getElementById('stickyNotice');
  if (!box || box.hidden) return;
  box.classList.add('closing');
  setTimeout(() => {
    box.hidden = true;
    box.classList.remove('closing');
  }, 220);
}
function showStickyNotice(message, type = 'warn') {
  const box = document.getElementById('stickyNotice');
  const text = document.getElementById('stickyNoticeText');
  if (!box || !text) return;
  text.textContent = message;
  box.className = 'sticky-notice ' + type;
  box.hidden = false;
  const close = document.getElementById('stickyNoticeClose');
  if (close) close.onclick = dismissStickyNotice;
}
function hideStickyNotice() {
  dismissStickyNotice();
}
function manifestErrorMessage(error) {
  if (!navigator.onLine)
    return 'You appear to be offline. Downloads are unavailable until your internet connection returns.';
  const msg = String(error?.message || error || '');
  if (/530|502|503|504|ECONN|ENOTFOUND|ETIMEDOUT|timed out|No trycloudflare|server URL/i.test(msg))
    return 'Unable to connect to server, this may not be a network issue.';
  return 'Unable to connect to server, this may not be a network issue.';
}
function focusItems() {
  const selector = state.railMode
    ? '.rail [data-focusable]'
    : '.surface [data-focusable], .modal-backdrop [data-focusable]';
  return [...document.querySelectorAll(selector)].filter(
    (x) => !x.disabled && x.offsetParent !== null
  );
}
function ensureGamepadFocus() {
  const items = focusItems();
  if (!items.length) return;
  if (!items.includes(document.activeElement)) items[0].focus({ preventScroll: true });
  updateMorphFocus();
}
function activateFocused() {
  ensureGamepadFocus();
  const el = document.activeElement;
  if (el && typeof el.click === 'function') el.click();
}
function openRailMode() {
  state.railMode = true;
  document.body.classList.add('rail-mode');
  const current =
    document.querySelector('.rail [data-view="' + state.view + '"]') ||
    document.querySelector('.rail [data-focusable]');
  current && current.focus({ preventScroll: true });
  updateMorphFocus();
  updateControllerHint();
}
function closeRailMode() {
  state.railMode = false;
  document.body.classList.remove('rail-mode');
  setTimeout(() => {
    document.querySelector('.surface [data-focusable]')?.focus({ preventScroll: true });
    updateMorphFocus();
    updateControllerHint();
  }, 0);
}
function backAction() {
  if (state.railMode) {
    closeRailMode();
    return;
  }
  if (
    state.view === 'details' ||
    state.view === 'imports' ||
    state.view === 'settings' ||
    state.view === 'downloads'
  )
    nav('library');
}
function gamepadMove(dx, dy) {
  ensureGamepadFocus();
  const items = focusItems();
  const current = document.activeElement;
  const from = items.includes(current) ? current : items[0];
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2,
    cy = r.top + r.height / 2;
  let best = null,
    bestScore = Infinity;
  for (const item of items) {
    if (item === from) continue;
    const b = item.getBoundingClientRect();
    const x = b.left + b.width / 2,
      y = b.top + b.height / 2;
    const vx = x - cx,
      vy = y - cy;
    if (dx < 0 && vx >= -4) continue;
    if (dx > 0 && vx <= 4) continue;
    if (dy < 0 && vy >= -4) continue;
    if (dy > 0 && vy <= 4) continue;
    const primary = dx ? Math.abs(vx) : Math.abs(vy);
    const secondary = dx ? Math.abs(vy) : Math.abs(vx);
    const score = primary + secondary * 2.2;
    if (score < bestScore) {
      bestScore = score;
      best = item;
    }
  }
  if (best) best.focus({ preventScroll: false });
  updateMorphFocus();
}
async function refreshMissingArtworkSoon() {
  try {
    if (state.settings?.autoRefreshArtwork === false) return;
    if (api.artwork?.refreshMissing) {
      const refreshed = await api.artwork.refreshMissing();
      if (Array.isArray(refreshed)) state.games = refreshed;
      render();
    }
  } catch (e) {
    console.warn('Artwork refresh failed', e);
  }
}
function formatBytes(bytes) {
  bytes = Number(bytes || 0);
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return (
    (i >= 3 ? value.toFixed(2) : i === 2 ? value.toFixed(1) : Math.round(value)) + ' ' + units[i]
  );
}
async function warnLowStorageBeforeDownload() {
  if (!api.system?.storage) return true;
  try {
    const storage = await api.system.storage();
    const free = Number(storage.freeBytes || 0);
    const limit = 10 * 1024 * 1024 * 1024;
    if (free && free < limit)
      return await confirmAction(
        'Low storage warning',
        'This computer only has ' +
          formatBytes(free) +
          ' free. Downloads can be large, so this might fail or fill the drive.',
        'Download anyway',
        true
      );
  } catch {}
  return true;
}
function formatSpeed(bps) {
  if (!bps) return '';
  const mbps = (bps * 8) / 1000 / 1000;
  return mbps >= 1 ? mbps.toFixed(2) + ' Mbps' : ((bps * 8) / 1000).toFixed(0) + ' Kbps';
}
function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 1) return '';
  seconds = Math.ceil(seconds);
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h) return h + 'h ' + m + 'm left';
  if (m) return m + 'm ' + s + 's left';
  return s + 's left';
}
function queueId() {
  return 'dq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
function downloadJobLabel(job) {
  const p = job.progress || {};
  const showStats = state.settings?.showDownloadStats !== false;
  const speed = formatSpeed(p.speedBps);
  const size = p.loadedBytes
    ? formatBytes(p.loadedBytes) + (p.totalBytes ? ' / ' + formatBytes(p.totalBytes) : '')
    : '';
  const eta =
    p.totalBytes && p.loadedBytes && p.speedBps
      ? formatEta((p.totalBytes - p.loadedBytes) / p.speedBps)
      : '';
  return (
    job.name +
    ' - ' +
    (p.phase || job.phase || 'queued') +
    (p.percent != null ? ' ' + p.percent + '%' : '') +
    (showStats && size ? ' • ' + size : '') +
    (showStats && speed ? ' • ' + speed : '') +
    (showStats && eta ? ' • ' + eta : '')
  );
}
function downloadQueueActionKind(job) {
  const queued = job.phase === 'queued';
  const failed = ['failed', 'cancelled'].includes(job.phase);
  const done = job.phase === 'done';
  if (queued || failed) return 'cancel';
  if (!done) return 'stop';
  return 'none';
}
function updateDownloadQueueRows(wrap) {
  state.downloadQueue.forEach((job) => {
    const row = wrap.querySelector('[data-job="' + job.id + '"]');
    if (!row) return;
    const p = job.progress || {};
    const queued = job.phase === 'queued';
    const failed = ['failed', 'cancelled'].includes(job.phase);
    const done = job.phase === 'done';
    const pct =
      p.percent != null
        ? Math.max(0, Math.min(100, p.percent))
        : queued
          ? 0
          : failed || done
            ? 100
            : 0;
    row.classList.toggle('queued', queued);
    row.classList.toggle('failed', failed);
    const label = row.querySelector('.progress-label');
    if (label) label.textContent = downloadJobLabel(job);
    const fill = row.querySelector('.progress-fill');
    if (fill) fill.style.width = pct + '%';
  });
}
function renderDownloadQueue() {
  const wrap = document.querySelector('#downloadQueue');
  if (!wrap) return;
  wrap.hidden = !state.downloadQueue.length;
  const signature = state.downloadQueue
    .map((job) => job.id + ':' + downloadQueueActionKind(job))
    .join('|');
  if (wrap.dataset.signature === signature) {
    updateDownloadQueueRows(wrap);
    return;
  }
  wrap.dataset.signature = signature;
  wrap.innerHTML = state.downloadQueue
    .map((job) => {
      const p = job.progress || {};
      const queued = job.phase === 'queued';
      const failed = ['failed', 'cancelled'].includes(job.phase);
      const done = job.phase === 'done';
      const pct =
        p.percent != null
          ? Math.max(0, Math.min(100, p.percent))
          : queued
            ? 0
            : failed || done
              ? 100
              : 0;
      const actionKind = downloadQueueActionKind(job);
      const actions =
        actionKind === 'cancel'
          ? '<button data-focusable class="cmd danger cancel-queued" data-cancel-job="' +
            job.id +
            '">Cancel</button>'
          : actionKind === 'stop'
            ? '<button data-focusable class="cmd danger stop-download" data-stop-job="' +
              job.id +
              '">Stop</button>'
            : '';
      return (
        '<div class="install-progress download-job ' +
        (queued ? 'queued ' : '') +
        (failed ? 'failed ' : '') +
        '" data-job="' +
        job.id +
        '"><div class="progress-head"><span class="progress-label">' +
        esc(downloadJobLabel(job)) +
        '</span><div class="progress-actions">' +
        actions +
        '</div></div><span class="progress-track"><span class="progress-fill" style="width:' +
        pct +
        '%"></span></span></div>'
      );
    })
    .join('');
  wrap
    .querySelectorAll('[data-cancel-job]')
    .forEach((b) => (b.onclick = () => cancelQueuedDownload(b.dataset.cancelJob)));
  wrap
    .querySelectorAll('[data-stop-job]')
    .forEach((b) => (b.onclick = () => stopDownloadJob(b.dataset.stopJob)));
}
function findDownloadJob(id) {
  return state.downloadQueue.find((j) => j.id === id);
}
function findDownloadJobByName(name) {
  return state.downloadQueue.find(
    (j) => j.name === name && j.phase !== 'done' && j.phase !== 'cancelled'
  );
}
function enqueueDownload(job) {
  if (findDownloadJobByName(job.name)) {
    setStatus(job.name + ' is already queued.');
    return;
  }
  state.downloadQueue.push({
    ...job,
    id: queueId(),
    phase: 'queued',
    progress: { name: job.name, phase: 'queued', percent: null, url: job.url }
  });
  renderDownloadQueue();
  runNextDownload();
}
function cancelQueuedDownload(id) {
  const job = findDownloadJob(id);
  if (!job) return;
  if (job.phase === 'queued' || job.phase === 'failed' || job.phase === 'paused') {
    if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
    state.downloadQueue = state.downloadQueue.filter((j) => j.id !== id);
    setStatus(job.name + ' removed from queue.');
    renderDownloadQueue();
    return;
  }
  stopDownloadJob(id);
}
function finishDownloadJob(job, phase = 'done') {
  if (!job) return;
  if (job.cleanupTimer) clearTimeout(job.cleanupTimer);
  job.phase = phase;
  job.progress = {
    ...(job.progress || {}),
    phase,
    percent: 100
  };
  if (state.activeDownloadId === job.id) state.activeDownloadId = null;
  renderDownloadQueue();
  job.cleanupTimer = setTimeout(() => {
    state.downloadQueue = state.downloadQueue.filter((j) => j.id !== job.id);
    renderDownloadQueue();
    runNextDownload();
  }, DOWNLOAD_FINISHED_CLEAR_MS);
}
async function stopDownloadJob(id) {
  const job = findDownloadJob(id);
  if (!job) return;
  if (job.phase === 'queued') return cancelQueuedDownload(id);
  job.phase = 'cancelled';
  job.progress = { ...(job.progress || {}), phase: 'cancelled', percent: 100 };
  renderDownloadQueue();
  try {
    await api.downloads.cancel(job.name);
  } catch {}
  if (state.activeDownloadId === id) {
    finishDownloadJob(job, 'cancelled');
  }
}
async function runNextDownload() {
  if (state.activeDownloadId) return;
  const job = state.downloadQueue.find((j) => j.phase === 'queued');
  if (!job) return;
  state.activeDownloadId = job.id;
  job.phase = 'active';
  job.progress = { ...(job.progress || {}), phase: 'starting', percent: 0 };
  renderDownloadQueue();
  setStatus((job.isUpdate ? 'Updating ' : 'Installing ') + job.name + '...');
  try {
    const result = await api.downloads.install({
      name: job.name,
      url: job.url,
      version: job.version || '',
      dlc: job.dlc === true
    });
    state.games = await api.games.list();
    if (state.settings?.autoRefreshArtwork !== false) await refreshMissingArtworkSoon();
    const diff = result.archiveDiff;
    const diffText = diff
      ? ' Changed ' + (diff.changed || 0) + ' files, skipped ' + (diff.skipped || 0) + '.'
      : '';
    job.phase = 'done';
    job.progress = { ...(job.progress || {}), phase: 'done', percent: 100 };
    setStatus(
      result.executablePath
        ? job.name + (job.isUpdate ? ' updated.' : ' installed and added to Library.') + diffText
        : job.name + ' downloaded. No executable found yet.'
    );
  } catch (e) {
    const text = String(e.message || '');
    const cancelled = text.toLowerCase().includes('cancelled');
    job.phase = cancelled ? 'cancelled' : 'failed';
    job.progress = {
      ...(job.progress || {}),
      phase: job.phase,
      percent: cancelled ? 100 : job.progress?.percent || 0,
      error: e.message,
      resumable: false
    };
    setStatus(cancelled ? 'Download cancelled.' : 'Install failed: ' + e.message);
  } finally {
    if (state.activeDownloadId === job.id) state.activeDownloadId = null;
    renderDownloadQueue();
    if (['done', 'cancelled'].includes(job.phase)) finishDownloadJob(job, job.phase);
    else runNextDownload();
    render();
  }
}
function date(v) {
  return v
    ? new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      }).format(new Date(v))
    : 'Never';
}
function formatPlaytime(seconds) {
  seconds = Math.max(0, Math.floor(Number(seconds || 0)));
  if (!seconds) return 'Never played';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h) return h + 'h ' + m + 'm';
  return Math.max(1, m) + 'm';
}
async function loadDownloadsCatalog() {
  if (state.downloadsLoading) return;
  state.downloadsLoading = true;
  state.serverStatus = 'connecting';
  if (state.view === 'downloads') render();
  try {
    state.downloadsCatalog = await api.downloads.catalog();
    state.serverStatus = 'online';
    if (state.hadConnectivityIssue) {
      state.hadConnectivityIssue = false;
      showStickyNotice("You're connected!", 'success');
    } else hideStickyNotice();
  } catch (e) {
    state.downloadsCatalog = null;
    state.serverStatus = 'offline';
    state.hadConnectivityIssue = true;
    const message = manifestErrorMessage(e);
    state.status = message;
    showStickyNotice(message, navigator.onLine ? 'warn' : 'offline');
  } finally {
    state.downloadsLoading = false;
    if (state.serverStatus === 'connecting')
      state.serverStatus = state.downloadsCatalog ? 'online' : 'offline';
    if (state.view === 'downloads') render();
  }
}
async function refreshRunningGames(renderIfChanged = true) {
  if (!api.games?.running) return;
  try {
    const before = [...state.runningGames].sort().join('|');
    const running = await api.games.running();
    state.runningGames = new Set((running || []).map((g) => g.id));
    const after = [...state.runningGames].sort().join('|');
    if (before !== after && api.games?.list) state.games = await api.games.list();
    if (renderIfChanged && before !== after) render();
  } catch (e) {
    console.warn('Running game check failed', e);
  }
}
let focusUpdateTimer = 0;
function checkUpdateOnFocus() {
  clearTimeout(focusUpdateTimer);
  focusUpdateTimer = setTimeout(() => checkLauncherUpdate(false), 350);
}
window.addEventListener('focus', checkUpdateOnFocus);
api.appInfo?.onReopened?.(checkUpdateOnFocus);
async function refresh() {
  if (api.appInfo?.bootstrap) {
    const boot = await api.appInfo.bootstrap();
    state.settings = boot.settings;
    state.games = boot.games || [];
    state.pending = boot.pendingImports || [];
    state.appVersion = boot.version || state.appVersion;
  } else {
    [state.settings, state.games, state.pending] = await Promise.all([
      api.settings.get(),
      api.games.list(),
      api.imports.list()
    ]);
  }
  await refreshRunningGames(false);
  if (!state.selectedGame && state.games[0]) state.selectedGame = state.games[0].id;
  render();
  setTimeout(loadDownloadsCatalog, 80);
  setTimeout(refreshMissingArtworkSoon, 2400);
  if (!state.didUpdateCheck) {
    state.didUpdateCheck = true;
    setTimeout(() => checkLauncherUpdate(false), 320);
  }
  if (state.settings?.tutorialCompleted === false) setTimeout(showTutorial, 500);
}
function setStatus(s) {
  state.status = s;
  const statusEl = $('#status');
  if (statusEl) {
    statusEl.textContent = s;
    statusEl.hidden = !state.settings?.showOutput;
  }
}
function title() {
  return state.view === 'details'
    ? game()?.title || 'Game Details'
    : state.view === 'imports'
      ? 'Imports'
      : state.view === 'downloads'
        ? 'Downloads'
        : state.view === 'settings'
          ? 'Settings'
          : 'Library';
}
function game() {
  return state.games.find((g) => g.id === state.selectedGame) || state.games[0];
}
function render() {
  if (!state.settings) return;
  applyImportedTheme();
  $('#title').textContent = title();
  const statusEl = $('#status');
  if (statusEl) {
    statusEl.textContent = state.status;
    statusEl.hidden = !state.settings.showOutput;
  }
  const v = $('#view');
  const viewChanged = state.lastAnimatedView !== state.view;
  if (viewChanged) {
    if (viewAnimationTimer) clearTimeout(viewAnimationTimer);
    v.classList.remove('view-anim');
    void v.offsetWidth;
    state.lastAnimatedView = state.view;
  }
  document.body.classList.toggle('reduce-motion', !!state.settings.reduceMotion);
  document.body.classList.toggle('large-text', !!state.settings.largeText);
  document.body.classList.toggle('gamepad-enabled', !!state.settings.enableGamepad);
  document.body.classList.toggle(
    'gamepad-cursor-mode',
    !!state.settings.enableGamepad && !!state.settings.useGamepadCursor
  );
  document.body.classList.toggle(
    'show-controller-hints',
    state.settings.showControllerHints !== false
  );
  document.body.classList.toggle(
    'show-controller-hint-text',
    state.settings.showControllerHintText !== false
  );
  document.body.classList.toggle('window-focused', document.hasFocus());
  document.body.classList.toggle('details-view', state.view === 'details');
  if (!state.settings.enableGamepad)
    document.getElementById('morphFocus')?.classList.remove('visible');
  if (state.view === 'library') renderLibrary(v);
  if (state.view === 'details') renderDetails(v);
  if (state.view === 'imports') renderImports(v);
  if (state.view === 'downloads') renderDownloads(v);
  if (state.view === 'settings') renderSettings(v);
  if (viewChanged) {
    v.classList.add('view-anim');
    viewAnimationTimer = setTimeout(() => {
      v.classList.remove('view-anim');
      viewAnimationTimer = null;
    }, 420);
  }
  setTimeout(() => {
    if (viewChanged) document.querySelector('[data-focusable]')?.focus();
    updateMorphFocus();
    updateControllerHint();
  }, 0);
}
function confirmRemove(game) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML =
      '<div class="confirm-modal"><h2>Remove ' +
      esc(game.title) +
      '?</h2><p>Choose whether to only remove it from the launcher or also delete its installed files.</p><div class="actions"><button data-focusable class="cmd" id="cancelRemove">Cancel</button><button data-focusable class="cmd" id="listRemove">Remove from list</button><button data-focusable class="cmd danger" id="deleteRemove">Remove and delete</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#cancelRemove').onclick = () => {
      overlay.remove();
      resolve('cancel');
    };
    overlay.querySelector('#listRemove').onclick = () => {
      overlay.remove();
      resolve('list');
    };
    overlay.querySelector('#deleteRemove').onclick = () => {
      overlay.remove();
      resolve('delete');
    };
    setTimeout(() => overlay.querySelector('#cancelRemove')?.focus(), 0);
  });
}
function showTutorial() {
  if (document.querySelector('.tutorial-modal')) return;
  const steps = [
    {
      view: 'library',
      title: 'Library',
      body: 'This is where installed games live. Favorites stay at the top, and Launch/Stop works from each game page.'
    },
    {
      view: 'downloads',
      title: 'Downloads',
      body: 'Browse the server catalog, search for a title, and download archives into the Games folder.'
    },
    {
      view: 'imports',
      title: 'Review Imports',
      body: 'Scans and manual archives land here first so you can approve or discard them before they enter the library.'
    },
    {
      view: 'settings',
      title: 'Settings',
      body: 'Choose folders, tune controller/accessibility options, and reset this tutorial later.'
    }
  ];
  let index = 0;
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop tutorial-modal';
  document.body.appendChild(overlay);
  const finish = async () => {
    overlay.remove();
    state.settings = await api.settings.update({ tutorialCompleted: true });
    render();
  };
  const draw = () => {
    const step = steps[index];
    const isLastStep = index === steps.length - 1;
    nav(step.view);
    overlay.innerHTML =
      '<div class="confirm-modal tutorial-card"><span class="tutorial-step">' +
      (index + 1) +
      ' / ' +
      steps.length +
      '</span><h2>' +
      esc(step.title) +
      '</h2><p>' +
      esc(step.body) +
      '</p><div class="actions">' +
      (isLastStep ? '' : '<button data-focusable class="cmd" id="skipTutorial">Skip</button>') +
      '<button data-focusable class="cmd primary" id="nextTutorial">' +
      (isLastStep ? 'Finish' : 'Next') +
      '</button></div></div>';
    const skipTutorial = overlay.querySelector('#skipTutorial');
    if (skipTutorial) skipTutorial.onclick = finish;
    overlay.querySelector('#nextTutorial').onclick = () => {
      if (index >= steps.length - 1) finish();
      else {
        index++;
        draw();
      }
    };
    setTimeout(() => overlay.querySelector('#nextTutorial')?.focus(), 0);
  };
  draw();
}
function showChangelogModal() {
  const overlay = document.createElement('div');
  overlay.className = 'modal-backdrop';
  overlay.innerHTML =
    '<div class="confirm-modal changelog-modal"><div class="changelog-head"><div><h2>Latest changelog</h2><p>Fetched inside the launcher.</p></div><button data-focusable class="cmd" id="closeChangelog">Close</button></div><pre id="changelogBody" class="changelog-body">Loading changelog...</pre><div class="actions"><button data-focusable class="cmd primary" id="changelogDownload">Download</button></div></div>';
  document.body.appendChild(overlay);
  const body = overlay.querySelector('#changelogBody');
  const close = () => overlay.remove();
  overlay.querySelector('#closeChangelog').onclick = close;
  overlay.querySelector('#changelogDownload').onclick = () => api.appInfo.openDownloadPage();
  api.appInfo
    .getChangelog?.()
    .then((data) => {
      if (body) body.textContent = data?.content || 'No changelog text was found.';
    })
    .catch((err) => {
      if (body)
        body.textContent = 'Could not load the changelog. ' + String(err?.message || err || '');
    });
  setTimeout(() => overlay.querySelector('#closeChangelog')?.focus(), 0);
}
function confirmAction(title, message, primary, danger = false) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML =
      '<div class="confirm-modal"><h2>' +
      esc(title) +
      '</h2><p>' +
      esc(message) +
      '</p><div class="actions"><button data-focusable class="cmd" id="cancelAction">Cancel</button><button data-focusable class="cmd ' +
      (danger ? 'danger' : 'primary') +
      '" id="confirmAction">' +
      esc(primary) +
      '</button></div></div>';
    document.body.appendChild(overlay);
    overlay.querySelector('#cancelAction').onclick = () => {
      overlay.remove();
      resolve(false);
    };
    overlay.querySelector('#confirmAction').onclick = () => {
      overlay.remove();
      resolve(true);
    };
    setTimeout(() => overlay.querySelector('#cancelAction')?.focus(), 0);
  });
}
function showErrorPopup(title, message) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML =
      '<div class="confirm-modal error-modal"><h2>' +
      esc(title) +
      '</h2><p>' +
      esc(message) +
      '</p><div class="actions"><button data-focusable class="cmd primary" id="closeError">OK</button></div></div>';
    document.body.appendChild(overlay);
    const close = () => {
      overlay.remove();
      resolve(true);
    };
    overlay.querySelector('#closeError').onclick = close;
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
    setTimeout(() => overlay.querySelector('#closeError')?.focus(), 0);
  });
}
function friendlyLaunchError(error) {
  const msg = String(error?.message || error || 'Unknown error');
  if (/Could not find application file|ENOENT/i.test(msg))
    return msg.startsWith('Could not find') ? msg : 'Could not find application file.';
  if (/EACCES|permission/i.test(msg))
    return 'The launcher does not have permission to open this game.';
  return msg;
}
async function toggleFavorite(game) {
  const u = await api.games.update(game.id, { favorite: !game.favorite });
  state.games = state.games.map((x) => (x.id === u.id ? u : x));
  setStatus(
    u.favorite ? game.title + ' added to Favorites.' : game.title + ' removed from Favorites.'
  );
  render();
}
function gameFromElement(el) {
  const target = el?.closest?.('[data-game],[data-menu],[data-game-wrap]');
  const id = target?.dataset?.game || target?.dataset?.menu || target?.dataset?.gameWrap;
  return id ? state.games.find((g) => g.id === id) : null;
}
async function favoriteFocusedGame() {
  let targetGame = null;
  if (state.view === 'details') targetGame = game();
  else if (state.settings?.useGamepadCursor) targetGame = gameFromElement(digitalCursorTarget());
  else targetGame = gameFromElement(document.activeElement);
  if (targetGame) await toggleFavorite(targetGame);
}
async function refreshGameArt(game) {
  const u = await api.artwork.refresh(game.id);
  state.games = state.games.map((x) => (x.id === u.id ? u : x));
  setStatus(game.title + ' art refreshed.');
  render();
}
async function replaceGameArt(game, slot) {
  if (!api.artwork.replace) {
    setStatus('Replace art is not available.');
    return;
  }
  const labels = { tile: 'tile art', logo: 'title art', banner: 'hero art' };
  const u = await api.artwork.replace(game.id, slot);
  if (u) {
    state.games = state.games.map((x) => (x.id === u.id ? u : x));
    setStatus(game.title + ' ' + (labels[slot] || 'art') + ' replaced.');
    render();
  }
}
async function searchAllGameArt(game, title) {
  if (!api.artwork.searchReplace) {
    setStatus('Artwork search is not available.');
    return;
  }
  setStatus('Searching artwork for ' + title + '...');
  const u = await api.artwork.searchReplace(game.id, title);
  if (u) {
    state.games = state.games.map((x) => (x.id === u.id ? u : x));
    setStatus(game.title + ' art replaced from search.');
    render();
  }
}
function artPreviewHtml(game, slot) {
  const a = game.artwork || {};
  const accent = a.color || '#46c2ff';
  const initials = a.initials || (game.title || '?').slice(0, 2).toUpperCase();
  if (slot === 'tile') {
    const img = a.gridUrl || '';
    return (
      '<span class="art-choice-preview tile-preview" style="--accent:' +
      esc(accent) +
      '">' +
      (img ? '<img src="' + esc(img) + '" alt="">' : '<b>' + esc(initials) + '</b>') +
      '</span>'
    );
  }
  if (slot === 'banner') {
    const img = a.heroUrl || a.gridUrl || '';
    return (
      '<span class="art-choice-preview hero-preview" style="--accent:' +
      esc(accent) +
      '">' +
      (img ? '<img src="' + esc(img) + '" alt="">' : '<b>' + esc(initials) + '</b>') +
      '</span>'
    );
  }
  const img = a.logoUrl || '';
  return (
    '<span class="art-choice-preview title-preview" style="--accent:' +
    esc(accent) +
    '">' +
    (img ? '<img src="' + esc(img) + '" alt="">' : '<b>' + esc(game.title || 'Title') + '</b>') +
    '</span>'
  );
}
function chooseReplacementArt(game) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML =
      '<div class="confirm-modal art-picker-modal"><h2>Replace art</h2><p>Type an exact SteamGridDB title to search all artwork at once, or choose a local file for one art type.</p><label class="art-search-field"><span>Search title</span><input data-focusable id="artSearchTitle" type="text" value="' +
      esc(game.title) +
      '"></label><div class="actions art-search-actions"><button data-focusable class="cmd primary" id="searchAllArt">Search</button></div><div class="art-choice-grid"><div class="art-choice-group">' +
      artPreviewHtml(game, 'tile') +
      '<strong>Tile art</strong><button data-focusable class="cmd" data-file-slot="tile">Local file</button></div><div class="art-choice-group">' +
      artPreviewHtml(game, 'banner') +
      '<strong>Hero art</strong><button data-focusable class="cmd" data-file-slot="banner">Local file</button></div><div class="art-choice-group">' +
      artPreviewHtml(game, 'logo') +
      '<strong>Title art</strong><button data-focusable class="cmd" data-file-slot="logo">Local file</button></div></div><div class="actions"><button data-focusable class="cmd" id="cancelArtReplace">Cancel</button></div></div>';
    document.body.appendChild(overlay);
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };
    const title = () => overlay.querySelector('#artSearchTitle')?.value?.trim() || game.title;
    overlay.querySelector('#searchAllArt').onclick = () => close({ search: true, title: title() });
    overlay.querySelector('#cancelArtReplace').onclick = () => close(null);
    overlay
      .querySelectorAll('[data-file-slot]')
      .forEach((btn) => (btn.onclick = () => close({ slot: btn.dataset.fileSlot })));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    setTimeout(() => overlay.querySelector('#artSearchTitle')?.focus(), 0);
  });
}
async function replaceGameArtFromPicker(game) {
  const choice = await chooseReplacementArt(game);
  if (!choice) return;
  if (choice.search) await searchAllGameArt(game, choice.title);
  else if (choice.slot) await replaceGameArt(game, choice.slot);
}
async function removeGame(game) {
  const choice = await confirmRemove(game);
  if (choice === 'cancel') return;
  if (choice === 'delete') {
    state.games = await api.games.removeWithFiles(game.id);
    setStatus(game.title + ' removed and files deleted.');
  } else {
    state.games = await api.games.remove(game.id);
    setStatus(game.title + ' removed from launcher.');
  }
  if (state.selectedGame === game.id) state.selectedGame = null;
  nav('library');
}
function renderGameMenu(game, anchor) {
  document.querySelector('.game-menu')?.remove();
  const menu = document.createElement('div');
  menu.className = 'game-menu';
  menu.innerHTML =
    '<button data-focusable id="menuFav">' +
    (game.favorite ? '★ Unfavorite' : '☆ Favorite') +
    '</button><button data-focusable id="menuBrowseFiles">Browse game files</button><button data-focusable id="menuRepair">Repair game</button><button data-focusable id="menuRefresh">Refresh Art</button><button data-focusable id="menuReplaceArt">Replace art</button><button data-focusable class="danger" id="menuRemove">Remove</button>';
  document.body.appendChild(menu);
  const r = anchor.getBoundingClientRect();
  menu.style.left = Math.min(window.innerWidth - 220, Math.max(12, r.right - 210)) + 'px';
  menu.style.top = Math.min(window.innerHeight - 220, Math.max(54, r.bottom + 8)) + 'px';
  const close = () => menu.remove();
  menu.querySelector('#menuFav').onclick = async () => {
    close();
    await toggleFavorite(game);
  };
  menu.querySelector('#menuBrowseFiles').onclick = async () => {
    close();
    try {
      await api.games.browseFiles(game.id);
      setStatus('Opened ' + game.title + ' files.');
    } catch (e) {
      setStatus('Could not open files: ' + e.message);
      await showErrorPopup('Could not open game files', e.message);
    }
  };
  menu.querySelector('#menuRepair').onclick = async () => {
    close();
    setStatus('Repairing ' + game.title + '...');
    try {
      const u = await api.games.repair(game.id);
      state.games = state.games.map((x) => (x.id === u.id ? u : x));
      setStatus(game.title + ' repaired.');
    } catch (e) {
      setStatus('Repair failed: ' + e.message);
      await showErrorPopup('Repair failed', e.message);
    }
    render();
  };
  menu.querySelector('#menuRefresh').onclick = async () => {
    close();
    await refreshGameArt(game);
  };
  menu.querySelector('#menuReplaceArt').onclick = async () => {
    close();
    await replaceGameArtFromPicker(game);
  };
  menu.querySelector('#menuRemove').onclick = async () => {
    close();
    await removeGame(game);
  };
  setTimeout(() => menu.querySelector('[data-focusable]')?.focus(), 0);
  setTimeout(() => {
    const handler = (e) => {
      if (!menu.contains(e.target) && e.target !== anchor) {
        close();
        document.removeEventListener('pointerdown', handler);
      }
    };
    document.addEventListener('pointerdown', handler);
  }, 0);
}
function dotsIcon() {
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h.01"></path><path d="M12 12h.01"></path><path d="M19 12h.01"></path></svg>';
}
function gameTileHtml(g) {
  const hasSize = Number.isFinite(Number(g.installedSizeBytes));
  const showSize = state.librarySort === 'size' || hasSize;
  const sizeLabel =
    state.librarySort === 'size' && state.librarySizeLoading && !hasSize
      ? 'Calculating...'
      : formatBytes(g.installedSizeBytes);
  const sizeHtml = showSize ? '<span class="size-badge">' + sizeLabel + '</span>' : '';
  return (
    '<div class="tile-wrap ' +
    (g.favorite ? 'favorite' : '') +
    ' ' +
    (state.runningGames.has(g.id) ? 'running' : '') +
    '" data-game-wrap="' +
    g.id +
    '"><button data-focusable class="tile" data-game="' +
    g.id +
    '">' +
    art(g.artwork, g.title) +
    sizeHtml +
    (g.favorite ? '<span class="favorite-badge">★</span>' : '') +
    (state.runningGames.has(g.id) ? '<span class="running-badge">Running</span>' : '') +
    '</button><button data-focusable class="tile-menu" data-menu="' +
    g.id +
    '" title="Game actions" aria-label="Game actions">' +
    dotsIcon() +
    '</button></div>'
  );
}
function wireLibraryTiles() {
  document.querySelectorAll('[data-game]').forEach(
    (b) =>
      (b.onclick = () => {
        state.selectedGame = b.dataset.game;
        nav('details');
      })
  );
  document.querySelectorAll('[data-menu]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const g = state.games.find((x) => x.id === b.dataset.menu);
        if (g) renderGameMenu(g, b);
      })
  );
}
function renderLibrary(v) {
  if (!state.games.length) {
    v.innerHTML =
      '<div class="empty"><h2>No games imported yet</h2><p>Add folders in Settings, then scan from Imports to review candidates before they land in your library.</p><div class="actions"><button data-focusable class="cmd primary" id="settings">Add folders</button><button data-focusable class="cmd" id="imports">Imports</button></div></div>';
    $('#settings').onclick = () => nav('settings');
    let im = $('#imports');
    if (im) im.onclick = () => nav('imports');
    return;
  }
  const sort = state.librarySort || 'default';
  const compare = (a, b) => {
    if (sort === 'az') return a.g.title.localeCompare(b.g.title);
    if (sort === 'za') return b.g.title.localeCompare(a.g.title);
    if (sort === 'size')
      return (
        (b.g.installedSizeBytes || 0) - (a.g.installedSizeBytes || 0) ||
        a.g.title.localeCompare(b.g.title)
      );
    if (sort === 'playtime')
      return (
        (b.g.playtimeSeconds || 0) - (a.g.playtimeSeconds || 0) ||
        a.g.title.localeCompare(b.g.title)
      );
    return a.i - b.i;
  };
  const query = String(state.librarySearch || '')
    .trim()
    .toLowerCase();
  const all = state.games
    .map((g, i) => ({ g, i }))
    .filter(
      (x) =>
        !query ||
        String(x.g.title || '')
          .toLowerCase()
          .includes(query)
    )
    .sort((a, b) => (b.g.favorite ? 1 : 0) - (a.g.favorite ? 1 : 0) || compare(a, b))
    .map((x) => x.g);
  const sortOptions = [
    ['default', 'Default'],
    ['az', 'A-Z'],
    ['za', 'Z-A'],
    ['size', 'Installed Size'],
    ['playtime', 'Time Played']
  ]
    .map(
      ([value, label]) =>
        '<option value="' +
        value +
        '" ' +
        (sort === value ? 'selected' : '') +
        '>' +
        label +
        '</option>'
    )
    .join('');
  v.innerHTML =
    '<div class="toolbar library-toolbar">' +
    (state.pending.length
      ? '<button data-focusable class="cmd" id="imports">' +
        state.pending.length +
        ' pending</button>'
      : '') +
    '<label class="library-search"><span>Search</span><input data-focusable id="librarySearch" type="search" value="' +
    esc(state.librarySearch || '') +
    '" placeholder="Find a game"></label><label class="sort-control library-sort">Sort<select data-focusable id="librarySort">' +
    sortOptions +
    '</select></label></div><section class="library-section"><h2>Library</h2>' +
    (all.length
      ? '<div class="grid">' + all.map(gameTileHtml).join('') + '</div>'
      : '<div class="downloads-empty"><h2>No matches</h2><p>No games match your search.</p></div>') +
    '</section>';
  const librarySearch = $('#librarySearch');
  if (librarySearch)
    librarySearch.oninput = (e) => {
      state.librarySearch = e.target.value;
      render();
      setTimeout(() => {
        const s = $('#librarySearch');
        if (s) {
          s.focus();
          s.selectionStart = s.selectionEnd = s.value.length;
        }
      }, 0);
    };
  const librarySort = $('#librarySort');
  if (librarySort)
    librarySort.onchange = async (e) => {
      state.librarySort = e.target.value;
      if (state.librarySort === 'size' && api.games?.list) {
        state.librarySizeLoading = true;
        render();
        try {
          state.games = await api.games.list();
        } catch (err) {
          console.warn('Size refresh failed', err);
        } finally {
          state.librarySizeLoading = false;
        }
      }
      render();
    };
  let im = $('#imports');
  if (im) im.onclick = () => nav('imports');
  wireLibraryTiles();
}
function renderDetails(v) {
  const g = game();
  if (!g) {
    nav('library');
    return;
  }
  const a = g.artwork || { color: '#46c2ff', initials: (g.title || '?').slice(0, 2).toUpperCase() };
  const hero = a.heroUrl || a.gridUrl || '';
  const logo = a.logoUrl || '';
  const logoHtml = logo
    ? '<span class="game-logo-bg" role="img" aria-label="' +
      esc(g.title) +
      '" style="background-image:url(&quot;' +
      esc(logo) +
      '&quot;)"></span>'
    : '<h2 class="game-logo-text">' + esc(g.title) + '</h2>';
  const isRunning = state.runningGames.has(g.id);
  const isLaunching = state.launchingGames.has(g.id);
  const launchLabel = isLaunching ? 'Launching...' : isRunning ? 'Stop' : 'Launch';
  const launchIcon = isRunning ? '×' : '▶';
  v.innerHTML =
    '<div class="details nevko-details" style="--accent:' +
    esc(a.color || '#46c2ff') +
    '"><section class="details-hero"><div class="details-hero-bg">' +
    (hero
      ? '<img src="' + esc(hero) + '" alt="">'
      : '<span class="details-hero-initials">' + esc(a.initials || '') + '</span>') +
    '</div><div class="details-hero-shade"></div><div class="details-top"><button data-focusable class="icon-nav back-arrow" id="back" title="Back" aria-label="Back"><svg viewBox="0 0 24 24"><path d="M15 18 9 12l6-6"></path></svg></button><button data-focusable class="icon-nav details-menu" id="detailsMenu" title="Game actions" aria-label="Game actions">' +
    dotsIcon() +
    '</button></div><div class="details-hero-content"><div class="game-logo-wrap">' +
    logoHtml +
    '</div><button data-focusable class="launch-hero ' +
    (isRunning ? 'stop ' : isLaunching ? 'launching-state ' : '') +
    '" id="launch" ' +
    (isLaunching ? 'disabled' : '') +
    '><span>' +
    launchIcon +
    '</span>' +
    launchLabel +
    '</button></div></section><section class="details-panels"><article class="details-panel activity-panel"><h3>Game Info</h3><div class="meta detail-meta"><span>Last played</span><strong>' +
    date(g.lastPlayed) +
    '</strong><span>Launches</span><strong>' +
    g.launchCount +
    '</strong><span>Playtime</span><strong>' +
    formatPlaytime(g.playtimeSeconds) +
    '</strong><span>Installed size</span><strong>' +
    (g.installedSizeBytes ? formatBytes(g.installedSizeBytes) : 'Unknown') +
    '</strong><span>Executable</span><strong>' +
    esc(g.executablePath) +
    '</strong></div></article><aside class="details-panel side-panel"><h3>Quick Actions</h3><button data-focusable class="cmd favorite-action ' +
    (g.favorite ? 'active' : '') +
    '" id="detailFav">' +
    (g.favorite ? '★ Favorited' : '☆ Favorite') +
    '</button><button data-focusable class="cmd" id="detailArt">Refresh Art</button></aside></section></div>';
  $('#launch').onclick = async () => {
    if (state.launchingGames.has(g.id)) return;
    if (state.runningGames.has(g.id)) {
      const ok = await confirmAction(
        'Stop ' + g.title + '?',
        'This will try to close the running game process.',
        'Stop',
        true
      );
      if (!ok) return;
      setStatus('Stopping ' + g.title + '...');
      const result = await api.games.stop(g.id);
      state.runningGames = new Set((result.running || []).map((x) => x.id));
      state.games = await api.games.list();
      setStatus(result.stopped ? g.title + ' stopped.' : g.title + ' is not running.');
      render();
      return;
    }
    const other = [...state.runningGames].filter((id) => id !== g.id);
    if (other.length) {
      const ok = await confirmAction(
        'Launch another game?',
        'Another game is already running. Launching another could cause lag on your computer.',
        'Launch anyway'
      );
      if (!ok) return;
    }
    setStatus('Launching ' + g.title + '...');
    state.launchingGames.add(g.id);
    document.body.classList.add('launching');
    render();
    try {
      const u = await api.games.launch(g.id);
      state.launchingGames.delete(g.id);
      state.runningGames = new Set((u._running || []).map((x) => x.id));
      state.games = state.games.map((x) => (x.id === u.id ? u : x));
      setStatus(g.title + ' launched.');
    } catch (e) {
      state.launchingGames.delete(g.id);
      const message = friendlyLaunchError(e);
      setStatus('Launch failed: ' + message);
      await showErrorPopup('Could not launch ' + g.title, message);
    } finally {
      document.body.classList.remove('launching');
      render();
    }
  };
  $('#detailsMenu').onclick = (e) => renderGameMenu(g, e.currentTarget);
  $('#back').onclick = () => nav('library');
  $('#detailFav').onclick = () => toggleFavorite(g);
  $('#detailArt').onclick = () => refreshGameArt(g);
}
function renderImports(v) {
  v.innerHTML =
    '<div class="toolbar"><button data-focusable class="cmd primary" id="scanImports">Scan folders</button><button data-focusable class="cmd" id="zipImport">Import archive</button><button data-focusable class="cmd" id="selectAllImports" ' +
    (!state.pending.length ? 'disabled' : '') +
    '>Select all</button><button data-focusable class="cmd primary" id="confirm" ' +
    (!state.selected.size ? 'disabled' : '') +
    '>Import selected</button><button data-focusable class="cmd danger" id="discard" ' +
    (!state.selected.size ? 'disabled' : '') +
    '>Discard selected</button><button data-focusable class="cmd danger" id="discardAllImports" ' +
    (!state.pending.length ? 'disabled' : '') +
    '>Discard all</button></div><div class="import-progress" hidden><div class="progress-head"><span class="import-progress-label">Preparing import...</span></div><span class="progress-track"><span class="import-progress-fill progress-fill"></span></span></div><div class="drop-zone" id="archiveDrop"><strong>Drop ZIP, 7Z, or RAR archives here</strong><span>They will extract into your Games folder and add themselves to Library.</span></div>' +
    (state.pending.length
      ? state.pending
          .map(
            (i) =>
              '<div class="row ' +
              (state.selected.has(i.id) ? 'selected' : '') +
              '">' +
              art(i.artwork, i.title) +
              '<span><label>Suggested title<input data-focusable type="text" data-name="' +
              i.id +
              '" value="' +
              esc(i.title) +
              '"></label><small>' +
              esc(i.executablePath) +
              '</small></span><label class="select"><input data-focusable type="checkbox" data-check="' +
              i.id +
              '" ' +
              (state.selected.has(i.id) ? 'checked' : '') +
              '>Import</label></div>'
          )
          .join('')
      : '<div class="empty"><h2>No pending imports</h2><p>Run a scan from Library or Settings to find executable games.</p></div>');
  $('#scanImports').onclick = scan;
  $('#zipImport').onclick = async () => {
    setStatus('Importing archive...');
    try {
      const result = await api.imports.importZip();
      state.games = result.games || state.games;
      setStatus(
        result.imported?.length
          ? 'Imported ' +
              result.imported.length +
              ' archive game' +
              (result.imported.length === 1 ? '' : 's') +
              '.'
          : 'No archive selected.'
      );
      if (result.imported?.length) nav('library');
      else render();
    } catch (e) {
      setStatus('ZIP import failed: ' + e.message);
    }
  };
  const drop = $('#archiveDrop');
  if (drop) {
    ['dragenter', 'dragover'].forEach((type) =>
      drop.addEventListener(type, (e) => {
        e.preventDefault();
        drop.classList.add('drag-over');
      })
    );
    ['dragleave', 'drop'].forEach((type) =>
      drop.addEventListener(type, (e) => {
        e.preventDefault();
        if (type === 'dragleave') drop.classList.remove('drag-over');
      })
    );
    drop.addEventListener('drop', async (e) => {
      e.preventDefault();
      drop.classList.remove('drag-over');
      const paths = [...e.dataTransfer.files]
        .map((f) => f.path)
        .filter(Boolean)
        .filter((p) => /\.(zip|7z|rar)$/i.test(p));
      if (!paths.length) {
        setStatus('Drop a ZIP, 7Z, or RAR archive.');
        return;
      }
      setStatus('Importing dropped archive' + (paths.length === 1 ? '' : 's') + '...');
      try {
        const result = await api.imports.importDropped(paths);
        state.games = result.games || state.games;
        setStatus(
          result.imported?.length
            ? 'Imported ' +
                result.imported.length +
                ' dropped archive game' +
                (result.imported.length === 1 ? '' : 's') +
                '.'
            : 'No playable games found in dropped archives.'
        );
        if (result.imported?.length) nav('library');
        else render();
      } catch (err) {
        setStatus('Dropped archive import failed: ' + err.message);
      }
    });
  }
  $('#selectAllImports').onclick = () => {
    state.selected = new Set(state.pending.map((p) => p.id));
    render();
  };
  $('#discardAllImports').onclick = async () => {
    if (!state.pending.length) return;
    state.pending = await api.imports.discard(state.pending.map((p) => p.id));
    state.selected.clear();
    setStatus('Discarded all pending imports.');
    render();
  };
  document.querySelectorAll('[data-name]').forEach(
    (i) =>
      (i.oninput = () => {
        const item = state.pending.find((p) => p.id === i.dataset.name);
        if (item) item.title = i.value;
      })
  );
  document.querySelectorAll('[data-check]').forEach(
    (c) =>
      (c.onchange = () => {
        c.checked ? state.selected.add(c.dataset.check) : state.selected.delete(c.dataset.check);
        render();
      })
  );
  $('#confirm').onclick = async () => {
    const ids = [...state.selected];
    const edits = Object.fromEntries(
      state.pending
        .filter((p) => state.selected.has(p.id))
        .map((p) => [p.id, { title: p.title, artwork: p.artwork }])
    );
    state.games = await api.imports.confirm({ ids, edits });
    state.pending = await api.imports.list();
    state.selected.clear();
    setStatus('Imported ' + ids.length + ' games.');
    nav('library');
  };
  $('#discard').onclick = async () => {
    state.pending = await api.imports.discard([...state.selected]);
    state.selected.clear();
    render();
  };
}
function renderDownloads(v) {
  const fallback = [];
  let items =
    state.downloadsCatalog && state.downloadsCatalog.length
      ? state.downloadsCatalog.map((x, i) => ({
          title: x.title,
          initials: (x.title || '?').slice(0, 2).toUpperCase(),
          color: x.color || '#46c2ff',
          image: x.image || '',
          download: x.download,
          version: x.version || '',
          dlc: x.dlc === true,
          controller: x.controller === true,
          index: i
        }))
      : fallback;
  const query = String(state.downloadsSearch || '')
    .trim()
    .toLowerCase();
  if (query)
    items = items.filter((item) =>
      String(item.title || '')
        .toLowerCase()
        .includes(query)
    );
  const sort = state.downloadsSort || 'default';
  if (sort === 'name')
    items = items
      .slice()
      .sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
  if (sort === 'nameDesc')
    items = items
      .slice()
      .sort((a, b) => String(b.title || '').localeCompare(String(a.title || '')));
  if (sort === 'available')
    items = items
      .slice()
      .sort(
        (a, b) =>
          (hasLibraryGame(a.title, a.download) ? 1 : 0) -
            (hasLibraryGame(b.title, b.download) ? 1 : 0) || a.index - b.index
      );
  if (sort === 'installed')
    items = items
      .slice()
      .sort(
        (a, b) =>
          (hasLibraryGame(b.title, b.download) ? 1 : 0) -
            (hasLibraryGame(a.title, a.download) ? 1 : 0) || a.index - b.index
      );
  const sortOptions = [
    ['default', 'Default'],
    ['name', 'Name A-Z'],
    ['nameDesc', 'Name Z-A'],
    ['available', 'Available first'],
    ['installed', 'Installed first']
  ]
    .map(
      ([value, label]) =>
        '<option value="' +
        value +
        '" ' +
        (sort === value ? 'selected' : '') +
        '>' +
        label +
        '</option>'
    )
    .join('');
  const serverLabel =
    state.serverStatus === 'online'
      ? 'Server online'
      : state.serverStatus === 'offline'
        ? 'Unable to connect'
        : 'Connecting...';
  v.innerHTML =
    '<div class="downloads-native"><div id="downloadQueue" class="download-queue" hidden></div><div class="self-hosted-note"><strong>Self-hosted downloads</strong><span>These files come from my own server, so downloads may be slow, <b>especially</b> when multiple people are downloading at the same time.</span></div><div class="downloads-controls"><span class="server-chip ' +
    state.serverStatus +
    '">' +
    serverLabel +
    '</span><label class="download-search"><span>Search</span><input data-focusable id="downloadsSearch" type="search" value="' +
    esc(state.downloadsSearch || '') +
    '" placeholder="Find a download"></label><label class="sort-control">Sort<select data-focusable id="downloadsSort">' +
    sortOptions +
    '</select></label><div class="downloads-actions"><button data-focusable class="cmd primary" id="downloadGames">Download games</button><button data-focusable class="cmd" id="refreshDownloads">Refresh</button><button data-focusable class="cmd" id="openSource">Open source page</button></div></div>' +
    (!items.length
      ? '<div class="downloads-empty"><h2>' +
        (state.downloadsLoading ? 'Loading server games' : 'No server games loaded') +
        '</h2><p>' +
        (state.downloadsLoading
          ? 'Checking the server in the background...'
          : 'Either you have no internet connection, or the server is down, which in that case, I am working on it.') +
        '</p></div>'
      : '<div class="download-grid">' +
        items
          .map((item) => {
            const installedGame = findLibraryGame(item.title, item.download);
            const updateAvailable =
              installedGame &&
              item.version &&
              compareGameVersions(item.version, installedGame.version) > 0;
            const disabled = installedGame && !updateAvailable;
            const status = updateAvailable
              ? 'Update available'
              : installedGame
                ? 'Already in Library'
                : 'Install to Games folder';
            const pills =
              (item.dlc ? '<span class="download-pill dlc-pill">DLC Included</span>' : '') +
              (item.controller
                ? '<span class="download-pill controller-pill">Controller Compatible</span>'
                : '') +
              (updateAvailable ? '<span class="download-pill update-pill">Update</span>' : '');
            return (
              '<button data-focusable class="download-card ' +
              (installedGame ? 'installed ' : '') +
              (updateAvailable ? 'update-available' : '') +
              '" ' +
              (disabled ? 'disabled ' : '') +
              'data-download="' +
              esc(item.title) +
              '" data-link="' +
              esc(item.download) +
              '" data-version="' +
              esc(item.version) +
              '" data-dlc="' +
              (item.dlc ? 'true' : 'false') +
              '" data-controller="' +
              (item.controller ? 'true' : 'false') +
              '" style="--accent:' +
              item.color +
              '"><span class="download-image-wrap">' +
              (item.image
                ? '<img class="download-img" src="' + esc(item.image) + '" alt="" loading="lazy">'
                : '') +
              '<span class="download-fallback">' +
              item.initials +
              '</span></span><span class="download-pills">' +
              pills +
              '</span><strong>' +
              esc(item.title) +
              '</strong><small>' +
              status +
              '</small></button>'
            );
          })
          .join('') +
        '</div>') +
    '</div>';
  renderDownloadQueue();
  const searchInput = $('#downloadsSearch');
  if (searchInput)
    searchInput.oninput = (e) => {
      state.downloadsSearch = e.target.value;
      render();
      setTimeout(() => {
        const s = $('#downloadsSearch');
        if (s) {
          s.focus();
          s.selectionStart = s.selectionEnd = s.value.length;
        }
      }, 0);
    };
  const sortSelect = $('#downloadsSort');
  if (sortSelect)
    sortSelect.onchange = (e) => {
      state.downloadsSort = e.target.value;
      render();
    };
  $('#downloadGames').onclick = async () => {
    setStatus('Opening downloads folder...');
    try {
      await api.downloads.openDrive();
      setStatus('Downloads folder opened.');
    } catch (e) {
      setStatus('Could not open downloads: ' + e.message);
    }
  };
  $('#refreshDownloads').onclick = async () => {
    setStatus('Refreshing downloads...');
    state.downloadsCatalog = null;
    await loadDownloadsCatalog();
    setStatus(state.downloadsCatalog ? 'Downloads refreshed.' : 'Downloads unavailable.');
  };
  $('#openSource').onclick = async () => {
    setStatus('Opening source page...');
    try {
      await api.downloads.open();
      setStatus('Source page opened.');
    } catch (e) {
      setStatus('Could not open source page: ' + e.message);
    }
  };
  document.querySelectorAll('[data-download]:not(:disabled)').forEach(
    (b) =>
      (b.onclick = async () => {
        const installed = findLibraryGame(b.dataset.download, b.dataset.link);
        const isUpdate = !!installed && b.classList.contains('update-available');
        if (installed && !isUpdate) {
          setStatus(b.dataset.download + ' is already installed.');
          return;
        }
        if (
          isUpdate &&
          !(await confirmAction(
            'Update ' + b.dataset.download + '?',
            'This will compare the downloaded archive against the installed folder and only replace files that changed.',
            'Update',
            true
          ))
        )
          return;
        if (!(await warnLowStorageBeforeDownload())) return;
        enqueueDownload({
          name: b.dataset.download,
          url: b.dataset.link,
          version: b.dataset.version || '',
          dlc: b.dataset.dlc === 'true',
          isUpdate
        });
        render();
      })
  );
}
function systemStatsHtml() {
  const s = state.systemStats;
  if (state.systemStatsLoading && !s) return '<p>Loading computer stats...</p>';
  if (!s) return '<p>Computer stats are not loaded yet.</p>';
  return (
    '<div class="stats-grid"><span>CPU</span><strong>' +
    esc(s.cpu) +
    '</strong><span>' +
    esc(s.gpuLabel || 'GPU') +
    '</span><strong>' +
    esc(s.gpu) +
    '</strong><span>RAM</span><strong>' +
    esc(s.ram) +
    '</strong><span>Display</span><strong>' +
    esc(s.display) +
    '</strong><span>' +
    esc(s.vramLabel || 'Dedicated GPU VRAM') +
    '</span><strong>' +
    esc(s.vram) +
    '</strong><span>Storage</span><strong>' +
    esc(s.storage) +
    '</strong></div>'
  );
}
async function loadSystemStats(force = false) {
  if (state.systemStatsLoading || !api.system?.stats) return;
  if (state.systemStatsRequested && !force) return;
  state.systemStatsRequested = true;
  state.systemStatsLoading = true;
  try {
    state.systemStats = await api.system.stats();
  } catch (e) {
    state.systemStats = {
      cpu: 'Unavailable',
      gpuLabel: 'GPU',
      gpu: 'Unavailable',
      ram: 'Unavailable',
      display: 'Unavailable',
      vramLabel: 'Dedicated GPU VRAM',
      vram: 'Unavailable',
      storage: 'Unavailable'
    };
    console.warn('System stats failed', e);
  } finally {
    state.systemStatsLoading = false;
    if (state.view === 'settings') render();
  }
}
function renderSettings(v) {
  v.innerHTML =
    '<div class="settings"><div class="panel"><h2>Scan folders</h2><div class="folders">' +
    (state.settings.scanFolders.length
      ? state.settings.scanFolders
          .map(
            (f) =>
              '<div class="folder-row"><code>' +
              esc(f) +
              '</code><button data-focusable class="cmd danger remove-folder" data-folder="' +
              esc(f) +
              '">Remove</button></div>'
          )
          .join('')
      : '<p>No folders selected.</p>') +
    '</div><div class="actions"><button data-focusable class="cmd primary" id="choose">Add folder</button><button data-focusable class="cmd" id="scan">Rescan</button></div></div><div class="panel theme-panel"><h2>Theme</h2><div class="theme-section"><h3>Themes</h3><div class="theme-current"><span>Current theme</span><strong>' +
    (state.settings.themeCssPath
      ? esc(state.settings.themeCssName || pathBase(state.settings.themeCssPath))
      : 'Default') +
    '</strong><span>Status</span><small>' +
    (state.settings.themeCssPath
      ? 'Loaded after built-in styles.'
      : 'Import a CSS theme or BSLT package to reskin the launcher.') +
    '</small></div>' +
    themeListHtml() +
    '<div class="actions"><button data-focusable class="cmd primary" id="importTheme">Import theme</button><button data-focusable class="cmd" id="themeFolder">Theme folder</button><button data-focusable class="cmd" id="themeDocs">Theme docs</button><button data-focusable class="cmd danger" id="removeTheme" ' +
    (!state.settings.themeCssPath ? 'disabled' : '') +
    '>Remove theme</button></div></div><div class="theme-section theme-background-section"><h3>Background</h3><div class="theme-current"><span>Background image</span><strong>' +
    (state.settings.themeBackgroundLocked || state.settings.themeBackgroundPath
      ? esc(state.settings.themeBackgroundName || pathBase(state.settings.themeBackgroundPath))
      : 'Default') +
    '</strong><span>Status</span><small>' +
    (state.settings.themeBackgroundLocked
      ? 'Locked by the active theme package.'
      : state.settings.themeBackgroundPath
        ? 'Used behind the launcher surface.'
        : 'Choose an image to use as the launcher background.') +
    '</small></div><div class="actions"><button data-focusable class="cmd primary" id="chooseBackground" ' +
    (state.settings.themeBackgroundLocked ? 'disabled' : '') +
    '>Choose background</button><button data-focusable class="cmd danger" id="removeBackground" ' +
    (!state.settings.themeBackgroundPath || state.settings.themeBackgroundLocked ? 'disabled' : '') +
    '>Remove background</button></div></div></div><div class="panel"><h2>SteamGridDB</h2><label>API key<input data-focusable type="password" id="key" value="' +
    esc(state.settings.steamGridDbApiKey) +
    '"></label><button data-focusable class="cmd" id="savekey">Save key</button></div><div class="panel accessibility-panel"><h2>Accessibility</h2><label class="select"><input data-focusable id="pad" type="checkbox" ' +
    (state.settings.enableGamepad ? 'checked' : '') +
    '>Gamepad navigation</label>' +
    (state.settings.enableGamepad
      ? '<label class="select sub-setting"><input data-focusable id="cursorMode" type="checkbox" ' +
        (state.settings.useGamepadCursor ? 'checked' : '') +
        '>Digital cursor</label>'
      : '') +
    '<label class="select"><input data-focusable id="motion" type="checkbox" ' +
    (state.settings.reduceMotion ? 'checked' : '') +
    '>Reduce motion</label><label class="select"><input data-focusable id="largeText" type="checkbox" ' +
    (state.settings.largeText ? 'checked' : '') +
    '>Larger text</label></div><div class="panel downloads-settings"><h2>Downloads</h2><label class="select"><input data-focusable id="downloadStats" type="checkbox" ' +
    (state.settings.showDownloadStats !== false ? 'checked' : '') +
    '>Show download stats</label><label class="select"><input data-focusable id="autoArtwork" type="checkbox" ' +
    (state.settings.autoRefreshArtwork !== false ? 'checked' : '') +
    '>Auto refresh artwork</label><label class="select"><input data-focusable id="updateNotifications" type="checkbox" ' +
    (state.settings.showUpdateNotifications !== false ? 'checked' : '') +
    '>Update notifications</label><button data-focusable class="cmd settings-check-update" id="checkUpdates">Check for updates</button></div><div class="panel window-panel"><h2>Window</h2><label class="select"><input data-focusable id="trayClose" type="checkbox" ' +
    (state.settings.minimizeToTray !== false ? 'checked' : '') +
    '>Minimize to tray when closing</label><label class="select"><input data-focusable id="controllerHints" type="checkbox" ' +
    (state.settings.showControllerHints !== false ? 'checked' : '') +
    '>Show controller hints</label>' +
    (state.settings.showControllerHints !== false
      ? '<label class="select sub-setting"><input data-focusable id="controllerHintText" type="checkbox" ' +
        (state.settings.showControllerHintText !== false ? 'checked' : '') +
        '>Show text indicator</label>'
      : '') +
    '</div><div class="panel tutorial-panel"><h2>Tutorial</h2><button data-focusable class="cmd" id="resetTutorial">Reset tutorial</button></div><div class="panel debug-panel"><h2>Debug</h2><label class="select"><input data-focusable id="showOutput" type="checkbox" ' +
    (state.settings.showOutput ? 'checked' : '') +
    '>Show output</label></div><div class="panel build-info"><h2>Build info</h2><div class="build-grid"><span>Version</span><strong>' +
    formatVersion(state.appVersion) +
    '</strong><span>Build</span><strong>Windows desktop package</strong><span>Downloads</span><strong>Server link</strong></div></div><div class="panel system-stats"><div class="panel-title-row"><h2>Computer stats</h2><button data-focusable class="cmd" id="refreshStats">Refresh</button></div>' +
    systemStatsHtml() +
    '</div></div>';
  $('#choose').onclick = async () => {
    state.settings.scanFolders = await api.folders.choose();
    render();
  };
  document.querySelectorAll('[data-folder]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        const folder = btn.dataset.folder;
        state.settings = await api.settings.update({
          scanFolders: state.settings.scanFolders.filter((f) => f !== folder)
        });
        render();
      })
  );
  $('#scan').onclick = scan;
  $('#savekey').onclick = async () => {
    state.settings = await api.settings.update({ steamGridDbApiKey: $('#key').value });
    setStatus('Settings saved.');
  };
  const themesToggle = $('#themesToggle');
  if (themesToggle)
    themesToggle.onclick = () => {
      state.themesListOpen = !state.themesListOpen;
      if (state.themesListOpen && state.themesList === null) loadThemeList();
      else render();
    };
  document.querySelectorAll('[data-theme-apply]').forEach(
    (btn) =>
      (btn.onclick = async () => {
        try {
          state.settings = await api.themes.apply(btn.dataset.themeApply);
          applyImportedTheme();
          setStatus(
            'Theme applied: ' +
              (state.settings.themeCssName || pathBase(state.settings.themeCssPath))
          );
          render();
        } catch (e) {
          setStatus('Could not apply theme: ' + e.message);
        }
      })
  );
  if (state.themesList === null && !state.themesListLoading) setTimeout(loadThemeList, 0);
  $('#importTheme').onclick = async () => {
    state.settings = await api.themes.importCss();
    applyImportedTheme();
    state.themesList = null;
    if (state.themesListOpen) await loadThemeList();
    setStatus(
      state.settings.themeCssPath
        ? 'Theme imported: ' +
            (state.settings.themeCssName || pathBase(state.settings.themeCssPath))
        : 'No theme selected.'
    );
    render();
  };
  $('#removeTheme').onclick = async () => {
    state.settings = await api.themes.remove();
    applyImportedTheme();
    state.themesList = null;
    if (state.themesListOpen) await loadThemeList();
    setStatus('Theme removed.');
    render();
  };
  $('#chooseBackground').onclick = async () => {
    state.settings = await api.themes.importBackground();
    applyImportedTheme();
    setStatus(
      state.settings.themeBackgroundPath
        ? 'Background applied: ' +
            (state.settings.themeBackgroundName || pathBase(state.settings.themeBackgroundPath))
        : 'No background selected.'
    );
    render();
  };
  $('#removeBackground').onclick = async () => {
    state.settings = await api.themes.removeBackground();
    applyImportedTheme();
    setStatus('Background removed.');
    render();
  };
  const themeFolder = $('#themeFolder');
  if (themeFolder)
    themeFolder.onclick = async () => {
      try {
        await api.themes.openFolder();
        state.themesList = null;
        await loadThemeList();
        setStatus('Theme folder opened.');
      } catch (e) {
        setStatus('Could not open theme folder: ' + e.message);
      }
    };
  $('#themeDocs').onclick = showThemeDocs;
  $('#pad').onchange = async (e) => {
    state.settings = await api.settings.update({ enableGamepad: e.target.checked });
    render();
  };
  const cursorMode = $('#cursorMode');
  if (cursorMode)
    cursorMode.onchange = async (e) => {
      state.settings = await api.settings.update({ useGamepadCursor: e.target.checked });
      render();
    };
  $('#motion').onchange = async (e) => {
    state.settings = await api.settings.update({ reduceMotion: e.target.checked });
    render();
  };
  $('#largeText').onchange = async (e) => {
    state.settings = await api.settings.update({ largeText: e.target.checked });
    render();
  };
  $('#downloadStats').onchange = async (e) => {
    state.settings = await api.settings.update({ showDownloadStats: e.target.checked });
  };
  $('#autoArtwork').onchange = async (e) => {
    state.settings = await api.settings.update({ autoRefreshArtwork: e.target.checked });
  };
  $('#updateNotifications').onchange = async (e) => {
    state.settings = await api.settings.update({ showUpdateNotifications: e.target.checked });
  };
  $('#checkUpdates').onclick = () => checkLauncherUpdate(true);
  $('#resetTutorial').onclick = async () => {
    state.settings = await api.settings.update({ tutorialCompleted: false });
    showTutorial();
  };
  $('#trayClose').onchange = async (e) => {
    state.settings = await api.settings.update({ minimizeToTray: e.target.checked });
  };
  $('#controllerHints').onchange = async (e) => {
    state.settings = await api.settings.update({ showControllerHints: e.target.checked });
    render();
  };
  const hintTextToggle = $('#controllerHintText');
  if (hintTextToggle)
    hintTextToggle.onchange = async (e) => {
      state.settings = await api.settings.update({ showControllerHintText: e.target.checked });
      render();
    };
  $('#showOutput').onchange = async (e) => {
    state.settings = await api.settings.update({ showOutput: e.target.checked });
    render();
  };
  const refreshStats = $('#refreshStats');
  if (refreshStats)
    refreshStats.onclick = () => {
      state.systemStatsRequested = false;
      loadSystemStats(true);
    };
  if (!state.systemStatsRequested) setTimeout(loadSystemStats, 0);
}
async function scan() {
  setStatus('Scanning folders...');
  const r = await api.library.scan();
  state.pending = await api.imports.list();
  setStatus('Found ' + r.candidatesFound + ' candidates. Ignored ' + r.ignoredCount + '.');
  if (r.pendingImports.length) nav('imports');
  else render();
}
function nav(v) {
  state.view = v;
  if (state.railMode) {
    state.railMode = false;
    document.body.classList.remove('rail-mode');
  }
  render();
  if (v === 'downloads' && !state.downloadsLoading && !state.downloadsCatalog)
    setTimeout(loadDownloadsCatalog, 0);
}
if (api.imports?.onProgress) {
  api.imports.onProgress((p) => {
    state.importProgress = p;
    const wrap = document.querySelector('.import-progress');
    const fill = document.querySelector('.import-progress-fill');
    const label = document.querySelector('.import-progress-label');
    if (wrap) wrap.hidden = false;
    if (fill && p.percent != null) fill.style.width = Math.max(0, Math.min(100, p.percent)) + '%';
    if (label)
      label.textContent =
        (p.total ? p.index + '/' + p.total + ' • ' : '') +
        p.name +
        ' - ' +
        p.phase +
        (p.percent != null ? ' ' + p.percent + '%' : '');
    if (p.phase === 'done')
      setTimeout(() => {
        state.importProgress = null;
        if (state.view === 'imports') render();
      }, 900);
  });
}
if (api.downloads.onProgress) {
  api.downloads.onProgress((p) => {
    try {
      state.installProgress = p;
      const job = findDownloadJobByName(p.name) || findDownloadJob(state.activeDownloadId);
      if (job) {
        job.progress = { ...(job.progress || {}), ...p };
        if (p.phase === 'failed') job.phase = 'failed';
        else if (p.phase === 'cancelled') job.phase = 'cancelled';
        else if (p.phase === 'done') finishDownloadJob(job, 'done');
        else if (job.phase !== 'queued') job.phase = 'active';
      }
      setStatus(p.name + ': ' + p.phase + (p.percent != null ? ' ' + p.percent + '%' : ''));
      renderDownloadQueue();
    } catch (e) {
      console.warn('Download progress render failed', e);
    }
  });
}
document.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => nav(b.dataset.view)));
document.addEventListener('keydown', (e) => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
    e.preventDefault();
    move(e.key);
  }
  if (e.key === 'Escape') {
    e.preventDefault();
    backAction();
  }
});
function move(k) {
  if (k === 'ArrowLeft') gamepadMove(-1, 0);
  if (k === 'ArrowRight') gamepadMove(1, 0);
  if (k === 'ArrowUp') gamepadMove(0, -1);
  if (k === 'ArrowDown') gamepadMove(0, 1);
}
let last = 0;
const gamepadButtons = { a: false, b: false, x: false, y: false, guide: false };
const cursorState = { x: window.innerWidth / 2, y: window.innerHeight / 2, last: 0, hover: null };
function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}
function clearDigitalHover() {
  if (cursorState.hover) {
    cursorState.hover.classList.remove('cursor-hover');
    cursorState.hover = null;
  }
}
function digitalCursorTarget() {
  const cursor = document.getElementById('gamepadCursor');
  if (cursor) cursor.style.display = 'none';
  const el = document.elementFromPoint(cursorState.x, cursorState.y);
  if (cursor) cursor.style.display = '';
  const target = el?.closest?.('[data-focusable],button,a,input,label,[role=button]');
  return isActionableElement(target) ? target : null;
}
function updateDigitalCursor() {
  const cursor = document.getElementById('gamepadCursor');
  if (!cursor) return;
  cursor.style.left = cursorState.x + 'px';
  cursor.style.top = cursorState.y + 'px';
  const target = digitalCursorTarget();
  if (target !== cursorState.hover) {
    clearDigitalHover();
    if (target && target.classList) target.classList.add('cursor-hover');
    cursorState.hover = target;
    updateControllerHint();
  }
}
function clickDigitalCursor() {
  const target = digitalCursorTarget();
  if (target && typeof target.click === 'function') target.click();
}
function scrollWithRightStick(value) {
  const dead = 0.18;
  if (Math.abs(value) <= dead) return;
  const target =
    document.querySelector('.modal-backdrop .confirm-modal') ||
    document.querySelector('.surface') ||
    document.scrollingElement;
  target.scrollBy({ top: value * 34, left: 0, behavior: 'auto' });
  if (state.settings?.useGamepadCursor) updateDigitalCursor();
}
function appIsActive() {
  return document.hasFocus() && !document.hidden;
}
function updateBackgroundMode() {
  state.backgroundMode = !appIsActive();
  document.body.classList.toggle('background-throttled', state.backgroundMode);
  if (state.backgroundMode) {
    clearDigitalHover();
    document.body.classList.remove('gamepad-connected');
  } else {
    state.nextGamepadPoll = 0;
    state.nextRunningPoll = 0;
    updateDigitalCursor();
    refreshRunningGames(true);
  }
}
window.addEventListener('focus', () => {
  document.body.classList.add('window-focused');
  updateBackgroundMode();
});
window.addEventListener('blur', () => {
  document.body.classList.remove('window-focused');
  updateBackgroundMode();
});
document.addEventListener('visibilitychange', updateBackgroundMode);
function gp() {
  const now = Date.now();
  const active = appIsActive();
  const interval = active ? 16 : 1000;
  if (now < (state.nextGamepadPoll || 0)) {
    requestAnimationFrame(gp);
    return;
  }
  state.nextGamepadPoll = now + interval;
  if (state.settings && state.settings.enableGamepad) {
    const p = navigator.getGamepads && [...navigator.getGamepads()].find(Boolean);
    document.body.classList.toggle('gamepad-connected', !!p && active);
    if (p) {
      const guide = !!p.buttons[16]?.pressed;
      if (guide && !gamepadButtons.guide && api.windowControls?.focus) api.windowControls.focus();
      if (active) {
        updateControllerHint();
        const [x = 0, y = 0, rx = 0, ry = 0] = p.axes;
        scrollWithRightStick(ry);
        const cursorMode = !!state.settings.useGamepadCursor && document.hasFocus();
        if (cursorMode) {
          const dt = Math.min(48, Math.max(1, now - (cursorState.last || now)));
          cursorState.last = now;
          const dead = 0.16;
          const vx = Math.abs(x) > dead ? x : 0;
          const vy = Math.abs(y) > dead ? y : 0;
          const speed = 1.15 * dt;
          cursorState.x = clamp(cursorState.x + vx * speed, 8, window.innerWidth - 8);
          cursorState.y = clamp(cursorState.y + vy * speed, 8, window.innerHeight - 8);
          updateDigitalCursor();
          updateControllerHint();
        } else if (now - last > 180) {
          if (y < -0.55) {
            gamepadMove(0, -1);
            last = now;
          } else if (y > 0.55) {
            gamepadMove(0, 1);
            last = now;
          } else if (x < -0.55) {
            gamepadMove(-1, 0);
            last = now;
          } else if (x > 0.55) {
            gamepadMove(1, 0);
            last = now;
          }
        }
        const a = !!p.buttons[0]?.pressed;
        const b = !!p.buttons[1]?.pressed;
        const xb = !!p.buttons[2]?.pressed;
        const yb = !!p.buttons[3]?.pressed;
        if (a && !gamepadButtons.a) {
          if (cursorMode) clickDigitalCursor();
          else activateFocused();
        }
        if (b && !gamepadButtons.b) backAction();
        if (xb && !gamepadButtons.x) favoriteFocusedGame();
        if (yb && !gamepadButtons.y && !cursorMode) openRailMode();
        gamepadButtons.a = a;
        gamepadButtons.b = b;
        gamepadButtons.x = xb;
        gamepadButtons.y = yb;
      } else {
        gamepadButtons.a = false;
        gamepadButtons.b = false;
        gamepadButtons.x = false;
        gamepadButtons.y = false;
      }
      gamepadButtons.guide = guide;
    } else {
      document.body.classList.remove('gamepad-connected');
      clearDigitalHover();
      updateControllerHint();
      gamepadButtons.a = false;
      gamepadButtons.b = false;
      gamepadButtons.x = false;
      gamepadButtons.y = false;
      gamepadButtons.guide = false;
    }
  }
  if (
    !(
      state.settings &&
      state.settings.enableGamepad &&
      state.settings.useGamepadCursor &&
      document.hasFocus()
    )
  )
    clearDigitalHover();
  requestAnimationFrame(gp);
}
window.addEventListener('offline', () => {
  state.hadConnectivityIssue = true;
  showStickyNotice(
    'You are offline. Downloads are unavailable until your connection returns.',
    'offline'
  );
});
window.addEventListener('online', () => {
  loadDownloadsCatalog();
});
function runningPollLoop() {
  const interval = appIsActive() ? 2500 : 30000;
  refreshRunningGames(true).finally(() => setTimeout(runningPollLoop, interval));
}
refresh();
updateBackgroundMode();
runningPollLoop();
gp();
