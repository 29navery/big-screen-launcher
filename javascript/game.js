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

// buttons

const favorite = document.getElementById('favorite-button')
const options = document.getElementById('options-button');
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