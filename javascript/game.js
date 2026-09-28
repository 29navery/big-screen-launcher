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