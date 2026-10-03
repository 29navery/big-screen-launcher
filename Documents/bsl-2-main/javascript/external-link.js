document.getElementById('external-link').addEventListener('click', function(e) {
    e.preventDefault();
    ipcRenderer.invoke('open-external-link', e.currentTarget.href);
});