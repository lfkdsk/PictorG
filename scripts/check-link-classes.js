#!/usr/bin/env node
/*
 * Lint guard against a recurring styled-jsx footgun.
 *
 * styled-jsx only adds its generated scoping class to plain DOM elements
 * (`div`, `a`, `span`, …). It does NOT add it to imported React components
 * such as next/link's <Link>. So a `<Link className="foo">` whose `.foo`
 * rule lives in a (scoped) `<style jsx>` block silently renders unstyled —
 * the styles never reach the underlying <a>, which is a common source of
 * "the CSS is broken again" bugs.
 *
 * This script fails (exit 1) when a <Link> uses a className whose classes
 * are not available GLOBALLY, where "global" means defined in:
 *   1. src/app/globals.css,
 *   2. a `<style jsx global>` block, or
 *   3. styled-jsx's `:global(...)` escape hatch.
 *
 * Safe ways to style a link:
 *   - <Link href={..} legacyBehavior><a className="foo">…</a></Link>
 *   - put the class in globals.css / a `<style jsx global>` block / :global(...)
 *   - use inline `style={{…}}` (the style prop forwards to the <a>)
 *
 * Only static string-literal classNames are analysed; dynamic
 * `className={…}` expressions are skipped.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      walk(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function main() {
  const files = walk(SRC);

  // Build the global CSS text.
  let globalCss = '';
  const globalsCss = path.join(SRC, 'app', 'globals.css');
  if (fs.existsSync(globalsCss)) globalCss += fs.readFileSync(globalsCss, 'utf8');
  const globalBlock = /<style\s+jsx\s+global[\s\S]*?<\/style>/g;
  const globalEscape = /:global\(([^)]*)\)/g;
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8');
    const blocks = text.match(globalBlock);
    if (blocks) globalCss += '\n' + blocks.join('\n');
    let g;
    globalEscape.lastIndex = 0;
    while ((g = globalEscape.exec(text)) !== null) globalCss += '\n' + g[1];
  }

  const isGlobalClass = (cls) =>
    new RegExp('\\.' + escapeRegExp(cls) + '(?![\\w-])').test(globalCss);

  // `[^>]` stops at the end of the opening tag; sufficient here because no
  // <Link> in this codebase has a `>` before its className.
  const linkClassName = /<Link\b[^>]*?\bclassName\s*=\s*"([^"]+)"/g;
  const violations = [];
  const root = path.join(SRC, '..');

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    linkClassName.lastIndex = 0;
    while ((m = linkClassName.exec(text)) !== null) {
      const scopedOnly = m[1].split(/\s+/).filter(Boolean).filter((c) => !isGlobalClass(c));
      if (scopedOnly.length > 0) {
        violations.push(`  ${path.relative(root, file)}: <Link className="${m[1]}"> → not global: ${scopedOnly.join(', ')}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error('\n✗ styled-jsx <Link className> guard failed.\n');
    console.error('These <Link>s reference scoped styled-jsx classes that never reach the <a>:');
    console.error(violations.join('\n'));
    console.error('\nFix: use <Link legacyBehavior><a className="…"/></Link>, a global/:global() class, or inline style={{…}}.\n');
    process.exit(1);
  }
  console.log('✓ styled-jsx <Link className> guard passed (no scoped classes on <Link>).');
}

main();
