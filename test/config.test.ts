import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig, parseToolsets, DEFAULT_TOOLSETS, TOOLSETS_ENV, API_KEY_ENV } from '../src/config.js';
import { ConfigError } from '../src/errors.js';

test('defaults to academics and clubs toolsets', () => {
  assert.deepEqual(parseToolsets(undefined), DEFAULT_TOOLSETS);
  assert.deepEqual(DEFAULT_TOOLSETS, ['academics', 'clubs']);
});

test('accepts an explicit subset in canonical order', () => {
  assert.deepEqual(parseToolsets('events,clubs'), ['clubs', 'events']);
  assert.deepEqual(parseToolsets(' academics '), ['academics']);
  assert.deepEqual(parseToolsets('academics,clubs,events'), ['academics', 'clubs', 'events']);
});

test('deduplicates repeated toolsets', () => {
  assert.deepEqual(parseToolsets('clubs,clubs'), ['clubs']);
});

test('rejects empty, unknown, and partially empty selections', () => {
  assert.throws(() => parseToolsets(''), ConfigError);
  assert.throws(() => parseToolsets('   '), ConfigError);
  assert.throws(() => parseToolsets('clubs,'), ConfigError);
  assert.throws(() => parseToolsets('clubs,,'), ConfigError);
  assert.throws(() => parseToolsets('events,dining'), ConfigError);
});

test('loadConfig trims the key and treats blank as missing', () => {
  assert.equal(loadConfig({ [API_KEY_ENV]: '  abc  ' }).apiKey, 'abc');
  assert.equal(loadConfig({ [API_KEY_ENV]: '' }).apiKey, undefined);
  assert.equal(loadConfig({ [API_KEY_ENV]: '   ' }).apiKey, undefined);
  assert.equal(loadConfig({}).apiKey, undefined);
});

test('loadConfig surfaces toolset misconfiguration as ConfigError', () => {
  assert.throws(() => loadConfig({ [TOOLSETS_ENV]: 'nope' }), ConfigError);
});
