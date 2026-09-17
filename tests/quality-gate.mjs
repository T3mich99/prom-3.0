import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] ?? 'all';

function repositoryFiles() {
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: repoRoot, encoding: 'utf8' });
  if (result.status !== 0) {
    // GitHub ZIPs have no .git; keep the same test gate usable after extraction.
    const scan = (directory = '') => readdirSync(path.join(repoRoot, directory), { withFileTypes: true }).flatMap((entry) => {
      if (['node_modules', '.git', 'runtime', 'outputs', '__pycache__'].includes(entry.name)) return [];
      const relative = path.join(directory, entry.name);
      return entry.isDirectory() ? scan(relative) : entry.isFile() ? [relative] : [];
    });
    return scan();
  }
  return result.stdout.split('\0').filter(Boolean);
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function filesWithExtension(extension) {
  return repositoryFiles().filter((file) => file.endsWith(extension));
}

function runNodeTests() {
  const files = filesWithExtension('.test.mjs');
  if (!files.length) throw new Error('No Node test files found');
  console.log(`Running ${files.length} Node test files`);
  run(process.execPath, ['--test', ...files]);
}

function runMjsSyntax() {
  const files = filesWithExtension('.mjs');
  for (const file of files) run(process.execPath, ['--check', file]);
  console.log(`MJS syntax checked: ${files.length}`);
}

function findExecutable(candidates, args) {
  for (const candidate of candidates) {
    const result = spawnSync(candidate, args, { cwd: repoRoot, stdio: 'ignore' });
    if (!result.error && result.status === 0) return candidate;
  }
  throw new Error(`None of these executables is available: ${candidates.join(', ')}`);
}

function runPythonSyntax() {
  const files = filesWithExtension('.py');
  const configured = process.env.PYTHON;
  const candidates = configured ? [configured] : process.platform === 'win32' ? ['py', 'python'] : ['python3', 'python'];
  const executable = findExecutable(candidates, ['--version']);
  run(executable, ['-m', 'py_compile', ...files]);
  console.log(`Python syntax checked: ${files.length}`);
}

function runPowerShellSyntax() {
  const configured = process.env.POWERSHELL;
  const candidates = configured ? [configured] : process.platform === 'win32' ? ['pwsh', 'powershell'] : ['pwsh'];
  const executable = findExecutable(candidates, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
  const command = `$files = git ls-files -- '*.ps1'
foreach ($file in $files) {
  $tokens = $null
  $errors = $null
  [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $file), [ref]$tokens, [ref]$errors) | Out-Null
  if ($errors.Count -gt 0) {
    $errors | Format-List | Out-String | Write-Output
    exit 1
  }
}`;
  run(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]);
  console.log(`PowerShell syntax checked: ${filesWithExtension('.ps1').length}`);
}

const tasks = {
  'node-tests': runNodeTests,
  'mjs-syntax': runMjsSyntax,
  'python-syntax': runPythonSyntax,
  'powershell-syntax': runPowerShellSyntax,
};

if (mode === 'all') {
  for (const task of Object.values(tasks)) task();
} else if (tasks[mode]) {
  tasks[mode]();
} else {
  throw new Error(`Unknown quality-gate mode: ${mode}`);
}
