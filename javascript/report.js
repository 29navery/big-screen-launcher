document.addEventListener("DOMContentLoaded", () => {
    const issueDropdown = document.getElementById("part-dropdown");
    const otherInput = document.getElementById("other-input");
    const issueDescInput = document.getElementById("issue-description");
    const issueDescCharCount = document.getElementById("char-counter");
    const submit = document.getElementById("submit-button");

    let description = "";

    function updateDescription() {
        description = issueDescInput.value
            .trim()
            .replace(/[^\S\r\n]+/g, " ")
            .replace(/\n{3,}/g, "\n\n");

        issueDescCharCount.textContent = description.length;

        if (description.length < 4000) {
            issueDescCharCount.style.color = "#fff";
        } else if (description.length < 5000) {
            issueDescCharCount.style.color = "#fd6";
        } else {
            issueDescCharCount.style.color = "#f66";
        }
    }

    issueDropdown.addEventListener("change", () => {
        otherInput.style.display =
            issueDropdown.value === "other" ? "block" : "none";
    });

    issueDescInput.addEventListener("input", updateDescription);

    submit.addEventListener("click", async () => {
        updateDescription();

        const category = issueDropdown.value === "other"
            ? otherInput.value.trim()
            : issueDropdown.value;

        if (!category || !description) {
            alert("Please fill out all fields.");
            return;
        }

        if (category.length > 100) {
            alert("Please keep the category to 100 characters or fewer.");
            return;
        }

        if (description.length > 5000) {
            alert("Your description is too long.");
            return;
        }

        const report = {
            category,
            description
        };

        try {
            submit.disabled = true;

            const response = await fetch("https://tungstenball.org/api/report", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(report),
                signal: AbortSignal.timeout(15000)
            });

            const result = await response.json().catch(() => null);
            if (!response.ok || result?.success !== true) {
                throw new Error(result?.error || `Report service returned HTTP ${response.status}. Please try again.`);
            }

            alert("Report submitted successfully!");

            issueDescInput.value = "";
            otherInput.value = "";

            updateDescription();

        } catch (error) {
            console.error("Failed to send report:", error);
            alert("Failed to submit report: \n" + error);
        } finally {
            submit.disabled = false;
        }
    });

    updateDescription();
});