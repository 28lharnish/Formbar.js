(function () {
    const body = document.body;
    const navToggle = document.querySelector(".nav-toggle");
    const sidebar = document.querySelector(".sidebar");
    const search = document.querySelector("#doc-search");
    const navCards = Array.from(document.querySelectorAll(".nav-card"));

    if (navToggle && sidebar) {
        navToggle.addEventListener("click", () => {
            const isOpen = body.classList.toggle("nav-open");
            navToggle.setAttribute("aria-expanded", String(isOpen));
        });

        sidebar.addEventListener("click", (event) => {
            if (event.target.closest("a")) {
                body.classList.remove("nav-open");
                navToggle.setAttribute("aria-expanded", "false");
            }
        });
    }

    if (search) {
        search.addEventListener("input", () => {
            const query = search.value.trim().toLowerCase();
            navCards.forEach((card) => {
                const visible = !query || card.dataset.search.includes(query);
                card.hidden = !visible;
            });
        });
    }

    document.querySelectorAll(".code-block").forEach((block) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "copy-button";
        button.textContent = "Copy";
        block.appendChild(button);

        button.addEventListener("click", async () => {
            const code = block.querySelector("code");
            if (!code) return;

            try {
                await navigator.clipboard.writeText(code.textContent);
                button.textContent = "Copied";
                window.setTimeout(() => {
                    button.textContent = "Copy";
                }, 1400);
            } catch {
                button.textContent = "Unavailable";
                window.setTimeout(() => {
                    button.textContent = "Copy";
                }, 1400);
            }
        });
    });

    const tocLinks = Array.from(document.querySelectorAll(".toc-link"));
    const headings = tocLinks.map((link) => document.querySelector(decodeURIComponent(link.hash))).filter(Boolean);

    if (tocLinks.length && headings.length && "IntersectionObserver" in window) {
        const byId = new Map(tocLinks.map((link) => [link.hash.slice(1), link]));
        const observer = new IntersectionObserver(
            (entries) => {
                const visible = entries
                    .filter((entry) => entry.isIntersecting)
                    .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];

                if (!visible) return;

                tocLinks.forEach((link) => link.classList.remove("active"));
                const active = byId.get(visible.target.id);
                if (active) active.classList.add("active");
            },
            {
                rootMargin: "-18% 0px -72% 0px",
                threshold: [0, 1],
            }
        );

        headings.forEach((heading) => observer.observe(heading));
    }
})();
