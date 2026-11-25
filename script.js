const { ipcRenderer } = require('electron');
const path = require("node:path");
const fs = require("node:fs");

const filePath = path.join(__dirname, "app-data.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const beta = data.beta;
const addonsEnabled = data.addonsEnabled;

document.addEventListener("DOMContentLoaded", () => {
    if (!beta) {
        document.getElementById("report-button").remove()
    }
    if (!addonsEnabled) {
        document.getElementById("addons-button").remove()
    }
});

// rail stuff
document.addEventListener('click', (e) => {
    const libraryBtn = e.target.closest('#library-button');
    const downloadsBtn = e.target.closest('#downloads-button');
    const addonsBtn = e.target.closest('#addons-button');
    const settingsBtn = e.target.closest('#settings-button');
    const playerBtn = e.target.closest('#player-button');
    const reportBtn = e.target.closest('#report-button');

    if (libraryBtn) window.location.href = 'index.html';
    if (downloadsBtn) window.location.href = 'downloads.html';
    if (addonsBtn) window.location.href = 'addons.html';
    if (settingsBtn) window.location.href = 'settings.html';
    if (playerBtn) window.location.href = 'music.html';
    if (reportBtn) window.location.href = 'report.html';

    const prevBtn = e.target.closest('#sngctrl-prev');
    const playPauseBtn = e.target.closest('#sngctrl-play-pause');
    const nextBtn = e.target.closest('#sngctrl-next');

    if (prevBtn) {
        ipcRenderer.send('send-audio-command', { action: 'prev' });
    }
    if (playPauseBtn) {
        ipcRenderer.send('send-audio-command', { action: 'toggle' });
    }
    if (nextBtn) {
        ipcRenderer.send('send-audio-command', { action: 'next' });
    }
});

// mini player shii
ipcRenderer.on('receive-audio-status', (event, data) => {
    const timeDisplay = document.getElementById('miniplayer-time');
    const titleDisplay = document.getElementById('miniplayer-title');
    const artistDisplay = document.getElementById('miniplayer-artist');
    const imgDisplay = document.getElementById('miniplayer-img');
    const playPauseBtn = document.getElementById('sngctrl-play-pause');

    if (titleDisplay && data.title) {
        titleDisplay.innerText = data.title;
    }
    
    if (artistDisplay && data.artist) {
        artistDisplay.innerText = data.artist;
    }

    if (imgDisplay && data.cover) {
        imgDisplay.src = data.cover;
    }

    if (playPauseBtn && data.isPlaying !== undefined) {
        playPauseBtn.src = data.isPlaying ? 'svg/music/play-pause.svg' : 'svg/music/play.svg';
    }

    if (timeDisplay && data.currentTime !== undefined) {
        const curMins = Math.floor(data.currentTime / 60);
        const curSecs = Math.floor(data.currentTime % 60).toString().padStart(2, '0');
        const durMins = data.duration ? Math.floor(data.duration / 60) : 0;
        const durSecs = data.duration ? Math.floor(data.duration % 60).toString().padStart(2, '0') : '00';

        timeDisplay.innerText = `${curMins}:${curSecs} / ${durMins}:${durSecs}`;
    }
});

// load fast
ipcRenderer.send('request-audio-status');

// prompt buttons
async function initButtonTexts() {
    const settings = await ipcRenderer.invoke('load-settings') || {};
    
    const yesBtn = document.getElementById('deletion-prompt-yes');
    const noBtn = document.getElementById('deletion-prompt-no');

    if (yesBtn) yesBtn.textContent = settings.yesTextInput || 'yeah, it sucked anyway';
    if (noBtn) noBtn.textContent = settings.noTextInput || 'nah, nevermind';
}

initButtonTexts();

// update version number in titlebar
const numberBox = document.getElementById('version-number');

ipcRenderer.invoke('get-app-version').then((version) => {
    numberBox.textContent = 'v' + version;
});

// big boy master downloads bar
const topbarDownloadsContainer = document.getElementById('topbar-download-container');
const topbarDownloadsText = document.getElementById('topbar-download-text');
const topbarDownloadsProgress = document.getElementById('topbar-download-progress');

function renderTopbarDownload(state) {
    if (!topbarDownloadsContainer) return;
    const active = state?.active;
    if (!active) {
        topbarDownloadsContainer.style.display = 'none';
        if (topbarDownloadsProgress) topbarDownloadsProgress.style.width = '0%';
        return;
    }

    topbarDownloadsContainer.style.display = 'flex';
    const progress = active.progress || {};
    if (topbarDownloadsText) {
        const detail = progress.etaStr || 'Starting…';
        topbarDownloadsText.textContent = `${active.title} — ${detail}`;
    }
    if (topbarDownloadsProgress) {
        topbarDownloadsProgress.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
    }
}

if (topbarDownloadsContainer) topbarDownloadsContainer.style.display = 'none';
ipcRenderer.on('download-state', (_event, state) => renderTopbarDownload(state));
ipcRenderer.on('download-progress', (_event, progress) => {
    if (!topbarDownloadsContainer) return;
    if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'failed') return;
    topbarDownloadsContainer.style.display = 'flex';
    if (topbarDownloadsText) topbarDownloadsText.textContent = `${progress.title || progress.gameName} — ${progress.etaStr || 'Downloading…'}`;
    if (topbarDownloadsProgress) topbarDownloadsProgress.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
});
ipcRenderer.invoke('get-download-state').then(renderTopbarDownload).catch(error => console.warn('Could not read download state:', error));


// gamepad stuff
const gamepadSelectedFrame = document.createElement("div");
let connectedGamepadIndex = null;
let selectedGamepadElement = null;
let gamepadHoveredElement = null;
let heldGamepadDirection = null;
let nextGamepadMoveAt = 0;
let gamepadActivationArmed = false;

gamepadSelectedFrame.classList.add("gamepadSelectedFrame");
document.body.appendChild(gamepadSelectedFrame);

const gamepadSelectableSelector = [
    "button:not(:disabled)",
    "a[href]",
    "input:not([type='hidden']):not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    "[role='button']:not([aria-disabled='true'])",
    "[tabindex]:not([tabindex='-1'])",
    "div.grid-item",
    ".song-item",
    "#song-controls img",
    ".minecraft-version-divider",
    ".queue-banner p[title]"
].join(",");

function isGamepadSelectable(element) {
    if (!(element instanceof HTMLElement) || element === gamepadSelectedFrame || !element.isConnected) return false;
    if (element.matches("button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled='true']")) return false;
    if (element.tabIndex < 0 && !element.matches("div.grid-item, .song-item, #song-controls img, .minecraft-version-divider, .queue-banner p[title], [role='button'], [data-gamepad-selectable]")) return false;
    if (!element.matches(gamepadSelectableSelector)) return false;

    const style = window.getComputedStyle(element);
    return style.display !== "none"
        && style.visibility !== "hidden"
        && Number(style.opacity) > 0.02
        && style.pointerEvents !== "none"
        && element.getClientRects().length > 0;
}

function getGamepadSelectableElements() {
    return Array.from(document.querySelectorAll(gamepadSelectableSelector)).filter(isGamepadSelectable);
}

function setGamepadHoveredElement(element) {
    if (gamepadHoveredElement === element) return;

    const previousElement = gamepadHoveredElement;
    gamepadHoveredElement = null;
    if (previousElement) {
        previousElement.classList.remove("gamepad-hover");
        previousElement.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false, relatedTarget: element || null }));
    }

    if (isGamepadSelectable(element)) {
        gamepadHoveredElement = element;
        element.classList.add("gamepad-hover");
        element.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false, relatedTarget: previousElement || null }));
    }
}

function updateGamepadSelectedFrame() {
    if (!selectedGamepadElement || !isGamepadSelectable(selectedGamepadElement)) {
        setGamepadHoveredElement(null);
        gamepadSelectedFrame.style.display = "none";
        return;
    }

    setGamepadHoveredElement(selectedGamepadElement);
    const rect = selectedGamepadElement.getBoundingClientRect();
    const style = window.getComputedStyle(selectedGamepadElement);
    Object.assign(gamepadSelectedFrame.style, {
        display: "block",
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
        borderRadius: style.borderRadius
    });
}

function selectGamepadElement(element, { scroll = false } = {}) {
    if (!isGamepadSelectable(element)) return false;
    selectedGamepadElement = element;
    if (!element.hasAttribute("tabindex") && !element.matches("button, a[href], input, select, textarea")) {
        element.tabIndex = -1;
    }
    element.focus({ preventScroll: true });
    if (scroll) element.scrollIntoView({ block: "nearest", inline: "nearest" });
    updateGamepadSelectedFrame();
    return true;
}

function selectFirstGamepadElement() {
    const activeElement = document.activeElement;
    if (isGamepadSelectable(activeElement)) return selectGamepadElement(activeElement);

    const pageName = window.location.pathname.split("/").pop().toLowerCase();
    const pageInitialSelectors = {
        "index.html": "#library-button",
        "downloads.html": "#downloads-button",
        "settings.html": "#settings-button",
        "music.html": "#player-button",
        "report.html": "#report-button",
        "addons.html": "#addons-button",
        "game.html": "#play-button"
    };
    const preferredSelector = pageInitialSelectors[pageName];
    const preferredElement = preferredSelector ? document.querySelector(preferredSelector) : null;
    if (isGamepadSelectable(preferredElement)) return selectGamepadElement(preferredElement, { scroll: true });

    const firstElement = getGamepadSelectableElements()[0];
    return firstElement ? selectGamepadElement(firstElement, { scroll: true }) : false;
}

function moveGamepadSelection(direction) {
    const selectableElements = getGamepadSelectableElements();
    if (!selectedGamepadElement || !selectableElements.includes(selectedGamepadElement)) {
        selectFirstGamepadElement();
        return;
    }

    const currentRect = selectedGamepadElement.getBoundingClientRect();
    const currentX = currentRect.left + currentRect.width / 2;
    const currentY = currentRect.top + currentRect.height / 2;
    let nextElement = null;
    let bestScore = Number.POSITIVE_INFINITY;

    for (const candidate of selectableElements) {
        if (candidate === selectedGamepadElement) continue;
        const rect = candidate.getBoundingClientRect();
        const dx = rect.left + rect.width / 2 - currentX;
        const dy = rect.top + rect.height / 2 - currentY;
        const primary = direction === "left" ? -dx
            : direction === "right" ? dx
                : direction === "up" ? -dy : dy;
        if (primary <= 1) continue;

        const perpendicular = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
        const score = primary + perpendicular * 1.7;
        if (score < bestScore) {
            bestScore = score;
            nextElement = candidate;
        }
    }

    if (nextElement) selectGamepadElement(nextElement, { scroll: true });
}

function readGamepadDirection(gamepad) {
    const dpad = gamepad.buttons || [];
    if (dpad[12]?.pressed) return "up";
    if (dpad[13]?.pressed) return "down";
    if (dpad[14]?.pressed) return "left";
    if (dpad[15]?.pressed) return "right";

    const axisX = Number(gamepad.axes?.[0]) || 0;
    const axisY = Number(gamepad.axes?.[1]) || 0;
    if (Math.max(Math.abs(axisX), Math.abs(axisY)) < 0.55) return null;
    if (Math.abs(axisX) > Math.abs(axisY)) return axisX < 0 ? "left" : "right";
    return axisY < 0 ? "up" : "down";
}

function pollGamepad(now) {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gamepad = connectedGamepadIndex === null
        ? Array.from(gamepads).find(Boolean)
        : gamepads[connectedGamepadIndex];

    if (gamepad) {
        if (connectedGamepadIndex === null) {
            connectedGamepadIndex = gamepad.index;
            selectFirstGamepadElement();
        }
        const direction = readGamepadDirection(gamepad);
        if (direction) {
            if (direction !== heldGamepadDirection) {
                heldGamepadDirection = direction;
                moveGamepadSelection(direction);
                nextGamepadMoveAt = now + 360;
            } else if (now >= nextGamepadMoveAt) {
                moveGamepadSelection(direction);
                nextGamepadMoveAt = now + 190;
            }
        } else {
            heldGamepadDirection = null;
        }

        const activatePressed = !!gamepad.buttons[0]?.pressed;
        if (!activatePressed) {
            gamepadActivationArmed = true;
        } else if (gamepadActivationArmed) {
            gamepadActivationArmed = false;
            if (!selectedGamepadElement || !isGamepadSelectable(selectedGamepadElement)) selectFirstGamepadElement();
            else selectedGamepadElement.click();
        }
        updateGamepadSelectedFrame();
    } else {
        connectedGamepadIndex = null;
        selectedGamepadElement = null;
        heldGamepadDirection = null;
        gamepadActivationArmed = false;
        setGamepadHoveredElement(null);
        gamepadSelectedFrame.style.display = "none";
    }

    window.requestAnimationFrame(pollGamepad);
}

document.addEventListener("focusin", (event) => {
    if (isGamepadSelectable(event.target)) {
        selectedGamepadElement = event.target;
        updateGamepadSelectedFrame();
    }
});

document.addEventListener("click", (event) => {
    const clickedElement = event.target instanceof Element ? event.target.closest(gamepadSelectableSelector) : null;
    if (isGamepadSelectable(clickedElement)) {
        selectedGamepadElement = clickedElement;
        updateGamepadSelectedFrame();
    }
}, true);

window.addEventListener("resize", updateGamepadSelectedFrame);
window.addEventListener("scroll", updateGamepadSelectedFrame, true);

window.addEventListener("gamepadconnected", (event) => {
    connectedGamepadIndex = event.gamepad.index;
    heldGamepadDirection = null;
    selectFirstGamepadElement();
    console.log("Connected:", event.gamepad.id, "at index", connectedGamepadIndex);
});

window.addEventListener("gamepaddisconnected", (event) => {
    if (event.gamepad.index === connectedGamepadIndex) {
        connectedGamepadIndex = null;
        selectedGamepadElement = null;
        heldGamepadDirection = null;
        gamepadActivationArmed = false;
        setGamepadHoveredElement(null);
        gamepadSelectedFrame.style.display = "none";
    }
    console.log("Disconnected:", event.gamepad.id);
});

window.requestAnimationFrame(pollGamepad);
