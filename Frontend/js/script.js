

document.addEventListener("DOMContentLoaded", function () {

    const grid = document.getElementById("slotGrid");
    const message = document.getElementById("nexvaultMessage") || document.getElementById("optivaultMessage");
    const toggle = document.getElementById("themeToggle");
    const root = document.documentElement;


    // =================================================
    // CREATE SLOT MAP
    // =================================================

    if (grid) {

        const layout = [
            2, 1, 0, 2, 1, 0, 1, 0, 2, 1, 1, 0,
            1, 0, 2, 1, 0, 2, 1, 1, 0, 1, 0, 2,
            0, 1, 2, 1, 1, 0, 2, 1, 0, 1, 0, 0,
            2, 1, 0, 0, 2, 1, 0, 1, 0, 2, 1, 0
        ];

        const classes = [
            "",
            "g",
            "o"
        ];

        grid.innerHTML = "";

        // Create all 48 slots
        layout.forEach(function (value) {

            const slot = document.createElement("span");

            if (classes[value]) {
                slot.classList.add(classes[value]);
            }

            grid.appendChild(slot);

        });


        // =================================================
        // GET ALL SLOTS
        // =================================================

        const slots = Array.from(
            grid.querySelectorAll("span")
        );


        // =================================================
        // INTRO ANIMATION
        // =================================================

        /*
            48 boxes
            12 boxes per row

            ROW 1 → LEFT TO RIGHT
            ROW 2 → LEFT TO RIGHT
            ROW 3 → LEFT TO RIGHT
            ROW 4 → LEFT TO RIGHT
        */

        const startDelay = 700;

        // Time between each box
        const blockDelay = 65;


        setTimeout(function () {

            slots.forEach(function (slot, index) {

                setTimeout(function () {

                    // This class is handled by CSS
                    slot.classList.add("box-hide");

                }, index * blockDelay);

            });


            // =================================================
            // SHOW WELCOME MESSAGE AFTER LAST BOX
            // =================================================

            const lastBlockTime =
                (slots.length - 1) * blockDelay;


            setTimeout(function () {

                if (message) {
                    message.classList.add("show");
                }

            }, lastBlockTime + 600);


        }, startDelay);

    }


    // =====================================================
    // DARK / LIGHT MODE
    // =====================================================

    if (toggle) {

        const savedTheme =
            localStorage.getItem("slotwise-theme");

        const systemDark =
            window.matchMedia &&
            window.matchMedia(
                "(prefers-color-scheme: dark)"
            ).matches;

        const initialTheme =
            savedTheme ||
            (systemDark ? "dark" : "light");


        function applyTheme(theme) {

            root.setAttribute(
                "data-theme",
                theme
            );

            const isDark =
                theme === "dark";

            const label =
                toggle.querySelector(
                    ".theme-label"
                );

            const icon =
                toggle.querySelector(
                    ".theme-icon"
                );


            if (label) {

                label.textContent =
                    isDark
                        ? "LIGHT"
                        : "DARK";

            }


            if (icon) {

                icon.textContent =
                    isDark
                        ? "☀"
                        : "◐";

            }


            toggle.setAttribute(
                "aria-label",
                isDark
                    ? "Switch to light mode"
                    : "Switch to dark mode"
            );

            toggle.setAttribute(
                "title",
                isDark
                    ? "Switch to light mode"
                    : "Switch to dark mode"
            );

        }


        // Apply saved/system theme
        applyTheme(initialTheme);


        // Theme toggle
        toggle.addEventListener(
            "click",
            function () {

                const currentTheme =
                    root.getAttribute(
                        "data-theme"
                    );

                const nextTheme =
                    currentTheme === "dark"
                        ? "light"
                        : "dark";


                localStorage.setItem(
                    "slotwise-theme",
                    nextTheme
                );


                applyTheme(nextTheme);

            }
        );

    }

});


// =====================================================
// NEXVAULT — ACCESS MODAL (TWO-STEP ROLE SELECTOR)
// Append to the end of script.js
//
// FLOW
//   openModal()             show backdrop + panel
//   goToStep(id, direction) animate one step out, next in
//   chooseRole(role)        save the choice, go to sign-in
//   closeModal()            hide, reset to step 1
// =====================================================

document.addEventListener("DOMContentLoaded", function () {

    const modal = document.getElementById("accessModal");

    // Nothing to do on pages without the modal markup
    if (!modal) {
        return;
    }


    const panel = modal.querySelector(".am-panel");

    const closeBtn = modal.querySelector("[data-am-close]");

    const steps = modal.querySelectorAll(".am-step");

    const openTriggers =
        document.querySelectorAll("[data-am-open]");


    // Element that opened the modal, so focus can return
    let lastFocused = null;

    // Which step is currently on screen
    let currentStep = "role";


    // =================================================
    // WHERE EACH ROLE GOES
    // Change these to your real file names
    // =================================================

    const ROLE_DESTINATIONS = {
        "company-admin": "signin.html?role=company-admin",
        "supervisor": "signin.html?role=supervisor",
        "platform-admin": "signin.html?role=platform-admin"
    };


    // =================================================
    // OPEN / CLOSE
    // =================================================

    function openModal() {

        lastFocused = document.activeElement;

        modal.classList.add("is-open");

        modal.setAttribute("aria-hidden", "false");

        // stop the page behind from scrolling
        document.body.style.overflow = "hidden";

        showStep("role");

        // wait for the panel to become visible before focusing
        setTimeout(function () {
            panel.focus();
        }, 60);

    }


    function closeModal() {

        modal.classList.remove("is-open");

        modal.setAttribute("aria-hidden", "true");

        document.body.style.overflow = "";

        // reset so it reopens on the first question
        showStep("role");

        if (lastFocused) {
            lastFocused.focus();
        }

    }


    // =================================================
    // STEP HANDLING
    // =================================================

    // Show one step immediately, hide the rest
    function showStep(stepId) {

        steps.forEach(function (step) {

            const isTarget =
                step.dataset.amStep === stepId;

            step.hidden = !isTarget;

            // clear any leftover animation classes
            step.className = "am-step";

        });

        currentStep = stepId;

    }


    // Animate from the current step to another one
    // direction: "forward" slides left, "back" slides right
    function goToStep(stepId, direction) {

        if (stepId === currentStep) {
            return;
        }


        const outgoing = modal.querySelector(
            '.am-step[data-am-step="' + currentStep + '"]'
        );

        const incoming = modal.querySelector(
            '.am-step[data-am-step="' + stepId + '"]'
        );

        if (!outgoing || !incoming) {
            return;
        }


        const outClass =
            direction === "back"
                ? "is-leaving-right"
                : "is-leaving-left";

        const inClass =
            direction === "back"
                ? "is-entering-left"
                : "is-entering-right";


        outgoing.classList.add(outClass);


        // 240ms matches the .26s exit animation in the CSS
        setTimeout(function () {

            outgoing.hidden = true;
            outgoing.className = "am-step";

            incoming.hidden = false;
            incoming.classList.add(inClass);

            currentStep = stepId;


            // move focus into the new step
            const firstOption =
                incoming.querySelector(".am-option");

            if (firstOption) {
                firstOption.focus();
            }

        }, 240);

    }


    // =================================================
    // ROLE SELECTION
    // =================================================

    function chooseRole(role) {

        // remember the choice so signin.html knows
        // which form to show
        try {

            localStorage.setItem("nexvault-role", role);
            localStorage.setItem("optivault-role", role);

        } catch (error) {

            console.warn(
                "Could not save role choice:",
                error
            );

        }


        const destination = ROLE_DESTINATIONS[role];

        if (destination) {

            window.location.href = destination;

        } else {

            console.warn(
                "No destination set for role:",
                role
            );

        }

    }


    // =================================================
    // EVENTS
    // =================================================

    openTriggers.forEach(function (trigger) {

        trigger.addEventListener("click", function (event) {

            // the ACCOUNT link is an <a href="#">
            event.preventDefault();

            openModal();

        });

    });


    if (closeBtn) {
        closeBtn.addEventListener("click", closeModal);
    }


    // click on the dark area outside the panel
    modal.addEventListener("click", function (event) {

        if (event.target === modal) {
            closeModal();
        }

    });


    // Escape closes
    document.addEventListener("keydown", function (event) {

        const isOpen =
            modal.classList.contains("is-open");

        if (event.key === "Escape" && isOpen) {
            closeModal();
        }

    });


    // One listener handles every button inside the modal.
    // The data- attribute decides what happens.
    modal.addEventListener("click", function (event) {

        const button = event.target.closest(
            "[data-am-next], [data-am-role], [data-am-back]"
        );

        if (!button) {
            return;
        }


        if (button.dataset.amNext) {

            goToStep(button.dataset.amNext, "forward");

        } else if (button.dataset.amRole) {

            chooseRole(button.dataset.amRole);

        } else if (button.dataset.amBack) {

            goToStep(button.dataset.amBack, "back");

        }

    });

});