#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli');

// Translate POSIX signals to conventional exit codes so shells and CI runners
// see the right status. SIGINT (130) is the conventional exit code for a user
// pressing Ctrl-C; SIGTERM (143) is the conventional exit code for a graceful
// kill request. Without these, the picker and other long-running prompts exit
// with 1 (or null) which looks like a crash rather than an interruption.
process.on('SIGINT', () => process.exit(130));
process.on('SIGTERM', () => process.exit(143));

runCli(process.argv.slice(2), {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: process.cwd()
}).then((result) => {
  process.exitCode = result.exitCode;
}).catch((error) => {
  process.stderr.write(`ignorekit: ${error.message}\n`);
  process.exitCode = 1;
});
