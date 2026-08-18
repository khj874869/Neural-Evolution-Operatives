import { readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.cwd());
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
if (packageJson.name !== 'neural-evolution-operatives') {
  throw new Error('Refusing to clean server output outside the Neural Evolution repository');
}

const output = path.resolve(root, 'dist-server');
const expectedOutput = path.join(root, 'dist-server');
if (output !== expectedOutput || path.dirname(output) !== root || path.basename(output) !== 'dist-server') {
  throw new Error(`Refusing to clean unexpected output path: ${output}`);
}

await rm(output, { recursive: true, force: true, maxRetries: 3 });
console.log(`Cleaned ${path.relative(root, output)}/`);
