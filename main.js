// hello I am the electron script
const { app, BrowserWindow, ipcMain, Tray, Menu, dialog, shell, session } = require('electron');
const fs = require('fs');
const path = require('path');

// tray & window
let mainWindow;
let audioWindow;
let tray = null;
let isQuitting = false;

const createWindow = () => {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 800,
        minHeight: 800,
        titleBarStyle: 'hidden',
        titleBarOverlay: {
            color: '#1e1e1e',
            symbolColor: '#ffffff',
            height: 35
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
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        //app.quit();
    }
});

// Shortcuts & Dialog Handlers
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

let appVersion = '26.0';
try {
    const versionPath = path.join(__dirname, 'appversion.txt');
    appVersion = fs.readFileSync(versionPath, 'utf8').trim();
} catch (err) {
    console.log("Could not read local version file:", err);
}

ipcMain.handle('get-app-version', () => appVersion);

// User Data & Game Management
const gamesDir = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games');
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

const { execFile } = require('child_process');
ipcMain.handle('launch-game-process', async (event, gamePath) => {
    execFile(gamePath, (error) => {
        if (error) console.error('Failed to launch game:', error);
    });
});

const settingsFilePath = path.join(app.getPath('userData'), 'settings.json');

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
        fs.writeFileSync(settingsFilePath, JSON.stringify(settingsData, null, 2), 'utf8');
        return true;
    } catch (err) {
        console.error("Could not save settings:", err);
        return false;
    }
});

const DEFAULT_API_KEY = '9d1906739a2fb8b80908934fa3529734';
function getApiKey() {
    if (fs.existsSync(settingsFilePath)) {
        const settings = JSON.parse(fs.readFileSync(settingsFilePath, 'utf8'));
        if (settings.apiKey) return settings.apiKey;
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

// download da shyt

const https = require('https');
const http = require('http');

let activeDownloadReq = null;
let activeDownloadStream = null;
let activeDownloadPath = null;

// start
ipcMain.handle('start-download', async (event, { gameName, downloadUrl, exeName }) => {
    const gamesDir = path.join(app.getPath('documents'), 'Big Screen Launcher', 'Games');
    
    const safeFolderName = gameName.replace(/[/\\?%*:|"<>]/g, '').trim();
    const targetFolder = path.join(gamesDir, safeFolderName);

    if (!fs.existsSync(targetFolder)) {
        fs.mkdirSync(targetFolder, { recursive: true });
    }

    let fileName = exeName;
    if (!fileName) {
        const urlExtension = path.extname(new URL(downloadUrl).pathname) || '.exe';
        fileName = `${safeFolderName}${urlExtension}`;
    }

    const filePath = path.join(targetFolder, fileName);
    activeDownloadPath = filePath;

    return new Promise((resolve, reject) => {
        function requestFile(url) {
            const protocol = url.startsWith('https') ? https : http;

            const req = protocol.get(url, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    return requestFile(res.headers.location);
                }

                if (res.statusCode !== 200) {
                    reject(`Server responded with status code: ${res.statusCode}`);
                    return;
                }

                const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
                let receivedBytes = 0;
                const startTime = Date.now();

                const fileStream = fs.createWriteStream(filePath);
                activeDownloadStream = fileStream;

                res.on('data', (chunk) => {
                    receivedBytes += chunk.length;
                    fileStream.write(chunk);

                    const elapsedSec = (Date.now() - startTime) / 1000;
                    const speedBytesPerSec = elapsedSec > 0 ? receivedBytes / elapsedSec : 0;
                    const remainingBytes = totalBytes - receivedBytes;
                    const remainingSec = speedBytesPerSec > 0 ? Math.ceil(remainingBytes / speedBytesPerSec) : 0;

                    const percent = totalBytes > 0 ? (receivedBytes / totalBytes) * 100 : 0;
                    const transferredMB = (receivedBytes / (1024 * 1024)).toFixed(1);
                    const totalMB = (totalBytes / (1024 * 1024)).toFixed(2);

                    let etaStr = remainingSec < 60 
                        ? `${remainingSec}s left` 
                        : `${Math.floor(remainingSec / 60)}m ${remainingSec % 60}s left`;

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('download-progress', {
                            gameName,
                            percent,
                            transferredMB,
                            totalMB,
                            etaStr,
                            status: 'downloading'
                        });
                    }
                });

                res.on('end', async () => {
                    fileStream.end();
                    activeDownloadReq = null;
                    activeDownloadStream = null;

                    const [art, hero, logo] = await Promise.all([
                        fetchGameArt(gameName),
                        fetchGameHero(gameName),
                        fetchGameLogo(gameName)
                    ]).catch(() => [null, null, null]);

                    const newGame = {
                        name: gameName,
                        path: filePath,
                        art: art || null,
                        hero: hero || null,
                        logo: logo || null
                    };

                    let savedGames = [];
                    if (fs.existsSync(gamesFilePath)) {
                        try {
                            savedGames = JSON.parse(fs.readFileSync(gamesFilePath, 'utf8'));
                        } catch (err) {
                            console.error("Error reading games file:", err);
                        }
                    }

                    if (!savedGames.some(g => g.title === gameName)) {
                        savedGames.push(newGame);
                        fs.writeFileSync(gamesFilePath, JSON.stringify(savedGames, null, 2), 'utf8');
                    }

                    if (mainWindow && !mainWindow.isDestroyed()) {
                        mainWindow.webContents.send('download-progress', {
                            gameName,
                            percent: 100,
                            status: 'completed'
                        });
                        mainWindow.webContents.send('library-updated');
                    }
                    resolve({ success: true, filePath });
                });

                res.on('error', (err) => {
                    fileStream.close();
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                    reject(err.message);
                });
            });

            activeDownloadReq = req;
            req.on('error', (err) => {
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                reject(err.message);
            });
        }

        requestFile(downloadUrl);
    });
});

// cancel
ipcMain.handle('stop-download', () => {
    if (activeDownloadReq) {
        activeDownloadReq.destroy();
        activeDownloadReq = null;
    }
    if (activeDownloadStream) {
        activeDownloadStream.close();
        activeDownloadStream = null;
    }
    if (activeDownloadPath && fs.existsSync(activeDownloadPath)) {
        try { fs.unlinkSync(activeDownloadPath); } catch (e) {}
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('download-progress', { status: 'cancelled' });
    }
    return true;
});