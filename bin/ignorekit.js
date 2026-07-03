#!/usr/bin/env node
'use strict';

const { runCli } = require('../src/cli');

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
