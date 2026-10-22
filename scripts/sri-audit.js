#!/usr/bin/env node
/**
 * SRI Audit Script (issue #298)
 *
 * Scans all HTML and TypeScript/JavaScript files for external ASSET references
 * — specifically <script src="…"> and <link href="…"> pointing to http/https
 * URLs — that lack an `integrity` attribute.
 *
 * Navigation links (<a href="…">) are intentionally ignored: SRI applies only
 * to subresources loaded by the browser, not to hyperlinks.
 *
 * Any finding causes a non-zero exit code, failing CI.
 *
 * Usage:
 *   node scripts/sri-audit.js
 *
 * To update SRI hashes when an external asset is upgraded, see
 *   docs/sri-policy.md
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { globSync } = require("glob");

// File patterns to scan
const PATTERNS = [
  "src/**/*.{ts,tsx,js,jsx}",
  "public/**/*.html",
  "pages/**/*.{ts,tsx,js,jsx}",
];

// Directories to exclude from scanning
const EXCLUDED = ["node_modules", ".next", "dist", "build", ".git", "coverage"];

function shouldExclude(filePath) {
  return EXCLUDED.some((ex) => filePath.split(path.sep).includes(ex));
}

// Match entire <script …> and <link …> elements (single-line)
const SCRIPT_SRC_RE = /(<script\b[^>]*?\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>)/gi;
const LINK_HREF_RE  = /(<link\b[^>]*?\bhref=["'](https?:\/\/[^"']+)["'][^>]*\/?>)/gi;

function missingIntegrity(elementStr) {
  return !/\bintegrity=["']sha/i.test(elementStr);
}

const findings = [];

for (const pattern of PATTERNS) {
  const files = globSync(pattern, { cwd: process.cwd(), absolute: true });

  for (const file of files) {
    if (shouldExclude(file)) continue;

    const content = fs.readFileSync(file, "utf-8");

    // Check <script src="https://…">
    SCRIPT_SRC_RE.lastIndex = 0;
    let match;
    while ((match = SCRIPT_SRC_RE.exec(content)) !== null) {
      const [, element, url] = match;
      if (missingIntegrity(element)) {
        const lineNumber = content.slice(0, match.index).split("\n").length;
        findings.push({ file: path.relative(process.cwd(), file), line: lineNumber, type: "script", url });
      }
    }

    // Check <link href="https://…">
    LINK_HREF_RE.lastIndex = 0;
    while ((match = LINK_HREF_RE.exec(content)) !== null) {
      const [, element, url] = match;
      if (missingIntegrity(element)) {
        const lineNumber = content.slice(0, match.index).split("\n").length;
        findings.push({ file: path.relative(process.cwd(), file), line: lineNumber, type: "link", url });
      }
    }
  }
}

if (findings.length === 0) {
  console.log("✅ SRI audit passed — no unprotected external script/stylesheet assets found.");
  process.exit(0);
} else {
  console.error(`\n❌ SRI audit FAILED — ${findings.length} external asset(s) missing integrity= attribute:\n`);
  for (const f of findings) {
    console.error(`  [${f.type}] ${f.file}:${f.line}`);
    console.error(`    URL: ${f.url}`);
    console.error(`    Fix: Migrate to a locally-hosted copy (preferred), or add`);
    console.error(`         integrity="sha384-<hash>" crossorigin="anonymous".\n`);
  }
  console.error("See docs/sri-policy.md for how to generate SRI hashes.");
  process.exit(1);
}
