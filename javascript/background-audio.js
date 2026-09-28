const { ipcRenderer, ipcMain } = require('electron');

const player = new Audio();
let queue = [];
let currentIndex = -1;
let currentMetadata = {
    title: 'Not Playing',
    artist: '',
    cover: 'images/album-cover-placeholder.jpg'
};

function formatUri(filePath) {
    if (!filePath) return '';
    if (filePath.startsWith('http://') || filePath.startsWith('https://') || filePath.startsWith('file://') || filePath.startsWith('data:')) {
        return filePath;
    }
    if (!filePath.includes(':') && !filePath.startsWith('/') && !filePath.startsWith('\\')) {
        return filePath;
    }
    const sanitized = filePath.replace(/\\/g, '/');
    return sanitized.startsWith('/') ? `file://${sanitized}` : `file:///${sanitized}`;
}

if ('mediaSession' in navigator) {
    navigator.mediaSession.setActionHandler('play', () => {
        player.play().catch(err => console.error("Audio resume error:", err));
        sendStatus();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
        player.pause();
        sendStatus();
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
        handlePrev();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
        handleNext();
    });
}

function handleNext() {
    if (queue.length > 0 && currentIndex < queue.length - 1) {
        playTrackAtIndex(currentIndex + 1);
    }
}

function handlePrev() {
    if (player.currentTime > 3) {
        player.currentTime = 0;
    } else if (queue.length > 0 && currentIndex > 0) {
        playTrackAtIndex(currentIndex - 1);
    }
}

function playTrackAtIndex(index) {
    if (index < 0 || index >= queue.length) return;
    currentIndex = index;
    const track = queue[currentIndex];
    const trackUrl = track.path || track.trackUrl;
    if (trackUrl) {
        player.src = formatUri(trackUrl);
    }
    currentMetadata = {
        title: track.title || 'Unknown Song',
        artist: track.artist || 'Unknown Artist',
        cover: track.cover ? formatUri(track.cover) : 'images/album-cover-placeholder.jpg'
    };
    document.title = `iPod`;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: currentMetadata.title,
            artist: currentMetadata.artist,
            artwork: [
                { src: formatUri(currentMetadata.cover), sizes: '512x512', type: 'image/png' }
            ]
        });
    }

    player.play().catch(err => console.error("Audio playback error:", err));
    sendStatus();
    loadLyrics(currentMetadata.artist, currentMetadata.title);
    player.addEventListener('play', () => {
        ipcRenderer.invoke('show-ipod-if-enabled');
    });
}

// Helpers for time
function getProgressPercentage(currentTime, duration) {
    if (!duration || isNaN(duration) || duration <= 0) return 0;
    const percentage = (currentTime / duration) * 100;
    return Math.min(100, Math.max(0, percentage));
}

function formatTime(totalSeconds) {
    if (!totalSeconds || isNaN(totalSeconds) || totalSeconds < 0) return "0:00";
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
}

function getRemainingTime(currentTime, duration) {
    if (!duration || isNaN(duration)) return "-0:00";
    const remaining = Math.max(0, duration - currentTime);
    const minutes = Math.floor(remaining / 60);
    const seconds = Math.floor(remaining % 60).toString().padStart(2, '0');
    return `-${minutes}:${seconds}`;
}

// Update iPod display
function updateDisplay() {
    const titleDisplay = document.getElementById('ipod-title');
    const artistDisplay = document.getElementById('ipod-artist');
    const imgDisplay = document.getElementById('miniplayer-img');

    const time = document.getElementById('seek-time');
    const progress = document.getElementById('progress');
    const negative = document.getElementById('seek-remaining');

    imgDisplay.src = currentMetadata.cover;
    titleDisplay.textContent = currentMetadata.title;
    artistDisplay.textContent = currentMetadata.artist;

    time.textContent = formatTime(player.currentTime);
    progress.style.setProperty('width', getProgressPercentage(player.currentTime, player.duration) + '%');
    negative.textContent = getRemainingTime(player.currentTime, player.duration);

    updateLyricsSync();
}

// Send status to Electron main process
function sendStatus() {
    const isPlaying = !player.paused;

    if ('mediaSession' in navigator) {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }

    const statusPayload = {
        currentTime: player.currentTime || 0,
        duration: player.duration || 0,
        isPlaying: isPlaying,
        title: currentMetadata.title,
        artist: currentMetadata.artist,
        cover: currentMetadata.cover
    };

    ipcRenderer.send('send-audio-status', statusPayload);
}

ipcRenderer.on('receive-audio-command', (event, data) => {
    if (data.action === 'play') {
        if (data.queue && Array.isArray(data.queue)) {
            queue = data.queue;
            currentIndex = data.index !== undefined ? data.index : 0;
            playTrackAtIndex(currentIndex);
        } else {
            queue = [{
                path: data.trackUrl,
                title: data.title,
                artist: data.artist,
                cover: data.cover
            }];
            currentIndex = 0;
            playTrackAtIndex(0);
        }
    } else if (data.action === 'pause') {
        player.pause();
        sendStatus();
    } else if (data.action === 'resume') {
        player.play().catch(err => console.error("Audio resume error:", err));
        sendStatus();
        player.addEventListener('play', () => {
            ipcRenderer.invoke('show-ipod-if-enabled');
        });
    } else if (data.action === 'toggle') {
        player.addEventListener('play', () => {
            ipcRenderer.invoke('show-ipod-if-enabled');
        });
        if (player.paused) {
            player.play().catch(err => console.error("Audio resume error:", err));
        } else {
            player.pause();
        }
        sendStatus();
    } else if (data.action === 'next') {
        handleNext();
    } else if (data.action === 'prev') {
        handlePrev();
    }
});

player.addEventListener('timeupdate', sendStatus);

player.addEventListener('ended', () => {
    if (queue.length > 0 && currentIndex < queue.length - 1) {
        playTrackAtIndex(currentIndex + 1);
    } else {
        document.title = 'iPod';
        if ('mediaSession' in navigator) {
            navigator.mediaSession.playbackState = 'none';
        }
        ipcRenderer.send('send-audio-status', { ended: true });
    }
});

ipcRenderer.on('request-audio-status', () => {
    sendStatus();
});

// Controls
document.getElementById('menu-button').addEventListener('click', () => {
    const img = document.getElementById('miniplayer-img');
    const lyrics = document.getElementById('lyrics-container');

    const isImgVisible = window.getComputedStyle(img).display !== 'none';

    if (isImgVisible) {
        img.style.display = 'none';
        lyrics.style.display = 'flex';
    } else {
        img.style.display = 'block';
        lyrics.style.display = 'none';
    }
});

document.getElementById('pause-button').addEventListener('click', () => {
    ipcRenderer.send('send-audio-command', { action: 'toggle' });
});
document.getElementById('skip-button').addEventListener('click', () => {
    ipcRenderer.send('send-audio-command', { action: 'next' });
});
document.getElementById('back-button').addEventListener('click', () => {
    ipcRenderer.send('send-audio-command', { action: 'prev' });
});

setInterval(updateDisplay, 500);
player.volume = 0.2;

const progressBar = document.getElementById('progress-bar');

progressBar.addEventListener('click', (e) => {
    if (!player.duration || isNaN(player.duration)) return;

    const rect = progressBar.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    let percentage = (clickX / rect.width) * 100;

    percentage = Math.max(0, Math.min(100, percentage));

    player.currentTime = player.duration * (percentage / 100);
    updateDisplay();
    sendStatus();
});

// Timed Lyrics Logic

let lyricsData = [];
let currentLyricIndex = -1;

function parseLRC(lrcText) {
    if (!lrcText) return [];
    const lines = lrcText.split('\n');
    const result = [];
    const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

    for (const line of lines) {
        const match = timeRegex.exec(line);
        if (match) {
            const minutes = parseInt(match[1], 10);
            const seconds = parseInt(match[2], 10);
            const milliseconds = parseInt(match[3].padEnd(3, '0'), 10);
            
            const totalSeconds = minutes * 60 + seconds + milliseconds / 1000;
            const text = line.replace(timeRegex, '').trim();

            if (text) {
                result.push({ time: totalSeconds, text });
            }
        }
    }
    return result;
}

async function loadLyrics(artist, title) {
    const listEl = document.getElementById('lyrics-container');
    if (!listEl) return;

    listEl.innerHTML = '<p class="lyric-line">Loading lyrics...</p>';
    lyricsData = [];
    currentLyricIndex = -1;

    try {
        let syncedLyrics = null;

        // 1. Try exact match
        const query = `artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`;
        let res = await fetch(`https://lrclib.net/api/get?${query}`);

        if (res.ok) {
            const data = await res.json();
            syncedLyrics = data.syncedLyrics;
        } else {
            // 2. Search query fallback
            const searchRes = await fetch(`https://lrclib.net/api/search?q=${encodeURIComponent(artist + ' ' + title)}`);
            if (searchRes.ok) {
                const searchResults = await searchRes.json();
                const match = searchResults.find(item => item.syncedLyrics);
                if (match) syncedLyrics = match.syncedLyrics;
            }
        }

        if (syncedLyrics) {
            lyricsData = parseLRC(syncedLyrics);
            listEl.innerHTML = lyricsData
                .map((line, idx) => `<p class="lyric-line" id="lyric-${idx}">${line.text}</p>`)
                .join('');
        } else {
            listEl.innerHTML = '<p class="lyric-line">No timed lyrics available</p>';
        }
    } catch (err) {
        listEl.innerHTML = '<p class="lyric-line">No lyrics found</p>';
    }
}

function updateLyricsSync() {
    if (!lyricsData.length) return;

    const currentTime = player.currentTime;
    let activeIndex = -1;

    for (let i = 0; i < lyricsData.length; i++) {
        if (currentTime >= lyricsData[i].time) {
            activeIndex = i;
        } else {
            break;
        }
    }

    if (activeIndex !== currentLyricIndex) {
        if (currentLyricIndex !== -1) {
            const prevEl = document.getElementById(`lyric-${currentLyricIndex}`);
            if (prevEl) prevEl.classList.remove('active');
        }

        currentLyricIndex = activeIndex;
        if (currentLyricIndex !== -1) {
            const activeEl = document.getElementById(`lyric-${currentLyricIndex}`);
            const container = document.getElementById('lyrics-container');

            if (activeEl && container) {
                activeEl.classList.add('active');

                // Smoothly center active line using CSS scroll-behavior
                const target = activeEl.offsetTop - (container.clientHeight / 2) + (activeEl.clientHeight / 2);
                container.scrollTop = Math.max(0, target);
            }
        }
    }
}