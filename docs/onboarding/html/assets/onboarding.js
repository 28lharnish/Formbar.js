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

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function watchDiagramForSvg(diagram) {
        if (diagram.dataset.panZoomReady === "true") return;

        const svg = diagram.querySelector("svg");
        if (svg) {
            initDiagramPanZoom(diagram, svg);
        }
    }

    function initDiagramPanZoom(diagram, svg) {
        if (diagram.dataset.panZoomReady === "true") return;
        diagram.dataset.panZoomReady = "true";
        diagram.classList.add("diagram-panzoom");

        const canvas = document.createElement("div");
        canvas.className = "diagram-canvas";
        canvas.appendChild(svg);
        diagram.replaceChildren(canvas);

        const controls = document.createElement("div");
        controls.className = "diagram-controls";
        controls.innerHTML = `
            <button type="button" data-action="zoom-in" aria-label="Zoom diagram in" title="Zoom in">+</button>
            <button type="button" data-action="zoom-out" aria-label="Zoom diagram out" title="Zoom out">-</button>
            <button type="button" data-action="reset" aria-label="Reset diagram zoom and position" title="Reset">1:1</button>
        `;
        diagram.appendChild(controls);

        const state = {
            scale: 1,
            svg: null,
            baseBox: null,
            fullBox: null,
            viewBox: null,
            dragging: false,
            pointerId: null,
            startX: 0,
            startY: 0,
            startBox: null,
        };

        function cloneBox(box) {
            return {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
            };
        }

        function readSvgBox(svg) {
            const viewBox = svg.viewBox?.baseVal;
            if (viewBox && viewBox.width && viewBox.height) {
                return {
                    x: viewBox.x,
                    y: viewBox.y,
                    width: viewBox.width,
                    height: viewBox.height,
                };
            }

            let measuredBox = null;
            try {
                measuredBox = svg.getBBox();
            } catch {
                measuredBox = null;
            }

            const width = measuredBox?.width || svg.getBoundingClientRect().width || parseFloat(svg.getAttribute("width")) || 1000;
            const height = measuredBox?.height || svg.getBoundingClientRect().height || parseFloat(svg.getAttribute("height")) || 700;

            return {
                x: measuredBox?.x || 0,
                y: measuredBox?.y || 0,
                width,
                height,
            };
        }

        function getViewportRect() {
            const rect = canvas.getBoundingClientRect();
            return {
                width: Math.max(rect.width, 1),
                height: Math.max(rect.height, 1),
            };
        }

        function fitBoxToViewport(baseBox) {
            const viewport = getViewportRect();
            const baseAspect = baseBox.width / baseBox.height;
            const viewportAspect = viewport.width / viewport.height;
            const fitted = cloneBox(baseBox);

            if (viewportAspect > baseAspect) {
                fitted.width = baseBox.height * viewportAspect;
                fitted.x = baseBox.x - (fitted.width - baseBox.width) / 2;
            } else {
                fitted.height = baseBox.width / viewportAspect;
                fitted.y = baseBox.y - (fitted.height - baseBox.height) / 2;
            }

            return fitted;
        }

        function clampViewBox(box) {
            const full = state.fullBox;
            if (!full) return box;

            if (box.width >= full.width) {
                box.x = full.x - (box.width - full.width) / 2;
            } else {
                box.x = clamp(box.x, full.x, full.x + full.width - box.width);
            }

            if (box.height >= full.height) {
                box.y = full.y - (box.height - full.height) / 2;
            } else {
                box.y = clamp(box.y, full.y, full.y + full.height - box.height);
            }

            return box;
        }

        function applyViewBox() {
            if (!state.svg || !state.viewBox) return;

            const box = state.viewBox;
            state.svg.setAttribute("viewBox", `${box.x} ${box.y} ${box.width} ${box.height}`);
            diagram.dataset.zoom = `${Math.round(state.scale * 100)}%`;
        }

        function resetViewBox() {
            if (!state.baseBox) return;

            state.scale = 1;
            state.fullBox = fitBoxToViewport(state.baseBox);
            state.viewBox = cloneBox(state.fullBox);
            applyViewBox();
        }

        function resizeViewBox() {
            if (!state.baseBox || !state.viewBox) return;

            const center = {
                x: state.viewBox.x + state.viewBox.width / 2,
                y: state.viewBox.y + state.viewBox.height / 2,
            };

            state.fullBox = fitBoxToViewport(state.baseBox);
            state.viewBox = clampViewBox({
                x: center.x - state.fullBox.width / state.scale / 2,
                y: center.y - state.fullBox.height / state.scale / 2,
                width: state.fullBox.width / state.scale,
                height: state.fullBox.height / state.scale,
            });
            applyViewBox();
        }

        function zoomAt(clientX, clientY, factor) {
            if (!state.svg || !state.viewBox || !state.fullBox) return;

            const rect = canvas.getBoundingClientRect();
            const nextScale = clamp(state.scale * factor, 0.35, 4);
            const ratioX = clamp((clientX - rect.left) / rect.width, 0, 1);
            const ratioY = clamp((clientY - rect.top) / rect.height, 0, 1);
            const cursor = {
                x: state.viewBox.x + state.viewBox.width * ratioX,
                y: state.viewBox.y + state.viewBox.height * ratioY,
            };
            const nextWidth = state.fullBox.width / nextScale;
            const nextHeight = state.fullBox.height / nextScale;

            state.scale = nextScale;
            state.viewBox = clampViewBox({
                x: cursor.x - nextWidth * ratioX,
                y: cursor.y - nextHeight * ratioY,
                width: nextWidth,
                height: nextHeight,
            });
            applyViewBox();
        }

        function zoomFromCenter(factor) {
            const rect = canvas.getBoundingClientRect();
            zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
        }

        function reset() {
            resetViewBox();
        }

        function connectSvg(renderedSvg) {
            if (!renderedSvg || state.svg === renderedSvg) return;

            state.svg = renderedSvg;
            state.baseBox = readSvgBox(renderedSvg);
            state.svg.setAttribute("preserveAspectRatio", "none");
            state.svg.removeAttribute("width");
            state.svg.removeAttribute("height");
            state.svg.style.transform = "none";
            resetViewBox();
        }

        diagram.addEventListener(
            "wheel",
            (event) => {
                event.preventDefault();
                const factor = Math.exp(-event.deltaY * 0.0012);
                zoomAt(event.clientX, event.clientY, factor);
            },
            { passive: false }
        );

        diagram.addEventListener("pointerdown", (event) => {
            if (event.target.closest(".diagram-controls")) return;
            if (event.pointerType === "mouse" && event.button !== 0) return;

            state.dragging = true;
            state.pointerId = event.pointerId;
            state.startX = event.clientX;
            state.startY = event.clientY;
            state.startBox = state.viewBox ? cloneBox(state.viewBox) : null;

            diagram.classList.add("is-panning");
            diagram.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        diagram.addEventListener("pointermove", (event) => {
            if (!state.dragging || event.pointerId !== state.pointerId || !state.startBox) return;

            const rect = canvas.getBoundingClientRect();
            const dx = ((event.clientX - state.startX) / rect.width) * state.startBox.width;
            const dy = ((event.clientY - state.startY) / rect.height) * state.startBox.height;

            state.viewBox = clampViewBox({
                ...state.startBox,
                x: state.startBox.x - dx,
                y: state.startBox.y - dy,
            });
            applyViewBox();
        });

        function endPan(event) {
            if (event.pointerId !== state.pointerId) return;
            state.dragging = false;
            state.pointerId = null;
            state.startBox = null;
            diagram.classList.remove("is-panning");
            if (diagram.hasPointerCapture(event.pointerId)) {
                diagram.releasePointerCapture(event.pointerId);
            }
        }

        diagram.addEventListener("pointerup", endPan);
        diagram.addEventListener("pointercancel", endPan);
        diagram.addEventListener("lostpointercapture", () => {
            state.dragging = false;
            state.pointerId = null;
            state.startBox = null;
            diagram.classList.remove("is-panning");
        });

        controls.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if (!button) return;

            if (button.dataset.action === "zoom-in") zoomFromCenter(1.18);
            if (button.dataset.action === "zoom-out") zoomFromCenter(1 / 1.18);
            if (button.dataset.action === "reset") reset();
        });

        connectSvg(svg);

        if ("ResizeObserver" in window) {
            const resizeObserver = new ResizeObserver(resizeViewBox);
            resizeObserver.observe(canvas);
        }

        diagram.dataset.zoom = "100%";
    }

    function initAllDiagrams() {
        document.querySelectorAll(".diagram").forEach(watchDiagramForSvg);
    }

    initAllDiagrams();
    window.addEventListener("formbar:mermaid-ready", () => {
        window.requestAnimationFrame(initAllDiagrams);
    });
    window.addEventListener("load", initAllDiagrams);

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
