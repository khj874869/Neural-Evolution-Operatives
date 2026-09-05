import { describe, expect, it } from 'vitest';
import { loadServerConfig } from '../src/config/env.js';

describe('server configuration', () => {
  it('keeps the private operations surface disabled unless a token is configured', () => {
    const config = loadServerConfig({ NODE_ENV: 'test' });
    expect(config.opsAdminToken).toBeUndefined();
    expect(config.trustProxyHops).toBe(0);
  });

  it('only trusts an explicit bounded number of reverse proxy hops', () => {
    expect(loadServerConfig({ NODE_ENV: 'test', TRUST_PROXY_HOPS: '1' }).trustProxyHops).toBe(1);
    expect(() => loadServerConfig({ NODE_ENV: 'test', TRUST_PROXY_HOPS: 'all' }))
      .toThrow('TRUST_PROXY_HOPS must be an integer from 0 to 3');
    expect(() => loadServerConfig({ NODE_ENV: 'test', TRUST_PROXY_HOPS: '4' }))
      .toThrow('TRUST_PROXY_HOPS must be an integer from 0 to 3');
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
