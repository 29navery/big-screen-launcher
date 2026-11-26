const addonsButton = document.getElementById("addons-button");
const themesButton = document.getElementById("themes-button");

addonsButton.addEventListener("click", () => {
    if (!window.location.href.includes('addons')) {
        window.location.href = 'addons.html';
    }
});

themesButton.addEventListener("click", () => {
    if (!window.location.href.includes('themes')) {
        window.location.href = 'themes.html';
    }
});