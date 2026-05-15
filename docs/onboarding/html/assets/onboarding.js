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
            svg: null,
            scale: 1,
            baseVX: 0, baseVY: 0, baseVW: 0, baseVH: 0,
            vx: 0, vy: 0, vw: 0, vh: 0,
            dragging: false,
            pointerId: null,
            startX: 0, startY: 0,
            startVX: 0, startVY: 0,
        };

        function applyViewBox() {
            if (!state.svg) return;
            state.svg.setAttribute("viewBox", `${state.vx} ${state.vy} ${state.vw} ${state.vh}`);
            diagram.dataset.zoom = `${Math.round(state.scale * 100)}%`;
        }

        function resetViewBox() {
            state.scale = 1;
            state.vx = state.baseVX;
            state.vy = state.baseVY;
            state.vw = state.baseVW;
            state.vh = state.baseVH;
            applyViewBox();
        }

        function zoomAt(clientX, clientY, factor) {
            if (!state.svg) return;
            const rect = canvas.getBoundingClientRect();
            const nextScale = clamp(state.scale * factor, 0.35, 4);

            // Cursor as a fraction of the canvas
            const fx = (clientX - rect.left) / rect.width;
            const fy = (clientY - rect.top) / rect.height;

            // SVG coordinate under the cursor before zooming
            const svgX = state.vx + fx * state.vw;
            const svgY = state.vy + fy * state.vh;

            // New viewBox dimensions at the new scale
            const newVW = state.baseVW / nextScale;
            const newVH = state.baseVH / nextScale;

            // Shift origin so that the SVG point stays under the cursor
            state.vx = svgX - fx * newVW;
            state.vy = svgY - fy * newVH;
            state.vw = newVW;
            state.vh = newVH;
            state.scale = nextScale;
            applyViewBox();
        }

        function zoomFromCenter(factor) {
            const rect = canvas.getBoundingClientRect();
            zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
        }

        function connectSvg(renderedSvg) {
            if (!renderedSvg || state.svg === renderedSvg) return;
            state.svg = renderedSvg;

            // Switch to non-uniform scaling so the viewBox maps 1:1 to the canvas.
            // We compensate by padding the base viewBox to match the container
            // aspect ratio, which avoids any distortion at scale=1.
            state.svg.setAttribute("preserveAspectRatio", "none");
            state.svg.removeAttribute("width");
            state.svg.removeAttribute("height");

            // Parse the original viewBox written by Mermaid
            const vbAttr = state.svg.getAttribute("viewBox");
            let ox = 0, oy = 0, ow = 800, oh = 600;
            if (vbAttr) {
                const parts = vbAttr.trim().split(/[\s,]+/).map(Number);
                if (parts.length >= 4 && parts.every(isFinite)) {
                    [ox, oy, ow, oh] = parts;
                }
            }

            // Expand the base viewBox to match the canvas aspect ratio so the
            // SVG always fills the canvas without distortion at scale=1
            const rect = canvas.getBoundingClientRect();
            const cw = rect.width > 0 ? rect.width : 800;
            const ch = rect.height > 0 ? rect.height : 600;
            const diagramAR = ow / oh;
            const containerAR = cw / ch;

            let baseVX, baseVY, baseVW, baseVH;
            if (diagramAR > containerAR) {
                // Wider than the canvas — fit width, pad vertically
                baseVW = ow;
                baseVH = ow / containerAR;
                baseVX = ox;
                baseVY = oy - (baseVH - oh) / 2;
            } else {
                // Taller than the canvas — fit height, pad horizontally
                baseVH = oh;
                baseVW = oh * containerAR;
                baseVX = ox - (baseVW - ow) / 2;
                baseVY = oy;
            }

            state.baseVX = baseVX;
            state.baseVY = baseVY;
            state.baseVW = baseVW;
            state.baseVH = baseVH;

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
            state.startVX = state.vx;
            state.startVY = state.vy;

            diagram.classList.add("is-panning");
            diagram.setPointerCapture(event.pointerId);
            event.preventDefault();
        });

        diagram.addEventListener("pointermove", (event) => {
            if (!state.dragging || event.pointerId !== state.pointerId) return;

            const rect = canvas.getBoundingClientRect();
            const dxScreen = event.clientX - state.startX;
            const dyScreen = event.clientY - state.startY;

            // Convert screen-pixel delta to SVG-coordinate delta
            state.vx = state.startVX - (dxScreen / rect.width) * state.vw;
            state.vy = state.startVY - (dyScreen / rect.height) * state.vh;
            applyViewBox();
        });

        function endPan(event) {
            if (event.pointerId !== state.pointerId) return;
            state.dragging = false;
            state.pointerId = null;
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
            diagram.classList.remove("is-panning");
        });

        controls.addEventListener("click", (event) => {
            const button = event.target.closest("button");
            if (!button) return;

            if (button.dataset.action === "zoom-in") zoomFromCenter(1.18);
            if (button.dataset.action === "zoom-out") zoomFromCenter(1 / 1.18);
            if (button.dataset.action === "reset") resetViewBox();
        });

        connectSvg(svg);

        diagram.dataset.zoom = "100%";
    }

    function initAllDiagrams() {
        document.querySelectorAll(".diagram").forEach(watchDiagramForSvg);
    }

    window.addEventListener("formbar:mermaid-ready", () => {
        window.requestAnimationFrame(initAllDiagrams);
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