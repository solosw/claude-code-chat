const fs = require('fs');
const content = fs.readFileSync('out/script.js', 'utf-8');

// Extract js code
const startMarker = '`<script>';
const endMarker = '</script>`';
const startIdx = content.indexOf(startMarker);
const endIdx = content.indexOf(endMarker);
const jsCode = content.substring(startIdx + startMarker.length, endIdx);

// Find ALL regex patterns and check them
const regexPattern = /(?<!\\)\/([^/\n]+)\/([gimsuy]*)/g;
let match;
let regexIndex = 0;
while ((match = regexPattern.exec(jsCode)) !== null) {
  regexIndex++;
  const pattern = match[1];
  const flags = match[2];
  const pos = match.index;
  // Get surrounding context
  const lineStart = jsCode.lastIndexOf('\n', pos) + 1;
  const lineEnd = jsCode.indexOf('\n', pos);
  const lineNum = jsCode.substring(0, pos).split('\n').length;
  const lineText = jsCode.substring(lineStart, lineEnd > 0 ? lineEnd : jsCode.length).trim();
  console.log(`Regex #${regexIndex} at line ~${lineNum}: /${pattern}/${flags}  Context: ${lineText.substring(0, 120)}`);
}

console.log('\n--- Checking bracket balance per section ---');

// Find our new code section brackets balance
const sections = [
  { name: 'autocomplete code', start: '// --- Inline command autocomplete ---', end: '// Add settings message handler to window message event' },
  { name: 'renderNativeCommandsInModal', start: 'function renderNativeCommandsInModal', end: null },
  { name: 'loadCustomSnippets', start: 'function loadCustomSnippets', end: null },
  { name: 'message handler', start: "window.addEventListener('message', event => {", end: null }
];

for (const section of sections) {
  const startIdx = jsCode.indexOf(section.start);
  if (startIdx < 0) {
    console.log(`Section "${section.name}": NOT FOUND`);
    continue;
  }

  let endIdx;
  if (section.end) {
    endIdx = jsCode.indexOf(section.end, startIdx);
  } else {
    // Find the end of the function (matching braces)
    let braceCount = 0;
    let started = false;
    endIdx = startIdx;
    for (let i = startIdx; i < jsCode.length; i++) {
      if (jsCode[i] === '{') { braceCount++; started = true; }
      if (jsCode[i] === '}') { braceCount--; }
      if (started && braceCount === 0) { endIdx = i + 1; break; }
    }
  }

  const sectionCode = jsCode.substring(startIdx, endIdx > startIdx ? endIdx : startIdx + 2000);
  const brackets = { '{': 0, '}': 0, '(': 0, ')': 0, '[': 0, ']': 0 };
  let inStr = false, strCh = '', inCmt = false, inBCmt = false;
  for (let i = 0; i < sectionCode.length; i++) {
    const ch = sectionCode[i];
    const nx = sectionCode[i+1];
    if (inBCmt) { if (ch === '*' && nx === '/') { inBCmt = false; i++; } continue; }
    if (inCmt) { if (ch === '\n') inCmt = false; continue; }
    if (inStr) { if (ch === '\\') { i++; continue; } if (ch === strCh) inStr = false; continue; }
    if (ch === '/' && nx === '/') { inCmt = true; continue; }
    if (ch === '/' && nx === '*') { inBCmt = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { inStr = true; strCh = ch; continue; }
    if (brackets[ch] !== undefined) brackets[ch]++;
  }
  const bracesBal = brackets['{'] - brackets['}'];
  const parensBal = brackets['('] - brackets[')'];
  const bracksBal = brackets['['] - brackets[']'];
  console.log(`Section "${section.name}": braces=${bracesBal}, parens=${parensBal}, brackets=${bracksBal}`);
  if (bracesBal !== 0 || parensBal !== 0 || bracksBal !== 0) {
    console.log('  WARNING: Unbalanced brackets in this section!');
  }
}