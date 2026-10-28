document.addEventListener("DOMContentLoaded", () => {
    const issueDropdown = document.getElementById("part-dropdown");
    const otherInput = document.getElementById("other-input");
    const issueDescInput = document.getElementById("issue-description");
    const submit = document.getElementById("submit-button");

    submit.addEventListener("click", () => {

    });

    issueDropdown.addEventListener("change", () => {
        if (issueDropdown.value === "other") {
            otherInput.style.display = "block";
        } else {
            otherInput.style.display = "none";
        }
    });
});