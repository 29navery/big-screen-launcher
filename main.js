// hello I am the electron script
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, session, net } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

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

autoUpdater.autoDownload = true;
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
    if (process.platform === 'win32') {
        app.setAppUserModelId('Big Screen Launcher');
    }

    createWindow();

    audioWindow = new BrowserWindow({
        width: 366,
        height: 477,
        resizable: false,
        show: false,
        title: 'Big Screen Launcher',
        transparent: true,
        frame: false,
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

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });

    applySettings();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        //app.quit();
    }
});

// shortcuts & dialog handlers
ipcMain.handle('dialog:open-game-file', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Select Game Executable',
        properties: ['openFile'],
        filters: [{ name: 'Executables & Shortcuts', extensions: ['exe', 'lnk', 'url'] }]
    });

    return canceled ? null : filePaths[0];
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
let appVersion = '26.0';
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

ipcMain.handle('load-games', () => {
    try {
        if (fs.existsSync(gamesFilePath)) {
            return JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
        }
    } catch (err) {
        console.error("Could not load games file:", err);
    }
    return [];
});

ipcMain.handle('save-games', (event, gamesArray) => {
    try {
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
    return { apiKey: '' };
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

const DEFAULT_API_KEY = '9d1906739a2fb8b80908934fa3529734';
function getApiKey() {
    if (fs.existsSync(settingsFilePath)) {
        try {
            const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
            if (settings.apiKey) return settings.apiKey;
        } catch (err) {
            console.error("Error reading settings file:", err);
        }
    }
    return DEFAULT_API_KEY;
}



// get the arts
async function fetchGameArt(gameName) {
    try {
        let apiKey = getApiKey();
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        const searchRes = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        const searchData = await searchRes.json();
        
        if (!searchData.success || !searchData.data || searchData.data.length === 0) return null;
        const gameId = searchData.data[0].id;

        const gridsRes = await fetch(`https://www.steamgriddb.com/api/v2/grids/game/${gameId}?dimensions=600x900,512x512`, { headers });
        const gridsData = await gridsRes.json();

        if (gridsData.success && gridsData.data && gridsData.data.length > 0) {
            return gridsData.data[0].url;
        }
    } catch (err) {
        console.error('Error connecting to SteamGridDB:', err);
    }
    return null;
}

async function fetchGameHero(gameName) {
    try {
        let apiKey = getApiKey();
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        const searchRes = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        const searchData = await searchRes.json();
        
        if (!searchData.success || !searchData.data || searchData.data.length === 0) return null;
        const gameId = searchData.data[0].id;

        const heroesRes = await fetch(`https://www.steamgriddb.com/api/v2/heroes/game/${gameId}`, { headers });
        const heroesData = await heroesRes.json();

        if (heroesData.success && heroesData.data && heroesData.data.length > 0) {
            return heroesData.data[0].url;
        }
    } catch (err) {
        console.error('Error connecting to SteamGridDB for hero art:', err);
    }
    return null;
}

async function fetchGameLogo(gameName) {
    try {
        let apiKey = getApiKey();
        const headers = { 'Authorization': `Bearer ${apiKey}` };
        const searchRes = await fetch(`https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameName)}`, { headers });
        const searchData = await searchRes.json();
        
        if (!searchData.success || !searchData.data || searchData.data.length === 0) return null;
        const gameId = searchData.data[0].id;

        const logosRes = await fetch(`https://www.steamgriddb.com/api/v2/logos/game/${gameId}`, { headers });
        const logosData = await logosRes.json();

        if (logosData.success && logosData.data && logosData.data.length > 0) {
            return logosData.data[0].url;
        }
    } catch (err) {
        console.error('Error connecting to SteamGridDB for logo art:', err);
    }
    return null;
}

ipcMain.handle('fetch-game-art', (event, gameName) => fetchGameArt(gameName));
ipcMain.handle('fetch-game-hero', (event, gameName) => fetchGameHero(gameName));
ipcMain.handle('fetch-game-logo', (event, gameName) => fetchGameLogo(gameName));



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

let activeDownloadReq = null;

// processes
const activeProcesses = new Map()

ipcMain.handle('launch-game-process', async (event, game) => {
    if (!game) {
        throw new Error('No game payload provided to launch-game-process.');
    }

    let exePath = '';

    if (game.path && typeof game.path === 'string' && fs.existsSync(game.path) && fs.statSync(game.path).isFile()) {
        exePath = game.path;
    } else {
        const gameName = (game.name || game.title || '').trim();

        if (!gameName) {
            throw new Error('Game name is required but was undefined or empty.');
        }

        const gameFolder = path.join(
            app.getPath('documents'),
            'Big Screen Launcher',
            'Games',
            gameName
        );

        let exeName = (game.exe || '').trim();

        if (exeName && fs.existsSync(path.join(gameFolder, exeName))) {
            exePath = path.join(gameFolder, exeName);
        } else {
            console.warn(`Saved exe "${exeName}" not found. Scanning ${gameFolder} for real executable...`);
            const detectedExe = findExecutableInFolder(gameFolder, gameName);
            exePath = path.join(gameFolder, detectedExe);

            saveGameToLibrary({
                ...game,
                name: gameName,
                exe: detectedExe,
                path: exePath
            });
        }
    }

    if (!fs.existsSync(exePath) || !fs.statSync(exePath).isFile()) {
        throw new Error(`Executable file not found at: ${exePath}`);
    }

    if (activeProcesses.has(exePath)) {
        console.log("Game is already running.");
        return { success: true };
    }

    try {
        // Broadcast 'starting' globally
        broadcastStatus(exePath, 'starting');

        const child = spawn(exePath, [], { 
            detached: true, 
            stdio: 'ignore',
            cwd: path.dirname(exePath) 
        });
        
        child.unref();
        activeProcesses.set(exePath, child);

        // Broadcast 'running' globally
        broadcastStatus(exePath, 'running');

        // Listen for when the game process closes
        child.on('exit', () => {
            activeProcesses.delete(exePath);
            // Broadcast 'stopped' globally so the UI instantly updates!
            broadcastStatus(exePath, 'stopped');
        });

    } catch (error) {
        activeProcesses.delete(exePath);
        broadcastStatus(exePath, 'stopped');
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
        activeProcesses.delete(targetPath);
        broadcastStatus(targetPath, 'stopped');
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

// start download
ipcMain.handle('start-download', async (event, payload) => {
    let zipPath = '';
    try {
        const { gameName, downloadUrl, exeName, version, cover } = payload;

        if (!downloadUrl) {
            throw new Error('No download URL provided.');
        }

        const gameFolder = path.join(
            app.getPath('documents'),
            'Big Screen Launcher',
            'Games',
            gameName
        );
        
        fs.mkdirSync(gameFolder, { recursive: true });
        zipPath = path.join(gameFolder, 'download_temp.zip');
        const fileStream = fs.createWriteStream(zipPath);

        // Uses Chromium's network stack (same as Google Chrome!)
        const response = await net.fetch(downloadUrl);

        if (!response.ok) {
            throw new Error(`Server returned HTTP ${response.status}`);
        }

        const totalBytes = parseInt(response.headers.get('content-length') || '0', 10);
        let transferredBytes = 0;
        let startTime = Date.now();

        // Read chunks using Chromium's native stream reader
        const reader = response.body.getReader();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            transferredBytes += value.length;
            fileStream.write(value);

            if (totalBytes > 0) {
                const percent = (transferredBytes / totalBytes) * 100;
                const transferredMB = (transferredBytes / (1024 * 1024)).toFixed(1);
                const totalMB = (totalBytes / (1024 * 1024)).toFixed(1);
                
                const elapsedSec = (Date.now() - startTime) / 1000;
                const speedBytesPerSec = transferredBytes / elapsedSec;
                const remainingSec = Math.ceil((totalBytes - transferredBytes) / (speedBytesPerSec || 1));

                const mins = Math.floor(remainingSec / 60);
                const secs = remainingSec % 60;

                event.sender.send('download-progress', {
                    status: 'downloading',
                    gameName,
                    percent,
                    transferredMB,
                    totalMB,
                    etaStr: `${mins}m ${secs}s left`
                });
            }
        }

        fileStream.end(async () => {
            try {
                event.sender.send('download-progress', {
                    status: 'downloading',
                    gameName,
                    percent: 100,
                    transferredMB: '',
                    totalMB: '',
                    etaStr: 'Extracting game files...'
                });

                await extractArchive(zipPath, gameFolder);

                if (fs.existsSync(zipPath)) {
                    fs.unlinkSync(zipPath);
                }

                flattenIfSingleSubfolder(gameFolder);

                let finalExeName = exeName;
                if (!finalExeName) {
                    finalExeName = findExecutableInFolder(gameFolder, gameName);
                }

                event.sender.send('download-progress', {
                    status: 'downloading',
                    gameName,
                    percent: 100,
                    transferredMB: '',
                    totalMB: '',
                    etaStr: 'Fetching game artwork...'
                });

                let gameCover = cover || "images/images.jpg";
                let gameHero = null;
                let gameLogo = null;

                try {
                    const fetchedCover = await fetchGameArt(gameName);
                    if (fetchedCover) gameCover = fetchedCover;

                    gameHero = await fetchGameHero(gameName);
                    gameLogo = await fetchGameLogo(gameName);
                } catch (artErr) {
                    console.error("Failed to fetch artwork automatically:", artErr);
                }

                saveGameToLibrary({
                    name: gameName,
                    version: version || "1.0.0",
                    cover: gameCover,
                    hero: gameHero,
                    logo: gameLogo,
                    exe: finalExeName,
                    path: path.join(gameFolder, finalExeName)
                });

                event.sender.send('download-progress', { status: 'completed', gameName });
            } catch (extractErr) {
                console.error('Failed to extract archive:', extractErr);
            }
        });

        return { success: true };

    } catch (error) {
        console.error("Download failed:", error);
        if (zipPath && fs.existsSync(zipPath)) {
            fs.unlinkSync(zipPath);
        }

        const errStr = error.message || '';
        if (
            errStr.includes('TLS') || 
            errStr.includes('socket disconnected') || 
            errStr.includes('ECONNRESET') || 
            errStr.includes('CERT') ||
            errStr.includes('net::')
        ) {
            throw new Error('Fatal error with TLS handshake, downloads cannot be reach at this time!');
        }

        throw error;
    }
});



// stop download
ipcMain.handle('stop-download', async (event) => {
    if (activeDownloadReq) {
        activeDownloadReq.destroy();
        activeDownloadReq = null;
        event.sender.send('download-progress', { status: 'cancelled' });
        return true;
    }
    return false;
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