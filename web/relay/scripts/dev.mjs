#!/usr/bin/env node
// A dev loop with no extra tooling (relay.md): compile once, then run
// `tsc --watch` and `node --watch` side by side, so saving a source file
// rebuilds dist/ and the server restarts on the new build. tsx and its kin
// are deliberately absent: the relay's devDependencies are exactly the three
// web/app pins.
import { spawn, spawnSync } from 'node:child_process';

const build = spawnSync('tsc', ['-p', 'tsconfig.build.json'], { stdio: 'inherit', shell: true });
if (build.status !== 0) process.exit(build.status ?? 1);

const children = [
  // --preserveWatchOutput keeps the watch summary from clearing the log on every rebuild.
  spawn('tsc', ['-p', 'tsconfig.build.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit', shell: true }),
  spawn(process.execPath, ['--watch', 'dist/index.js'], { stdio: 'inherit' }),
];

const stop = () => {
  for (const child of children) child.kill();
};
process.on('SIGINT', () => {
  stop();
  process.exit(0);
});
process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});
// If either half dies for good, take the other with it rather than sit half-alive.
for (const child of children) {
  child.on('exit', () => {
    stop();
    process.exit(0);
  });
}
