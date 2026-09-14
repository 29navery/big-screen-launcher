const {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  screen,
  Tray,
  Menu,
  nativeImage,
  Notification,
  net
} = require('electron');
app.commandLine.appendSwitch('disable-quic');
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { promisify } = require('util');
const { pathToFileURL } = require('url');
const shoeset = require('@eirslett/shoeset');
const inflateRaw = promisify(zlib.inflateRaw);
const execFileAsync = promisify(execFile);
const APP_VERSION = '179';
const APP_VERSION_URL =
  'https://sites.google.com/view/tungsten-ball/big-screen-launcher/app-version';
const APP_DOWNLOAD_URL =
  'https://sites.google.com/view/tungsten-ball/big-screen-launcher/downloads';
const APP_CHANGELOG_URL = 'https://sites.google.com/view/tungsten-ball/big-screen-launcher/updates';
const APP_ICON_PATH = path.join(__dirname, 'assets', 'app-icon.ico');
const DEFAULT_STEAMGRIDDB_API_KEY = '5d6cb8beef2ca8c95e7fd5eec962f4e5';
const defaultSettings = {
  scanFolders: [],
  steamGridDbApiKey: DEFAULT_STEAMGRIDDB_API_KEY,
  enableGamepad: true,
  useGamepadCursor: false,
  reduceMotion: false,
  largeText: false,
  showOutput: false,
  showDownloadStats: true,
  autoRefreshArtwork: true,
  showUpdateNotifications: true,
  minimizeToTray: true,
  showControllerHints: true,
  showControllerHintText: true,
  downloadsManifestUrl: '',
  tutorialCompleted: false,
  downloadsLinkPageUrl: 'https://sites.google.com/view/tungsten-ball/home/server-link/',
  themeCssPath: '',
  themeBackgroundPath: '',
  themePackagePath: '',
  themePackageName: '',
  themePackageLockedBackground: false,
  themePackageBackgroundPath: '',
  themePackageIconPath: '',
  themePackageUpdatedAt: ''
};
const statePath = () => path.join(app.getPath('userData'), 'launcher-state.json');
function settingsForRenderer(settings) {
  const out = { ...settings };
  if (out.themeCssPath) {
    try {
      const url = pathToFileURL(out.themeCssPath).toString();
      out.themeCssUrl = out.themeUpdatedAt
        ? url + '?v=' + encodeURIComponent(out.themeUpdatedAt)
        : url;
    } catch {
      out.themeCssUrl = '';
    }
    out.themeCssName = out.themeCssName || path.basename(out.themeCssPath);
  } else {
    out.themeCssUrl = '';
    out.themeCssName = 'Default';
  }
  if (out.themePackageIconPath) {
    try {
      const url = pathToFileURL(out.themePackageIconPath).toString();
      out.themeIconUrl = out.themePackageUpdatedAt
        ? url + '?v=' + encodeURIComponent(out.themePackageUpdatedAt)
        : url;
    } catch {
      out.themeIconUrl = '';
    }
  } else {
    out.themeIconUrl = '';
  }
  const lockedBackground = !!(out.themePackageLockedBackground && out.themePackageBackgroundPath);
  if (lockedBackground) {
    try {
      const url = pathToFileURL(out.themePackageBackgroundPath).toString();
      out.themeBackgroundUrl = out.themePackageUpdatedAt
        ? url + '?v=' + encodeURIComponent(out.themePackageUpdatedAt)
        : url;
      out.themeBackgroundName =
        out.themePackageName || path.basename(out.themePackageBackgroundPath);
      out.themeBackgroundLocked = true;
    } catch {
      out.themeBackgroundUrl = '';
      out.themeBackgroundLocked = false;
    }
    return out;
  }
  if (out.themeBackgroundPath) {
    try {
      const url = pathToFileURL(out.themeBackgroundPath).toString();
      out.themeBackgroundUrl = out.themeBackgroundUpdatedAt
        ? url + '?v=' + encodeURIComponent(out.themeBackgroundUpdatedAt)
        : url;
    } catch {
      out.themeBackgroundUrl = '';
    }
    out.themeBackgroundName = out.themeBackgroundName || path.basename(out.themeBackgroundPath);
  } else {
    out.themeBackgroundUrl = '';
    out.themeBackgroundName = 'Default';
  }
  out.themeBackgroundLocked = false;
  return out;
}
const activeDownloads = new Map();
const downloadStates = new Map();
const DOWNLOAD_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
const activeGameProcesses = new Map();
let cachedState = null;
let tray = null;
let mainWindow = null;
let splashWindow = null;
let isQuitting = false;
let currentAppIconPath = APP_ICON_PATH;
const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  isQuitting = true;
  app.quit();
}
const palette = [
  '#46c2ff',
  '#f06a6a',
  '#ffd166',
  '#63d471',
  '#b389ff',
  '#ff9f43',
  '#4dd4ac',
  '#f65aa3'
];
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}
async function readState() {
  if (cachedState) return clone(cachedState);
  try {
    const parsed = JSON.parse(await fs.readFile(statePath(), 'utf8'));
    const settings = { ...defaultSettings, ...(parsed.settings || {}) };
    if (!settings.steamGridDbApiKey) settings.steamGridDbApiKey = DEFAULT_STEAMGRIDDB_API_KEY;
    const repairedThemeIcon = await repairPackageIconSetting(settings);
    cachedState = {
      settings,
      games: parsed.games || [],
      pendingImports: parsed.pendingImports || []
    };
    if (repairedThemeIcon) await writeState(cachedState);
    return clone(cachedState);
  } catch {
    cachedState = { settings: clone(defaultSettings), games: [], pendingImports: [] };
    return clone(cachedState);
  }
}
async function writeState(state) {
  await fs.mkdir(path.dirname(statePath()), { recursive: true });
  await fs.writeFile(statePath(), JSON.stringify(state, null, 2));
}
async function updateState(fn) {
  const state = await readState();
  await fn(state);
  cachedState = clone(state);
  await writeState(state);
  return clone(state);
}
function initials(title) {
  const words = title
    .replace(/[^a-zA-Z0-9 ]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return '?';
  return (words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]).toUpperCase();
}
function color(title) {
  let hash = 0;
  for (const ch of title) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}
function placeholder(title) {
  return { kind: 'placeholder', color: color(title), initials: initials(title) };
}
function titleFromExe(file) {
  const parsed = path.parse(file);
  return (
    (parsed.name || path.basename(path.dirname(file)))
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-.]+/g, ' ')
      .replace(/\b(win64|win32|x64|x86|shipping|release|final|launcher|game)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase()) || parsed.name
  );
}
function ignoreExe(file) {
  const base = path.basename(file);
  return (
    !base.toLowerCase().endsWith('.exe') ||
    /(unins|uninstall|setup|install|installer|crash|report|redist|vcredist|dxsetup|unitycrash|helper|patch|update|launcherhelper|cef|service|benchmark|config|server)/i.test(
      base
    )
  );
}
async function walk(dir, depth = 0, out = []) {
  if (depth > 5) return out;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (!['node_modules', '$recycle.bin', 'windows', 'system32'].includes(ent.name.toLowerCase()))
        await walk(full, depth + 1, out);
    } else if (ent.isFile() && !ignoreExe(full)) out.push(full);
  }
  return out;
}
async function sgdb(title, key) {
  if (!key || !key.trim()) return placeholder(title);
  const headers = { Authorization: 'Bearer ' + key };
  const get = async (url) => {
    try {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), 8000);
      const r = await fetch(url, { headers, signal: c.signal });
      clearTimeout(t);
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  };
  const search = await get(
    'https://www.steamgriddb.com/api/v2/search/autocomplete/' + encodeURIComponent(title)
  );
  const game = search && search.data && search.data[0];
  if (!game) return placeholder(title);
  const [grids, heroes, preferredLogos, fallbackLogos] = await Promise.all([
    get(
      'https://www.steamgriddb.com/api/v2/grids/game/' +
        game.id +
        '?dimensions=600x900,342x482,660x930&types=static'
    ),
    get(
      'https://www.steamgriddb.com/api/v2/heroes/game/' +
        game.id +
        '?dimensions=1920x620,3840x1240&types=static'
    ),
    get(
      'https://www.steamgriddb.com/api/v2/logos/game/' +
        game.id +
        '?types=static&styles=official,white'
    ),
    get('https://www.steamgriddb.com/api/v2/logos/game/' + game.id + '?types=static')
  ]);
  const logos =
    preferredLogos && preferredLogos.data && preferredLogos.data.length
      ? preferredLogos
      : fallbackLogos;
  const p = placeholder(game.name || title);
  return {
    kind: 'steamgriddb',
    gridUrl: grids && grids.data && grids.data[0] && grids.data[0].url,
    heroUrl: heroes && heroes.data && heroes.data[0] && heroes.data[0].url,
    logoUrl: logos && logos.data && logos.data[0] && logos.data[0].url,
    color: p.color,
    initials: p.initials
  };
}
function artworkLooksUseful(art) {
  return !!(art && art.kind !== 'placeholder' && (art.gridUrl || art.heroUrl || art.logoUrl));
}
function normalizeArtworkResult(art, title, source = 'server') {
  const p = placeholder(title);
  if (!art || typeof art !== 'object') return p;
  return {
    kind: art.kind || source,
    gridUrl: art.gridUrl || '',
    heroUrl: art.heroUrl || '',
    logoUrl: art.logoUrl || '',
    color: art.color || p.color,
    initials: art.initials || p.initials
  };
}
async function serverArtwork(title) {
  try {
    const manifestUrl = await resolveManifestUrl();
    const base = manifestUrl.replace(/\/games\.json(?:[?#].*)?$/i, '').replace(/\/+$/, '');
    const url = base + '/artwork?title=' + encodeURIComponent(title);
    const { buffer, headers } = await downloadBuffer(url);
    const type = String(headers['content-type'] || '').toLowerCase();
    if (!type.includes('json') && !buffer.subarray(0, 1).toString('utf8').includes('{'))
      return null;
    return normalizeArtworkResult(JSON.parse(buffer.toString('utf8')), title, 'server-steamgriddb');
  } catch {
    return null;
  }
}
async function artworkForTitle(title, key) {
  const server = await serverArtwork(title);
  if (artworkLooksUseful(server)) return server;
  const direct = await sgdb(title, key);
  if (artworkLooksUseful(direct)) return direct;
  return server || direct || placeholder(title);
}
async function scanFolders(folders, existing, key) {
  const seen = new Set(existing.map((p) => path.normalize(p).toLowerCase()));
  const pending = [];
  let ignoredCount = 0;
  for (const folder of folders) {
    const files = await walk(folder);
    for (const exe of files.sort()) {
      const k = path.normalize(exe).toLowerCase();
      if (seen.has(k)) {
        ignoredCount++;
        continue;
      }
      seen.add(k);
      const title = titleFromExe(exe);
      pending.push({
        id: crypto.createHash('sha1').update(k).digest('hex'),
        title,
        executablePath: exe,
        installDir: path.dirname(exe),
        artwork: await artworkForTitle(title, key),
        detectedAt: new Date().toISOString()
      });
    }
  }
  return { pending, ignoredCount };
}
function runningGames() {
  return [...activeGameProcesses.entries()].map(([id, info]) => ({
    id,
    title: info.title,
    pid: info.child.pid,
    state: info.state,
    startedAt: info.startedAt,
    elapsedSeconds: Math.max(0, Math.floor((Date.now() - info.startedAt) / 1000))
  }));
}
async function finalizeGamePlaytime(id) {
  const info = activeGameProcesses.get(id);
  if (!info || info.finalized) return;
  info.finalized = true;
  const seconds = Math.max(1, Math.floor((Date.now() - info.startedAt) / 1000));
  await updateState((s) => {
    s.games = s.games.map((g) =>
      g.id === id
        ? { ...g, playtimeSeconds: Math.max(0, Number(g.playtimeSeconds || 0)) + seconds }
        : g
    );
  });
}
async function launchGameProcess(game) {
  if (activeGameProcesses.has(game.id)) return activeGameProcesses.get(game.id).child;
  try {
    await fs.access(game.executablePath);
  } catch {
    throw new Error('Could not find application file: ' + game.executablePath);
  }
  if (isShortcutPath(game.executablePath)) {
    const result = await shell.openPath(game.executablePath);
    if (result) throw new Error(result);
    return null;
  }
  const startedAt = Date.now();
  const child = await new Promise((resolve, reject) => {
    const proc = spawn(game.executablePath, {
      cwd: game.installDir,
      detached: false,
      stdio: 'ignore',
      windowsHide: false
    });
    proc.once('error', (err) => {
      if (err && err.code === 'ENOENT')
        reject(new Error('Could not find application file: ' + game.executablePath));
      else reject(err);
    });
    proc.once('spawn', () => {
      proc.unref();
      resolve(proc);
    });
  });
  activeGameProcesses.set(game.id, {
    child,
    title: game.title,
    state: 'running',
    startedAt,
    finalized: false
  });
  child.once('exit', async () => {
    await finalizeGamePlaytime(game.id);
    activeGameProcesses.delete(game.id);
  });
  child.once('error', async () => {
    await finalizeGamePlaytime(game.id);
    activeGameProcesses.delete(game.id);
  });
  return child;
}
async function stopGameProcess(id) {
  const info = activeGameProcesses.get(id);
  if (!info) return false;
  info.state = 'stopping';
  try {
    await execFileAsync('taskkill.exe', ['/PID', String(info.child.pid), '/T', '/F'], {
      windowsHide: true
    });
  } catch {
    try {
      info.child.kill();
    } catch {}
  }
  await finalizeGamePlaytime(id);
  activeGameProcesses.delete(id);
  return true;
}

function isShortcutPath(file) {
  return /\.(lnk|url)$/i.test(String(file || ''));
}
function safeName(name) {
  return (
    String(name || 'Game')
      .replace(/[<>:"/\\|?*]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'Game'
  );
}
function defaultThemesRoot() {
  return path.join(app.getPath('documents'), 'Big Screen Launcher', 'Themes');
}
function safeThemeFileName(source) {
  const parsed = path.parse(String(source || 'theme.css'));
  const stem = safeName(parsed.name).replace(/\s+/g, '-').toLowerCase() || 'theme';
  return stem + '-' + Date.now() + '.css';
}
function safeThemeAssetFileName(source) {
  const parsed = path.parse(String(source || 'background.png'));
  const ext = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'].includes(parsed.ext.toLowerCase())
    ? parsed.ext.toLowerCase()
    : '.png';
  const stem = safeName(parsed.name).replace(/\s+/g, '-').toLowerCase() || 'background';
  return stem + '-' + Date.now() + ext;
}
function isThemeImageFile(file) {
  return /\.(jpg|jpeg|png|webp|gif|bmp)$/i.test(String(file || ''));
}
function isThemeIconFile(file) {
  return /\.(ico|png|jpg|jpeg|webp)$/i.test(String(file || ''));
}
function cleanThemeName(name) {
  return String(name || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}
function themeNameFromCss(css, fallback) {
  const text = String(css || '');
  const variable = text.match(/--bsl-theme-name\s*:\s*(['"])(.*?)\1\s*;?/i);
  if (variable) return cleanThemeName(variable[2]) || fallback;
  const comment = text.match(/\/\*\s*(?:theme\s+)?name\s*[:=]\s*(['"]?)([^"'\r\n*]+)\1\s*\*\//i);
  if (comment) return cleanThemeName(comment[2]) || fallback;
  const loose = text.match(/(?:^|\n)\s*Name\s*=\s*(['"])(.*?)\1\s*(?:;|$)/i);
  if (loose) return cleanThemeName(loose[2]) || fallback;
  return fallback;
}
async function removeManagedTheme(filePath) {
  if (!filePath) return;
  try {
    const roots = [path.join(app.getPath('userData'), 'themes')].map(
      (p) => path.resolve(p).toLowerCase() + path.sep
    );
    const target = path.resolve(filePath);
    if (roots.some((root) => target.toLowerCase().startsWith(root)))
      await fs.rm(target, { force: true });
  } catch {}
}
async function listStoredThemes() {
  const themeDir = defaultThemesRoot();
  await fs.mkdir(themeDir, { recursive: true });
  const entries = await fs.readdir(themeDir, { withFileTypes: true }).catch(() => []);
  const themes = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.(css|bslt)$/i.test(entry.name)) continue;
    const filePath = path.join(themeDir, entry.name);
    if (entry.name.toLowerCase().endsWith('.bslt')) {
      themes.push({
        name: await themeNameFromPackageFile(filePath),
        fileName: entry.name,
        path: filePath
      });
      continue;
    }
    let css = '';
    try {
      css = await fs.readFile(filePath, 'utf8');
    } catch {}
    themes.push({ name: themeNameFromCss(css, entry.name), fileName: entry.name, path: filePath });
  }
  return themes.sort(
    (a, b) => a.name.localeCompare(b.name) || a.fileName.localeCompare(b.fileName)
  );
}
function clearThemePackageSettings(settings) {
  settings.themePackagePath = '';
  settings.themePackageName = '';
  settings.themePackageLockedBackground = false;
  settings.themePackageBackgroundPath = '';
  settings.themePackageIconPath = '';
  settings.themePackageUpdatedAt = '';
}
async function repairPackageIconSetting(settings) {
  if (!settings?.themePackagePath || !settings.themePackageIconPath) return false;
  const manifest = await readThemePackageManifest(settings.themePackagePath);
  if (manifest.icon || manifest.appIcon) return false;
  settings.themePackageIconPath = '';
  settings.themePackageUpdatedAt = String(Date.now());
  return true;
}
async function applyStoredTheme(filePath) {
  const themeDir = path.resolve(defaultThemesRoot()).toLowerCase() + path.sep;
  const target = path.resolve(String(filePath || ''));
  if (!target.toLowerCase().startsWith(themeDir) || !/\.(css|bslt)$/i.test(target))
    throw new Error('Theme must be a CSS or BSLT file inside the Themes folder.');
  if (target.toLowerCase().endsWith('.bslt')) return installThemePackage(target);
  const css = await fs.readFile(target, 'utf8');
  const st = await updateState((s) => {
    s.settings.themeCssPath = target;
    s.settings.themeCssName = themeNameFromCss(css, path.basename(target));
    s.settings.themeUpdatedAt = String(Date.now());
    clearThemePackageSettings(s.settings);
  });
  updateAppIcons(st.settings);
  return settingsForRenderer(st.settings);
}
async function walkFiles(root) {
  const out = [];
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) out.push(...(await walkFiles(fullPath)));
    else if (entry.isFile()) out.push(fullPath);
  }
  return out;
}
async function readThemePackageManifest(packageDir) {
  for (const name of ['manifest.json', 'theme.json', 'bsl-theme.json']) {
    try {
      return JSON.parse(await fs.readFile(path.join(packageDir, name), 'utf8'));
    } catch {}
  }
  return {};
}
function firstManifestValue(manifest, names) {
  for (const name of names) {
    const value = cleanThemeName(manifest?.[name]);
    if (value) return value;
  }
  return '';
}
function packageFile(packageDir, files, requested, predicate) {
  if (requested) {
    const target = path.resolve(packageDir, String(requested).replace(/\\/g, '/'));
    const root = path.resolve(packageDir).toLowerCase() + path.sep;
    if (!target.toLowerCase().startsWith(root)) throw new Error('Theme package manifest path is unsafe.');
    if (files.some((file) => path.resolve(file).toLowerCase() === target.toLowerCase()) && predicate(target)) {
      return target;
    }
    throw new Error('Theme package file was not found: ' + requested);
  }
  return files.find((file) => predicate(file)) || '';
}
async function themeNameFromPackageFile(source) {
  const fallback =
    cleanThemeName(path.basename(source, path.extname(source))) || path.basename(source);
  let tempDir = '';
  try {
    const buffer = await fs.readFile(source);
    validateThemePackageZip(buffer);
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'bsl-theme-name-'));
    await extractZipBuffer(buffer, tempDir);
    const files = await walkFiles(tempDir);
    const manifest = await readThemePackageManifest(tempDir);
    const manifestName = firstManifestValue(manifest, ['name', 'title']);
    if (manifestName) return manifestName;
    const cssPath = packageFile(
      tempDir,
      files,
      manifest.css || manifest.stylesheet,
      (file) => /\.css$/i.test(file)
    );
    if (!cssPath) return fallback;
    const css = await fs.readFile(cssPath, 'utf8');
    return themeNameFromCss(css, fallback);
  } catch {
    return fallback;
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}
async function installThemePackage(source) {
  const buffer = await fs.readFile(source);
  validateThemePackageZip(buffer);
  const themeDir = defaultThemesRoot();
  const packagesDir = path.join(themeDir, 'Packages');
  await fs.mkdir(packagesDir, { recursive: true });
  const packageDir = path.join(
    packagesDir,
    safeName(path.basename(source, path.extname(source))).replace(/\s+/g, '-').toLowerCase() +
      '-' +
      Date.now()
  );
  try {
    await extractZipBuffer(buffer, packageDir);
    const files = await walkFiles(packageDir);
    const manifest = await readThemePackageManifest(packageDir);
    const cssPath = packageFile(
      packageDir,
      files,
      manifest.css || manifest.stylesheet,
      (file) => /\.css$/i.test(file)
    );
    if (!cssPath) throw new Error('Theme package must include a CSS file.');
    const backgroundPath = packageFile(
      packageDir,
      files,
      manifest.background || manifest.backgroundImage,
      isThemeImageFile
    );
    const iconRequest = manifest.icon || manifest.appIcon;
    const iconPath = iconRequest
      ? packageFile(packageDir, files, iconRequest, isThemeIconFile)
      : '';
    const css = await fs.readFile(cssPath, 'utf8');
    const packageName =
      firstManifestValue(manifest, ['name', 'title']) ||
      themeNameFromCss(css, path.basename(source, path.extname(source)));
    const lockedBackground =
      !!backgroundPath && manifest.lockedBackground !== false && manifest.allowBackgroundOverride !== true;
    let oldPath = '';
    const st = await updateState((s) => {
      oldPath = s.settings.themeCssPath || '';
      s.settings.themeCssPath = cssPath;
      s.settings.themeCssName = packageName;
      s.settings.themeUpdatedAt = String(Date.now());
      if (backgroundPath && !lockedBackground) {
        s.settings.themeBackgroundPath = backgroundPath;
        s.settings.themeBackgroundName = packageName;
        s.settings.themeBackgroundUpdatedAt = String(Date.now());
      }
      s.settings.themePackagePath = packageDir;
      s.settings.themePackageName = packageName;
      s.settings.themePackageLockedBackground = lockedBackground;
      s.settings.themePackageBackgroundPath = backgroundPath || '';
      s.settings.themePackageIconPath = iconPath || '';
      s.settings.themePackageUpdatedAt = String(Date.now());
    });
    await removeManagedTheme(oldPath);
    updateAppIcons(st.settings);
    return settingsForRenderer(st.settings);
  } catch (error) {
    await fs.rm(packageDir, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
function readUInt64LE(buf, offset) {
  return buf.readUInt32LE(offset) + buf.readUInt32LE(offset + 4) * 0x100000000;
}
function electronHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {}))
    out[String(key).toLowerCase()] = Array.isArray(value) ? value.join('; ') : String(value);
  return out;
}
function downloadBuffer(url, redirects = 0, timeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const request = net.request({ url, method: 'GET', redirect: 'manual' });
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    };
    let timer = setTimeout(() => {
      try {
        request.abort();
      } catch {}
      fail(new Error('Download timed out'));
    }, timeoutMs);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          request.abort();
        } catch {}
        fail(new Error('Download timed out'));
      }, timeoutMs);
    };
    request.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36 BigScreenLauncher/131'
    );
    request.setHeader('Accept', 'application/json,text/html,application/octet-stream,*/*');
    request.on('response', (res) => {
      const headers = electronHeaders(res.headers);
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        clearTimeout(timer);
        const next = new URL(headers.location || '', url).toString();
        res.on('data', () => {});
        res.on('end', () => downloadBuffer(next, redirects + 1, timeoutMs).then(resolve, reject));
        return;
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => fail(new Error('Download failed with HTTP ' + res.statusCode)));
        return;
      }
      const chunks = [];
      res.on('data', (c) => {
        resetTimer();
        chunks.push(Buffer.from(c));
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ buffer: Buffer.concat(chunks), headers, finalUrl: url });
      });
    });
    request.on('error', fail);
    request.on('abort', () => fail(new Error('Download canceled')));
    request.end();
  });
}
function updateTaskbarDownloadProgress(payload) {
  try {
    const win = mainWindow || BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (!win || win.isDestroyed()) return;
    const phase = String((payload && payload.phase) || '').toLowerCase();
    if (phase === 'done' || phase === 'cancelled' || phase === 'paused') {
      win.setProgressBar(-1);
      return;
    }
    if (phase === 'failed') {
      win.setProgressBar(1, { mode: 'error' });
      setTimeout(() => {
        try {
          win.setProgressBar(-1);
        } catch {}
      }, 4000);
      return;
    }
    const percent = Number(payload && payload.percent);
    if (Number.isFinite(percent)) {
      win.setProgressBar(Math.max(0.01, Math.min(0.99, percent / 100)), { mode: 'normal' });
    } else if (
      ['starting', 'downloading', 'resuming', 'saving', 'extracting', 'scanning'].includes(phase)
    ) {
      win.setProgressBar(2, { mode: 'indeterminate' });
    }
  } catch {}
}
function emitInstallProgress(event, payload) {
  updateTaskbarDownloadProgress(payload);
  try {
    event && event.sender && event.sender.send('downloads:progress', payload);
  } catch {}
}
function emitImportProgress(event, payload) {
  try {
    event && event.sender && event.sender.send('imports:progress', payload);
  } catch {}
}
function downloadBufferWithProgress(
  url,
  event,
  name,
  tempPath,
  redirects = 0,
  timeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS
) {
  return new Promise(async (resolve, reject) => {
    if (redirects > 6) return reject(new Error('Too many redirects'));
    const request = net.request({ url, method: 'GET', redirect: 'manual' });
    let settled = false;
    let loaded = 0;
    let total = 0;
    let streamPromise = null;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeDownloads.delete(name);
      reject(err);
    };
    let timer = setTimeout(() => {
      try {
        request.abort();
      } catch {}
      fail(new Error('Download timed out'));
    }, timeoutMs);
    const resetTimer = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          request.abort();
        } catch {}
        fail(new Error('Download timed out'));
      }, timeoutMs);
    };
    request.setHeader(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36 BigScreenLauncher/131'
    );
    request.setHeader('Accept', 'application/json,text/html,application/octet-stream,*/*');
    request.on('response', (res) => {
      const headers = electronHeaders(res.headers);
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        clearTimeout(timer);
        activeDownloads.delete(name);
        const next = new URL(headers.location || '', url).toString();
        res.on('data', () => {});
        res.on('end', () =>
          downloadBufferWithProgress(next, event, name, tempPath, redirects + 1, timeoutMs).then(
            resolve,
            reject
          )
        );
        return;
      }
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        res.on('data', () => {});
        res.on('end', () => fail(new Error('Download failed with HTTP ' + res.statusCode)));
        return;
      }
      total = Number(headers['content-length'] || 0);
      const chunks = [];
      const startedAt = Date.now();
      let lastEmit = 0;
      if (tempPath) {
        streamPromise = (async () => {
          await fs.mkdir(path.dirname(tempPath), { recursive: true });
          await fs.rm(tempPath, { force: true }).catch(() => {});
          await fs.writeFile(tempPath, Buffer.alloc(0));
        })();
      }
      const completeDownload = async () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        activeDownloads.delete(name);
        try {
          if (streamPromise) await streamPromise;
          const buffer = tempPath ? null : Buffer.concat(chunks);
          emitInstallProgress(event, {
            name,
            phase: 'saving',
            percent: 96,
            loadedBytes: loaded,
            totalBytes: total || loaded,
            speedBps: 0,
            resumable: false
          });
          resolve({
            buffer,
            headers,
            finalUrl: url,
            tempPath,
            downloadedPath: tempPath || '',
            size: loaded
          });
        } catch (e) {
          reject(e);
        }
      };
      emitInstallProgress(event, {
        name,
        phase: 'downloading',
        percent: total ? 1 : null,
        speedBps: 0,
        loadedBytes: 0,
        totalBytes: total || 0,
        resumable: false
      });
      res.on('data', (c) => {
        resetTimer();
        const buf = Buffer.from(c);
        if (!tempPath) chunks.push(buf);
        loaded += buf.length;
        if (tempPath) {
          streamPromise = streamPromise.then(() => fs.appendFile(tempPath, buf));
        }
        const now = Date.now();
        if (now - lastEmit > 250) {
          lastEmit = now;
          const elapsed = Math.max(0.25, (now - startedAt) / 1000);
          emitInstallProgress(event, {
            name,
            phase: 'downloading',
            percent: total ? Math.max(1, Math.min(95, Math.round((loaded / total) * 95))) : null,
            speedBps: Math.round(loaded / elapsed),
            loadedBytes: loaded,
            totalBytes: total || 0,
            resumable: false
          });
        }
      });
      res.on('end', completeDownload);
    });
    const entry = {
      action: 'cancel',
      destroy: () => {
        entry.action = 'cancel';
        request.abort();
      }
    };
    activeDownloads.set(name, entry);
    request.on('error', (err) => {
      const msg = String(err?.message || err || '');
      fail(/abort|cancel/i.test(msg) ? new Error('Download cancelled') : err);
    });
    request.on('abort', () => fail(new Error('Download cancelled')));
    request.end();
  });
}
async function readFilePrefix(filePath, length = 512) {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const result = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}
function filenameFromHeaders(headers, fallback) {
  const cd = headers['content-disposition'] || '';
  const m = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd);
  return safeName(m ? decodeURIComponent(m[1].replace(/"/g, '')) : fallback);
}
const CRC32_TABLE = (() => {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC32_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
async function sameFileBySizeAndCrc(filePath, size, crc) {
  try {
    const st = await fs.stat(filePath);
    if (!st.isFile() || st.size !== size) return false;
    return crc32(await fs.readFile(filePath)) === crc >>> 0;
  } catch {
    return false;
  }
}
async function extractZipBuffer(buf, dest) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000 - 22); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  let changed = 0,
    skipped = 0,
    files = 0;
  await fs.mkdir(dest, { recursive: true });
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('Bad ZIP directory');
    const method = buf.readUInt16LE(cdOffset + 10);
    const crc = buf.readUInt32LE(cdOffset + 16);
    let compressedSize = buf.readUInt32LE(cdOffset + 20);
    let uncompressedSize = buf.readUInt32LE(cdOffset + 24);
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    let localOffset = buf.readUInt32LE(cdOffset + 42);
    const name = buf
      .subarray(cdOffset + 46, cdOffset + 46 + nameLen)
      .toString('utf8')
      .replace(/\\/g, '/');
    const extra = buf.subarray(cdOffset + 46 + nameLen, cdOffset + 46 + nameLen + extraLen);
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      let p = 0;
      while (p + 4 <= extra.length) {
        const id = extra.readUInt16LE(p);
        const size = extra.readUInt16LE(p + 2);
        p += 4;
        if (id === 0x0001) {
          let z = p;
          if (uncompressedSize === 0xffffffff) {
            uncompressedSize = readUInt64LE(extra, z);
            z += 8;
          }
          if (compressedSize === 0xffffffff) {
            compressedSize = readUInt64LE(extra, z);
            z += 8;
          }
          if (localOffset === 0xffffffff) {
            localOffset = readUInt64LE(extra, z);
            z += 8;
          }
        }
        p += size;
      }
    }
    cdOffset += 46 + nameLen + extraLen + commentLen;
    if (!name || name.endsWith('/')) {
      await fs.mkdir(path.join(dest, name), { recursive: true });
      continue;
    }
    if (name.includes('..')) throw new Error('Unsafe ZIP path');
    const out = path.join(dest, name);
    files++;
    if (await sameFileBySizeAndCrc(out, uncompressedSize, crc)) {
      skipped++;
      continue;
    }
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Bad ZIP local header');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const compressed = buf.subarray(dataStart, dataStart + compressedSize);
    const data = method === 0 ? compressed : method === 8 ? await inflateRaw(compressed) : null;
    if (!data) continue;
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, data);
    changed++;
  }
  return { files, changed, skipped };
}

function zipEntryNames(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 0x10000 - 22); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP directory not found');
  const total = buf.readUInt16LE(eocd + 10);
  let cdOffset = buf.readUInt32LE(eocd + 16);
  const names = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(cdOffset) !== 0x02014b50) throw new Error('Bad ZIP directory');
    const nameLen = buf.readUInt16LE(cdOffset + 28);
    const extraLen = buf.readUInt16LE(cdOffset + 30);
    const commentLen = buf.readUInt16LE(cdOffset + 32);
    const name = buf
      .subarray(cdOffset + 46, cdOffset + 46 + nameLen)
      .toString('utf8')
      .replace(/\\/g, '/');
    names.push(name);
    cdOffset += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function validateThemePackageZip(buf) {
  const names = zipEntryNames(buf);
  for (const name of names) {
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) {
      throw new Error('Theme package contains an unsafe path.');
    }
  }
  return names;
}

function isZipBuffer(buf) {
  return buf && buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50;
}
function is7zBuffer(buf) {
  return (
    buf &&
    buf.length >= 6 &&
    buf[0] === 0x37 &&
    buf[1] === 0x7a &&
    buf[2] === 0xbc &&
    buf[3] === 0xaf &&
    buf[4] === 0x27 &&
    buf[5] === 0x1c
  );
}
function isRarBuffer(buf) {
  return (
    buf &&
    buf.length >= 7 &&
    buf[0] === 0x52 &&
    buf[1] === 0x61 &&
    buf[2] === 0x72 &&
    buf[3] === 0x21 &&
    buf[4] === 0x1a &&
    buf[5] === 0x07 &&
    (buf[6] === 0x00 || buf[6] === 0x01)
  );
}
async function extract7zFile(filePath, dest) {
  await fs.mkdir(dest, { recursive: true });
  const result = shoeset.decompress(await fs.readFile(filePath));
  const files = Array.isArray(result && result.files) ? result.files : [];
  let changed = 0,
    skipped = 0,
    total = 0;
  for (const file of files) {
    const name = String(file.name || '').replace(/\\/g, '/');
    if (!name || name.includes('..')) throw new Error('Unsafe 7Z path');
    const out = path.join(dest, name);
    if (name.endsWith('/')) {
      await fs.mkdir(out, { recursive: true });
      continue;
    }
    total++;
    const data = Buffer.from(file.data || []);
    let same = false;
    try {
      const st = await fs.stat(out);
      same =
        st.isFile() &&
        st.size === data.length &&
        Buffer.compare(await fs.readFile(out), data) === 0;
    } catch {}
    if (same) {
      skipped++;
      continue;
    }
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, data);
    changed++;
  }
  return { files: total, changed, skipped };
}
async function extractArchiveWithTar(filePath, dest) {
  await fs.mkdir(dest, { recursive: true });
  await execFileAsync('tar.exe', ['-xf', filePath, '-C', dest], {
    windowsHide: true,
    maxBuffer: 1024 * 1024
  });
  return { files: 0, changed: 1, skipped: 0, extractor: 'tar' };
}
async function extractArchiveFile(filePath, buffer, dest) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.rar') || isRarBuffer(buffer)) {
    try {
      const diff = await extractArchiveWithTar(filePath, dest);
      return { type: 'rar', ...diff };
    } catch (e) {
      throw new Error(
        'RAR extraction failed. This PC may not support this RAR format. Try repacking it as .7z or .zip.'
      );
    }
  }
  if (lower.endsWith('.7z') || is7zBuffer(buffer)) {
    try {
      const diff = await extractArchiveWithTar(filePath, dest);
      return { type: '7z', ...diff };
    } catch {}
    const diff = await extract7zFile(filePath, dest);
    return { type: '7z', ...diff };
  }
  if (lower.endsWith('.zip') || isZipBuffer(buffer)) {
    try {
      const st = await fs.stat(filePath);
      if (st.size > 1024 * 1024 * 1024) {
        const diff = await extractArchiveWithTar(filePath, dest);
        return { type: 'zip', ...diff };
      }
    } catch {}
    const fullBuffer = buffer && buffer.length > 1024 ? buffer : await fs.readFile(filePath);
    const diff = await extractZipBuffer(fullBuffer, dest);
    return { type: 'zip', ...diff };
  }
  return null;
}
async function cleanupDownloadResidue(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let removed = 0;
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      removed += await cleanupDownloadResidue(p);
      continue;
    }
    if (ent.isFile() && /\.(download|part)$/i.test(ent.name)) {
      await fs
        .rm(p, { force: true })
        .then(() => removed++)
        .catch(() => {});
    }
  }
  return removed;
}

function simplifiedName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\.exe$/, '')
    .replace(/[^a-z0-9]+/g, '');
}
function scoreExecutableCandidate(file, gameName, rootDir) {
  const base = path.basename(file).toLowerCase();
  const simpleBase = simplifiedName(base);
  const simpleGame = simplifiedName(gameName);
  const rel = path.relative(rootDir, file).toLowerCase();
  let score = 0;
  if (
    /(createdump|crash|dump|report|unins|uninstall|setup|install|installer|redist|vcredist|dxsetup|unitycrash|helper|patch|update|launcherhelper|cef|service|benchmark|config|server|dotnet|vc_redist)/i.test(
      base
    )
  )
    score -= 1000;
  if (simpleBase === simpleGame) score += 500;
  if (simpleGame && simpleBase.includes(simpleGame)) score += 260;
  if (simpleGame && simpleGame.includes(simpleBase) && simpleBase.length > 4) score += 140;
  if (rel.includes('win64') || rel.includes('x64')) score += 30;
  if (rel.includes('shipping')) score += 24;
  if (rel.includes('release')) score += 12;
  if (rel.includes('debug')) score -= 80;
  if (
    rel.includes('tools') ||
    rel.includes('redist') ||
    rel.includes('support') ||
    rel.includes('launcher')
  )
    score -= 90;
  score += Math.min(60, simpleBase.length);
  return score;
}
async function findBestGameExe(dir, gameName) {
  const files = await walk(dir, 0, []);
  const exes = files.filter((f) => f.toLowerCase().endsWith('.exe'));
  if (!exes.length) return '';
  return exes
    .map((file) => ({ file, score: scoreExecutableCandidate(file, gameName, dir) }))
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)[0].file;
}
async function directorySizeBytes(dir, depth = 0) {
  if (!dir || depth > 24) return 0;
  let total = 0;
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const ent of entries) {
    const p = path.join(dir, ent.name);
    try {
      if (ent.isDirectory()) total += await directorySizeBytes(p, depth + 1);
      else if (ent.isFile()) total += (await fs.stat(p)).size;
    } catch {}
  }
  return total;
}
async function gamesWithInstalledSizes(games) {
  return Promise.all(
    (games || []).map(async (g) => ({
      ...g,
      version: g.version || '1.0.0',
      installedSizeBytes: await directorySizeBytes(g.installDir || path.dirname(g.executablePath))
    }))
  );
}
function defaultGamesRoot() {
  return path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games');
}
function installRootForState(state) {
  return (state.settings.scanFolders && state.settings.scanFolders[0]) || defaultGamesRoot();
}
async function importArchiveFiles(filePaths, event) {
  const state = await readState();
  const installRoot = installRootForState(state);
  const imported = [];
  const files = (filePaths || []).filter((file) => /\.(zip|7z|rar)$/i.test(file));
  emitImportProgress(event, {
    phase: 'starting',
    name: 'Archives',
    percent: files.length ? 0 : 100,
    index: 0,
    total: files.length
  });
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const base = path.basename(file);
    emitImportProgress(event, {
      phase: 'reading',
      name: base,
      percent: Math.round((i / files.length) * 100),
      index: i + 1,
      total: files.length
    });
    const game = await addExtractedGameFromZip(
      file,
      installRoot,
      state.settings.autoRefreshArtwork !== false ? state.settings.steamGridDbApiKey : '',
      event,
      i,
      files.length
    );
    if (game) imported.push(game);
    emitImportProgress(event, {
      phase: 'done item',
      name: base,
      percent: Math.round(((i + 1) / files.length) * 100),
      index: i + 1,
      total: files.length
    });
  }
  emitImportProgress(event, {
    phase: 'done',
    name: 'Archives',
    percent: 100,
    index: files.length,
    total: files.length
  });
  return { games: await gamesWithInstalledSizes((await readState()).games), imported };
}
async function addExtractedGameFromZip(zipPath, installRoot, apiKey, event, index = 0, total = 1) {
  const title = titleFromExe(path.basename(zipPath, path.extname(zipPath)));
  const gameDir = path.join(installRoot, safeName(title));
  await fs.mkdir(gameDir, { recursive: true });
  emitImportProgress(event, {
    phase: 'reading',
    name: path.basename(zipPath),
    percent: Math.round(((index + 0.12) / total) * 100),
    index: index + 1,
    total
  });
  const buffer = await readFilePrefix(zipPath, 512);
  emitImportProgress(event, {
    phase: 'extracting',
    name: title,
    percent: Math.round(((index + 0.35) / total) * 100),
    index: index + 1,
    total
  });
  const archiveType = await extractArchiveFile(zipPath, buffer, gameDir);
  if (!archiveType)
    throw new Error(path.basename(zipPath) + ' is not a supported ZIP, 7Z, or RAR archive');
  emitImportProgress(event, {
    phase: 'scanning',
    name: title,
    percent: Math.round(((index + 0.62) / total) * 100),
    index: index + 1,
    total
  });
  const exe = await findBestGameExe(gameDir, title);
  if (!exe) throw new Error('No playable .exe found in ' + path.basename(zipPath));
  emitImportProgress(event, {
    phase: 'artwork',
    name: title,
    percent: Math.round(((index + 0.82) / total) * 100),
    index: index + 1,
    total
  });
  const art = apiKey ? await artworkForTitle(title, apiKey) : placeholder(title);
  let addedGame = null;
  await updateState((s) => {
    if (!s.settings.scanFolders.includes(installRoot)) s.settings.scanFolders.push(installRoot);
    const normalizedExe = path.normalize(exe).toLowerCase();
    if (!s.games.some((g) => path.normalize(g.executablePath).toLowerCase() === normalizedExe)) {
      addedGame = {
        id: crypto.randomUUID(),
        title,
        executablePath: exe,
        installDir: path.dirname(exe),
        sourceDownloadTitle: title,
        sourceDownloadUrl: '',
        version: '1.0.0',
        artwork: art,
        favorite: false,
        addedAt: new Date().toISOString(),
        launchCount: 0
      };
      s.games.push(addedGame);
      s.games.sort((a, b) => a.title.localeCompare(b.title));
    }
  });
  return addedGame;
}

async function findFirstExe(dir) {
  const files = await walk(dir, 0, []);
  return files.find((f) => !ignoreExe(f)) || files[0];
}
async function installDownload(name, url) {
  if (
    !/^https?:\/\/([a-z0-9-]+\.trycloudflare\.com|tungstenball\.org|www\.tungstenball\.org|drive\.google\.com|sites\.google\.com)\//.test(
      url
    )
  )
    throw new Error('Blocked download URL');
  const installRoot = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games');
  const gameDir = path.join(installRoot, safeName(name));
  await fs.mkdir(gameDir, { recursive: true });
  const { buffer, headers } = await downloadBuffer(url);
  const type = String(headers['content-type'] || '').toLowerCase();
  if (
    type.includes('text/html') ||
    buffer.subarray(0, 80).toString('utf8').toLowerCase().includes('<!doctype html')
  )
    throw new Error('This link needs browser sign-in or is not a direct download');
  const fileName = filenameFromHeaders(headers, safeName(name) + '.download');
  const filePath = path.join(gameDir, fileName);
  await fs.rename(tempPath, filePath).catch(async () => fs.writeFile(filePath, buffer));
  downloadStates.delete(name);
  const archiveType = await extractArchiveFile(filePath, buffer, gameDir);
  const exe = await findBestGameExe(gameDir, name);
  let addedGame = null;
  if (exe) {
    const title = safeName(name) || titleFromExe(exe);
    const currentState = await readState();
    const art =
      currentState.settings.autoRefreshArtwork !== false
        ? await artworkForTitle(title, currentState.settings.steamGridDbApiKey)
        : placeholder(title);
    await updateState((s) => {
      if (!s.settings.scanFolders.includes(installRoot)) s.settings.scanFolders.push(installRoot);
      const normTitleValue = (v) =>
        String(v || '')
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '');
      const normUrlValue = (v) =>
        String(v || '')
          .trim()
          .toLowerCase()
          .replace(/[?#].*$/, '')
          .replace(/\/+$/, '');
      const normalizedExe = path.normalize(exe).toLowerCase();
      const existingIndex = s.games.findIndex(
        (g) =>
          path.normalize(g.executablePath).toLowerCase() === normalizedExe ||
          normTitleValue(g.title) === normTitleValue(name) ||
          (!!url && normUrlValue(g.sourceDownloadUrl || g.downloadUrl) === normUrlValue(url))
      );
      if (existingIndex >= 0) {
        const existing = s.games[existingIndex];
        addedGame = {
          ...existing,
          executablePath: exe,
          installDir: path.dirname(exe),
          sourceDownloadTitle: name,
          sourceDownloadUrl: url,
          downloadTitle: name,
          downloadUrl: url,
          version: meta.version || existing.version || '1.0.0',
          dlcIncluded: meta.dlc === true || existing.dlcIncluded === true,
          artwork: existing.artwork || art
        };
        s.games[existingIndex] = addedGame;
      } else {
        addedGame = {
          id: crypto.randomUUID(),
          title,
          executablePath: exe,
          installDir: path.dirname(exe),
          sourceDownloadTitle: name,
          sourceDownloadUrl: url,
          downloadTitle: name,
          downloadUrl: url,
          version: meta.version || '1.0.0',
          dlcIncluded: meta.dlc === true,
          artwork: art,
          favorite: false,
          addedAt: new Date().toISOString(),
          launchCount: 0
        };
        s.games.push(addedGame);
        s.games.sort((a, b) => a.title.localeCompare(b.title));
      }
    });
  }
  return {
    installDir: gameDir,
    filePath,
    extracted: !!archiveType,
    archiveType,
    executablePath: exe || '',
    addedGame
  };
}

function htmlDecode(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
function manifestFromBaseUrl(raw) {
  const clean = htmlDecode(raw)
    .trim()
    .replace(/[)\]}>.,]+$/, '');
  if (/\.json(?:[?#].*)?$/i.test(clean)) return clean;
  return clean.replace(/\/+$/, '') + '/games.json';
}
async function resolveManifestUrl() {
  return 'https://tungstenball.org/games.json';
}

function resolveCatalogUrl(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    return new URL(raw, baseUrl).toString();
  } catch {
    return '';
  }
}
async function getDownloadCatalog() {
  const url = 'https://tungstenball.org/games.json';
  const rootUrl = 'https://tungstenball.org/';
  const fetchUrl = url + '?t=' + Date.now();
  const { buffer, headers } = await downloadBuffer(fetchUrl, 0, 15000);
  const type = String(headers['content-type'] || '').toLowerCase();
  if (!type.includes('json') && !url.toLowerCase().endsWith('.json'))
    throw new Error('Downloads manifest did not look like JSON');
  const parsed = JSON.parse(buffer.toString('utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.games;
  if (!Array.isArray(list)) throw new Error('Manifest must be an array or { games: [...] }');
  return list
    .map((item, index) => ({
      title: safeName(item.title || item.name || 'Game ' + (index + 1)),
      image: resolveCatalogUrl(item.image || item.icon || '', rootUrl),
      download: resolveCatalogUrl(item.download || item.url || '', rootUrl),
      color: String(item.color || '#46c2ff'),
      version: item.version == null ? '' : String(item.version),
      dlc: item.dlc === true,
      controller: item.controller === true
    }))
    .filter((item) => item.download && /^https?:\/\//.test(item.download));
}

async function installDownloadWithProgress(event, name, url, meta = {}) {
  emitInstallProgress(event, {
    name,
    phase: 'starting',
    percent: 0,
    loadedBytes: 0,
    totalBytes: 0,
    speedBps: 0
  });
  if (
    !/^https?:\/\/([a-z0-9-]+\.trycloudflare\.com|tungstenball\.org|www\.tungstenball\.org|drive\.google\.com|sites\.google\.com)\//.test(
      url
    )
  )
    throw new Error('Blocked download URL');
  const normTitleValue = (v) =>
    String(v || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '');
  const normUrlValue = (v) =>
    String(v || '')
      .trim()
      .toLowerCase()
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  const initialState = await readState();
  const installRoot = installRootForState(initialState);
  const existingGame = (initialState.games || []).find(
    (g) =>
      normTitleValue(g.title) === normTitleValue(name) ||
      normTitleValue(g.sourceDownloadTitle || g.downloadTitle) === normTitleValue(name) ||
      (!!url && normUrlValue(g.sourceDownloadUrl || g.downloadUrl) === normUrlValue(url))
  );
  const gameDir = existingGame
    ? existingGame.installDir || path.dirname(existingGame.executablePath)
    : path.join(installRoot, safeName(name));
  await fs.mkdir(gameDir, { recursive: true });
  const tempPath = path.join(gameDir, safeName(name) + '.download.part');
  downloadStates.set(name, { url, tempPath, gameDir });
  const downloaded = await downloadBufferWithProgress(url, event, name, tempPath);
  const { buffer, headers } = downloaded;
  const type = String(headers['content-type'] || '').toLowerCase();
  const prefix = buffer
    ? buffer.subarray(0, 512)
    : await readFilePrefix(downloaded.downloadedPath || tempPath, 512);
  if (
    type.includes('text/html') ||
    prefix.toString('utf8').toLowerCase().includes('<!doctype html')
  )
    throw new Error('This link needs browser sign-in or is not a direct download');
  const fileName = filenameFromHeaders(headers, safeName(name) + '.download');
  const filePath = path.join(gameDir, fileName);
  if (buffer) {
    await fs.writeFile(filePath, buffer);
  } else if (path.resolve(downloaded.downloadedPath || tempPath) !== path.resolve(filePath)) {
    await fs.rm(filePath, { force: true }).catch(() => {});
    await fs.rename(downloaded.downloadedPath || tempPath, filePath);
  }
  const archiveHeader = buffer || prefix;
  const downloadedBytes =
    downloaded.size || (buffer ? buffer.length : (await fs.stat(filePath)).size);
  let archiveDiff = null;
  if (
    filePath.toLowerCase().endsWith('.zip') ||
    filePath.toLowerCase().endsWith('.7z') ||
    filePath.toLowerCase().endsWith('.rar') ||
    isZipBuffer(archiveHeader) ||
    is7zBuffer(archiveHeader) ||
    isRarBuffer(archiveHeader)
  ) {
    emitInstallProgress(event, {
      name,
      phase: 'scanning files',
      percent: 96,
      loadedBytes: downloadedBytes,
      totalBytes: downloadedBytes,
      speedBps: 0
    });
    archiveDiff = await extractArchiveFile(filePath, archiveHeader, gameDir);
    emitInstallProgress(event, {
      name,
      phase: archiveDiff && archiveDiff.changed === 0 ? 'already current' : 'extracting',
      percent: 98,
      loadedBytes: downloadedBytes,
      totalBytes: downloadedBytes,
      speedBps: 0,
      changedFiles: archiveDiff?.changed || 0,
      skippedFiles: archiveDiff?.skipped || 0,
      totalFiles: archiveDiff?.files || 0
    });
  }
  emitInstallProgress(event, {
    name,
    phase: 'scanning',
    percent: 99,
    loadedBytes: downloadedBytes,
    totalBytes: downloadedBytes,
    speedBps: 0
  });
  const exe = await findBestGameExe(gameDir, name);
  let addedGame = null;
  if (exe) {
    const catalogTitle = safeName(name);
    const title = existingGame?.title || catalogTitle || titleFromExe(exe);
    const artworkTitle = catalogTitle || title;
    const currentState = await readState();
    const art =
      existingGame?.artwork ||
      (currentState.settings.autoRefreshArtwork !== false
        ? await artworkForTitle(artworkTitle, currentState.settings.steamGridDbApiKey)
        : placeholder(artworkTitle));
    await updateState((s) => {
      if (!s.settings.scanFolders.includes(installRoot)) s.settings.scanFolders.push(installRoot);
      const normalizedExe = path.normalize(exe).toLowerCase();
      const existingIndex = s.games.findIndex(
        (g) =>
          path.normalize(g.executablePath).toLowerCase() === normalizedExe ||
          normTitleValue(g.title) === normTitleValue(name) ||
          normTitleValue(g.sourceDownloadTitle || g.downloadTitle) === normTitleValue(name) ||
          (!!url && normUrlValue(g.sourceDownloadUrl || g.downloadUrl) === normUrlValue(url))
      );
      if (existingIndex >= 0) {
        const existing = s.games[existingIndex];
        addedGame = {
          ...existing,
          executablePath: exe,
          installDir: path.dirname(exe),
          sourceDownloadTitle: name,
          sourceDownloadUrl: url,
          downloadTitle: name,
          downloadUrl: url,
          version: meta.version || existing.version || '1.0.0',
          dlcIncluded: meta.dlc === true || existing.dlcIncluded === true,
          artwork: existing.artwork || art,
          updatedAt: new Date().toISOString()
        };
        s.games[existingIndex] = addedGame;
      } else {
        addedGame = {
          id: crypto.randomUUID(),
          title,
          executablePath: exe,
          installDir: path.dirname(exe),
          sourceDownloadTitle: name,
          sourceDownloadUrl: url,
          downloadTitle: name,
          downloadUrl: url,
          version: meta.version || '1.0.0',
          dlcIncluded: meta.dlc === true,
          artwork: art,
          favorite: false,
          addedAt: new Date().toISOString(),
          launchCount: 0
        };
        s.games.push(addedGame);
        s.games.sort((a, b) => a.title.localeCompare(b.title));
      }
    });
  }
  const cleanedFiles = await cleanupDownloadResidue(gameDir);
  downloadStates.delete(name);
  emitInstallProgress(event, {
    name,
    phase: 'done',
    percent: 100,
    loadedBytes: downloadedBytes,
    totalBytes: downloadedBytes,
    speedBps: 0,
    changedFiles: archiveDiff?.changed || 0,
    skippedFiles: archiveDiff?.skipped || 0,
    totalFiles: archiveDiff?.files || 0
  });
  return {
    installDir: gameDir,
    filePath,
    extracted: !!archiveDiff,
    archiveType: archiveDiff?.type || '',
    archiveDiff,
    cleanedFiles,
    executablePath: exe || '',
    addedGame
  };
}

function parseVersionCount(value) {
  const match = String(value || '').match(/v?\s*(\d+)/i);
  return match ? parseInt(match[1], 10) || 0 : 0;
}
function compareVersions(a, b) {
  return parseVersionCount(a) - parseVersionCount(b);
}
function extractRemoteVersion(raw) {
  const decoded = htmlDecode(String(raw || ''))
    .replace(/\u003d/g, '=')
    .replace(/\u0026/g, '&')
    .replace(/<[^>]+>/g, ' ');
  const explicit = [...decoded.matchAll(/\bv\s*(\d{1,4})\b/gi)].map((m) => 'v' + m[1]);
  if (explicit.length) return explicit.sort((a, b) => compareVersions(b, a))[0];
  const phrase = decoded.match(/\b(?:app\s*)?version\b[^0-9]{0,40}(\d{1,4})/i);
  if (phrase) return String(parseInt(phrase[1], 10));
  const compact = decoded.trim().match(/^\D*(\d{1,4})\D*$/);
  return compact ? String(parseInt(compact[1], 10)) : '';
}
async function checkForUpdate() {
  const { buffer } = await downloadBuffer(APP_VERSION_URL);
  const remoteVersion = extractRemoteVersion(buffer.toString('utf8'));
  if (!remoteVersion) throw new Error('No version number found on app-version page');
  return {
    currentVersion: APP_VERSION,
    remoteVersion,
    updateAvailable: compareVersions(remoteVersion, APP_VERSION) > 0,
    downloadUrl: APP_DOWNLOAD_URL
  };
}
function changelogTextFromHtml(raw) {
  const cleaned = htmlDecode(String(raw || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<(h[1-6]|p|div|li|br|section|article)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '\n')
    .replace(/\u003d/g, '=')
    .replace(/\u0026/g, '&')
    .replace(/\\u([0-9a-f]{4})/gi, (_m, h) => String.fromCharCode(parseInt(h, 16)));
  const skip =
    /^(skip to main content|search this site|report abuse|page details|google sites|navigation|home|downloads)$/i;
  const seen = new Set();
  const lines = cleaned
    .split(/\r?\n/)
    .map((v) => v.replace(/\s+/g, ' ').trim())
    .filter((v) => v.length > 1 && !skip.test(v))
    .filter((v) => {
      const key = v.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  const headings = [];
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^v\s*(\d+)\s+changelog$/i);
    if (match) headings.push({ index: i, version: parseInt(match[1], 10) || 0 });
  }
  if (headings.length) {
    const latest = headings.slice().sort((a, b) => b.version - a.version)[0];
    const next = headings
      .filter((h) => h.index > latest.index)
      .sort((a, b) => a.index - b.index)[0];
    const body = lines
      .slice(latest.index + 1, next ? next.index : lines.length)
      .filter((line) => !/^v\s*\d+\s+changelog$/i.test(line));
    if (body.length)
      return body
        .map((line, index) => (/^\d+\.\s/.test(line) ? line : index + 1 + '. ' + line))
        .join('\n')
        .slice(0, 9000);
  }
  return lines.slice(0, 120).join('\n').slice(0, 9000) || 'No changelog text was found.';
}
async function getChangelog() {
  const url = APP_CHANGELOG_URL;
  const { buffer } = await downloadBuffer(
    url + (url.includes('?') ? '&' : '?') + 't=' + Date.now()
  );
  const content = changelogTextFromHtml(buffer.toString('utf8'));
  return { url, title: 'Latest changelog', content };
}

function bytesLabel(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return 'Unknown';
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
function cleanGpuName(name, cpu = '') {
  let value = String(name || '')
    .replace(/\(TM\)|\(R\)|®|™/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!value || /^Vendor \d+ \/ Device \d+$/i.test(value)) {
    if (/radeon graphics/i.test(cpu)) value = 'AMD Radeon Graphics';
    else if (/intel/i.test(cpu)) value = 'Intel Integrated Graphics';
    else value = 'Unknown';
  }
  return value;
}
function rawGpuName(device) {
  return (
    (device &&
      (device.name ||
        device.Name ||
        device.FriendlyName ||
        device.Caption ||
        device.deviceString ||
        device.vendorString ||
        device.glRenderer ||
        (device.vendorId || device.deviceId
          ? [
              'Vendor ' + (device.vendorId || 'unknown'),
              'Device ' + (device.deviceId || 'unknown')
            ].join(' / ')
          : 'Unknown'))) ||
    'Unknown'
  );
}
function gpuDeviceName(device, cpu = '') {
  return cleanGpuName(rawGpuName(device), cpu);
}
function gpuMemoryBytes(device) {
  const raw =
    device &&
    (device.dedicatedVideoMemory ||
      device.DedicatedVideoMemory ||
      device.adapterRam ||
      device.AdapterRAM ||
      device.videoMemory ||
      device.dedicatedVideoMemoryMB ||
      device.memorySize);
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1024 * 1024 ? n * 1024 * 1024 : n;
}
function isIntegratedGpu(device) {
  const text = (rawGpuName(device) + ' ' + ((device && device.vendorString) || '')).toLowerCase();
  return (
    /intel|uhd|iris|integrated|igpu|radeon graphics|vega/.test(text) &&
    !/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|firepro|arc a[0-9]/.test(text)
  );
}
function isDedicatedGpu(device) {
  return gpuScore(device) >= 500;
}
function gpuScore(device) {
  const text = (
    rawGpuName(device) +
    ' ' +
    ((device && device.vendorString) || '') +
    ' ' +
    ((device && device.PNPDeviceID) || (device && device.pnpDeviceId) || '')
  ).toLowerCase();
  let score = 0;
  if (/nvidia|geforce|rtx|gtx|quadro/.test(text)) score += 1200;
  if (/radeon rx|radeon pro|firepro/.test(text)) score += 1100;
  if (/intel arc|arc a[0-9]/.test(text)) score += 1000;
  if (/amd|radeon/.test(text) && !/radeon graphics|vega/.test(text)) score += 650;
  if (isIntegratedGpu(device)) score -= 700;
  const mem = gpuMemoryBytes(device);
  if (mem >= 2 * 1024 * 1024 * 1024) score += 300;
  else if (mem >= 512 * 1024 * 1024) score += 120;
  if (device && device.active) score += 20;
  if (device && device.source === 'windows') score += 40;
  return score;
}
async function getWindowsVideoControllers() {
  if (process.platform !== 'win32') return [];
  const out = [];
  try {
    const script =
      '$cim=Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM,PNPDeviceID; $pnp=Get-PnpDevice -Class Display -Status OK -ErrorAction SilentlyContinue | Select-Object @{Name="Name";Expression={$_.FriendlyName}},InstanceId; $reg=Get-ItemProperty -Path "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Video\\*\\0000" -ErrorAction SilentlyContinue | ForEach-Object { $n=$_."HardwareInformation.AdapterString"; if($n -is [byte[]]){$n=[Text.Encoding]::Unicode.GetString($n).Trim([char]0)}; $m=$_."HardwareInformation.qwMemorySize"; if($m -is [byte[]]){if($m.Length -ge 8){$m=[BitConverter]::ToUInt64($m,0)}elseif($m.Length -ge 4){$m=[BitConverter]::ToUInt32($m,0)}}; if($n){[pscustomobject]@{Name=$n;DedicatedVideoMemory=$m;Source="registry"}} }; @($reg)+@($cim)+@($pnp) | ConvertTo-Json -Compress';
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
      { timeout: 8000, windowsHide: true }
    );
    const parsed = JSON.parse(String(stdout || '').trim() || '[]');
    out.push(...(Array.isArray(parsed) ? parsed : [parsed]).filter(Boolean));
  } catch {}
  if (!out.length) {
    try {
      const { stdout } = await execFileAsync(
        'wmic.exe',
        ['path', 'win32_VideoController', 'get', 'Name,AdapterRAM', '/format:csv'],
        { timeout: 6000, windowsHide: true }
      );
      out.push(
        ...String(stdout || '')
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter((line) => line && !/^Node,/i.test(line))
          .map((line) => {
            const parts = line.split(',');
            return {
              Name: parts.slice(1, -1).join(',') || parts[1],
              AdapterRAM: parts[parts.length - 1]
            };
          })
          .filter((v) => v.Name)
      );
    } catch {}
  }
  const seen = new Set();
  return out
    .map((d) => ({ ...d, source: 'windows' }))
    .filter((d) => {
      const key = String(
        d.Name || d.FriendlyName || d.PNPDeviceID || d.InstanceId || ''
      ).toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
function selectedGpuFromInfo(info, windowsDevices = []) {
  const electronDevices = (Array.isArray(info && info.gpuDevice) ? info.gpuDevice : []).map(
    (d) => ({ ...d, source: d.source || 'electron' })
  );
  const winDevices = windowsDevices.map((d) => ({
    name: d.Name || d.FriendlyName,
    adapterRam: d.AdapterRAM,
    dedicatedVideoMemory: d.DedicatedVideoMemory,
    pnpDeviceId: d.PNPDeviceID || d.InstanceId,
    source: d.Source || d.source || 'windows'
  }));
  const devices = [...winDevices, ...electronDevices].filter((d) => gpuDeviceName(d) !== 'Unknown');
  const ranked = devices
    .map((device) => ({ device, score: gpuScore(device) }))
    .sort((a, b) => b.score - a.score);
  const best = (ranked[0] && ranked[0].device) || {};
  const type = isDedicatedGpu(best)
    ? 'dedicated'
    : isIntegratedGpu(best)
      ? 'integrated'
      : 'unknown';
  return { device: best, type };
}
function gpuVramFromInfo(info, selected) {
  if (selected && selected.type === 'integrated') return 'Shared system memory';
  const active = (selected && selected.device) || {};
  const mem = gpuMemoryBytes(active);
  if (mem > 0) return bytesLabel(mem);
  const attrs = (info && info.auxAttributes) || {};
  const stats = attrs.videoMemoryUsageStats || attrs.gpuMemoryBufferSupport;
  if (stats && stats.total) return bytesLabel(Number(stats.total));
  return 'Unknown';
}
async function getStorageStats() {
  try {
    if (typeof fs.statfs !== 'function')
      return { free: 'Unknown', total: 'Unknown', freeBytes: 0, totalBytes: 0 };
    const st = await fs.statfs(app.getPath('documents'));
    const block = Number(st.bsize || st.frsize || 0);
    const free = Number(st.bavail || st.bfree || 0) * block;
    const total = Number(st.blocks || 0) * block;
    return { free: bytesLabel(free), total: bytesLabel(total), freeBytes: free, totalBytes: total };
  } catch {
    return { free: 'Unknown', total: 'Unknown', freeBytes: 0, totalBytes: 0 };
  }
}
async function getSystemStats() {
  const cpus = os.cpus() || [];
  const cpu = cpus[0]
    ? cpus[0].model.replace(/\s+/g, ' ').trim() + ' (' + cpus.length + ' threads)'
    : 'Unknown';
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const display = screen.getPrimaryDisplay();
  const size = display && display.size ? display.size : { width: 0, height: 0 };
  let gpuInfo = {};
  try {
    gpuInfo = await app.getGPUInfo('complete');
  } catch {
    try {
      gpuInfo = await app.getGPUInfo('basic');
    } catch {}
  }
  const windowsGpus = await getWindowsVideoControllers();
  const storage = await getStorageStats();
  const selectedGpu = selectedGpuFromInfo(gpuInfo, windowsGpus);
  return {
    cpu,
    gpuLabel:
      selectedGpu.type === 'dedicated'
        ? 'Dedicated GPU'
        : selectedGpu.type === 'integrated'
          ? 'iGPU'
          : 'GPU',
    gpu: gpuDeviceName(selectedGpu.device, cpu),
    ram: bytesLabel(totalMem) + ' total / ' + bytesLabel(freeMem) + ' free',
    display:
      (size.width || '?') +
      ' x ' +
      (size.height || '?') +
      ' @ ' +
      Math.round(((display && display.scaleFactor) || 1) * 100) +
      '% scale',
    vramLabel: selectedGpu.type === 'integrated' ? 'iGPU memory' : 'Dedicated GPU VRAM',
    vram: gpuVramFromInfo(gpuInfo, selectedGpu),
    storage: storage.free + ' free / ' + storage.total + ' total'
  };
}

async function refreshMissingArtwork() {
  const state = await readState();
  if (state.settings.autoRefreshArtwork === false) return state.games;
  const key = state.settings.steamGridDbApiKey || DEFAULT_STEAMGRIDDB_API_KEY;
  if (!key) return state.games;
  let changed = false;
  const games = [];
  for (const game of state.games) {
    if (game.artwork && game.artwork.kind !== 'placeholder') {
      games.push(game);
      continue;
    }
    const artwork = await artworkForTitle(game.title, key);
    if (artwork && artwork.kind !== 'placeholder') {
      games.push({ ...game, artwork });
      changed = true;
    } else games.push(game);
  }
  if (changed) {
    const next = await updateState((s) => {
      s.games = games;
    });
    return next.games;
  }
  return state.games;
}

function trayIcon() {
  const icon = nativeImage.createFromPath(currentAppIconPath || APP_ICON_PATH);
  if (!icon.isEmpty()) return icon.resize({ width: 16, height: 16 });
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#101720"/><path d="M32 10l5.4 14.8L52 32l-14.6 7.2L32 54l-5.4-14.8L12 32l14.6-7.2L32 10z" fill="#46c2ff"/><path d="M32 19l3.2 8.8L44 32l-8.8 4.2L32 45l-3.2-8.8L20 32l8.8-4.2L32 19z" fill="#f7fbff"/></svg>';
  return nativeImage
    .createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'))
    .resize({ width: 16, height: 16 });
}
function updateAppIcons(settings = cachedState?.settings || {}) {
  currentAppIconPath = settings.themePackageIconPath || APP_ICON_PATH;
  const image = nativeImage.createFromPath(currentAppIconPath);
  if (image.isEmpty()) currentAppIconPath = APP_ICON_PATH;
  try {
    if (tray) tray.setImage(trayIcon());
  } catch {}
  try {
    const windowIcon = nativeImage.createFromPath(currentAppIconPath);
    if (!windowIcon.isEmpty()) {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && typeof win.setIcon === 'function') win.setIcon(windowIcon);
      }
    }
  } catch {}
}
function notifyRendererAppReopened(win) {
  try {
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed())
      win.webContents.send('app:reopened');
  } catch {}
}
function showWindow(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  notifyRendererAppReopened(win);
}
function notifyDownload(title, body) {
  try {
    if (Notification.isSupported()) new Notification({ title, body, icon: currentAppIconPath }).show();
  } catch {}
}
function wantsTrayClose() {
  return !cachedState || !cachedState.settings || cachedState.settings.minimizeToTray !== false;
}
function createTray(win) {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('Big Screen Launcher');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Big Screen Launcher', click: () => showWindow(win) },
      {
        label: 'Quit',
        click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
  tray.on('double-click', () => showWindow(win));
  tray.on('click', () => showWindow(win));
}
function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    splashWindow.close();
  }
  splashWindow = null;
}
function createSplashWindow() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    show: true,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    icon: APP_ICON_PATH,
    backgroundColor: '#08111a',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    icon: APP_ICON_PATH,
    backgroundColor: '#11151d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true
    }
  });
  mainWindow = win;
  createTray(win);
  win.on('focus', () => notifyRendererAppReopened(win));
  win.on('show', () => notifyRendererAppReopened(win));
  win.on('restore', () => notifyRendererAppReopened(win));
  win.on('close', (e) => {
    if (isQuitting || !wantsTrayClose()) return;
    e.preventDefault();
    win.hide();
  });
  win.once('ready-to-show', () => {
    closeSplash();
    win.show();
    win.focus();
  });
  win.webContents.once('did-finish-load', () => setTimeout(closeSplash, 600));
  win.loadFile(path.join(__dirname, 'index.html'));
}
function register() {
  ipcMain.handle('app:version', async () => APP_VERSION);
  ipcMain.handle('app:checkUpdate', async () => checkForUpdate());
  ipcMain.handle('app:openDownloadPage', async () => {
    await shell.openExternal(APP_DOWNLOAD_URL);
    return true;
  });
  ipcMain.handle('app:openChangelogPage', async () => {
    await shell.openExternal(APP_CHANGELOG_URL);
    return true;
  });
  ipcMain.handle('app:getChangelog', async () => getChangelog());
  ipcMain.handle('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.handle('window:maximize', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win?.isMaximized()) win.unmaximize();
    else win?.maximize();
  });
  ipcMain.handle('window:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
  ipcMain.handle('window:focus', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    showWindow(win);
    return true;
  });
  ipcMain.handle('app:bootstrap', async () => {
    const s = await readState();
    updateAppIcons(s.settings);
    return {
      settings: settingsForRenderer(s.settings),
      games: await gamesWithInstalledSizes(s.games),
      pendingImports: s.pendingImports,
      version: APP_VERSION
    };
  });
  ipcMain.handle('settings:get', async () => settingsForRenderer((await readState()).settings));
  ipcMain.handle('settings:update', async (_e, u) =>
    settingsForRenderer(
      (
        await updateState((s) => {
          s.settings = { ...s.settings, ...u };
        })
      ).settings
    )
  );
  ipcMain.handle('themes:import', async () => {
    const pick = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Theme file', extensions: ['css', 'bslt'] }]
    });
    if (pick.canceled || !pick.filePaths.length)
      return settingsForRenderer((await readState()).settings);
    const source = pick.filePaths[0];
    if (source.toLowerCase().endsWith('.bslt')) return installThemePackage(source);
    const themeDir = defaultThemesRoot();
    await fs.mkdir(themeDir, { recursive: true });
    const dest = path.join(themeDir, safeThemeFileName(source));
    const css = await fs.readFile(source, 'utf8');
    await fs.writeFile(dest, css);
    const displayName = themeNameFromCss(css, path.basename(source));
    let oldPath = '';
    const st = await updateState((s) => {
      oldPath = s.settings.themeCssPath || '';
      s.settings.themeCssPath = dest;
      s.settings.themeCssName = displayName;
      s.settings.themeUpdatedAt = String(Date.now());
      clearThemePackageSettings(s.settings);
    });
    await removeManagedTheme(oldPath);
    updateAppIcons(st.settings);
    return settingsForRenderer(st.settings);
  });
  ipcMain.handle('themes:remove', async () => {
    let oldPath = '';
    const st = await updateState((s) => {
      oldPath = s.settings.themeCssPath || '';
      s.settings.themeCssPath = '';
      s.settings.themeCssName = 'Default';
      s.settings.themeUpdatedAt = '';
      clearThemePackageSettings(s.settings);
    });
    await removeManagedTheme(oldPath);
    updateAppIcons(st.settings);
    return settingsForRenderer(st.settings);
  });
  ipcMain.handle('themes:list', async () => listStoredThemes());
  ipcMain.handle('themes:apply', async (_e, filePath) => applyStoredTheme(filePath));
  ipcMain.handle('themes:backgroundImport', async () => {
    const pick = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Background image', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'] }]
    });
    if (pick.canceled || !pick.filePaths.length)
      return settingsForRenderer((await readState()).settings);
    const source = pick.filePaths[0];
    const themeDir = defaultThemesRoot();
    await fs.mkdir(themeDir, { recursive: true });
    const dest = path.join(themeDir, safeThemeAssetFileName(source));
    await fs.copyFile(source, dest);
    const st = await updateState((s) => {
      s.settings.themeBackgroundPath = dest;
      s.settings.themeBackgroundName = path.basename(source);
      s.settings.themeBackgroundUpdatedAt = String(Date.now());
    });
    return settingsForRenderer(st.settings);
  });
  ipcMain.handle('themes:backgroundRemove', async () => {
    const st = await updateState((s) => {
      s.settings.themeBackgroundPath = '';
      s.settings.themeBackgroundName = 'Default';
      s.settings.themeBackgroundUpdatedAt = '';
    });
    return settingsForRenderer(st.settings);
  });
  ipcMain.handle('themes:openFolder', async () => {
    const themeDir = defaultThemesRoot();
    await fs.mkdir(themeDir, { recursive: true });
    const result = await shell.openPath(themeDir);
    if (result) throw new Error(result);
    return themeDir;
  });
  ipcMain.handle('themes:openDocs', async () => {
    const docs = path.join(__dirname, 'THEME_AUTHORING.md');
    await shell.openPath(docs);
    return docs;
  });
  ipcMain.handle('themes:getDocs', async () =>
    fs.readFile(path.join(__dirname, 'THEME_AUTHORING.md'), 'utf8')
  );
  ipcMain.handle('folders:choose', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled) return [];
    return (
      await updateState((s) => {
        s.settings.scanFolders = Array.from(new Set([...s.settings.scanFolders, ...r.filePaths]));
      })
    ).settings.scanFolders;
  });
  ipcMain.handle('library:scan', async (event) => {
    const s = await readState();
    emitImportProgress(event, {
      phase: 'scanning',
      name: 'Scan folders',
      percent: 5,
      index: 0,
      total: s.settings.scanFolders.length
    });
    const existing = [
      ...s.games.map((g) => g.executablePath),
      ...s.pendingImports.map((p) => p.executablePath)
    ];
    const { pending, ignoredCount } = await scanFolders(
      s.settings.scanFolders,
      existing,
      s.settings.steamGridDbApiKey
    );
    emitImportProgress(event, {
      phase: 'reviewing',
      name: 'Scan results',
      percent: 88,
      index: s.settings.scanFolders.length,
      total: s.settings.scanFolders.length
    });
    await updateState((st) => {
      st.pendingImports = [...st.pendingImports, ...pending];
    });
    emitImportProgress(event, {
      phase: 'done',
      name: 'Scan complete',
      percent: 100,
      index: s.settings.scanFolders.length,
      total: s.settings.scanFolders.length
    });
    return {
      scannedFolders: s.settings.scanFolders,
      candidatesFound: pending.length,
      pendingImports: pending,
      ignoredCount
    };
  });
  ipcMain.handle('imports:list', async () => (await readState()).pendingImports);
  ipcMain.handle('imports:importZip', async (event) => {
    const pick = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Game archives', extensions: ['zip', '7z', 'rar'] }]
    });
    if (pick.canceled || !pick.filePaths.length)
      return { games: await gamesWithInstalledSizes((await readState()).games), imported: [] };
    return importArchiveFiles(pick.filePaths, event);
  });
  ipcMain.handle('imports:importDropped', async (event, filePaths) =>
    importArchiveFiles(filePaths, event)
  );
  ipcMain.handle(
    'imports:confirm',
    async (_e, input) =>
      (
        await updateState((s) => {
          const ids = new Set(input.ids || []);
          const imported = [];
          s.pendingImports = s.pendingImports.filter((item) => {
            if (!ids.has(item.id)) return true;
            const edit = input.edits && input.edits[item.id];
            imported.push({
              id: crypto.randomUUID(),
              title: (edit && edit.title) || item.title,
              executablePath: item.executablePath,
              installDir: item.installDir,
              artwork: (edit && edit.artwork) || item.artwork,
              favorite: false,
              version: '1.0.0',
              addedAt: new Date().toISOString(),
              launchCount: 0
            });
            return false;
          });
          s.games = [...s.games, ...imported].sort((a, b) => a.title.localeCompare(b.title));
        })
      ).games
  );
  ipcMain.handle(
    'imports:discard',
    async (_e, ids) =>
      (
        await updateState((s) => {
          const set = new Set(ids || []);
          s.pendingImports = s.pendingImports.filter((i) => !set.has(i.id));
        })
      ).pendingImports
  );
  ipcMain.handle('games:list', async () => gamesWithInstalledSizes((await readState()).games));
  ipcMain.handle('games:update', async (_e, id, update) => {
    let updated;
    await updateState((s) => {
      s.games = s.games.map((g) => (g.id === id ? (updated = { ...g, ...update }) : g));
    });
    if (!updated) throw new Error('Game not found');
    return updated;
  });
  ipcMain.handle(
    'games:remove',
    async (_e, id) =>
      (
        await updateState((s) => {
          s.games = s.games.filter((g) => g.id !== id);
        })
      ).games
  );

  ipcMain.handle('games:removeWithFiles', async (_e, id) => {
    const state = await readState();
    const game = state.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    const installRoot = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games');
    const target = path.resolve(game.installDir || path.dirname(game.executablePath));
    const root = path.resolve(installRoot);
    if (!target.toLowerCase().startsWith(root.toLowerCase() + path.sep))
      throw new Error('Refusing to delete files outside the launcher Games folder');
    await fs.rm(target, { recursive: true, force: true });
    const next = await updateState((s) => {
      s.games = s.games.filter((g) => g.id !== id);
    });
    return next.games;
  });
  ipcMain.handle('games:launch', async (_e, id) => {
    const s = await readState();
    const game = s.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    await launchGameProcess(game);
    let launched;
    await updateState((st) => {
      st.games = st.games.map((g) =>
        g.id === id
          ? (launched = {
              ...g,
              lastPlayed: new Date().toISOString(),
              launchCount: g.launchCount + 1
            })
          : g
      );
    });
    return { ...launched, _running: runningGames() };
  });
  ipcMain.handle('games:running', async () => runningGames());
  ipcMain.handle('games:repair', async (_e, id) => {
    const s = await readState();
    const game = s.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    const folder = game.installDir || path.dirname(game.executablePath);
    try {
      await fs.access(folder);
    } catch {
      throw new Error('Could not find game folder: ' + folder);
    }
    const exe = await findBestGameExe(folder, game.sourceDownloadTitle || game.title);
    if (!exe) throw new Error('No playable .exe found in ' + folder);
    let updated;
    await updateState((st) => {
      st.games = st.games.map((g) =>
        g.id === id ? (updated = { ...g, executablePath: exe, installDir: path.dirname(exe) }) : g
      );
    });
    return updated;
  });
  ipcMain.handle('games:browseFiles', async (_e, id) => {
    const s = await readState();
    const game = s.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    const folder = game.installDir || path.dirname(game.executablePath);
    try {
      await fs.access(folder);
    } catch {
      throw new Error('Could not find game folder: ' + folder);
    }
    const result = await shell.openPath(folder);
    if (result) throw new Error(result);
    return true;
  });
  ipcMain.handle('games:stop', async (_e, id) => ({
    stopped: await stopGameProcess(id),
    running: runningGames()
  }));
  ipcMain.handle('system:stats', async () => getSystemStats());
  ipcMain.handle('system:storage', async () => getStorageStats());
  ipcMain.handle('downloads:open', async () => {
    await shell.openExternal('https://sites.google.com/view/tungsten-ball/home');
    return true;
  });
  ipcMain.handle('downloads:openDrive', async () => {
    await shell.openExternal(
      'https://drive.google.com/drive/folders/1rcFA-x0VTFcAwmQsKzmC3fIzYJUteHVr?usp=drive_link'
    );
    return true;
  });
  ipcMain.handle('downloads:openUrl', async (_e, url) => {
    if (
      !/^https?:\/\/([a-z0-9-]+\.trycloudflare\.com|tungstenball\.org|www\.tungstenball\.org|drive\.google\.com|sites\.google\.com)\//.test(
        url
      )
    )
      throw new Error('Blocked download URL');
    await shell.openExternal(url);
    return true;
  });
  ipcMain.handle('downloads:install', async (event, input) => {
    const name = input.name || 'Game';
    try {
      const result = await installDownloadWithProgress(event, name, input.url, {
        version: input.version || '',
        dlc: input.dlc === true
      });
      notifyDownload(
        'Download complete',
        result.executablePath
          ? name + ' installed and added to your Library.'
          : name + ' downloaded, but no executable was found.'
      );
      return result;
    } catch (error) {
      const message = String(error?.message || error || 'Unknown error');
      downloadStates.delete(name);
      notifyDownload(
        message.toLowerCase().includes('cancelled') ? 'Download cancelled' : 'Download failed',
        name + ': ' + message
      );
      throw error;
    }
  });
  ipcMain.handle('downloads:cancel', async (event, name) => {
    const req = activeDownloads.get(name);
    const state = downloadStates.get(name);
    emitInstallProgress(event, {
      name,
      phase: 'cancelled',
      percent: 0,
      loadedBytes: 0,
      totalBytes: 0,
      speedBps: 0,
      resumable: false
    });
    if (req) {
      req.destroy(new Error('Download cancelled'));
      activeDownloads.delete(name);
    }
    if (state?.tempPath) {
      await fs.rm(state.tempPath, { force: true }).catch(() => {});
    }
    downloadStates.delete(name);
    return !!(req || state);
  });
  ipcMain.handle('downloads:catalog', async () => getDownloadCatalog());
  ipcMain.handle('downloads:resolveManifest', async () => resolveManifestUrl());

  ipcMain.handle('artwork:replace', async (_e, id, slot = 'tile') => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const fileUrl = 'file:///' + result.filePaths[0].replace(/\\/g, '/');
    const target = slot === 'logo' ? 'logoUrl' : slot === 'banner' ? 'heroUrl' : 'gridUrl';
    let updated;
    await updateState((s) => {
      s.games = s.games.map((g) => {
        if (g.id !== id) return g;
        const base = g.artwork || placeholder(g.title);
        updated = {
          ...g,
          artwork: {
            ...base,
            kind: 'manual',
            [target]: fileUrl,
            color: base.color || '#46c2ff',
            initials: base.initials || initials(g.title)
          }
        };
        return updated;
      });
    });
    return updated;
  });
  ipcMain.handle('artwork:refreshMissing', async () => refreshMissingArtwork());
  ipcMain.handle('artwork:refresh', async (_e, id) => {
    const s = await readState();
    const game = s.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    const art = await artworkForTitle(game.title, s.settings.steamGridDbApiKey);
    let refreshed;
    await updateState((st) => {
      st.games = st.games.map((g) => (g.id === id ? (refreshed = { ...g, artwork: art }) : g));
    });
    return refreshed;
  });
  ipcMain.handle('artwork:searchReplace', async (_e, id, title = '') => {
    const s = await readState();
    const game = s.games.find((g) => g.id === id);
    if (!game) throw new Error('Game not found');
    const query = String(title || game.title || '').trim();
    if (!query) throw new Error('Enter a title to search');
    const art = await artworkForTitle(query, s.settings.steamGridDbApiKey);
    if (!art || !(art.gridUrl || art.heroUrl || art.logoUrl))
      throw new Error('No artwork found for ' + query);
    let updated;
    await updateState((st) => {
      st.games = st.games.map((g) => {
        if (g.id !== id) return g;
        const base = g.artwork || placeholder(g.title);
        updated = {
          ...g,
          artwork: {
            ...base,
            ...art,
            kind: art.kind || 'steamgriddb',
            color: art.color || base.color || '#46c2ff',
            initials: art.initials || base.initials || initials(g.title)
          }
        };
        return updated;
      });
    });
    return updated;
  });
}
if (singleInstanceLock) {
  app.on('second-instance', () => {
    const win =
      mainWindow && !mainWindow.isDestroyed()
        ? mainWindow
        : BrowserWindow.getAllWindows().find((w) => w !== splashWindow);
    if (win) showWindow(win);
  });
  app.whenReady().then(() => {
    app.setAppUserModelId('BigScreenLauncher');
    createSplashWindow();
    register();
    createWindow();
    app.on('activate', () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createSplashWindow();
        createWindow();
      }
    });
  });
  app.on('before-quit', () => {
    isQuitting = true;
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
