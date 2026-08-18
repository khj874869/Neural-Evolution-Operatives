import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../src/config/env.js';

describe('server configuration', () => {
  it('keeps the private operations surface disabled unless a token is configured', () => {
    expect(loadServerConfig({ NODE_ENV: 'test' }).opsAdminToken).toBeUndefined();
  });

  it('rejects weak operations tokens before the server starts', () => {
    expect(() => loadServerConfig({
      NODE_ENV: 'test',
      OPS_ADMIN_TOKEN: 'too-short',
    })).toThrow('OPS_ADMIN_TOKEN must be at least 32 characters');
    const configured = loadServerConfig({
      NODE_ENV: 'test',
      OPS_ADMIN_TOKEN: 'valid-ops-token-with-more-than-32-characters',
    }).opsAdminToken;
    expect(configured?.length).toBeGreaterThanOrEqual(32);
  });
});
