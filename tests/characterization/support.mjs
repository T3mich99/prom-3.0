import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const testsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.resolve(testsDir, '..');

export const repoPath = (...parts) => path.join(repoRoot, ...parts);

export async function readProduction(relativePath) {
  return fs.readFile(repoPath(relativePath), 'utf8');
}

function findBalancedBlock(source, openIndex) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = openIndex; i < source.length; i += 1) {
    const current = source[i];
    const next = source[i + 1];

    if (lineComment) {
      if (current === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === quote) {
        quote = null;
      }
      continue;
    }
    if (current === '/' && next === '/') {
      lineComment = true;
      i += 1;
      continue;
    }
    if (current === '/' && next === '*') {
      blockComment = true;
      i += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === '`') {
      quote = current;
      continue;
    }
    if (current === '{') depth += 1;
    if (current === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, i + 1);
    }
  }
  throw new Error(`Unbalanced block starting at ${openIndex}`);
}

export function extractFunction(source, name) {
  const start = source.search(new RegExp(`function\\s+${name}\\s*\\(`, 'u'));
  assert.notEqual(start, -1, `function ${name} must still exist in production source`);
  const open = source.indexOf('{', start);
  assert.notEqual(open, -1, `function ${name} must have a body`);
  const block = findBalancedBlock(source, open);
  return source.slice(start, open + block.length);
}

export function extractArrowExpression(source, name) {
  const declaration = source.match(new RegExp(`const\\s+${name}\\s*=`, 'u'));
  assert.ok(declaration, `arrow expression ${name} must still exist in production source`);
  const valueStart = declaration.index + declaration[0].length;
  const arrow = source.indexOf('=>', valueStart);
  assert.notEqual(arrow, -1, `arrow expression ${name} must still have an arrow`);
  const bodyStart = source.slice(arrow + 2).search(/\S/u) + arrow + 2;
  if (source[bodyStart] === '{') {
    const block = findBalancedBlock(source, bodyStart);
    return source.slice(valueStart, bodyStart + block.length).trim();
  }
  const end = source.indexOf(';', bodyStart);
  assert.notEqual(end, -1, `arrow expression ${name} must end with a semicolon`);
  return source.slice(valueStart, end).trim();
}

export function evaluateFunction(functionSource, ...parameters) {
  return Function(...parameters.map((parameter) => parameter.name), `return (${functionSource});`)(...parameters.map((parameter) => parameter.value));
}

export function evaluateExpression(expression) {
  return Function(`return (${expression});`)();
}

export function assertSource(source, pattern, message) {
  assert.match(source, pattern, message);
}

export function countPhrases(value) {
  return String(value ?? '').split(', ').filter(Boolean).length;
}

export function directDriveUrl(id) {
  return id ? `https://lh3.googleusercontent.com/d/${id}=w1280` : '';
}

export const PHOTO_ROLES = ['01_main', '02_benefits', '03_features', '04_use', '05_details'];
