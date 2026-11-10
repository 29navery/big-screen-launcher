// Load and select artwork for the current library entry.
async function initGamePage() {
    const index = new URLSearchParams(window.location.search).get('index');
    if (index === null) return;
    const games = await ipcRenderer.invoke('load-games');
    const game = games[index];
    if (!game) return;
    const types = {cover: 'grid', hero: 'hero', logo: 'logo'};
    const applyArt = () => {
        const hero = document.querySelector('.hero-image');
        const logo = document.querySelector('.logo-image');
        if (hero && game.hero) hero.style.setProperty('background-image', 'url(' + JSON.stringify(game.hero) + ')', 'important');
        if (logo && game.logo) logo.src = game.logo;
    };
    applyArt();
    let request = 0;
    let saving = Promise.resolve();
    const loadArt = async (name, defaults = false) => {
        const token = ++request;
        for (const type of Object.values(types)) {
            const row = document.getElementById(type + '-art-container');
            if (row) row.textContent = 'Loading artwork…';
        }
        let choices;
        try { choices = await ipcRenderer.invoke('fetch-game-art-options', name); }
        catch (error) { console.error(error); choices = {}; }
        if (token !== request) return;
        for (const [key, type] of Object.entries(types)) {
            const row = document.getElementById(type + '-art-container');
            if (!row) continue;
            const items = choices[key] || [];
            if (defaults && !game[key] && items.length) {
                try { game[key] = await ipcRenderer.invoke('set-game-art', game.path, key, items[0].url, true); }
                catch (error) { console.error('Could not save default artwork:', error); }
                if (token !== request) return;
            }
            const unique = new Map(items.map(item => [item.url, item]));
            if (game[key] && !unique.has(game[key])) unique.set(game[key], {url: game[key], thumb: game[key]});
            row.replaceChildren();
            for (const item of unique.values()) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = type + '-art';
                button.dataset.url = item.url;
                button.classList.toggle('selected', game[key] === item.url);
                button.setAttribute('aria-pressed', String(game[key] === item.url));
                button.title = 'Use this ' + type + ' artwork';
                const img = document.createElement('img');
                img.src = item.thumb;
                img.alt = type + ' artwork option';
                img.loading = 'lazy';
                button.appendChild(img);
                button.addEventListener('click', () => {
                    saving = saving.catch(() => {}).then(async () => {
                        game[key] = await ipcRenderer.invoke('set-game-art', game.path, key, item.url);
                        applyArt();
                        for (const tile of row.children) {
                            const selected = tile.dataset.url === game[key];
                            tile.classList.toggle('selected', selected);
                            tile.setAttribute('aria-pressed', String(selected));
                        }
                    });
                    saving.catch(error => window.alert('Could not save artwork: ' + error.message));
                });
                row.appendChild(button);
            }
            if (!unique.size) row.textContent = choices[key] == null ? 'Could not load artwork. Try searching again.' : 'No artwork found.';
        }
        applyArt();
    };
    const search = document.getElementById('search-name');
    if (search) {
        search.value = game.name;
        let timer;
        search.addEventListener('input', () => {
            clearTimeout(timer);
            ++request;
            timer = setTimeout(() => loadArt(search.value.trim() || game.name), 400);
        });
    }
    await loadArt(game.name, true);
}

document.addEventListener('DOMContentLoaded', initGamePage);

function formatPlaytime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds || 0));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    if (hours) return `${hours} h ${minutes} m`;
    if (minutes) return `${minutes} m ${remainingSeconds} s`;
    return `${remainingSeconds} s`;
}

function formatGameSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** unitIndex);
    return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function updateGameMetadataDisplay(metadata) {
    const sizeText = document.getElementById('game-size-text');
    const playtimeText = document.getElementById('play-time-text');
    const lastPlayedText = document.getElementById('last-played-text');
    if (sizeText && metadata.gameSizeBytes !== null) sizeText.textContent = formatGameSize(metadata.gameSizeBytes);
    if (playtimeText) playtimeText.textContent = formatPlaytime(metadata.playtimeSeconds);
    if (lastPlayedText) {
        lastPlayedText.textContent = metadata.lastPlayedAt
            ? new Date(metadata.lastPlayedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
            : 'Never';
    }
}

async function loadGameMetadata(game) {
    try {
        updateGameMetadataDisplay(await ipcRenderer.invoke('get-game-metadata', game.path, game.type));
    } catch (error) {
        console.error('Could not load game metadata:', error);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const index = new URLSearchParams(window.location.search).get('index');
    if (index === null) return;
    try {
        const games = await ipcRenderer.invoke('load-games');
        const game = games[index];
        if (game) await loadGameMetadata(game);
    } catch (error) {
        console.error('Could not load game metadata:', error);
    }
});

ipcRenderer.on('game-metadata-update', (_event, payload) => {
    const index = new URLSearchParams(window.location.search).get('index');
    if (index === null) return;
    ipcRenderer.invoke('load-games').then(games => {
        const game = games[index];
        if (game && game.path?.toLowerCase() === payload.gamePath?.toLowerCase()) {
            loadGameMetadata(game);
        }
    }).catch(error => console.error('Could not refresh game metadata:', error));
});

// sound

async function playSound(fileName) {
    const settings = await ipcRenderer.invoke('load-settings');

    if (settings.appSFX) {
        const audio = new Audio(`assets/sounds/${fileName}.ogg`);
        audio.volume = 0.5;
        audio.play().catch(err => {
            console.log("Audio playback prevented:", err);
        });
    }
}

// launch

const launchButton = document.getElementById('play-button');



async function launchGame(index) {
    const games = await ipcRenderer.invoke('load-games');
    const game = games[index];

    if (game) {
        console.log(`Launching game: ${game.name || 'Unnamed'}`);
        ipcRenderer.invoke('launch-game-process', game);
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIndex = urlParams.get('index');

    const games = await ipcRenderer.invoke('load-games');
    const game = games[gameIndex];

    if (!game) {
        console.error("Game not found for index:", gameIndex);
        return;
    }

    const launchOptionsInput = document.getElementById('launch-options-input');
    let launchOptionsSave = Promise.resolve();
    if (launchOptionsInput) {
        launchOptionsInput.value = game.launchOptions || '';
        launchOptionsInput.addEventListener('input', () => {
            const value = launchOptionsInput.value;
            game.launchOptions = value;
            launchOptionsSave = launchOptionsSave.catch(() => {}).then(async () => {
                await ipcRenderer.invoke('save-game-launch-options', game.path, value);
            });
            launchOptionsSave.catch(error => {
                console.error('Could not save launch options:', error);
                window.alert('Could not save launch options: ' + error.message);
            });
        });
    }

    const currentStatus = await ipcRenderer.invoke('get-game-status', game.path);
    updateButtonState(launchButton, currentStatus);

    ipcRenderer.on('game-status-update', (event, data) => {
        if (data.path === game.path) {
            updateButtonState(launchButton, data.status);
        }
    });

    launchButton.onclick = async () => {
        try {
        const liveStatus = await ipcRenderer.invoke('get-game-status', game.path);
        
        if (liveStatus === 'running') {
            await ipcRenderer.invoke('stop-game-process', game);
        } else {
            await launchOptionsSave;
            await ipcRenderer.invoke('launch-game-process', game);
        }
        playSound('maximize_007');
        } catch (error) { window.alert('Could not launch game: ' + error.message); }
    };
});

function updateButtonState(button, status) {
    if (status === 'starting') {
        button.textContent = '✖ Starting . . .';
        button.style.setProperty('background-color', '#4eb7d1')
        button.disabled = true;
    } else if (status === 'running') {
        button.textContent = '✖ Stop';
        button.style.setProperty('background-color', '#4eb7d1')
        button.disabled = false;
    } else {
        button.textContent = '▶ Start';
        button.style.setProperty('background-color', '')
        button.disabled = false;
    }
}

// buttons

const favorite = document.getElementById('favorite-button')
const options = document.getElementById('options-button');
const folder = document.getElementById('folder-button');
const remove = document.getElementById('remove-button');

// remove
const deleteYes = document.getElementById('deletion-prompt-yes');
const deleteNo = document.getElementById('deletion-prompt-no');

const deleteCover = document.getElementById('deletion-prompt-cover');

remove.addEventListener('click', () => {
    deleteCover.style.setProperty('display', 'block');

    deleteNo.addEventListener('click', () => {
        deleteCover.style.setProperty('display', 'none');
    });

    deleteYes.addEventListener('click', () => {
        deleteCover.style.setProperty('display', 'none');
    });
});

favorite.addEventListener('click', () => {
    const img = favorite.querySelector('img');

    if (img.src.endsWith('svg/heart.svg')) {
        img.src = 'svg/heart-filled.svg';
    } else {
        img.src = 'svg/heart.svg';
    }


});


// options
const optionsCover = document.getElementById('options-cover');

options.addEventListener('click', () => {
    optionsCover.style.setProperty('display', 'flex');
});

optionsCover.addEventListener('click', (event) => {
    if (event.target === optionsCover) {
        optionsCover.style.setProperty('display', 'none');
    }
});

// folder
folder.addEventListener('click', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIndex = urlParams.get('index');
    const games = await ipcRenderer.invoke('load-games');
    const game = games[gameIndex];

    if (game && game.path) {
        ipcRenderer.send('open-game-folder', game.path);
    }
});

document.getElementById('browser-folder-button').addEventListener('click', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIndex = urlParams.get('index');
    const games = await ipcRenderer.invoke('load-games');
    const game = games[gameIndex];

    if (game && game.path) {
        ipcRenderer.send('open-game-folder', game.path);
    }
});


// mc dropdown
const dropdown = document.getElementById('dropdown');
const dropdownMenu = document.getElementById('dropdown-menu');

const arrow = document.getElementById('dropdown-arrow');

let animating = false

dropdownMenu.style.display = 'none';

dropdown.addEventListener('click', async () => {
    if (!animating) {
            const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        if (dropdownMenu.style.display !== 'block') {
            animating = true;
            dropdownMenu.style.display = 'block';
            dropdownMenu.style.animation = 'unfold 200ms ease-out forwards'
            arrow.style.animation = 'rotUp 200ms ease-out forwards'
            await sleep(200);
            animating = false;
        } else {
            animating = true;
            dropdownMenu.style.animation = 'fold 200ms ease-out forwards'
            arrow.style.animation = 'rotDown 200ms ease-out forwards'
            await sleep(200);
            dropdownMenu.style.display = 'none';
            animating = false;
        }
    }
});

// retrieve versions
async function getVersions() {
    const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
    const data = await response.json();

    return data.versions;
}

async function loadVersions() {
    const versionBox = document.getElementById('versions-list');

    try {
        const allVersions = await getVersions();

        const releases = allVersions.filter(v => v.type === 'release');

        releases.forEach(version => {
            const option = document.createElement('div');
            option.textContent = `Minecraft ${version.id}`;
            versionBox.appendChild(option);
        })
    } catch (err) {
        console.error("failed to load the versions...", err);
        versionBox.textContent = 'Failed to load Minecraft versions.'
    }
}

// add installations
const instCover = document.getElementById('versions-cover');
const instWindow = document.getElementById('versions-window');
const addInstButton = document.getElementById('add-inst-button');

addInstButton.addEventListener('click', () => {
    if (instCover.style.display !== 'none') {
        instCover.style.setProperty('display', 'none');
    } else {
        instCover.style.setProperty('display', 'block');
    }
});

document.addEventListener('click', (event) => {
    addInstButton.addEventListener('click', (event) => {
        event.stopPropagation();
        instCover.style.setProperty('display', 'flex');
        loadVersions();
    });
    if (instWindow && !instWindow.contains(event.target) && !addInstButton.contains(event.target)) {
        instCover.style.setProperty('display', 'none');
    }
});



// tut page
//const params = new URLSearchParams(window.location.search);
//const flagTut = params.get("flags-tut") === "true";

const tutCover = document.getElementById("tut-cover");
const tutWindow = document.getElementById("tut-window");

const link = document.getElementById("tut-link");
link.addEventListener("click", () => {
    tutCover.style.display = "block";
    optionsCover.style.display = "none";
});

//if (!flagTut) {
//    tutCover.style.display = "none";
//} else {
//    tutCover.style.display = "block";
//}

tutCover.addEventListener('click', (event) => {
    if (event.target === tutCover) {
        tutCover.style.setProperty('display', 'none');
    }
});
