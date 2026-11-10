// sound
async function playSound(fileName) {
    const settings = await ipcRenderer.invoke('load-settings');
    if (!settings.appSFX) return;

    const audio = new Audio(`assets/sounds/${fileName}.ogg`);
    audio.volume = 0.5;
    audio.play().catch(err => {
        console.log("Audio playback prevented:", err);
    });
}

// import prompt
const importPromptContainer = document.getElementById('import-prompt-cover');
const importPromptWindowsButton = document.getElementById('import-windows-game');
const importPromptEmuButton = document.getElementById('import-emu-game');

function promptForGameType() {
    return new Promise((resolve) => {
        importPromptContainer.style.setProperty('display', 'flex');
        document.getElementById('import-game-cancel').onclick = () => {
            importPromptContainer.style.display = 'none';
            resolve(null);
        };
        importPromptWindowsButton.onclick = () => {
            importPromptContainer.style.display = 'none';
            resolve('windows')
        };
        importPromptEmuButton.onclick = () => {
            importPromptContainer.style.display = 'none';
            resolve('emu')
        };
    });
}

// games
const addGameButton = document.getElementById('add-game-btn');

async function launchGame(index) {
    const games = await ipcRenderer.invoke('load-games');
    const game = games[index];

    if (game) {
        console.log(`Launching game: ${game.name || 'Unnamed'}`);
        ipcRenderer.invoke('launch-game-process', game);
    }
}

async function renderGamesGrid() {
    const gameGrid = document.getElementById("game-grid");
    gameGrid.innerHTML = '';

    const games = await ipcRenderer.invoke('load-games');

    games.forEach((game, index) => {
        const newDiv = document.createElement("div");
        const newImg = document.createElement("img");

        newDiv.classList.add("grid-item");
        newDiv.dataset.id = index;
        
        newImg.classList.add("grid-item");
        gameGrid.appendChild(newDiv);
        newDiv.appendChild(newImg);
        
        newImg.setAttribute("src", game.cover || "images/images.jpg");
        
        newDiv.addEventListener('animationend', () => {
            newDiv.style.animation = 'none';
        });

        newDiv.addEventListener('click', () => {
            window.location.href = `game.html?index=${index}`;
        });

        newDiv.addEventListener('mouseenter', () => {
            playSound('drop_003');
        });
    });
}

renderGamesGrid();

addGameButton.addEventListener('click', async () => {
    const settings = await ipcRenderer.invoke('load-settings');
    if (addGameButton.disabled) return;
    addGameButton.disabled = true;
    try {
    let gameType = 'windows';
    let emulator = '';
    const configured = ['xenia', 'dolphin', 'cemu', 'ryujinx', 'yuzu', 'rpcs3', 'shadps4'].filter(id => settings[id + 'DirInput']?.trim());
    const askForGameType = configured.length > 0;


    if (askForGameType) {
        gameType = await promptForGameType();
        if (!gameType) return;
        if (gameType === 'emu') {
            const cover = document.getElementById('emulator-prompt-cover');
            const confirm = document.getElementById('import-emulator-confirm');
            let selected = configured[0] || null;
            const updateSelection = () => {
                for (const id of ['xenia', 'dolphin', 'cemu', 'ryujinx', 'yuzu', 'rpcs3', 'shadps4']) {
                    const button = document.getElementById('emu-opt-' + id);
                    button.disabled = !configured.includes(id);
                    button.classList.toggle('selected', id === selected);
                    button.setAttribute('aria-pressed', String(id === selected));
                    button.title = button.disabled ? 'Set the executable path in Settings to enable ' + button.textContent : '';
                }
                confirm.disabled = !selected;
            };
            for (const id of ['xenia', 'dolphin', 'cemu', 'ryujinx', 'yuzu', 'rpcs3', 'shadps4']) {
                document.getElementById('emu-opt-' + id).onclick = () => {
                    if (!configured.includes(id)) return;
                    selected = id;
                    updateSelection();
                };
            }
            updateSelection();
            cover.style.display = 'flex';
            document.getElementById('emu-opt-' + selected)?.focus();
            emulator = await new Promise(resolve => {
                confirm.onclick = () => { if (selected) resolve(selected); };
                document.getElementById('import-emulator-cancel').onclick = () => resolve(null);
            });
            cover.style.display = 'none';
            if (!emulator) return;
        }
    }

    const filePath = await ipcRenderer.invoke('dialog:open-game-file', emulator);
    if (!filePath) return;

    const fileName = filePath.split('\\').pop().split('/').pop();
    const defaultName = fileName.substring(0, fileName.lastIndexOf('.')) || fileName;

    promptInputField.value = defaultName;
    const gameName = await promptForGameName();
    
    if (!gameName) return;

    console.log(`Searching SteamGridDB for art: ${gameName}...`);
    
    const artworkUrl = await ipcRenderer.invoke('fetch-game-art', gameName);

    const newGame = {
        name: gameName,
        path: filePath,
        cover: artworkUrl || '',
        type: gameType,
        emulator
    };

    let savedGames = await ipcRenderer.invoke('load-games');
    savedGames.push(newGame);
    await ipcRenderer.invoke('save-games', savedGames);

    renderGamesGrid();
    } catch (error) {
        console.error(error);
        window.alert('Could not import game: ' + error.message);
    } finally {
        addGameButton.disabled = false;
    }
});

// name prompt
const promptContainer = document.getElementById('name-prompt-cover');
const promptInputField = document.getElementById('name-input-text-field');
const promptDoneButton = document.getElementById('name-input-create-button');

function promptForGameName() {
    return new Promise((resolve) => {
        promptContainer.style.setProperty('display', 'block');
        promptInputField.focus();

        promptDoneButton.onclick = () => {
            const name = promptInputField.value ? promptInputField.value.trim() : '';
            if (name !== '') {
                promptContainer.style.setProperty('display', 'none');
                promptInputField.value = '';
                resolve(name);
            }
        };
    });
}

// context menu
let activeTileIndex = null;
const contextMenu = document.getElementById('custom-context-menu');
const cmMain = document.getElementById('cm-main');
const cmReplaceArtwork = document.getElementById('cm-replace-artwork');

if (!contextMenu) {
    console.error("ERROR: #custom-context-menu element not found in HTML!");
}

document.addEventListener('contextmenu', (e) => {
    const tile = e.target.closest('.grid-item');
    
    if (!tile) {
        if (contextMenu) contextMenu.style.display = 'none';
        return;
    }

    e.preventDefault();
    
    activeTileIndex = tile.dataset.id; 

    contextMenu.style.top = `${e.pageY}px`;
    contextMenu.style.left = `${e.pageX}px`;
    contextMenu.style.display = 'block';
    cmMain.style.display = 'block';
    cmReplaceArtwork.style.display = 'none';
});

document.addEventListener('click', (e) => {
    if (contextMenu && !contextMenu.contains(e.target)) {
        contextMenu.style.display = 'none';
    }
});

// context menu buttons
document.getElementById('menu-launch').addEventListener('click', () => {
    if (activeTileIndex !== null) {
        launchGame(activeTileIndex);
        contextMenu.style.display = 'none';
    }
});

document.getElementById('menu-artwork').addEventListener('click', async () => {
    if (activeTileIndex !== null) {
        cmMain.style.setProperty("display", "none");
        cmReplaceArtwork.style.setProperty("display", "block");
        
    }
});

document.getElementById('menu-remove').addEventListener('click', async () => {
    if (activeTileIndex !== null) {
        const success = await ipcRenderer.invoke('remove-game', activeTileIndex);
        
        if (success) {
            console.log(`Game at index ${activeTileIndex} removed successfully.`);
        }
        
        contextMenu.style.display = 'none';
        activeTileIndex = null;
        
        renderGamesGrid();
    }
});

// subcontext menu buttons
async function updateGameArtwork(fetchChannel, propertyKey) {
    if (activeTileIndex === null) return;

    let savedGames = await ipcRenderer.invoke('load-games');
    const game = savedGames[activeTileIndex];

    if (game) {
        console.log(`Re-searching SteamGridDB for ${propertyKey}: ${game.name}...`);
        const artworkUrl = await ipcRenderer.invoke(fetchChannel, game.name);

        if (artworkUrl) {
            game[propertyKey] = artworkUrl;
            await ipcRenderer.invoke('save-games', savedGames);
            renderGamesGrid();
        }
    }

    contextMenu.style.display = 'none';
    cmMain.style.setProperty('display', 'block');
    cmReplaceArtwork.style.setProperty('display', 'none');
}

document.getElementById('menu-artwork-grid').addEventListener('click', () => updateGameArtwork('fetch-game-art', 'cover'));
document.getElementById('menu-artwork-logo').addEventListener('click', () => updateGameArtwork('fetch-game-logo', 'logo'));
document.getElementById('menu-artwork-hero').addEventListener('click', () => updateGameArtwork('fetch-game-hero', 'hero'));
document.getElementById('menu-artwork-all').addEventListener('click', () => {
    updateGameArtwork('fetch-game-art', 'grid');
    updateGameArtwork('fetch-game-logo', 'logo');
    updateGameArtwork('fetch-game-hero', 'hero');
});
