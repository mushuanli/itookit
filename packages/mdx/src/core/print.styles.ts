// @file: mdx/core/print.styles.ts

/**
 * 打印服务样式常量
 * 使用 BEM 命名规范：Block__Element--Modifier
 */
export const PRINT_STYLES = `
/* ============================================
   ROOT & TYPOGRAPHY
   ============================================ */

.mdx-print {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, 
                 "Helvetica Neue", Arial, sans-serif,
                 "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol";
    font-size: 14px;
    line-height: 1.6;
    color: #24292f;
    background: #ffffff;
    max-width: 800px;
    margin: 0 auto;
    padding: 40px 20px;
}

.mdx-print * {
    box-sizing: border-box;
}

/* ============================================
   HEADER
   ============================================ */

.mdx-print-header {
    margin-bottom: 32px;
    padding-bottom: 16px;
    border-bottom: 2px solid #e0e0e0;
}

.mdx-print-header__title {
    margin: 0;
    font-size: 1.75em;
    font-weight: 600;
    color: #24292f;
}

.mdx-print-header__meta {
    margin: 8px 0 0;
    font-size: 0.875em;
    color: #656d76;
}

.mdx-print-header__meta-item {
    display: inline;
}

.mdx-print-header__meta-item:not(:last-child)::after {
    content: " · ";
    color: #d0d7de;
}

/* ============================================
   HEADINGS
   ============================================ */

.mdx-print h1,
.mdx-print h2,
.mdx-print h3,
.mdx-print h4,
.mdx-print h5,
.mdx-print h6 {
    margin-top: 24px;
    margin-bottom: 16px;
    font-weight: 600;
    line-height: 1.25;
}

.mdx-print h1 {
    font-size: 2em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid #d8dee4;
}

.mdx-print h2 {
    font-size: 1.5em;
    padding-bottom: 0.3em;
    border-bottom: 1px solid #d8dee4;
}

.mdx-print h3 { font-size: 1.25em; }
.mdx-print h4 { font-size: 1em; }
.mdx-print h5 { font-size: 0.875em; }
.mdx-print h6 { font-size: 0.85em; color: #656d76; }

/* ============================================
   PARAGRAPHS & INLINE ELEMENTS
   ============================================ */

.mdx-print p { margin: 0 0 16px; }
.mdx-print strong { font-weight: 600; }
.mdx-print em { font-style: italic; }

.mdx-print a {
    color: #0969da;
    text-decoration: none;
}

.mdx-print mark {
    background-color: #fff8c5;
    padding: 0.1em 0.2em;
    border-radius: 2px;
}

.mdx-print del {
    text-decoration: line-through;
    color: #656d76;
}

/* ============================================
   LISTS
   ============================================ */

.mdx-print ul,
.mdx-print ol {
    margin: 0 0 16px;
    padding-left: 2em;
}

.mdx-print li { margin: 0.25em 0; }
.mdx-print li > p { margin: 0; }

/* ============================================
   CODE
   ============================================ */

.mdx-print code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.875em;
    background-color: rgba(175, 184, 193, 0.2);
    border-radius: 6px;
    padding: 0.2em 0.4em;
}

.mdx-print pre {
    margin: 0 0 16px;
    padding: 16px;
    overflow-x: auto;
    font-size: 0.875em;
    line-height: 1.45;
    background-color: #f6f8fa;
    border: 1px solid #d0d7de;
    border-radius: 6px;
}

.mdx-print pre code {
    background: transparent;
    padding: 0;
    border-radius: 0;
    font-size: inherit;
}

/* ============================================
   TABLE
   ============================================ */

.mdx-print table {
    border-collapse: collapse;
    width: 100%;
    margin: 0 0 16px;
}

.mdx-print th,
.mdx-print td {
    padding: 6px 13px;
    border: 1px solid #d0d7de;
    text-align: left;
}

.mdx-print th {
    font-weight: 600;
    background-color: #f6f8fa;
}

.mdx-print tr:nth-child(2n) {
    background-color: #f6f8fa;
}

/* ============================================
   BLOCKQUOTE
   ============================================ */

.mdx-print blockquote {
    margin: 0 0 16px;
    padding: 0 1em;
    color: #656d76;
    border-left: 0.25em solid #d0d7de;
}

/* ============================================
   HORIZONTAL RULE
   ============================================ */

.mdx-print hr {
    height: 0.25em;
    padding: 0;
    margin: 24px 0;
    background-color: #d0d7de;
    border: 0;
}

/* ============================================
   IMAGES
   ============================================ */

.mdx-print img {
    max-width: 100%;
    height: auto;
    display: block;
    margin: 16px 0;
}

/* ============================================
   CALLOUT / ADMONITION
   ============================================ */

.mdx-print-callout {
    margin: 16px 0;
    padding: 16px;
    border-radius: 6px;
    border-left: 4px solid;
}

.mdx-print-callout--note {
    border-left-color: #0969da;
    background-color: #ddf4ff;
}

.mdx-print-callout--warning {
    border-left-color: #9a6700;
    background-color: #fff8c5;
}

.mdx-print-callout--danger {
    border-left-color: #cf222e;
    background-color: #ffebe9;
}

.mdx-print-callout--tip {
    border-left-color: #1a7f37;
    background-color: #dafbe1;
}

/* ============================================
   LLM CONVERSATION - MESSAGE
   ============================================ */

.mdx-print-message {
    margin: 16px 0;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid;
}

.mdx-print-message__header {
    display: flex;
    align-items: center;
    margin-bottom: 12px;
}

.mdx-print-message__avatar {
    width: 28px;
    height: 28px;
    border-radius: 50%;
    margin-right: 10px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
}

.mdx-print-message__role {
    font-size: 0.8125em;
    font-weight: 600;
    text-transform: uppercase;
}

.mdx-print-message--user {
    background-color: #ddf4ff;
    border-color: #54aeff;
    margin-left: 10%;
}

.mdx-print-message--user .mdx-print-message__avatar {
    background-color: #0969da;
    color: #ffffff;
}

.mdx-print-message--assistant {
    background-color: #f6f8fa;
    border-color: #d0d7de;
    margin-right: 10%;
}

.mdx-print-message--assistant .mdx-print-message__avatar {
    background-color: #8250df;
    color: #ffffff;
}

.mdx-print-message--system {
    background-color: #fff8c5;
    border-color: #d4a72c;
    font-style: italic;
}

/* ============================================
   LLM CONVERSATION - SESSION DIVIDER
   ============================================ */

.mdx-print-session {
    position: relative;
    margin: 32px 0;
    text-align: center;
}

.mdx-print-session__line {
    position: absolute;
    top: 50%;
    left: 0;
    right: 0;
    border-top: 2px dashed #d0d7de;
}

.mdx-print-session__label {
    position: relative;
    display: inline-block;
    padding: 4px 16px;
    background-color: #ffffff;
    font-size: 0.75em;
    font-weight: 500;
    color: #656d76;
    text-transform: uppercase;
}

/* ============================================
   PRINT-SPECIFIC STYLES
   ============================================ */

@media print {
    .mdx-print {
        max-width: none;
        padding: 0;
        font-size: 12pt;
    }

    .mdx-print,
    .mdx-print * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
    }

    .mdx-print a {
        color: inherit;
        text-decoration: underline;
    }

    .mdx-print a[href]::after {
        content: none !important;
    }

    .mdx-print h1,
    .mdx-print h2,
    .mdx-print h3 {
        page-break-after: avoid;
        break-after: avoid;
    }

    .mdx-print pre,
    .mdx-print blockquote,
    .mdx-print table,
    .mdx-print img,
    .mdx-print-message {
        page-break-inside: avoid;
        break-inside: avoid;
    }

    .mdx-print p,
    .mdx-print li {
        orphans: 3;
        widows: 3;
    }

    .mdx-print-message--user,
    .mdx-print-message--assistant {
        margin-left: 0;
        margin-right: 0;
    }
}

@page {
    margin: 20mm 15mm;
    size: A4;
}

/* ============================================
   UTILITY CLASSES
   ============================================ */

.mdx-print--compact {
    font-size: 12px;
    line-height: 1.5;
}

.mdx-print--no-header .mdx-print-header {
    display: none;
}
`;
