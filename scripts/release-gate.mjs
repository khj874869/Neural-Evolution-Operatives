import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const failures = [];
let checks = 0;

async function read(relativePath) {
  return readFile(path.join(root, relativePath), 'utf8');
}

async function exists(relativePath) {
  try {
    await access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function serviceBlock(compose, serviceName) {
  const lines = compose.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  if (start === -1) return '';
  const endOffset = lines.slice(start + 1).findIndex((line) => /^  [\w-]+:\s*$/.test(line));
  const end = endOffset === -1 ? lines.length : start + 1 + endOffset;
  return lines.slice(start, end).join('\n');
}

async function filesUnder(relativeDirectory) {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const relativePath = path.join(relativeDirectory, entry.name);
    return entry.isDirectory() ? filesUnder(relativePath) : [relativePath.replaceAll('\\', '/')];
  }));
  return nested.flat();
}

const packageJson = JSON.parse(await read('package.json'));
const releaseSource = await read('packages/shared/src/release.ts');
const androidGradle = await read('android/app/build.gradle');
const serviceWorker = await read('public/sw.js');
const viteConfig = await read('vite.config.ts');
const serverTsconfig = JSON.parse(await read('server/tsconfig.json'));
const gitignore = (await read('.gitignore')).split(/\r?\n/).map((line) => line.trim());
const androidWorkflow = await read('.github/workflows/android-alpha.yml');
const ciWorkflow = await read('.github/workflows/ci.yml');
const compose = await read('infra/docker-compose.yml');
const serverDockerfile = await read('infra/server.Dockerfile');

const sharedVersion = releaseSource.match(/APP_VERSION\s*=\s*['"]([^'"]+)['"]/)?.[1];
const androidVersion = androidGradle.match(/versionName\s+['"]([^'"]+)['"]/)?.[1];
const swVersion = serviceWorker.match(/CACHE_NAME\s*=\s*['"]neo-static-v([^'"]+)['"]/)?.[1];
const expectedVersionCode = Number(packageJson.version.split('.').reduce(
  (value, part, index) => value + Number(part) * [10000, 100, 1][index],
  0,
));

check(packageJson.version === sharedVersion, 'package.json and shared APP_VERSION must match');
check(packageJson.version === androidVersion, 'Android versionName must match package.json');
check(packageJson.version === swVersion, 'service-worker cache version must match package.json');
check(androidGradle.includes("System.getenv('ANDROID_VERSION_CODE')"), 'Android must accept ANDROID_VERSION_CODE');
check(
  androidGradle.includes(`?: '${expectedVersionCode}'`),
  `Android fallback versionCode must be ${expectedVersionCode}`,
);
check(/sourcemap:\s*false/.test(viteConfig), 'client production source maps must be disabled');
check(serverTsconfig.compilerOptions?.sourceMap === false, 'server production source maps must be disabled');
check(
  Array.isArray(serverTsconfig.include) && !serverTsconfig.include.some((entry) => entry.includes('test')),
  'server build must not include test sources',
);
check(gitignore.includes('dist-server/'), 'dist-server/ must be ignored');
check(gitignore.includes('node_modules.failed/'), 'node_modules.failed/ must be ignored');
check(packageJson.scripts?.['release:check'] === 'node scripts/release-gate.mjs', 'release:check script is missing');
check(packageJson.scripts?.['clean:server'] === 'node scripts/clean-server-build.mjs', 'safe server clean script is missing');
check(packageJson.scripts?.['build:server']?.startsWith('npm run clean:server &&'), 'server build must clean stale output first');
check(serverDockerfile.includes('COPY scripts/clean-server-build.mjs'), 'server image must copy the safe clean script');

const unitTestPath = 'android/app/src/test/java/com/neuralevolution/operatives/ExampleUnitTest.java';
const instrumentedTestPath = 'android/app/src/androidTest/java/com/neuralevolution/operatives/ExampleInstrumentedTest.java';
check(await exists(unitTestPath), 'Android unit test must live under the application package path');
check(await exists(instrumentedTestPath), 'Android instrumented test must live under the application package path');
check(!(await exists('android/app/src/test/java/com/getcapacitor/myapp/ExampleUnitTest.java')), 'stale Capacitor unit test path must be removed');
check(!(await exists('android/app/src/androidTest/java/com/getcapacitor/myapp/ExampleInstrumentedTest.java')), 'stale Capacitor instrumented test path must be removed');
if (await exists(unitTestPath)) {
  check((await read(unitTestPath)).includes('package com.neuralevolution.operatives;'), 'Android unit test package is incorrect');
}
if (await exists(instrumentedTestPath)) {
  check((await read(instrumentedTestPath)).includes('package com.neuralevolution.operatives;'), 'Android instrumented test package is incorrect');
}

for (const secretName of [
  'ANDROID_KEYSTORE_BASE64',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD',
]) {
  check(androidWorkflow.includes(secretName), `Android workflow must validate ${secretName}`);
}
check(androidWorkflow.includes('validateHttpsUrl'), 'Android workflow must validate release URLs as HTTPS');
check(androidWorkflow.includes('ANDROID_SIGNED_RELEASE'), 'Android workflow must enforce complete signing configuration');
check(
  androidWorkflow.includes(`ANDROID_VERSION_CODE=$((${expectedVersionCode} + GITHUB_RUN_NUMBER))`),
  'Android workflow must provide a SemVer-based monotonic versionCode',
);
check(androidWorkflow.includes('release:check -- --client-artifacts'), 'Android workflow must validate built client artifacts');

const postgresBlock = serviceBlock(compose, 'postgres');
const redisBlock = serviceBlock(compose, 'redis');
const gameServerBlock = serviceBlock(compose, 'game-server');
check(Boolean(postgresBlock), 'docker-compose postgres service is missing');
check(Boolean(redisBlock), 'docker-compose redis service is missing');
check(!/^\s{4}ports:/m.test(postgresBlock), 'PostgreSQL must not publish a host port');
check(!/^\s{4}ports:/m.test(redisBlock), 'Redis must not publish a host port');
check(postgresBlock.includes('POSTGRES_PASSWORD:?'), 'docker-compose must require POSTGRES_PASSWORD');
check(redisBlock.includes('REDIS_PASSWORD:?'), 'docker-compose must require REDIS_PASSWORD');
check(redisBlock.includes('--requirepass'), 'docker-compose Redis must require authentication');
check(redisBlock.includes('REDISCLI_AUTH='), 'Redis health check must not expose its password as a command argument');
check(gameServerBlock.includes('DATABASE_URL:?'), 'docker-compose must require DATABASE_URL');
check(gameServerBlock.includes('REDIS_URL:?'), 'docker-compose must require authenticated REDIS_URL');

check(ciWorkflow.includes('postgres:17-alpine'), 'CI must run a PostgreSQL service container');
check(ciWorkflow.includes('redis:8-alpine'), 'CI must run a Redis service container');
check(ciWorkflow.includes('NODE_ENV: production'), 'CI server smoke test must use production configuration');
check(ciWorkflow.includes('npm run smoke:server'), 'CI must run the server smoke test');
check(ciWorkflow.includes('release:check -- --artifacts'), 'CI must validate production artifacts');

const requireClientArtifacts = process.argv.includes('--client-artifacts') || process.argv.includes('--artifacts');
const requireServerArtifacts = process.argv.includes('--artifacts');
const requireAndroidArtifacts = process.argv.includes('--client-artifacts');

if (requireClientArtifacts) {
  check(await exists('dist/index.html'), 'client artifact dist/index.html is missing');
  if (await exists('dist')) {
    const clientFiles = await filesUnder('dist');
    check(!clientFiles.some((file) => file.endsWith('.map')), 'client artifact must not contain source maps');
  }
}

if (requireAndroidArtifacts) {
  const androidAssets = 'android/app/src/main/assets/public';
  check(await exists(`${androidAssets}/index.html`), 'synced Android client artifact is missing');
  if (await exists(androidAssets)) {
    const androidFiles = await filesUnder(androidAssets);
    check(!androidFiles.some((file) => file.endsWith('.map')), 'Android client artifact must not contain source maps');
  }
}

if (requireServerArtifacts) {
  check(await exists('dist-server/server/src/index.js'), 'server entry artifact is missing');
  if (await exists('dist-server')) {
    const serverFiles = await filesUnder('dist-server');
    check(!serverFiles.some((file) => file.endsWith('.map')), 'server artifact must not contain source maps');
    check(!serverFiles.some((file) => /(^|\/)tests?(\/|$)/.test(file)), 'server artifact must not ship test files');
  }
}

if (failures.length > 0) {
  console.error(`Release gate failed (${failures.length}/${checks} checks):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Release gate passed: v${packageJson.version} (${checks} checks)`);
