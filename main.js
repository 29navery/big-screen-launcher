// hello I am the electron script
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, session, net, safeStorage } = require('electron');
// Only the first process should initialize the launcher.
if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
}

const { autoUpdater } = require('electron-updater');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// settings because everything is a loser and hates when I call it before it exists
const bslDir = path.join(app.getPath('documents'), 'Big Screen Launcher');
const settingsFilePath = path.join(bslDir, '.settings.json');

// apply settings
function applySettings() {
    const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
    app.setLoginItemSettings({
        openAtLogin: !!settings.startWithWindows,
        openAsHidden: true
    });

    if (audioWindow) audioWindow.setAlwaysOnTop(!!settings.keepIpodOnTop);
}

// tray & window
let mainWindow;
let audioWindow;
let tray = null;
let isQuitting = false;

const MICROSOFT_CLIENT_ID = '4dd96d7c-71f0-4bf2-8903-509778a4d30a';
const MICROSOFT_REDIRECT_URI = `msal${MICROSOFT_CLIENT_ID}://auth`;
const MICROSOFT_PROTOCOL = `msal${MICROSOFT_CLIENT_ID}`;
const minecraftAccountPath = path.join(app.getPath('userData'), 'minecraft-account.json');
const minecraftRefreshTokenPath = path.join(app.getPath('userData'), 'minecraft-refresh-token.bin');
let pendingMicrosoftSignIn = null;
let cachedMinecraftSession = null;

function saveMinecraftRefreshToken(refreshToken) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device.');
    fs.mkdirSync(path.dirname(minecraftRefreshTokenPath), { recursive: true });
    fs.writeFileSync(minecraftRefreshTokenPath, safeStorage.encryptString(refreshToken));
}

function readMinecraftRefreshToken() {
    if (!fs.existsSync(minecraftRefreshTokenPath)) return null;
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure token storage is unavailable on this device.');
    return safeStorage.decryptString(fs.readFileSync(minecraftRefreshTokenPath));
}

function getSavedMinecraftAccount() {
    if (!fs.existsSync(minecraftAccountPath) || !fs.existsSync(minecraftRefreshTokenPath)) return null;
    try { return JSON.parse(fs.readFileSync(minecraftAccountPath, 'utf8')); }
    catch { return null; }
}

function handleMicrosoftRedirect(rawUrl) {
    if (!pendingMicrosoftSignIn || typeof rawUrl !== 'string') return;
    let callback;
    try { callback = new URL(rawUrl); } catch { return; }
    if (callback.protocol !== `${MICROSOFT_PROTOCOL}:` || callback.hostname !== 'auth') return;

    const pending = pendingMicrosoftSignIn;
    pendingMicrosoftSignIn = null;
    clearTimeout(pending.timeout);
    if (callback.searchParams.get('state') !== pending.state) {
        pending.reject(new Error('Microsoft sign-in state validation failed. Please try again.'));
    } else if (callback.searchParams.has('error')) {
        pending.reject(new Error(callback.searchParams.get('error_description') || callback.searchParams.get('error')));
    } else if (!callback.searchParams.get('code')) {
        pending.reject(new Error('Microsoft did not return an authorization code.'));
    } else {
        pending.resolve({ code: callback.searchParams.get('code'), verifier: pending.verifier });
    }
    focusMainWindow();
}

function extractMicrosoftRedirect(args) {
    return args.find(argument => typeof argument === 'string' && argument.startsWith(`${MICROSOFT_PROTOCOL}://`));
}

function beginMicrosoftSignIn() {
    if (pendingMicrosoftSignIn) throw new Error('Microsoft sign-in is already in progress.');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(24).toString('hex');
    const authorizeUrl = new URL('https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize');
    authorizeUrl.search = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        response_type: 'code',
        redirect_uri: MICROSOFT_REDIRECT_URI,
        response_mode: 'query',
        scope: 'XboxLive.signin XboxLive.offline_access',
        code_challenge: challenge,
        code_challenge_method: 'S256',
        state,
        prompt: 'select_account'
    }).toString();

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            if (pendingMicrosoftSignIn?.state !== state) return;
            pendingMicrosoftSignIn = null;
            reject(new Error('Microsoft sign-in timed out. Please try again.'));
        }, 5 * 60 * 1000);
        pendingMicrosoftSignIn = { resolve, reject, state, verifier, challenge, timeout };
        shell.openExternal(authorizeUrl.toString()).catch(error => {
            clearTimeout(timeout);
            pendingMicrosoftSignIn = null;
            reject(error);
        });
    });
}

async function requestJson(url, options, label) {
    const response = await net.fetch(url, options);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const description = body.error_description || body.errorMessage || body.Message || body.message || body.error || `HTTP ${response.status}`;
        const endpointPath = body.path ? ` (${body.path})` : '';
        throw new Error(`${label} (HTTP ${response.status})${endpointPath}: ${description}`);
    }
    return body;
}

async function exchangeMicrosoftCode(code, verifier) {
    const body = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: MICROSOFT_REDIRECT_URI,
        code_verifier: verifier,
        scope: 'XboxLive.signin XboxLive.offline_access'
    });
    return requestJson('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    }, 'Microsoft token exchange failed');
}

async function getMinecraftSessionFromMicrosoftToken(msAccessToken) {
    const xbl = await requestJson('https://user.auth.xboxlive.com/user/authenticate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
        body: JSON.stringify({
            Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
            RelyingParty: 'http://auth.xboxlive.com', TokenType: 'JWT'
        })
    }, 'Xbox sign-in failed');
    const xsts = await requestJson('https://xsts.auth.xboxlive.com/xsts/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-xbl-contract-version': '1' },
        body: JSON.stringify({
            Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
            RelyingParty: 'rp://api.minecraftservices.com/', TokenType: 'JWT'
        })
    }, 'Xbox security check failed');
    const xui = xsts.DisplayClaims?.xui?.[0] || xbl.DisplayClaims?.xui?.[0] || {};
    if (!xui.uhs || !xsts.Token) throw new Error('Xbox did not return a valid security token.');

    const minecraft = await requestJson('https://api.minecraftservices.com/authentication/login_with_xbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identityToken: `XBL3.0 x=${xui.uhs};${xsts.Token}` })
    }, 'Minecraft sign-in failed');
    const entitlements = await requestJson('https://api.minecraftservices.com/entitlements/mcstore', {
        headers: { Authorization: `Bearer ${minecraft.access_token}` }
    }, 'Could not check Minecraft ownership');
    const ownsJava = (entitlements.items || []).some(item => ['game_minecraft', 'product_minecraft'].includes(String(item.name || '').toLowerCase()));
    if (!ownsJava) throw new Error('This Microsoft account does not appear to own Minecraft: Java Edition or have an eligible Game Pass subscription.');

    const javaProfile = await requestJson('https://api.minecraftservices.com/minecraft/profile', {
        headers: { Authorization: `Bearer ${minecraft.access_token}` }
    }, 'Could not load the Minecraft profile');
    let xboxProfile = {};
    try {
        xboxProfile = await requestJson('https://profile.xboxlive.com/users/me/profile/settings?settings=GameDisplayName,GameDisplayPicRaw,ModernGamertag,Gamertag', {
            headers: { Authorization: `XBL3.0 x=${xui.uhs};${xsts.Token}`, 'x-xbl-contract-version': '2' }
        }, 'Could not load Xbox profile');
    } catch (error) {
        console.warn('Xbox profile details unavailable:', error.message);
    }
    const profileUser = xboxProfile.profileUsers?.[0] || {};
    const profileSettings = Object.fromEntries((profileUser.settings || []).map(setting => [setting.id, setting.value]));
    const profile = {
        minecraftName: javaProfile.name,
        minecraftUuid: javaProfile.id,
        xboxUsername: profileSettings.GameDisplayName || profileSettings.ModernGamertag || profileSettings.Gamertag || javaProfile.name,
        xboxPicture: profileSettings.GameDisplayPicRaw || '',
        xuid: profileUser.id || xui.xid || xui.xuid || ''
    };
    return { profile, session: { accessToken: minecraft.access_token, expiresAt: Date.now() + (minecraft.expires_in || 3600) * 1000, profile } };
}

async function refreshMinecraftSession() {
    const refreshToken = readMinecraftRefreshToken();
    if (!refreshToken) throw new Error('Sign in to your Microsoft account before launching Minecraft.');
    const body = new URLSearchParams({
        client_id: MICROSOFT_CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: 'XboxLive.signin XboxLive.offline_access'
    });
    const refreshed = await requestJson('https://login.microsoftonline.com/consumers/oauth2/v2.0/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString()
    }, 'Microsoft session refresh failed. Sign in again');
    if (refreshed.refresh_token) saveMinecraftRefreshToken(refreshed.refresh_token);
    const result = await getMinecraftSessionFromMicrosoftToken(refreshed.access_token);
    fs.writeFileSync(minecraftAccountPath, JSON.stringify(result.profile, null, 2), 'utf8');
    cachedMinecraftSession = result.session;
    return result.session;
}

async function getMinecraftSession() {
    if (cachedMinecraftSession && cachedMinecraftSession.expiresAt > Date.now() + 60_000) return cachedMinecraftSession;
    return refreshMinecraftSession();
}

ipcMain.handle('get-minecraft-account', () => getSavedMinecraftAccount());
ipcMain.handle('sign-in-minecraft', async () => {
    const { code, verifier } = await beginMicrosoftSignIn();
    const microsoftTokens = await exchangeMicrosoftCode(code, verifier);
    if (!microsoftTokens.access_token || !microsoftTokens.refresh_token) throw new Error('Microsoft did not return the tokens required for Xbox and Minecraft sign-in.');
    const result = await getMinecraftSessionFromMicrosoftToken(microsoftTokens.access_token);
    saveMinecraftRefreshToken(microsoftTokens.refresh_token);
    fs.mkdirSync(path.dirname(minecraftAccountPath), { recursive: true });
    fs.writeFileSync(minecraftAccountPath, JSON.stringify(result.profile, null, 2), 'utf8');
    cachedMinecraftSession = result.session;
    return result.profile;
});
ipcMain.handle('sign-out-minecraft', () => {
    cachedMinecraftSession = null;
    for (const file of [minecraftRefreshTokenPath, minecraftAccountPath]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    return true;
});

function focusMainWindow() {
    if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow();
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
}

app.on('open-url', (event, url) => {
    event.preventDefault();
    handleMicrosoftRedirect(url);
});

app.on('second-instance', (_event, commandLine) => {
    app.whenReady().then(focusMainWindow);
    const redirectUrl = extractMicrosoftRedirect(commandLine);
    if (redirectUrl) handleMicrosoftRedirect(redirectUrl);
});

autoUpdater.autoDownload = true;
autoUpdater.on('error', (error) => {
    console.error('Update check failed:', error);
});
ipcMain.on('restart-app', () => {
    app.relaunch();
    app.exit(0);
});

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1240,
        height: 720,
        minWidth: 800,
        minHeight: 600,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#131314',
            symbolColor: '#ffffff',
            height: 45
        },
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });

    // no more cuss words guys (no more closing)
    mainWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
    });

    mainWindow.loadFile('index.html');
};

app.whenReady().then(() => {
    app.setName('Big Screen Launcher');
    if (process.defaultApp && process.argv[1]) {
        app.setAsDefaultProtocolClient(MICROSOFT_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
    } else {
        app.setAsDefaultProtocolClient(MICROSOFT_PROTOCOL);
    }
    const initialMicrosoftRedirect = extractMicrosoftRedirect(process.argv);
    if (initialMicrosoftRedirect) handleMicrosoftRedirect(initialMicrosoftRedirect);
    if (process.platform === 'win32') {
        app.setAppUserModelId('Big Screen Launcher');
    }

    createWindow();

    audioWindow = new BrowserWindow({
        width: 179,
        height: 477,
        show: false,
        frame: false,
        resizable: false,
        transparent: true,
        maximizable: false,
        fullscreenable: false,
        title: 'Big Screen Launcher',
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false
        }
    });
    audioWindow.loadFile('background-audio.html');
    audioWindow.on('close', (event) => {
        if (!isQuitting) {
            event.preventDefault();
            audioWindow.hide();
        }
    });

    ipcMain.on('send-audio-command', (event, commandData) => {
        if (audioWindow && !audioWindow.isDestroyed()) {
            audioWindow.webContents.send('receive-audio-command', commandData);
        }
    });

    ipcMain.on('request-audio-status', () => {
        if (audioWindow && !audioWindow.isDestroyed()) {
            audioWindow.webContents.send('request-audio-status');
        }
    });

    ipcMain.on('send-audio-status', (event, statusData) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('receive-audio-status', statusData);
        }
    });

    tray = new Tray(path.join(__dirname, 'assets/app-icon.ico'));

    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Library',
            click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.loadFile('index.html'); }
        },
        {
            label: 'Downloads',
            click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.loadFile('downloads.html'); }
        },
        {
            label: 'Settings',
            click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.loadFile('settings.html'); }
        },
        {
            label: 'Music',
            click: () => { mainWindow.show(); mainWindow.focus(); mainWindow.loadFile('music.html'); }
        },
        { type: 'separator' },
        {
            label: 'Show iPod',
            click: () => { audioWindow.show(); audioWindow.focus(); }
        },
        { type: 'separator' },
        {
            label: 'Quit...',
            click: () => {
                isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('Big Screen Launcher');
    tray.setContextMenu(contextMenu);

    tray.on('click', () => {
        if (mainWindow.isVisible()) mainWindow.hide(); else mainWindow.show();
    });

    app.on('activate', focusMainWindow);

    applySettings();

    // Check for a GitHub release whenever the packaged app starts.
    if (app.isPackaged) {
        autoUpdater.checkForUpdates().catch((error) => {
            console.error('Update check failed:', error);
        });
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        //app.quit();
    }
});

// shortcuts & dialog handlers
ipcMain.handle('dialog:open-emulator-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Emulator Executable', properties: ['openFile'],
        filters: [{ name: 'Executable', extensions: ['exe'] }]
    });
    return canceled ? null : filePaths[0];
});

ipcMain.handle('dialog:open-game-file', async (event, emulator) => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: emulator ? 'Select Game ROM or Disc Image' : 'Select Game Executable',
        properties: ['openFile'],
        filters: emulator ? [{ name: 'Game Files', extensions: ['*'] }] : [{ name: 'Executables & Shortcuts', extensions: ['exe', 'lnk', 'url'] }]
    });

    return canceled ? null : filePaths[0];
});

ipcMain.handle('import-library-json', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Game Library',
        properties: ['openFile'],
        filters: [{ name: 'JSON Library', extensions: ['json'] }]
    });
    if (canceled || !filePaths[0]) return { canceled: true };

    const imported = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
    if (imported?.format !== 'big-screen-launcher-library' || imported?.version !== 1 || !Array.isArray(imported.games)) {
        throw new Error('This file is not a supported Big Screen Launcher library export.');
    }

    const games = fs.existsSync(gamesFilePath) ? JSON.parse(fs.readFileSync(gamesFilePath, 'utf8')) : [];
    if (!Array.isArray(games)) throw new Error('The existing game library is invalid.');

    let added = 0;
    let updated = 0;
    for (const entry of imported.games) {
        if (!entry || typeof entry.title !== 'string' || !entry.title.trim() || typeof entry.executablePath !== 'string' || !entry.executablePath.trim()) continue;
        const artwork = entry.artwork && typeof entry.artwork === 'object' ? entry.artwork : {};
        let defaults = {};
        if (![artwork.gridUrl, artwork.heroUrl, artwork.logoUrl].every(url => typeof url === 'string' && url)) {
            defaults = await fetchDefaultGameArtwork(entry.title.trim());
        }
        const game = {
            name: entry.title.trim(),
            path: entry.executablePath,
            cover: typeof artwork.gridUrl === 'string' && artwork.gridUrl ? artwork.gridUrl : defaults.cover || '',
            hero: typeof artwork.heroUrl === 'string' && artwork.heroUrl ? artwork.heroUrl : defaults.hero || '',
            logo: typeof artwork.logoUrl === 'string' && artwork.logoUrl ? artwork.logoUrl : defaults.logo || '',
            type: 'windows',
            emulator: '',
            playtimeSeconds: Number.isFinite(entry.playtimeSeconds) ? Math.max(0, entry.playtimeSeconds) : 0,
            favorite: Boolean(entry.favorite),
            artworkKind: typeof artwork.kind === 'string' ? artwork.kind : '',
            color: typeof artwork.color === 'string' ? artwork.color : '',
            initials: typeof artwork.initials === 'string' ? artwork.initials : ''
        };
        const existingIndex = games.findIndex(existing => typeof existing.path === 'string' && existing.path.toLowerCase() === game.path.toLowerCase());
        if (existingIndex >= 0) {
            games[existingIndex] = { ...games[existingIndex], ...game };
            updated++;
        } else {
            games.push(game);
            added++;
        }
    }

    fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    return { added, updated };
});

ipcMain.handle('open-external-link', async (event, url) => {
    await shell.openExternal(url);
});

ipcMain.handle('get-documents-path', () => {
    return app.getPath('documents');
});

ipcMain.handle('open-music-dialog', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Audio Files',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Audio Files', extensions: ['mp3', 'wav', 'ogg', 'flac', 'm4a'] }]
    });

    return canceled ? [] : filePaths;
});

ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
});


// ipod
ipcMain.handle('show-ipod-if-enabled', () => {
    if (fs.existsSync(settingsFilePath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
            if (settings.showIpod && audioWindow && !audioWindow.isDestroyed()) {
                audioWindow.show();
            }
        } catch (err) {
            console.error(err);
        }
    }
});


//version
let appVersion = 'ersion unavailable';
try {
    const versionPath = path.join(__dirname, 'appversion.txt');
    appVersion = fs.readFileSync(versionPath, 'utf8').trim();
} catch (err) {
    console.log("Could not read local version file:", err);
}

ipcMain.handle('get-app-version', () => appVersion);



// user data
if (!fs.existsSync(bslDir)) {
    fs.mkdirSync(bslDir, { recursive: true });
}

const gamesDir = path.join(bslDir, 'Games');
if (!fs.existsSync(gamesDir)) {
    fs.mkdirSync(gamesDir, { recursive: true });
}
const gamesFilePath = path.join(gamesDir, '.games.json');

function readSavedGames() {
    if (!fs.existsSync(gamesFilePath)) return [];
    const games = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
    return Array.isArray(games) ? games : [];
}

function updateSavedGame(gamePath, update) {
    const games = readSavedGames();
    const game = games.find(item => typeof item.path === 'string' && item.path.toLowerCase() === gamePath.toLowerCase());
    if (!game) return null;
    update(game);
    fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    return game;
}

async function getPathSizeBytes(targetPath) {
    let stat;
    try { stat = await fs.promises.stat(targetPath); }
    catch { return 0; }
    if (stat.isFile()) return stat.size;
    if (!stat.isDirectory()) return 0;

    let total = 0;
    let entries;
    try { entries = await fs.promises.readdir(targetPath, { withFileTypes: true }); }
    catch { return 0; }
    for (const entry of entries) {
        if (entry.isFile() || entry.isDirectory()) {
            total += await getPathSizeBytes(path.join(targetPath, entry.name));
        }
    }
    return total;
}

ipcMain.handle('get-game-metadata', async (event, gamePath, gameType) => {
    if (typeof gamePath !== 'string') throw new Error('Invalid game path.');
    const game = readSavedGames().find(item => typeof item.path === 'string' && item.path.toLowerCase() === gamePath.toLowerCase());
    let sizePath = fs.existsSync(gamePath) && fs.statSync(gamePath).isDirectory() ? gamePath : path.dirname(gamePath);
    const isEmulatedGame = gameType === 'emu' || game?.type === 'emu';
    if (isEmulatedGame) {
        // Emulated game entries point to the ROM or disc image, so report that file's size.
        sizePath = gamePath;
    }
    return {
        gameSizeBytes: await getPathSizeBytes(sizePath),
        playtimeSeconds: Number.isFinite(game?.playtimeSeconds) ? game.playtimeSeconds : 0,
        lastPlayedAt: game?.lastPlayedAt || null
    };
});

ipcMain.handle('load-games', () => {
    try {
        if (fs.existsSync(gamesFilePath)) {
            const games = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
            if (!Array.isArray(games)) return [];
            let migrated = false;
            for (const game of games) {
                if (game.type?.toLowerCase() === 'minecraft' || game.name?.toLowerCase() === 'minecraft') {
                    if (game.path !== minecraftLibraryPath || game.type !== 'minecraft') {
                        game.path = minecraftLibraryPath;
                        game.type = 'minecraft';
                        migrated = true;
                    }
                }
            }
            if (migrated) fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
            return games;
        }
    } catch (err) {
        console.error("Could not load games file:", err);
    }
    return [];
});

ipcMain.handle('save-games', (event, gamesArray) => {
    try {
        if (Array.isArray(gamesArray)) {
            for (const game of gamesArray) {
                if (game.type?.toLowerCase() === 'minecraft' || game.name?.toLowerCase() === 'minecraft') {
                    game.path = minecraftLibraryPath;
                    game.type = 'minecraft';
                }
            }
        }
        fs.writeFileSync(gamesFilePath, JSON.stringify(gamesArray, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error("Could not save games file:", err);
        return false;
    }
});



ipcMain.handle('load-settings', () => {
    try {
        if (fs.existsSync(settingsFilePath)) {
            return JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
        }
    } catch (err) {
        console.error("Could not load settings:", err);
    }
    return {};
});

ipcMain.handle('save-settings', (event, settingsData) => {
    try {
        if (!fs.existsSync(bslDir)) {
            fs.mkdirSync(bslDir, { recursive: true });
        }
        fs.writeFileSync(settingsFilePath, JSON.stringify(settingsData, null, 2), 'utf8');
        applySettings();
        return true;
    } catch (err) {
        console.error("Could not save settings:", err);
        return false;
    }
});

// get the arts
const WORKER_URL = 'https://api-art-proxy.nicholasavery2.workers.dev';

async function getGameId(gameName) {
    try {
        const res = await net.fetch(`${WORKER_URL}/?endpoint=search/autocomplete/${encodeURIComponent(gameName)}`);
        const data = await res.json();
        return data.data?.[0]?.id || null;
    } catch (err) {
        console.error("Proxy Search error:", err);
        return null;
    }
}

async function fetchArtworkEndpoint(gameName, endpoint) {
    const gameId = await getGameId(gameName);
    if (!gameId) return null;
    try {
        const res = await net.fetch(`${WORKER_URL}/?endpoint=${endpoint}/game/${gameId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return data.data?.[0]?.url || null;
    } catch (err) {
        console.error(`Artwork request failed (${endpoint}):`, err);
        return null;
    }
}

async function fetchGameArt(gameName) { return fetchArtworkEndpoint(gameName, 'grids'); }
async function fetchGameHero(gameName) { return fetchArtworkEndpoint(gameName, 'heroes'); }
async function fetchGameLogo(gameName) { return fetchArtworkEndpoint(gameName, 'logos'); }

async function fetchDefaultGameArtwork(gameName) {
    const gameId = await getGameId(gameName);
    if (!gameId) return {};
    const fetchFirst = async endpoint => {
        try {
            const res = await net.fetch(`${WORKER_URL}/?endpoint=${endpoint}/game/${gameId}`);
            if (!res.ok) return null;
            const data = await res.json();
            return data.data?.[0]?.url || null;
        } catch (err) {
            console.error(`Artwork request failed (${endpoint}):`, err);
            return null;
        }
    };
    const [cover, hero, logo] = await Promise.all([
        fetchFirst('grids'), fetchFirst('heroes'), fetchFirst('logos')
    ]);
    return { cover, hero, logo };
}

ipcMain.handle('fetch-game-art', async (event, gameName) => fetchGameArt(gameName));
ipcMain.handle('fetch-game-hero', async (event, gameName) => fetchGameHero(gameName));
ipcMain.handle('fetch-game-logo', async (event, gameName) => fetchGameLogo(gameName));
ipcMain.handle('fetch-default-game-artwork', async (event, gameName) => fetchDefaultGameArtwork(gameName));



ipcMain.handle('fetch-game-art-options', async (event, gameName) => {
    const gameId = await getGameId(gameName);
    const result = {};
    await Promise.all(Object.entries({cover: 'grids', hero: 'heroes', logo: 'logos'}).map(async ([key, endpoint]) => {
        try {
            if (!gameId) { result[key] = []; return; }
            const res = await net.fetch(WORKER_URL + '/?endpoint=' + endpoint + '/game/' + gameId);
            if (!res.ok) throw new Error('Artwork request failed: ' + res.status);
            const data = await res.json();
            if (!Array.isArray(data.data)) throw new Error('Invalid artwork response.');
            result[key] = data.data.filter(item => typeof item.url === 'string').map(item => ({url: item.url, thumb: item.thumb || item.url}));
        } catch (error) {
            console.error('Artwork options error:', error);
            result[key] = null;
        }
    }));
    return result;
});

ipcMain.handle('set-game-art', (event, gamePath, key, url, onlyIfMissing = false) => {
    if (!['cover', 'hero', 'logo'].includes(key) || typeof url !== 'string' || !url.startsWith('https://')) {
        throw new Error('Invalid artwork selection.');
    }
    const games = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
    const game = games.find(item => item.path === gamePath);
    if (!game) throw new Error('Game no longer exists in the library.');
    if (!onlyIfMissing || !game[key]) {
        game[key] = url;
        fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    }
    return game[key];
});

// clear game list cache
ipcMain.handle('clear-games-cache', async () => {
    try {
        await session.defaultSession.clearCache();
        await session.defaultSession.clearStorageData({
            storages: ['shadercache', 'serviceworkers', 'indexdb']
        });
        return true;
    } catch (err) {
        console.error("Failed to clear caches:", err);
        return false;
    }
});



// remove games
ipcMain.handle('remove-game', async (event, index) => {
    try {
        let savedGames = [];
        if (fs.existsSync(gamesFilePath)) {
            savedGames = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
        }
        savedGames.splice(index, 1);
        fs.writeFileSync(gamesFilePath, JSON.stringify(savedGames, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error("Could not remove game:", err);
        return false;
    }
});

const { parseFile } = require('music-metadata');
ipcMain.handle('extract-mp3-metadata', async (event, filePath) => {
    try {
        const metadata = await parseFile(filePath);
        const common = metadata.common;
        
        let coverUrl = null;
        if (common.picture && common.picture.length > 0) {
            const picture = common.picture[0];
            const base64Data = Buffer.from(picture.data).toString('base64');
            coverUrl = `data:${picture.format};base64,${base64Data}`;
        }

        let artistName = common.artist;
        if (!artistName && common.artists && common.artists.length > 0) {
            artistName = common.artists.join(', ');
        }

        return {
            title: common.title || null,
            artist: artistName || null,
            duration: metadata.format.duration || 0,
            cover: coverUrl
        };
    } catch (err) {
        console.error("Failed to parse MP3 metadata:", err);
        return null;
    }
});

function hasIpcHandler(channel) {
  return ipcMain._invokeHandlers instanceof Map && ipcMain._invokeHandlers.has(channel);
}


// download da shyt

const axios = require('axios');
const https = require('https');
const http = require('http');
const AdmZip = require('adm-zip');
const unrar = require('node-unrar-js');
const { settings } = require('cluster');

let downloadQueue = [];
let activeDownloadJob = null;
let activeDownloadController = null;
let downloadQueueRunning = false;

// processes
const activeProcesses = new Map()
const gamePlaySessions = new Map();

function finishGamePlaySession(gamePath) {
    const session = gamePlaySessions.get(gamePath);
    if (!session) return;
    gamePlaySessions.delete(gamePath);
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - session.startedAt) / 1000));
    const game = updateSavedGame(session.gamePath, saved => {
        saved.playtimeSeconds = (Number.isFinite(saved.playtimeSeconds) ? saved.playtimeSeconds : 0) + elapsedSeconds;
    });
    if (game) {
        const metadata = {
            gameSizeBytes: null,
            playtimeSeconds: game.playtimeSeconds,
            lastPlayedAt: game.lastPlayedAt || null
        };
        BrowserWindow.getAllWindows().forEach(win => win.webContents.send('game-metadata-update', { gamePath: session.gamePath, metadata }));
    }
}

// Split launch options without invoking a shell; preserve Windows path separators.
function parseLaunchOptions(value = '') {
    if (typeof value !== 'string') throw new Error('Launch options must be text.');
    const args = [];
    let current = '', quote = null, started = false;
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        if (char === '\\' && (value[i + 1] === '"' || value[i + 1] === "'")) {
            current += value[++i]; started = true;
        } else if (quote) {
            if (char === quote) quote = null;
            else current += char;
        } else if (char === '"' || char === "'") {
            quote = char; started = true;
        } else if (/\s/.test(char)) {
            if (started) { args.push(current); current = ''; started = false; }
        } else { current += char; started = true; }
    }
    if (quote) throw new Error('Launch options contain an unclosed quote.');
    if (started) args.push(current);
    return args;
}

function matchesMinecraftRules(rules) {
    if (!Array.isArray(rules) || rules.length === 0) return true;
    let allowed = false;
    for (const rule of rules) {
        const os = rule.os || {};
        if (os.name && os.name !== 'windows') continue;
        if (os.arch && !new RegExp(os.arch).test(process.arch)) continue;
        if (os.version && !new RegExp(os.version).test(require('os').release())) continue;
        const enabledFeatures = { has_custom_resolution: false, is_demo_user: false, has_quick_plays_support: false };
        if (rule.features && Object.entries(rule.features).some(([key, value]) => Boolean(enabledFeatures[key]) !== Boolean(value))) continue;
        allowed = rule.action === 'allow';
    }
    return allowed;
}

function getMinecraftArgumentValues(value, variables) {
    const values = Array.isArray(value) ? value : [value];
    return values.filter(item => typeof item === 'string').map(item => item.replace(/\$\{([^}]+)\}/g, (_match, key) => variables[key] ?? ''));
}

function extractMinecraftNatives(library, versionFolder, nativesDirectory) {
    if (!matchesMinecraftRules(library.rules)) return;
    const classifierName = library.natives?.windows?.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
    const classifier = classifierName && library.downloads?.classifiers?.[classifierName];
    if (!classifier?.path) return;
    const nativeJar = path.resolve(versionFolder, 'libraries', classifier.path);
    if (!fs.existsSync(nativeJar)) return;
    const excluded = library.extract?.exclude || [];
    const archive = new AdmZip(nativeJar);
    for (const entry of archive.getEntries()) {
        if (entry.isDirectory || excluded.some(prefix => entry.entryName.startsWith(prefix))) continue;
        const destination = path.resolve(nativesDirectory, entry.entryName);
        if (!destination.startsWith(nativesDirectory + path.sep)) continue;
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, entry.getData());
    }
}

function findJavaCandidates() {
    const candidates = [];
    if (process.env.JAVA_HOME) candidates.push(path.join(process.env.JAVA_HOME, 'bin', 'java.exe'));
    const runtimeRoot = path.join(app.getPath('appData'), '.minecraft', 'runtime');
    const scan = (folder, depth = 0) => {
        if (depth > 6 || !fs.existsSync(folder)) return;
        let entries;
        try { entries = fs.readdirSync(folder, { withFileTypes: true }); } catch { return; }
        for (const entry of entries) {
            const entryPath = path.join(folder, entry.name);
            if (entry.isDirectory()) scan(entryPath, depth + 1);
            else if (entry.isFile() && entry.name.toLowerCase() === 'java.exe') candidates.push(entryPath);
        }
    };
    scan(runtimeRoot);
    candidates.push('java');
    return [...new Set(candidates)];
}

function resolveJavaExecutable(requiredMajor) {
    const found = [];
    for (const javaPath of findJavaCandidates()) {
        const result = spawnSync(javaPath, ['-version'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
        const output = `${result.stdout || ''}\n${result.stderr || ''}`;
        const match = output.match(/version\s+"(?:1\.)?(\d+)/i) || output.match(/openjdk\s+(\d+)/i);
        if (!match) continue;
        const major = Number(match[1]);
        found.push(`${javaPath} (Java ${major})`);
        if (major >= requiredMajor) {
            const javawPath = path.join(path.dirname(javaPath), 'javaw.exe');
            return fs.existsSync(javawPath) ? javawPath : javaPath;
        }
    }
    throw new Error(`Minecraft requires Java ${requiredMajor} or newer. ${found.length ? `Found: ${found.join(', ')}.` : 'Install a compatible Java runtime or install one with the official Minecraft Launcher.'}`);
}

async function prepareMinecraftLaunch(game) {
    const minecraftSession = await getMinecraftSession();
    const versionId = game.selectedMinecraftVersion || game.version;
    if (!versionId || !/^[A-Za-z0-9._-]+$/.test(versionId)) throw new Error('Choose a Minecraft installation first.');
    const priorGamePath = game.path;
    game.path = minecraftLibraryPath;
    if (typeof priorGamePath === 'string' && priorGamePath !== minecraftLibraryPath) {
        updateSavedGame(priorGamePath, saved => { saved.path = minecraftLibraryPath; });
    }
    const versionFolder = path.join(minecraftLibraryPath, versionId);
    const metadataPath = path.join(versionFolder, `${versionId}.json`);
    const clientJar = path.join(versionFolder, `${versionId}.jar`);
    if (!fs.existsSync(path.join(versionFolder, '.installed')) || !fs.existsSync(metadataPath) || !fs.existsSync(clientJar)) {
        throw new Error(`Minecraft ${versionId} is not fully installed. Use the version dropdown to install it first.`);
    }
    const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    const javaPath = resolveJavaExecutable(metadata.javaVersion?.majorVersion || 8);
    const nativesDirectory = path.join(versionFolder, 'natives');
    fs.mkdirSync(nativesDirectory, { recursive: true });

    const classpathEntries = [clientJar];
    for (const library of metadata.libraries || []) {
        if (!matchesMinecraftRules(library.rules)) continue;
        const artifact = library.downloads?.artifact;
        if (artifact?.path) {
            const artifactPath = path.resolve(versionFolder, 'libraries', artifact.path);
            if (!artifactPath.startsWith(path.resolve(versionFolder, 'libraries') + path.sep)) throw new Error('Minecraft metadata contains an invalid library path.');
            if (!fs.existsSync(artifactPath)) throw new Error(`A Minecraft library is missing: ${artifact.path}`);
            classpathEntries.push(artifactPath);
        }
        extractMinecraftNatives(library, versionFolder, nativesDirectory);
    }

    const username = minecraftSession.profile.minecraftName;
    const minecraftUuid = String(minecraftSession.profile.minecraftUuid || '').replace(/-/g, '');
    if (!username || !/^[a-f0-9]{32}$/i.test(minecraftUuid)) throw new Error('The signed-in Microsoft account has no valid Minecraft Java profile.');
    const assetIndex = metadata.assetIndex || {};
    const loggingFile = metadata.logging?.client?.file;
    const variables = {
        auth_player_name: username,
        version_name: versionId,
        game_directory: game.path,
        assets_root: path.join(versionFolder, 'assets'),
        assets_index_name: assetIndex.id || '',
        auth_uuid: minecraftUuid,
        auth_access_token: minecraftSession.accessToken,
        user_type: 'msa',
        version_type: metadata.type || 'release',
        user_properties: '{}',
        clientid: MICROSOFT_CLIENT_ID,
        auth_xuid: minecraftSession.profile.xuid || '',
        natives_directory: nativesDirectory,
        library_directory: path.join(versionFolder, 'libraries'),
        classpath: classpathEntries.join(path.delimiter),
        classpath_separator: path.delimiter,
        launcher_name: 'Big Screen Launcher',
        launcher_version: app.getVersion(),
        resolution_width: '1280',
        resolution_height: '720',
        path: loggingFile ? path.join(versionFolder, 'assets', 'log_configs', loggingFile.id || 'client.xml') : ''
    };

    let jvmArgs = [];
    if (Array.isArray(metadata.arguments?.jvm)) {
        for (const argument of metadata.arguments.jvm) {
            if (typeof argument === 'string') jvmArgs.push(...getMinecraftArgumentValues(argument, variables));
            else if (argument && matchesMinecraftRules(argument.rules)) jvmArgs.push(...getMinecraftArgumentValues(argument.value, variables));
        }
    } else {
        jvmArgs = [`-Djava.library.path=${nativesDirectory}`, '-cp', variables.classpath];
    }
    if (metadata.logging?.client?.argument) {
        jvmArgs.push(...getMinecraftArgumentValues(metadata.logging.client.argument, variables));
    }
    if (!jvmArgs.includes('-cp') && !jvmArgs.includes('-classpath')) jvmArgs.push('-cp', variables.classpath);
    if (!jvmArgs.some(argument => argument.startsWith('-Djava.library.path='))) jvmArgs.push(`-Djava.library.path=${nativesDirectory}`);

    let gameArgs = [];
    if (Array.isArray(metadata.arguments?.game)) {
        for (const argument of metadata.arguments.game) {
            if (typeof argument === 'string') gameArgs.push(...getMinecraftArgumentValues(argument, variables));
            else if (argument && matchesMinecraftRules(argument.rules)) gameArgs.push(...getMinecraftArgumentValues(argument.value, variables));
        }
    } else if (metadata.minecraftArguments) {
        gameArgs = getMinecraftArgumentValues(parseLaunchOptions(metadata.minecraftArguments), variables);
    }

    const launchArgs = [...jvmArgs, metadata.mainClass, ...gameArgs];
    return { javaPath, launchArgs, workingDirectory: game.path, processKey: game.path };
}

ipcMain.handle('save-game-launch-options', (event, gamePath, value) => {
    if (typeof value !== 'string') throw new Error('Launch options must be text.');
    const games = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
    const game = games.find(item => item.path === gamePath);
    if (!game) throw new Error('Game no longer exists in the library.');
    game.launchOptions = value;
    fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    return true;
});

ipcMain.handle('launch-game-process', async (event, game) => {
    if (!game) {
        throw new Error('No game payload provided to launch-game-process.');
    }

    let exePath = '';
    let launchPath = '';
    let launchArgs = [];
    let processKey = '';
    if (game.type === 'minecraft') {
        const minecraftLaunch = await prepareMinecraftLaunch(game);
        launchPath = minecraftLaunch.javaPath;
        launchArgs = minecraftLaunch.launchArgs;
        processKey = minecraftLaunch.processKey;
    } else {
        if (game.path && typeof game.path === 'string' && fs.existsSync(game.path) && fs.statSync(game.path).isFile()) {
            exePath = game.path;
        } else {
            const gameName = (game.name || game.title || '').trim();
            if (!gameName) throw new Error('Game name is required but was undefined or empty.');
            const gameFolder = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games', gameName);
            const exeName = (game.exe || '').trim();
            if (exeName && fs.existsSync(path.join(gameFolder, exeName))) {
                exePath = path.join(gameFolder, exeName);
            } else {
                console.warn(`Saved exe "${exeName}" not found. Scanning ${gameFolder} for real executable...`);
                const detectedExe = findExecutableInFolder(gameFolder, gameName);
                exePath = path.join(gameFolder, detectedExe);
                saveGameToLibrary({ ...game, name: gameName, exe: detectedExe, path: exePath });
            }
        }
        if (!fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) throw new Error(`Executable file not found at: ${exePath}`);
        game.path = exePath;
        launchPath = exePath;
        processKey = exePath;
        if (game.type === 'emu') {
            const flags = { xenia: [], dolphin: ['-e'], cemu: ['-g'], ryujinx: [], yuzu: [], rpcs3: [], shadps4: ['-g'] };
            if (!Object.hasOwn(flags, game.emulator)) throw new Error('Choose a supported emulator for this game.');
            const savedSettings = fs.existsSync(settingsFilePath) ? JSON.parse(fs.readFileSync(settingsFilePath, 'utf8')) : {};
            launchPath = (savedSettings[game.emulator + 'DirInput'] || '').trim();
            if (!launchPath || !fs.existsSync(launchPath) || !fs.statSync(launchPath).isFile()) {
                throw new Error('Locate the ' + game.emulator + ' executable in Settings first.');
            }
            launchArgs = [...flags[game.emulator], exePath];
        }
        launchArgs.push(...parseLaunchOptions(game.launchOptions || ''));
    }

    if (activeProcesses.has(processKey)) {
        console.log("Game is already running.");
        return { success: true };
    }

    try {
        // Broadcast 'starting' globally
        broadcastStatus(processKey, 'starting');

        const child = spawn(launchPath, launchArgs, { 
            detached: true, 
            stdio: 'ignore',
            cwd: game.type === 'minecraft' ? game.path : path.dirname(launchPath)
        });
        
        child.on('error', error => {
            activeProcesses.delete(processKey);
            finishGamePlaySession(processKey);
            broadcastStatus(processKey, 'stopped');
            dialog.showErrorBox('Could not launch game', error.message);
        });
        child.unref();
        activeProcesses.set(processKey, child);

        child.once('spawn', () => {
            const startedAt = Date.now();
            const gamePath = game.path || exePath;
            gamePlaySessions.set(processKey, { gamePath, startedAt });
            const updatedGame = updateSavedGame(gamePath, saved => {
                saved.lastPlayedAt = new Date(startedAt).toISOString();
            });
            if (updatedGame) {
                const metadata = {
                    gameSizeBytes: null,
                    playtimeSeconds: Number.isFinite(updatedGame.playtimeSeconds) ? updatedGame.playtimeSeconds : 0,
                    lastPlayedAt: updatedGame.lastPlayedAt
                };
                BrowserWindow.getAllWindows().forEach(win => win.webContents.send('game-metadata-update', { gamePath, metadata }));
            }
        });

        // Broadcast 'running' globally
        broadcastStatus(processKey, 'running');

        // Listen for when the game process closes
        child.on('exit', () => {
            activeProcesses.delete(processKey);
            finishGamePlaySession(processKey);
            // Broadcast 'stopped' globally so the UI instantly updates!
            broadcastStatus(processKey, 'stopped');
        });

    } catch (error) {
        activeProcesses.delete(processKey);
        finishGamePlaySession(processKey);
        broadcastStatus(processKey, 'stopped');
        throw new Error(`Failed to launch process: ${error.message}`);
    }

    return { success: true };
});

// stop
ipcMain.handle('stop-game-process', async (event, game) => {
    const targetPath = game.path;
    const child = activeProcesses.get(targetPath);
    
    if (child) {
        child.kill();
    }
});

function broadcastStatus(gamePath, status) {
    // console.log(`Broadcasting status: ${status} for ${gamePath}`);
    BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('game-status-update', { path: gamePath, status });
    });
}

ipcMain.handle('get-game-status', async (event, gamePath) => {
    return activeProcesses.has(gamePath) ? 'running' : 'stopped';
});


// smart search
const HELPER_EXE_PATTERNS = [
    /unitycrashhandler/i,
    /crashpad/i,
    /crashreport/i,
    /unins\d*/i,
    /uninstall/i,
    /setup/i,
    /vcredist/i,
    /dxsetup/i,
    /dotnet/i,
    /prereq/i,
    /dependencies/i,
    /config/i,
    /updater/i
];

function findExecutableInFolder(folderPath, gameName) {
    function getExecutables(dir, depth = 0) {
        if (depth > 2) return [];
        let results = [];

        try {
            const items = fs.readdirSync(dir);
            for (const item of items) {
                const fullPath = path.join(dir, item);
                const stat = fs.statSync(fullPath);

                if (stat.isDirectory()) {
                    const lowerDir = item.toLowerCase();
                    if (!['mono', 'engine', 'redist', 'support', 'directx'].includes(lowerDir)) {
                        results = results.concat(getExecutables(fullPath, depth + 1));
                    }
                } else if (item.toLowerCase().endsWith('.exe')) {
                    results.push(path.relative(folderPath, fullPath));
                }
            }
        } catch (err) {
            console.error('Error scanning folder for exes:', err);
        }
        return results;
    }

    const allExes = getExecutables(folderPath);
    if (allExes.length === 0) return `${gameName}.exe`;

    const validExes = allExes.filter(exeRelPath => {
        const fileName = path.basename(exeRelPath);
        return !HELPER_EXE_PATTERNS.some(pattern => pattern.test(fileName));
    });

    const candidates = validExes.length > 0 ? validExes : allExes;

    if (candidates.length === 1) {
        return candidates[0];
    }

    const cleanStr = str => str.toLowerCase().replace(/[^a-z0-9]/g, '');
    const targetName = cleanStr(gameName);

    let bestExe = candidates[0];
    let highestScore = -1;

    for (const exeRelPath of candidates) {
        const exeBaseName = path.basename(exeRelPath, '.exe');
        const cleanExe = cleanStr(exeBaseName);

        let score = 0;

        if (cleanExe === targetName) {
            score = 100;
        } 
        else if (targetName.includes(cleanExe) && cleanExe.length > 2) {
            score = 50 + (cleanExe.length / targetName.length) * 30;
        } else if (cleanExe.includes(targetName) && targetName.length > 2) {
            score = 40 + (targetName.length / cleanExe.length) * 30;
        } else {
            const exeWords = exeBaseName.toLowerCase().split(/[^a-z0-9]+/);
            const targetWords = gameName.toLowerCase().split(/[^a-z0-9]+/);
            const matchingWords = exeWords.filter(w => w.length > 2 && targetWords.includes(w));
            
            if (matchingWords.length > 0) {
                score = 20 + (matchingWords.length * 10);
            }
        }

        if (!exeRelPath.includes(path.sep)) {
            score += 5;
        }

        if (score > highestScore) {
            highestScore = score;
            bestExe = exeRelPath;
        }
    }

    return bestExe;
}

function flattenIfSingleSubfolder(folderPath) {
    const items = fs.readdirSync(folderPath);
    if (items.length === 1) {
        const subPath = path.join(folderPath, items[0]);
        if (fs.statSync(subPath).isDirectory()) {
            const subItems = fs.readdirSync(subPath);
            subItems.forEach(item => {
                fs.renameSync(path.join(subPath, item), path.join(folderPath, item));
            });
            fs.rmdirSync(subPath);
        }
    }
}

async function extractArchive(archivePath, destFolder) {
    const fileBuffer = fs.readFileSync(archivePath);
    const headerHex = fileBuffer.subarray(0, 7).toString('hex');

    if (headerHex.startsWith('52617221')) {
        const extractor = await unrar.createExtractorFromData({ data: fileBuffer });
        const extracted = extractor.extract({ files: () => true });

        for (const fileData of extracted.files) {
            const relativePath = fileData.fileHeader.name;
            const fullPath = path.join(destFolder, relativePath);

            if (fileData.fileHeader.flags.directory) {
                fs.mkdirSync(fullPath, { recursive: true });
            } else if (fileData.extraction) {
                fs.mkdirSync(path.dirname(fullPath), { recursive: true });
                fs.writeFileSync(fullPath, Buffer.from(fileData.extraction));
            }
        }
    } else {
        const zip = new AdmZip(archivePath);
        zip.extractAllTo(destFolder, true);
    }
}

function getDownloadState() {
    return {
        active: activeDownloadJob ? {
            id: activeDownloadJob.id,
            type: activeDownloadJob.type,
            title: activeDownloadJob.title,
            progress: activeDownloadJob.progress || null
        } : null,
        queue: downloadQueue.map(job => ({ id: job.id, type: job.type, title: job.title, size: job.payload?.size || '' }))
    };
}

function broadcastDownloadState() {
    const state = getDownloadState();
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.send('download-state', state);
    });
}

function reportDownloadProgress(job, details) {
    job.progress = { ...details, type: job.type, title: job.title };
    BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) {
            win.webContents.send('download-progress', job.progress);
            if (job.type === 'minecraft' && details.completed !== undefined) {
                win.webContents.send('minecraft-install-progress', { version: job.version, completed: details.completed, total: details.total });
            }
        }
    });
}

async function performGameDownload(payload, job, signal) {
    let zipPath = '';
    try {
        const { gameName, downloadUrl, exeName, version, cover } = payload;
        if (!downloadUrl) throw new Error('No download URL provided.');

        const gameFolder = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games', gameName);
        fs.mkdirSync(gameFolder, { recursive: true });
        zipPath = path.join(gameFolder, 'download_temp.zip');

        const response = await net.fetch(downloadUrl, { signal });
        if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
        const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
        let transferredBytes = 0;
        const startTime = Date.now();
        const reader = response.body.getReader();
        const fileStream = fs.createWriteStream(zipPath);
        const waitForDrain = () => new Promise((resolve, reject) => {
            const onDrain = () => { cleanup(); resolve(); };
            const onError = error => { cleanup(); reject(error); };
            const onAbort = () => { cleanup(); reject(new Error('Download cancelled.')); };
            const cleanup = () => {
                fileStream.removeListener('drain', onDrain);
                fileStream.removeListener('error', onError);
                signal.removeEventListener('abort', onAbort);
            };
            fileStream.once('drain', onDrain);
            fileStream.once('error', onError);
            signal.addEventListener('abort', onAbort, { once: true });
        });
        try {
            while (true) {
                if (signal.aborted) throw new Error('Download cancelled.');
                const { done, value } = await reader.read();
                if (done) break;
                transferredBytes += value.length;
                if (!fileStream.write(Buffer.from(value))) await waitForDrain();

                const percent = totalBytes ? Math.min(100, (transferredBytes / totalBytes) * 100) : 0;
                const transferredMB = (transferredBytes / (1024 * 1024)).toFixed(1);
                const totalMB = totalBytes ? (totalBytes / (1024 * 1024)).toFixed(1) : '?';
                const elapsedSec = Math.max(0.1, (Date.now() - startTime) / 1000);
                const remainingSec = totalBytes ? Math.ceil((totalBytes - transferredBytes) / (transferredBytes / elapsedSec || 1)) : 0;
                reportDownloadProgress(job, {
                    status: 'downloading', percent, transferredMB, totalMB,
                    etaStr: totalBytes ? `${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s left` : 'Downloading…'
                });
            }
            await new Promise((resolve, reject) => {
                const cleanup = () => {
                    fileStream.removeListener('error', onError);
                    fileStream.removeListener('finish', onFinish);
                    signal.removeEventListener('abort', onAbort);
                };
                const onError = error => { cleanup(); reject(error); };
                const onFinish = () => { cleanup(); resolve(); };
                const onAbort = () => { fileStream.destroy(); cleanup(); reject(new Error('Download cancelled.')); };
                fileStream.once('error', onError);
                fileStream.once('finish', onFinish);
                signal.addEventListener('abort', onAbort, { once: true });
                fileStream.end();
            });
        } catch (error) {
            reader.cancel().catch(() => {});
            fileStream.destroy();
            if (!fileStream.closed) await new Promise(resolve => fileStream.once('close', resolve));
            throw error;
        }

        if (signal.aborted) throw new Error('Download cancelled.');
        reportDownloadProgress(job, { status: 'downloading', percent: 100, transferredMB: '', totalMB: '', etaStr: 'Extracting game files…' });
        await extractArchive(zipPath, gameFolder);
        if (signal.aborted) throw new Error('Download cancelled.');
        if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        flattenIfSingleSubfolder(gameFolder);

        let finalExeName = exeName || findExecutableInFolder(gameFolder, gameName);
        reportDownloadProgress(job, { status: 'downloading', percent: 100, transferredMB: '', totalMB: '', etaStr: 'Fetching game artwork…' });
        let gameCover = cover || 'images/images.jpg';
        let gameHero = null;
        let gameLogo = null;
        try {
            const fetchedArtwork = await fetchDefaultGameArtwork(gameName);
            if (fetchedArtwork.cover) gameCover = fetchedArtwork.cover;
            gameHero = fetchedArtwork.hero;
            gameLogo = fetchedArtwork.logo;
        } catch (artErr) {
            console.error('Failed to fetch artwork automatically:', artErr);
        }

        saveGameToLibrary({ name: gameName, version: version || '1.0.0', cover: gameCover, hero: gameHero, logo: gameLogo, exe: finalExeName, path: path.join(gameFolder, finalExeName) });
    } catch (error) {
        console.error('Download failed:', error);
        if (zipPath && fs.existsSync(zipPath)) fs.unlinkSync(zipPath);
        const errStr = error.message || '';
        if (!signal.aborted && (errStr.includes('TLS') || errStr.includes('socket disconnected') || errStr.includes('ECONNRESET') || errStr.includes('CERT') || errStr.includes('net::'))) {
            throw new Error('Fatal error with TLS handshake, downloads cannot be reached at this time!');
        }
        throw error;
    }
}

async function runDownloadQueue() {
    if (downloadQueueRunning) return;
    downloadQueueRunning = true;
    while (downloadQueue.length) {
        const job = downloadQueue.shift();
        activeDownloadJob = job;
        activeDownloadController = new AbortController();
        broadcastDownloadState();
        try {
            reportDownloadProgress(job, { status: 'downloading', percent: 0, transferredMB: '0.0', totalMB: '?', etaStr: 'Connecting…' });
            if (job.type === 'minecraft') {
                await performMinecraftInstall(job.version, (progress) => reportDownloadProgress(job, progress), activeDownloadController.signal);
            } else {
                await performGameDownload(job.payload, job, activeDownloadController.signal);
            }
            reportDownloadProgress(job, { status: 'completed', percent: 100 });
        } catch (error) {
            const cancelled = activeDownloadController.signal.aborted;
            reportDownloadProgress(job, { status: cancelled ? 'cancelled' : 'failed', percent: job.progress?.percent || 0, error: error.message });
            if (!cancelled) console.error(`Download job failed (${job.title}):`, error);
        } finally {
            activeDownloadJob = null;
            activeDownloadController = null;
            broadcastDownloadState();
        }
    }
    downloadQueueRunning = false;
    broadcastDownloadState();
}

function enqueueDownload(job) {
    job.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    job.progress = null;
    const queued = !!activeDownloadJob || downloadQueue.length > 0;
    downloadQueue.push(job);
    broadcastDownloadState();
    runDownloadQueue();
    return { id: job.id, queued };
}

ipcMain.handle('queue-download', (_event, payload) => {
    if (!payload || typeof payload.gameName !== 'string' || typeof payload.downloadUrl !== 'string') throw new Error('Invalid game download request.');
    return enqueueDownload({ type: 'game', title: payload.gameName, payload });
});

ipcMain.handle('queue-minecraft-install', (_event, versionId) => {
    if (typeof versionId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(versionId)) throw new Error('Invalid Minecraft version.');
    if (listMinecraftVersions().includes(versionId)) throw new Error(`Minecraft ${versionId} is already installed.`);
    if (activeDownloadJob?.type === 'minecraft' && activeDownloadJob.version === versionId) throw new Error(`Minecraft ${versionId} is already downloading.`);
    if (downloadQueue.some(job => job.type === 'minecraft' && job.version === versionId)) throw new Error(`Minecraft ${versionId} is already queued.`);
    return enqueueDownload({ type: 'minecraft', title: `Minecraft ${versionId}`, version: versionId });
});

ipcMain.handle('get-download-state', () => getDownloadState());

ipcMain.handle('remove-download-from-queue', (_event, jobId) => {
    const index = downloadQueue.findIndex(job => job.id === jobId);
    if (index === -1) return false;
    downloadQueue.splice(index, 1);
    broadcastDownloadState();
    return true;
});

ipcMain.handle('stop-download', async () => {
    if (!activeDownloadController) return false;
    activeDownloadController.abort();
    return true;
});



// saving the games
function saveGameToLibrary(newGameRecord) {
    const libraryPath = path.join(
        app.getPath('documents'),
        'Big Screen Launcher',
        'Games',
        '.games.json'
    );

    let library = [];

    if (fs.existsSync(libraryPath)) {
        try {
            const raw = fs.readFileSync(libraryPath, 'utf8');
            const parsed = JSON.parse(raw);
            library = Array.isArray(parsed) ? parsed : (parsed.games || []);
        } catch (err) {
            console.error("Error parsing existing .games.json:", err);
        }
    }

    const index = library.findIndex(g => 
        (g.name || g.title || "").toLowerCase() === newGameRecord.name.toLowerCase()
    );

    if (index !== -1) {
        library[index] = { ...library[index], ...newGameRecord };
    } else {
        library.push(newGameRecord);
    }

    fs.mkdirSync(path.dirname(libraryPath), { recursive: true });
    fs.writeFileSync(libraryPath, JSON.stringify(library, null, 2), 'utf8');
}

const minecraftLibraryPath = path.join(gamesDir, 'Minecraft');

function listMinecraftVersions() {
    if (!fs.existsSync(minecraftLibraryPath)) return [];
    return fs.readdirSync(minecraftLibraryPath, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .filter(version => fs.existsSync(path.join(minecraftLibraryPath, version, `${version}.json`))
            && fs.existsSync(path.join(minecraftLibraryPath, version, `${version}.jar`))
            && fs.existsSync(path.join(minecraftLibraryPath, version, '.installed')))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

ipcMain.handle('get-minecraft-versions', () => listMinecraftVersions());
ipcMain.handle('get-available-minecraft-versions', async () => {
    const response = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json');
    if (!response.ok) throw new Error(`Could not load Minecraft version list (HTTP ${response.status}).`);
    const manifest = await response.json();
    return manifest.versions
        .filter(version => version.type === 'release')
        .map(({ id, url, type }) => ({ id, url, type }));
});

ipcMain.handle('add-minecraft-library', async () => {
    fs.mkdirSync(minecraftLibraryPath, { recursive: true });
    const games = readSavedGames();
    const existing = games.find(game => game.type === 'minecraft' || game.name?.toLowerCase() === 'minecraft');
    if (!existing) {
        let artwork = {};
        try { artwork = await fetchDefaultGameArtwork('Minecraft'); } catch (error) { console.warn('Could not load Minecraft artwork:', error); }
        saveGameToLibrary({
            name: 'Minecraft',
            path: minecraftLibraryPath,
            type: 'minecraft',
            cover: artwork.cover || '',
            hero: artwork.hero || '',
            logo: artwork.logo || '',
            version: listMinecraftVersions()[0] || ''
        });
    } else if (existing.path !== minecraftLibraryPath || existing.type !== 'minecraft') {
        existing.path = minecraftLibraryPath;
        existing.type = 'minecraft';
        fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    }
    return { versions: listMinecraftVersions() };
});

async function downloadMinecraftFile(url, destination, expectedSha1, signal) {
    if (typeof url !== 'string' || !url.startsWith('https://')) throw new Error('Minecraft provided an invalid download URL.');
    if (fs.existsSync(destination)) {
        if (!expectedSha1) return;
        const existingHash = await new Promise((resolve, reject) => {
            const hash = require('crypto').createHash('sha1');
            const stream = fs.createReadStream(destination);
            stream.on('data', chunk => hash.update(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(hash.digest('hex')));
        });
        if (existingHash.toLowerCase() === expectedSha1.toLowerCase()) return;
    }
    const response = await net.fetch(url, { signal });
    if (!response.ok) throw new Error(`Minecraft download failed (HTTP ${response.status}): ${url}`);
    const data = Buffer.from(await response.arrayBuffer());
    if (signal?.aborted) throw new Error('Minecraft download cancelled.');
    if (expectedSha1) {
        const actualHash = require('crypto').createHash('sha1').update(data).digest('hex');
        if (actualHash.toLowerCase() !== expectedSha1.toLowerCase()) throw new Error(`Minecraft file checksum failed: ${url}`);
    }
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const tempPath = destination + '.part';
    fs.writeFileSync(tempPath, data);
    fs.renameSync(tempPath, destination);
}

async function performMinecraftInstall(versionId, onProgress, signal) {
    if (typeof versionId !== 'string' || !/^[A-Za-z0-9._-]+$/.test(versionId)) throw new Error('Invalid Minecraft version.');
    const manifestResponse = await net.fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json', { signal });
    if (!manifestResponse.ok) throw new Error('Could not load the official Minecraft version list.');
    const manifest = await manifestResponse.json();
    const versionEntry = manifest.versions.find(item => item.id === versionId && item.type === 'release');
    if (!versionEntry) throw new Error(`Minecraft release ${versionId} was not found.`);

    const versionResponse = await net.fetch(versionEntry.url, { signal });
    if (!versionResponse.ok) throw new Error(`Could not load Minecraft ${versionId} metadata.`);
    const versionData = await versionResponse.json();
    const versionFolder = path.join(minecraftLibraryPath, versionId);
    fs.mkdirSync(versionFolder, { recursive: true });
    const installedMarkerPath = path.join(versionFolder, '.installed');
    if (fs.existsSync(installedMarkerPath)) fs.unlinkSync(installedMarkerPath);
    const versionJsonPath = path.join(versionFolder, `${versionId}.json`);
    fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2), 'utf8');

    const files = [];
    const addInstallFile = (url, sha1, relativePath) => {
        if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error('Minecraft provided an invalid install path.');
        const destination = path.resolve(versionFolder, relativePath);
        if (!destination.startsWith(versionFolder + path.sep)) throw new Error('Minecraft provided an unsafe install path.');
        files.push({ url, sha1, path: destination });
    };
    if (versionData.downloads?.client) {
        const item = versionData.downloads.client;
        addInstallFile(item.url, item.sha1, `${versionId}.jar`);
    } else {
        throw new Error(`Minecraft ${versionId} has no client download.`);
    }

    for (const library of versionData.libraries || []) {
        const artifact = library.downloads?.artifact;
        if (artifact?.url && artifact.path) {
            addInstallFile(artifact.url, artifact.sha1, path.join('libraries', artifact.path));
        }
        const nativeKey = library.natives?.windows?.replace('${arch}', process.arch === 'ia32' ? '32' : '64');
        const native = nativeKey && library.downloads?.classifiers?.[nativeKey];
        if (native?.url && native.path) {
            addInstallFile(native.url, native.sha1, path.join('libraries', native.path));
        }
    }

    const loggingFile = versionData.logging?.client?.file;
    if (loggingFile?.url && loggingFile.id) {
        addInstallFile(loggingFile.url, loggingFile.sha1, path.join('assets', 'log_configs', loggingFile.id));
    }

    let assetObjects = [];
    const assetIndex = versionData.assetIndex;
    if (assetIndex?.url && assetIndex.id) {
        addInstallFile(assetIndex.url, assetIndex.sha1, path.join('assets', 'indexes', `${assetIndex.id}.json`));
        const assetResponse = await net.fetch(assetIndex.url, { signal });
        if (!assetResponse.ok) throw new Error(`Could not load Minecraft ${versionId} asset index.`);
        const assetManifest = await assetResponse.json();
        assetObjects = Object.values(assetManifest.objects || {});
        for (const object of assetObjects) {
            if (typeof object.hash !== 'string' || !/^[a-f0-9]{40}$/i.test(object.hash)) continue;
            addInstallFile(
                `https://resources.download.minecraft.net/${object.hash.slice(0, 2)}/${object.hash}`,
                object.hash,
                path.join('assets', 'objects', object.hash.slice(0, 2), object.hash)
            );
        }
    }

    const uniqueFiles = [...new Map(files.map(file => [file.path, file])).values()];

    let completed = 0;
    let nextFile = 0;
    const worker = async () => {
        while (nextFile < uniqueFiles.length) {
            const file = uniqueFiles[nextFile++];
            await downloadMinecraftFile(file.url, file.path, file.sha1, signal);
            completed++;
            onProgress({ status: 'downloading', percent: Math.round((completed / uniqueFiles.length) * 100), completed, total: uniqueFiles.length, etaStr: `Installing files ${completed}/${uniqueFiles.length}` });
        }
    };
    const workerResults = await Promise.allSettled(Array.from({ length: Math.min(8, uniqueFiles.length) }, worker));
    const workerFailure = workerResults.find(result => result.status === 'rejected');
    if (workerFailure) throw workerFailure.reason;
    if (signal?.aborted) throw new Error('Minecraft download cancelled.');
    fs.writeFileSync(installedMarkerPath, new Date().toISOString(), 'utf8');

    const games = readSavedGames();
    let minecraftGame = games.find(game => game.type === 'minecraft' || game.name?.toLowerCase() === 'minecraft');
    if (!minecraftGame) {
        let artwork = {};
        try { artwork = await fetchDefaultGameArtwork('Minecraft'); } catch (error) { console.warn('Could not load Minecraft artwork:', error); }
        minecraftGame = { name: 'Minecraft', path: minecraftLibraryPath, type: 'minecraft', cover: artwork.cover || '', hero: artwork.hero || '', logo: artwork.logo || '' };
        games.push(minecraftGame);
    }
    minecraftGame.path = minecraftLibraryPath;
    minecraftGame.type = 'minecraft';
    minecraftGame.version = versionId;
    minecraftGame.selectedMinecraftVersion = versionId;
    fs.writeFileSync(gamesFilePath, JSON.stringify(games, null, 2), 'utf8');
    return { version: versionId, files: uniqueFiles.length, assetObjects: assetObjects.length };
}



// get games
ipcMain.handle('get-installed-games', async () => {
    try {
        const libraryPath = path.join(
            app.getPath('documents'),
            'Big Screen Launcher',
            'Games',
            '.games.json'
        );

        if (!fs.existsSync(libraryPath)) {
            return [];
        }

        const data = fs.readFileSync(libraryPath, 'utf8');
        const parsed = JSON.parse(data);

        return Array.isArray(parsed) ? parsed : (parsed.games || []);
    } catch (error) {
        console.error("Error reading local .games.json:", error);
        return [];
    }
});



// open game folder
ipcMain.on('open-game-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
});
