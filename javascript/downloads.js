// downloads status
const light = document.getElementById("status-light");
light.style.setProperty("background-color", "var(--status-yellow)");
light.style.setProperty("box-shadow", "var(--status-yellow) 0 0 15px");

for (let i = 0; i < 10; i++) {
    fetch('https://tungstenball.org/games.json')
        .then(response => response.json())
        .then(data => {
            light.style.setProperty("background-color", "var(--status-green)");
            light.style.setProperty("box-shadow", "var(--status-green) 0 0 15px");
            return;
        })
        .catch(error => {
            light.style.setProperty("background-color", "var(--status-red)");
            light.style.setProperty("box-shadow", "var(--status-red) 0 0 15px");
            console.warn(error);
        });
}

// important function for color
function muteHexColor(hex, alpha = 0.5) {
    let c = hex.replace('#', '');
    if (c.length === 3) c = c.split('').map(x => x + x).join('');
    const num = parseInt(c, 16);
    return `rgba(${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}, ${alpha})`;
}

// version
function isUpdateAvailable(localVersion, remoteVersion) {
    if (!localVersion) return true;
    if (!remoteVersion) return false;

    const localParts = String(localVersion).split('.').map(Number);
    const remoteParts = String(remoteVersion).split('.').map(Number);

    for (let i = 0; i < Math.max(localParts.length, remoteParts.length); i++) {
        const local = localParts[i] || 0;
        const remote = remoteParts[i] || 0;

        if (remote > local) return true;
        if (local > remote) return false;
    }
    return false;
}

// load data
(async () => {
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    const gameGrid = document.getElementById("download-grid");

    let games;
    let localLibrary = [];

    try {
        localLibrary = await ipcRenderer.invoke('get-installed-games') || [];
    } catch (err) {
        console.warn("Could not load local library for version checking:", err);
    }

    const cachedData = localStorage.getItem('tungsten_games_cache');

    if (cachedData) {
        games = JSON.parse(cachedData);
    } else {
        try {
            const response = await fetch('https://tungstenball.org/games.json');
            games = await response.json();
            localStorage.setItem('tungsten_games_cache', JSON.stringify(games));
        } catch(error) {
            console.error("Couldn't load games.json.", error);
            return;
        }
    }

    try {
        for (const game of games.games) {
            const newItem = document.createElement("button");
            const newText = document.createElement("p");
            const newImg = document.createElement("img");
            const affectors = document.createElement('div');

            const mutedColor = muteHexColor(game.color, 0.4);

            const installedGame = localLibrary.find(
                item => (item.name === game.title || item.title === game.title)
            );

            if (installedGame) {
                const needsUpdate = isUpdateAvailable(installedGame.version, game.version);

                if (!needsUpdate) {
                    newItem.disabled = true;
                    newItem.classList.add("installed-card");
                    newText.textContent = `${game.title} (Installed)`;
                } else {
                    newItem.classList.add("update-card");
                    newText.textContent = `${game.title} (Update v${game.version})`;
                }
            } else {
                newText.textContent = game.title;
            }

            gameGrid.appendChild(newItem);
            newText.style.setProperty("z-index", 2);
            newItem.style.setProperty("--card-accent-color", mutedColor);
            newItem.appendChild(newText);
            newItem.appendChild(newImg);
            newItem.appendChild(affectors);

            affectors.classList.add('affectors');

            if (game.controller === true) { 
                const gamepadIcon = document.createElement("img");
                gamepadIcon.setAttribute('src', 'svg/gamepad.svg');
                gamepadIcon.style.setProperty('width', '32px');
                gamepadIcon.style.setProperty('postion', 'absolute');

                affectors.appendChild(gamepadIcon);
                newItem.addEventListener('mouseenter', () => {
                    gamepadIcon.animate([
                        { opacity: 1}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
                newItem.addEventListener('mouseleave', () => {
                    gamepadIcon.animate([
                        { opacity: 0.5}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
             }
            if (game.dlc === true) { 
                const gamepadIcon = document.createElement("img");
                gamepadIcon.setAttribute('src', 'svg/dlc.svg');
                gamepadIcon.style.setProperty('width', '32px');
                gamepadIcon.style.setProperty('postion', 'absolute');

                affectors.appendChild(gamepadIcon);
                newItem.addEventListener('mouseenter', () => {
                    gamepadIcon.animate([
                        { opacity: 1}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
                newItem.addEventListener('mouseleave', () => {
                    gamepadIcon.animate([
                        { opacity: 0.5}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
             }
            if (game.lag === true) { 
                const gamepadIcon = document.createElement("img");
                gamepadIcon.setAttribute('src', 'svg/lag.svg');
                gamepadIcon.style.setProperty('width', '32px');
                gamepadIcon.style.setProperty('postion', 'absolute');

                affectors.appendChild(gamepadIcon);
                newItem.addEventListener('mouseenter', () => {
                    gamepadIcon.animate([
                        { opacity: 1}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
                newItem.addEventListener('mouseleave', () => {
                    gamepadIcon.animate([
                        { opacity: 0.5}
                    ], {
                        duration: 200,
                        easing: 'ease-out',
                        fill: 'forwards'
                    });
                });
             }

            newItem.addEventListener('click', () => {
                const gameSize = game.size || game.fileSize || game.filesize || game.downloadSize || null;

                window.downloadGame(
                    game.title, 
                    `https://tungstenball.org${game.download}`, 
                    null, 
                    game.version,
                    gameSize
                );
            });

            newImg.style.setProperty("position", "absolute");
            newImg.style.setProperty("transform", "translateY(-6px)");
            newImg.setAttribute("src", `https://tungstenball.org${game.image}`);
            
            newItem.style.setProperty("animation", 'fadeIn 300ms ease-out forwards');
            newItem.addEventListener('animationend', () => {
                newItem.style.removeProperty("animation");
            });
            
            await sleep(25);
        }
    } catch(error) {
        console.error("Error building game grid.", error);
    }
})();

const refreshButton = document.getElementById('refresh-button');

if (refreshButton) {
    ipcRenderer.invoke('clear-games-cache');
    refreshButton.addEventListener('click', async () => {
        localStorage.removeItem('tungsten_games_cache');
        const success = await ipcRenderer.invoke('clear-games-cache');
        
        if (success) {
            window.location.reload();
        }
    });
}

(() => {
    const banner = document.querySelector('.active-download-banner');
    const title = banner ? banner.querySelector('h2') : null;
    const statusText = banner ? banner.querySelector('p') : null;
    const progressFill = banner ? banner.querySelector('.download-bar-fill') : null;
    const stopBtn = document.getElementById('stop-download-button');
    const queueBanner = document.querySelector('.queue-banner');

    if (banner) banner.style.display = 'none';
    if (queueBanner) queueBanner.style.display = 'none';

    function renderDownloadState(state) {
        if (!queueBanner) return;
        queueBanner.querySelectorAll('p').forEach(p => p.remove());
        const queue = state?.queue || [];
        if (queue.length) {
            queueBanner.style.display = 'block';
            queue.forEach(item => {
                const p = document.createElement('p');
                p.style.cursor = 'pointer';
                p.title = 'Click to remove from queue';
                const rawSize = String(item.size || '').trim();
                const sizeLabel = rawSize ? (/gb|mb|kb/i.test(rawSize) ? rawSize : `${rawSize} GB`) : '';
                p.textContent = sizeLabel ? `${item.title} — ${sizeLabel}` : item.title;
                p.addEventListener('click', () => ipcRenderer.invoke('remove-download-from-queue', item.id).catch(console.error));
                queueBanner.appendChild(p);
            });
        } else {
            queueBanner.style.display = 'none';
        }

        const active = state?.active;
        if (active && banner) {
            banner.style.display = 'block';
            if (title) title.textContent = active.title;
            const progress = active.progress || {};
            if (statusText && progress.status === 'downloading') {
                statusText.textContent = active.type === 'minecraft'
                    ? `${progress.etaStr || 'Installing Minecraft…'} (${progress.completed || 0}/${progress.total || 0} files)`
                    : `Installing. ${progress.transferredMB || '0.0'} MB / ${progress.totalMB || '?'} MB — ${progress.etaStr || ''}`;
            }
            if (progressFill) progressFill.style.width = `${Number(progress.percent || 0)}%`;
        }
    }

    window.downloadGame = async function(gameName, downloadUrl, exeName, version, size) {
        try {
            return await ipcRenderer.invoke('queue-download', {
                gameName, downloadUrl, exeName: exeName || `${gameName}.exe`, version, size
            });
        } catch (error) {
            console.error(`Could not queue ${gameName}:`, error);
        }
    };

    if (stopBtn) {
        stopBtn.addEventListener('click', async () => {
            await ipcRenderer.invoke('stop-download');
        });
    }

    ipcRenderer.on('download-state', (_event, state) => renderDownloadState(state));
    ipcRenderer.invoke('get-download-state').then(renderDownloadState).catch(console.error);

    ipcRenderer.on('download-progress', (_event, data) => {
        if (!banner) return;

        if (data.status === 'downloading') {
            banner.style.display = 'block';
            if (title) title.textContent = data.title || data.gameName;
            if (statusText) {
                statusText.textContent = data.type === 'minecraft'
                    ? `${data.etaStr || 'Installing Minecraft…'} (${data.completed || 0}/${data.total || 0} files)`
                    : `Installing. ${data.transferredMB || '0.0'} MB / ${data.totalMB || '?'} MB — ${data.etaStr || ''}`;
            }
            if (progressFill) {
                progressFill.style.width = `${Number(data.percent || 0).toFixed(1)}%`;
            }
        } else if (data.status === 'completed') {
            if (statusText) statusText.textContent = data.type === 'minecraft' ? 'Minecraft installation complete.' : 'Download Complete! Added to Library.';
            if (progressFill) progressFill.style.width = '100%';
            setTimeout(() => ipcRenderer.invoke('get-download-state').then(state => {
                if (!state.active && banner) banner.style.display = 'none';
            }).catch(console.error), 1500);
        } else if (data.status === 'cancelled' || data.status === 'failed') {
            if (statusText) statusText.textContent = data.status === 'cancelled' ? 'Download cancelled.' : `Download failed: ${data.error || 'Unknown error'}`;
            setTimeout(() => ipcRenderer.invoke('get-download-state').then(state => {
                if (!state.active && banner) banner.style.display = 'none';
            }).catch(console.error), 1500);
        }
    });
})();


// minecraft handler

const minecraftButton = document.getElementById('minecraft-button');

minecraftButton.addEventListener('click', () => {
    minecraftButton.disabled = true;
    ipcRenderer.invoke('add-minecraft-library').then(result => {
        const versionSummary = result.versions.length ? ` ${result.versions.length} version(s) are already installed.` : ' Open Minecraft in your library and choose Add Installation to download a version.';
        window.alert(`Minecraft was added to your library.${versionSummary}`);
    }).catch(error => {
        console.error('Could not add Minecraft to the library:', error);
        window.alert('Could not add Minecraft to the library: ' + error.message);
    }).finally(() => { minecraftButton.disabled = false; });
});
