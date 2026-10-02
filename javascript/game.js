// main code

async function initGamePage() {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIndex = urlParams.get('index');

    if (gameIndex === null) {
        console.warn("No game index provided in URL.");
        return;
    }

    const games = await ipcRenderer.invoke('load-games');
    const game = games[gameIndex];

    if (!game) {
        console.error("Game not found at index:", gameIndex);
        return;
    }

    console.log("Loaded game details for:", game.name);

    let needsSave = false;

    const heroImage = document.querySelector('.hero-image');
    if (heroImage) {
        if (game.hero) {
            heroImage.style.setProperty('background-image', 'url(' + game.hero + ')', 'important');
        } else {
            console.log("Fetching wide hero banner for:", game.name);
            const heroUrl = await ipcRenderer.invoke('fetch-game-hero', game.name);
            if (heroUrl) {
                game.hero = heroUrl;
                heroImage.style.setProperty('background-image', 'url(' + game.hero + ')', 'important');
                needsSave = true;
            }
        }
    }

    const logoImage = document.querySelector('.logo-image');
    if (logoImage) {
        if (game.logo) {
            logoImage.setAttribute('src', game.logo);
        } else {
            console.log("Fetching transparent logo for:", game.name);
            const logoUrl = await ipcRenderer.invoke('fetch-game-logo', game.name);
            if (logoUrl) {
                game.logo = logoUrl;
                logoImage.setAttribute('src', logoUrl);
                needsSave = true;
            }
        }
    }

    if (needsSave) {
        games[gameIndex] = game;
        await ipcRenderer.invoke('save-games', games);
    }

    const playButton = document.querySelector('.hero-container .preferable-button');
    if (playButton) {
        playButton.addEventListener('click', () => {
            console.log(`Launching game: ${game.name} at ${game.path}`);
            ipcRenderer.invoke('launch-game-process', game.path);
        });
    }
}

document.addEventListener('DOMContentLoaded', initGamePage);

// sound

function playSound(fileName) {
    const audio = new Audio(`assets/sounds/${fileName}.ogg`);
    audio.volume = 0.5;
    audio.play().catch(err => {
        console.log("Audio playback prevented:", err);
    });
}

// launch

const launchButton = document.getElementById('play-button');

launchButton.addEventListener('click', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const gameIndex = urlParams.get('index');
    launchGame(gameIndex);
    playSound('maximize_007');
});

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

    const currentStatus = await ipcRenderer.invoke('get-game-status', game.path);
    updateButtonState(launchButton, currentStatus);

    ipcRenderer.on('game-status-update', (event, data) => {
        if (data.path === game.path) {
            updateButtonState(launchButton, data.status);
        }
    });

    launchButton.onclick = async () => {
        const liveStatus = await ipcRenderer.invoke('get-game-status', game.path);
        
        if (liveStatus === 'running') {
            await ipcRenderer.invoke('stop-game-process', game);
        } else {
            await ipcRenderer.invoke('launch-game-process', game);
        }
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
const optionsWindow = document.getElementById('options-window');

options.addEventListener('click', () => {
    optionsCover.style.setProperty('display', 'block');
});

document.addEventListener('click', (event) => {
    options.addEventListener('click', (event) => {
        event.stopPropagation();
        optionsCover.style.setProperty('display', 'flex');
    });
    if (optionsWindow && !optionsWindow.contains(event.target) && !options.contains(event.target)) {
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
    const versionBox = document.getElementById('versions-window');

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

document.addEventListener('DOMContentLoaded', loadVersions);

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