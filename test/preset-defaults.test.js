'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

test('generic preset does not include any AI tool by default', () => {
  const generic = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'presets', 'generic.json'), 'utf8'));
  assert.deepEqual(generic.components.filter(component => component.startsWith('local/ai-')), []);
});
