// Makes sure esbuild's platform binary is present before anything tries to use it.
//
// npm has a long-standing bug where installing an unrelated package can prune
// another package's optionalDependencies. esbuild ships its compiled binary
// that way — one per platform — so `npm install <anything>` can leave behind an
// esbuild that throws:
//
//   Error [TransformError]: The package "@esbuild/darwin-arm64" could not be
//   found, and is needed by esbuild.
//
// tsx uses esbuild, so when that happens the backend will not start and the
// tests will not run, with an error that says nothing about what you changed.
// It has bitten this project more than once, always right after adding a
// dependency, so `npm run dev` and `npm test` repair it rather than failing.
//
// Deliberately NOT pinning `@esbuild/<platform>` in package.json: that would
// hard-code one architecture into a repo other people clone.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

function esbuildWorks() {
  try {
    // Loading the module is what actually resolves the platform binary, so
    // this catches the broken state that a file-exists check would miss.
    require('esbuild');
    return true;
  } catch {
    return false;
  }
}

if (esbuildWorks()) process.exit(0);

console.warn(
  `[fix-esbuild] esbuild cannot load its binary for ${process.platform}-${process.arch}. Reinstalling esbuild…`,
);

try {
  // Reinstall esbuild itself rather than the `@esbuild/<platform>` package.
  // Installing the platform package alone with --no-save was tried first and
  // does not stick: npm prunes it again on the next install, because nothing in
  // the tree claims it. Reinstalling esbuild re-resolves its own
  // optionalDependencies, which is the relationship that was broken.
  //
  // execFileSync with an argument array, not execSync with a string: no shell
  // is involved, so nothing here can be read as a shell metacharacter.
  execFileSync('npm', ['install', 'esbuild', '--force', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    shell: false,
  });
} catch {
  console.error('[fix-esbuild] Could not reinstall esbuild. Try: rm -rf node_modules && npm install');
  process.exit(1);
}

if (!esbuildWorks()) {
  console.error('[fix-esbuild] esbuild still will not load. Try: rm -rf node_modules && npm install');
  process.exit(1);
}

console.log('[fix-esbuild] esbuild repaired.');
