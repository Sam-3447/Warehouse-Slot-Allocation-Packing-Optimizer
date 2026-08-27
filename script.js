document.addEventListener("DOMContentLoaded", function () {

    const grid = document.getElementById("slotGrid");
    const message = document.getElementById("nexvaultMessage") || document.getElementById("optivaultMessage");
    const toggle = document.getElementById("themeToggle");
    const root = document.documentElement;

    
    
    

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

        
        layout.forEach(function (value) {

            const slot = document.createElement("span");

            if (classes[value]) {
                slot.classList.add(classes[value]);
            }

            grid.appendChild(slot);

        });

        
        
        

        const slots = Array.from(
            grid.querySelectorAll("span")
        );

        
        
        

        

        const startDelay = 700;

        
        const blockDelay = 65;

        setTimeout(function () {

            slots.forEach(function (slot, index) {

                setTimeout(function () {

                    
                    slot.classList.add("box-hide");

                }, index * blockDelay);

            });

            
            
            

            const lastBlockTime =
                (slots.length - 1) * blockDelay;

            setTimeout(function () {

                if (message) {
                    message.classList.add("show");
                }

            }, lastBlockTime + 600);

        }, startDelay);

    }

    
    
    

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

        
        applyTheme(initialTheme);

        
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
                    "nexvault-theme",
                    nextTheme
                );
                localStorage.setItem(
                    "optivault-theme",
                    nextTheme
                );
                localStorage.setItem(
                    "slotwise-theme",
                    nextTheme
                );

                applyTheme(nextTheme);

            }
        );

    }

});

document.addEventListener("DOMContentLoaded", function () {

    const modal = document.getElementById("accessModal");

    
    if (!modal) {
        return;
    }

    const panel = modal.querySelector(".am-panel");

    const closeBtn = modal.querySelector("[data-am-close]");

    const steps = modal.querySelectorAll(".am-step");

    const openTriggers =
        document.querySelectorAll("[data-am-open]");

    
    let lastFocused = null;

    
    let currentStep = "role";

    
    
    
    

    const ROLE_DESTINATIONS = {
        "company-admin": "signin.html?role=company-admin",
        "supervisor": "signin.html?role=supervisor",
        "platform-admin": "signin.html?role=platform-admin"
    };

    
    
    

    function openModal() {

        lastFocused = document.activeElement;

        modal.classList.add("is-open");

        modal.setAttribute("aria-hidden", "false");

        
        document.body.style.overflow = "hidden";

        showStep("role");

        
        setTimeout(function () {
            panel.focus();
        }, 60);

    }

    function closeModal() {

        modal.classList.remove("is-open");

        modal.setAttribute("aria-hidden", "true");

        document.body.style.overflow = "";

        
        showStep("role");

        if (lastFocused) {
            lastFocused.focus();
        }

    }

    
    
    

    
    function showStep(stepId) {

        steps.forEach(function (step) {

            const isTarget =
                step.dataset.amStep === stepId;

            step.hidden = !isTarget;

            
            step.className = "am-step";

        });

        currentStep = stepId;

    }

    
    
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

        
        setTimeout(function () {

            outgoing.hidden = true;
            outgoing.className = "am-step";

            incoming.hidden = false;
            incoming.classList.add(inClass);

            currentStep = stepId;

            
            const firstOption =
                incoming.querySelector(".am-option");

            if (firstOption) {
                firstOption.focus();
            }

        }, 240);

    }

    
    
    

    function chooseRole(role) {

        
        
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

    
    
    

    openTriggers.forEach(function (trigger) {

        trigger.addEventListener("click", function (event) {

            
            event.preventDefault();

            openModal();

        });

    });

    if (closeBtn) {
        closeBtn.addEventListener("click", closeModal);
    }

    
    modal.addEventListener("click", function (event) {

        if (event.target === modal) {
            closeModal();
        }

    });

    
    document.addEventListener("keydown", function (event) {

        const isOpen =
            modal.classList.contains("is-open");

        if (event.key === "Escape" && isOpen) {
            closeModal();
        }

    });

    
    
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
