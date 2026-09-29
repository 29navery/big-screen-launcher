const { ipcRenderer } = require('electron')

// rail stuff
document.addEventListener('click', (e) => {
    const libraryBtn = e.target.closest('#library-button');
    const downloadsBtn = e.target.closest('#downloads-button');
    const settingsBtn = e.target.closest('#settings-button');
    const playerBtn = e.target.closest('#player-button');

    if (libraryBtn) window.location.href = 'index.html';
    if (downloadsBtn) window.location.href = 'downloads.html';
    if (settingsBtn) window.location.href = 'settings.html';
    if (playerBtn) window.location.href = 'music.html';

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