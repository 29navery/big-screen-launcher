const { ipcRenderer } = require('electron');

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
    document.title = `iPod`; // `${currentMetadata.title} - ${currentMetadata.artist}`

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
}

// helpers for time
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

// update ipod display
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
}

// send the status
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
    } else if (data.action === 'toggle') {
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

// buttons 
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