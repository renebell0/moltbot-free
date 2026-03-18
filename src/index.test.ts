import { describe, it, expect, vi } from 'vitest';
import worker from './index';

describe('Moltbot-Free Unit Tests', () => {
  it('responds with running status on root', async () => {
    const request = new Request('http://example.com/');
    const env = { TELEGRAM_BOT_TOKEN: 'test' };
    const response = await worker.fetch(request, env as any, {} as any);
    expect(await response.text()).toBe('Moltbot-Free is running!');
  });

  it('validates tools: fetchWebPage processes HTML correctly', async () => {
    const { fetchWebPage } = await import('./tools');
    // Mock global fetch
    global.fetch = vi.fn().mockResolvedValue({
      text: () => Promise.resolve('<html><body><h1>Hello World</h1><script>ignore</script></body></html>')
    });
    
    const content = await fetchWebPage('http://test.com');
    expect(content).toContain('Hello World');
    expect(content).not.toContain('ignore');
  });

  it('checks unauthorized access in webhook', async () => {
    const payload = {
      update_id: 1,
      message: {
        chat: { id: 123 },
        from: { id: 999 },
        text: 'hi'
      }
    };
    
    // Mock env and sendTelegram
    const env = {
      ALLOWED_USER_IDS: '111',
      TELEGRAM_BOT_TOKEN: 'token',
      DB: {
        prepare: () => ({ bind: () => ({ all: () => Promise.resolve({ results: [] }) }) })
      }
    };

    const request = new Request('http://example.com/webhook', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const response = await worker.fetch(request, env as any, {} as any);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.ok).toBe(true);
  });
});
