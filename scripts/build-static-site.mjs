import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const siteDir = path.join(projectRoot, 'site');

const ROOT_FILES = [
  'index.html',
  'scanner.css',
  'favicon.svg',
];

rmSync(siteDir, { recursive: true, force: true });
mkdirSync(siteDir, { recursive: true });

for (const relativePath of ROOT_FILES) {
  const sourcePath = path.join(projectRoot, relativePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing deployment asset: ${relativePath}`);
  }
  cpSync(sourcePath, path.join(siteDir, relativePath));
}

cpSync(path.join(projectRoot, 'dist'), path.join(siteDir, 'dist'), { recursive: true });
writeFileSync(path.join(siteDir, '.nojekyll'), '');
