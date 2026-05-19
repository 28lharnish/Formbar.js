const fs = require("fs");
const path = require("path");

const ROOT_DIR = __dirname;
const OUT_DIR = path.join(ROOT_DIR, "html");

const pages = [
    {
        source: "README.md",
        output: "index.html",
        navTitle: "Start Here",
        description: "Setup, project shape, task routing, glossary, and common pitfalls.",
    },
    {
        source: "branches.md",
        output: "branches.html",
        navTitle: "Git Branches",
        description: "What main, RC, and DEV are for and what each branch contains today.",
    },
    {
        source: "project-map.md",
        output: "project-map.html",
        navTitle: "Project Map",
        description: "Where code lives and where new code usually belongs.",
    },
    {
        source: "runtime-flow.md",
        output: "runtime-flow.html",
        navTitle: "Runtime Flow",
        description: "Startup, HTTP request routing, sockets, errors, and debugging checks.",
    },
    {
        source: "data-and-auth.md",
        output: "data-and-auth.html",
        navTitle: "Data And Auth",
        description: "SQLite, migrations, auth paths, tokens, API keys, roles, and scopes.",
    },
    {
        source: "dev-workflow.md",
        output: "dev-workflow.html",
        navTitle: "Developer Workflow",
        description: "Daily commands, change workflows, testing, and handoff checklist.",
    },
    {
        source: "architecture.md",
        output: "architecture.html",
        navTitle: "Architecture",
        description: "Visual maps of the backend, request lifecycle, sockets, auth, and data.",
    },
    {
        source: "codebase-map.md",
        output: "codebase-map.html",
        navTitle: "Codebase Map",
        description: "Detailed directory, file, test, and ownership inventory.",
    },
    {
        source: "feature-state.md",
        output: "feature-state.html",
        navTitle: "Feature State",
        description: "Implemented areas, partial work, deprecated paths, and follow-up risks.",
    },
];

const pageBySource = new Map(pages.map((page) => [page.source.toLowerCase(), page]));

/** Content between these markers is kept in markdown sources but omitted from generated HTML. */
const OMIT_FROM_HTML_START = /<!--\s*omit-from-onboarding-html:start\s*-->/;
const OMIT_FROM_HTML_END = /<!--\s*omit-from-onboarding-html:end\s*-->/;

function stripOmitFromHtmlSections(markdown) {
    const text = String(markdown).replace(/\r\n/g, "\n");
    let result = "";
    let pos = 0;

    while (pos < text.length) {
        const slice = text.slice(pos);
        const startMatch = slice.match(OMIT_FROM_HTML_START);
        if (!startMatch || startMatch.index === undefined) {
            result += slice;
            break;
        }

        const startIndex = pos + startMatch.index;
        result += text.slice(pos, startIndex);
        const afterStart = startIndex + startMatch[0].length;
        const tail = text.slice(afterStart);
        const endMatch = tail.match(OMIT_FROM_HTML_END);
        if (!endMatch || endMatch.index === undefined) {
            result += text.slice(startIndex);
            break;
        }

        pos = afterStart + endMatch.index + endMatch[0].length;
    }

    return result.replace(/\n{3,}/g, "\n\n");
}

function escapeHtml(value) {
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
}

function stripInlineMarkdown(value) {
    return value
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();
}

function slugify(value, usedSlugs) {
    const base =
        stripInlineMarkdown(value)
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .trim()
            .replace(/\s+/g, "-") || "section";

    const count = usedSlugs.get(base) || 0;
    usedSlugs.set(base, count + 1);
    return count === 0 ? base : `${base}-${count + 1}`;
}

function convertMarkdownHref(href) {
    if (/^(https?:|mailto:|#)/i.test(href)) {
        return href;
    }

    const [target, hash] = href.split("#");
    const cleanTarget = target.replace(/^\.\//, "");
    const page = pageBySource.get(cleanTarget.toLowerCase());

    if (page) {
        return `${page.output}${hash ? `#${hash}` : ""}`;
    }

    if (cleanTarget.endsWith(".md")) {
        const output = cleanTarget.replace(/\.md$/i, ".html");
        return `${output}${hash ? `#${hash}` : ""}`;
    }

    return href;
}

function renderInline(value) {
    const codeSpans = [];
    let text = value.replace(/`([^`]+)`/g, (_, code) => {
        const token = `@@CODE_${codeSpans.length}@@`;
        codeSpans.push(`<code>${escapeHtml(code)}</code>`);
        return token;
    });

    text = escapeHtml(text);

    text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
        const convertedHref = convertMarkdownHref(href.trim());
        return `<a href="${escapeAttribute(convertedHref)}">${label}</a>`;
    });

    codeSpans.forEach((code, index) => {
        text = text.replace(`@@CODE_${index}@@`, code);
    });

    return text;
}

function isHeading(line) {
    return /^#{1,6}\s+/.test(line);
}

function isFence(line) {
    return /^```/.test(line.trim());
}

function isListItem(line) {
    return /^\s*(?:[-*]|\d+\.)\s+/.test(line);
}

function isTableSeparator(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isTableStart(lines, index) {
    return lines[index]?.trim().startsWith("|") && isTableSeparator(lines[index + 1] || "");
}

function splitTableRow(line) {
    return line
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim());
}

function renderTable(lines) {
    const headers = splitTableRow(lines[0]);
    const bodyRows = lines.slice(2).map(splitTableRow);

    const head = headers.map((header) => `<th>${renderInline(header)}</th>`).join("");
    const body = bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join("")}</tr>`).join("\n");

    return ['<div class="table-wrap">', "<table>", `<thead><tr>${head}</tr></thead>`, `<tbody>${body}</tbody>`, "</table>", "</div>"].join("\n");
}

function renderList(lines) {
    const html = [];
    const stack = [];

    function closeList() {
        const current = stack.pop();
        if (current.openLi) html.push("</li>");
        html.push(`</${current.type}>`);
    }

    for (const line of lines) {
        const match = line.match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (!match) continue;

        const indent = match[1].replace(/\t/g, "    ").length;
        const type = /\d+\./.test(match[2]) ? "ol" : "ul";
        const content = match[3];

        while (stack.length && indent < stack[stack.length - 1].indent) {
            closeList();
        }

        if (!stack.length || indent > stack[stack.length - 1].indent || type !== stack[stack.length - 1].type) {
            html.push(`<${type}>`);
            stack.push({ type, indent, openLi: false });
        } else if (stack[stack.length - 1].openLi) {
            html.push("</li>");
        }

        stack[stack.length - 1].openLi = true;
        html.push(`<li>${renderInline(content)}`);
    }

    while (stack.length) {
        closeList();
    }

    return html.join("\n");
}

function renderParagraph(lines) {
    const raw = lines.join(" ").trim();
    const content = renderInline(raw);

    if (/^Beginner takeaway:/i.test(raw)) {
        return `<p class="takeaway">${content}</p>`;
    }

    if (/^Important:/i.test(raw)) {
        return `<p class="callout">${content}</p>`;
    }

    return `<p>${content}</p>`;
}

function renderMarkdown(markdown) {
    const lines = markdown.replace(/\r\n/g, "\n").split("\n");
    const usedSlugs = new Map();
    const headings = [];
    const html = [];
    let title = "Documentation";
    let skippedFirstH1 = false;
    let hasMermaid = false;

    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!trimmed || /^Back to:\s+/i.test(trimmed)) {
            i += 1;
            continue;
        }

        if (isFence(line)) {
            const language = trimmed.replace(/^```/, "").trim() || "text";
            const codeLines = [];
            i += 1;
            while (i < lines.length && !isFence(lines[i])) {
                codeLines.push(lines[i]);
                i += 1;
            }
            i += 1;

            const code = codeLines.join("\n");
            if (language.toLowerCase() === "mermaid") {
                hasMermaid = true;
                html.push(`<div class="diagram"><pre class="mermaid">${escapeHtml(code)}</pre></div>`);
            } else {
                html.push(
                    `<div class="code-block" data-language="${escapeAttribute(language)}"><pre><code class="language-${escapeAttribute(language)}">${escapeHtml(code)}</code></pre></div>`
                );
            }
            continue;
        }

        if (isHeading(line)) {
            const match = line.match(/^(#{1,6})\s+(.*)$/);
            const level = match[1].length;
            const rawTitle = match[2].trim();
            const textTitle = stripInlineMarkdown(rawTitle);

            if (level === 1 && !skippedFirstH1) {
                title = textTitle;
                skippedFirstH1 = true;
                i += 1;
                continue;
            }

            const id = slugify(rawTitle, usedSlugs);
            headings.push({ id, level, title: textTitle });
            html.push(
                `<h${level} id="${id}"><a class="heading-anchor" href="#${id}" aria-label="Link to ${escapeAttribute(textTitle)}">#</a>${renderInline(rawTitle)}</h${level}>`
            );
            i += 1;
            continue;
        }

        if (isTableStart(lines, i)) {
            const tableLines = [];
            while (i < lines.length && lines[i].trim().startsWith("|")) {
                tableLines.push(lines[i]);
                i += 1;
            }
            html.push(renderTable(tableLines));
            continue;
        }

        if (isListItem(line)) {
            const listLines = [];
            while (i < lines.length && isListItem(lines[i])) {
                listLines.push(lines[i]);
                i += 1;
            }
            html.push(renderList(listLines));
            continue;
        }

        const paragraph = [];
        while (
            i < lines.length &&
            lines[i].trim() &&
            !/^Back to:\s+/i.test(lines[i].trim()) &&
            !isFence(lines[i]) &&
            !isHeading(lines[i]) &&
            !isTableStart(lines, i) &&
            !isListItem(lines[i])
        ) {
            paragraph.push(lines[i]);
            i += 1;
        }
        html.push(renderParagraph(paragraph));
    }

    return {
        title,
        headings,
        body: html.join("\n"),
        hasMermaid,
    };
}

function renderNav(activeOutput) {
    return pages
        .map((page) => {
            const active = page.output === activeOutput ? " active" : "";
            const current = page.output === activeOutput ? ' aria-current="page"' : "";
            return [
                `<a class="nav-card${active}" href="${page.output}"${current} data-search="${escapeAttribute(`${page.navTitle} ${page.description}`.toLowerCase())}">`,
                `<span>${escapeHtml(page.navTitle)}</span>`,
                `<small>${escapeHtml(page.description)}</small>`,
                "</a>",
            ].join("");
        })
        .join("\n");
}

function renderToc(headings) {
    const tocHeadings = headings.filter((heading) => heading.level === 2 || heading.level === 3);
    if (!tocHeadings.length) {
        return '<p class="toc-empty">No sections on this page.</p>';
    }

    return tocHeadings
        .map((heading) => {
            const indent = heading.level === 3 ? " nested" : "";
            return `<a class="toc-link${indent}" href="#${heading.id}">${escapeHtml(heading.title)}</a>`;
        })
        .join("\n");
}

function renderPage(page, parsed, index) {
    const previous = pages[index - 1];
    const next = pages[index + 1];
    const sourceHref = `../${page.source}`;
    const mermaidScript = parsed.hasMermaid
        ? '<script type="module">import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.esm.min.mjs"; mermaid.initialize({ startOnLoad: false, theme: "base", themeVariables: { primaryColor: "#eefcf8", primaryTextColor: "#102321", primaryBorderColor: "#2f9f8f", lineColor: "#5f6f6a", fontFamily: "Inter, Segoe UI, sans-serif" } }); await mermaid.run({ querySelector: ".mermaid" }); window.dispatchEvent(new Event("formbar:mermaid-ready"));</script>'
        : "";

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(parsed.title)} | Formbar.js Onboarding</title>
    <meta name="description" content="${escapeAttribute(page.description)}">
    <link rel="stylesheet" href="assets/onboarding.css">
    <script defer src="assets/onboarding.js"></script>
    ${mermaidScript}
</head>
<body>
    <a class="skip-link" href="#main">Skip to content</a>
    <header class="topbar">
        <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="sidebar">Menu</button>
        <a class="brand" href="index.html" aria-label="Formbar.js onboarding home">
            <span class="brand-mark">F</span>
            <span>
                <strong>Formbar.js</strong>
                <small>Onboarding Docs</small>
            </span>
        </a>
        <a class="source-link" href="${sourceHref}">Markdown source</a>
    </header>

    <div class="layout">
        <aside class="sidebar" id="sidebar">
            <div class="sidebar-inner">
                <label class="search-label" for="doc-search">Filter docs</label>
                <input id="doc-search" class="doc-search" type="search" placeholder="Search pages">
                <nav class="page-nav" aria-label="Documentation pages">
                    ${renderNav(page.output)}
                </nav>
            </div>
        </aside>

        <main class="content-shell" id="main">
            <section class="hero">
                <p class="eyebrow">Formbar.js Onboarding</p>
                <h1>${escapeHtml(parsed.title)}</h1>
                <p>${escapeHtml(page.description)}</p>
                <div class="hero-actions">
                    <a href="${sourceHref}">View Markdown</a>
                    <a href="index.html">Docs Home</a>
                </div>
            </section>

            <article class="doc-content">
                ${parsed.body}
            </article>

            <nav class="page-turner" aria-label="Page navigation">
                ${previous ? `<a class="turn-card previous" href="${previous.output}"><small>Previous</small><span>${escapeHtml(previous.navTitle)}</span></a>` : "<span></span>"}
                ${next ? `<a class="turn-card next" href="${next.output}"><small>Next</small><span>${escapeHtml(next.navTitle)}</span></a>` : "<span></span>"}
            </nav>
        </main>

        <aside class="toc" aria-label="Page sections">
            <div class="toc-inner">
                <h2>On This Page</h2>
                ${renderToc(parsed.headings)}
            </div>
        </aside>
    </div>
</body>
</html>
`;
}

function build() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    pages.forEach((page, index) => {
        const rawMarkdown = fs.readFileSync(path.join(ROOT_DIR, page.source), "utf8");
        const markdown = stripOmitFromHtmlSections(rawMarkdown);
        const parsed = renderMarkdown(markdown);
        const html = renderPage(page, parsed, index);
        fs.writeFileSync(path.join(OUT_DIR, page.output), html, "utf8");
    });

    console.log(`Built ${pages.length} onboarding HTML pages in ${path.relative(process.cwd(), OUT_DIR)}`);
}

build();
