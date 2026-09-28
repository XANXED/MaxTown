import { describe, expect, it, vi } from 'vitest';
import { initializeVkPlatform, isStandaloneBrowser, readVkCode } from './vk.ts';

describe('VK Mini App bootstrap', () => {
  it('initializes bridge and preserves signed URL launch parameters for server verification', async () => {
    const bridge = {
      send: vi.fn(async (method: string) => method === 'VKWebAppGetLaunchParams' ? { vk_user_id: 42 } : undefined),
      isWebView: vi.fn(() => true),
    };

    const result = await initializeVkPlatform(bridge, '?vk_app_id=123&vk_user_id=42&sign=raw_signature', false);

    expect(bridge.send).toHaveBeenCalledWith('VKWebAppInit');
    expect(result).toEqual({ launchParams: 'vk_app_id=123&vk_user_id=42&sign=raw_signature', isEmbedded: true });
  });

  it('fills missing launch parameters from VK Bridge and allows an unsigned local browser preview', async () => {
    const bridge = {
      send: vi.fn(async (method: string) => method === 'VKWebAppGetLaunchParams'
        ? { vk_app_id: 123, vk_user_id: 42, sign: 'bridge_signature' }
        : undefined),
      isWebView: vi.fn(() => false),
    };
    const fromBridge = await initializeVkPlatform(bridge, '', false);
    expect(new URLSearchParams(fromBridge.launchParams).get('vk_user_id')).toBe('42');
    expect(new URLSearchParams(fromBridge.launchParams).get('sign')).toBe('bridge_signature');

    const browserBridge = { send: vi.fn(async () => { throw new Error('bridge unavailable'); }), isWebView: () => false };
    await expect(initializeVkPlatform(browserBridge, '', true)).resolves.toEqual({ launchParams: '', isEmbedded: false });
  });

  it('keeps a signed production URL launch when the bridge lookup is temporarily unavailable', async () => {
    const bridge = { send: vi.fn(async () => { throw new Error('bridge response unavailable'); }), isWebView: () => false };

    await expect(initializeVkPlatform(bridge, '?vk_app_id=123&vk_user_id=42&sign=signed', false))
      .resolves.toEqual({ launchParams: 'vk_app_id=123&vk_user_id=42&sign=signed', isEmbedded: false });
  });

  it('skips the bridge in a standalone local browser tab, where it never answers', async () => {
    const bridge = { send: vi.fn(() => new Promise<unknown>(() => {})), isWebView: () => false };

    await expect(initializeVkPlatform(bridge, '?vk_app_id=1&vk_user_id=7&sign=local', true, true))
      .resolves.toEqual({ launchParams: 'vk_app_id=1&vk_user_id=7&sign=local', isEmbedded: false });
    expect(bridge.send).not.toHaveBeenCalled();
  });

  it('treats only a top-level non-WebView page as standalone', () => {
    const page = {};
    expect(isStandaloneBrowser({ isWebView: () => false }, { self: page, top: page })).toBe(true);
    expect(isStandaloneBrowser({ isWebView: () => false }, { self: page, top: {} })).toBe(false);
    expect(isStandaloneBrowser({ isWebView: () => true }, { self: page, top: page })).toBe(false);
  });

  it('returns scanner content only when VK Bridge provides a code_data value', async () => {
    await expect(readVkCode({ send: async () => ({ code_data: 'https://vk.com/app123?ref=inv_code' }) }))
      .resolves.toBe('https://vk.com/app123?ref=inv_code');
    await expect(readVkCode({ send: async () => ({ code_data: 12 }) })).resolves.toBeNull();
  });
});
