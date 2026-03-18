import { Hono } from 'hono';
import { Env, TelegramUpdate, Message } from './types';
import { runAgent } from './agent';

const app = new Hono<{ Bindings: Env }>();

// Database & Stats Helpers
async function getHistory(chatId: string, db: D1Database): Promise<Message[]> {
  try {
    const { results } = await db
      .prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 15')
      .bind(chatId)
      .all();
    return (results as any[] || []).reverse().map(r => ({
      role: r.role as any,
      content: r.content
    }));
  } catch (e) { return []; }
}

async function saveMessage(chatId: string, role: string, content: string, db: D1Database) {
  await db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
    .bind(chatId, role, content)
    .run();
}

async function getStats(db: D1Database) {
  try {
    const conversations = await db.prepare('SELECT COUNT(DISTINCT chat_id) as count FROM messages').first('count') || 0;
    const totalMessages = await db.prepare('SELECT COUNT(*) as count FROM messages').first('count') || 0;
    const totalLogs = await db.prepare('SELECT COUNT(*) as count FROM logs').first('count') || 0;
    
    return {
      conversations: Number(conversations),
      totalMessages: Number(totalMessages),
      totalLogs: Number(totalLogs),
      model: 'Llama 3.3 70B',
      storage_kb: Math.round((Number(totalMessages) * 0.5)),
    };
  } catch (e) {
    return { conversations: 0, totalMessages: 0, totalLogs: 0, model: 'N/A', storage_kb: 0 };
  }
}

// API Routes
app.get('/api/status', async (c) => {
  const stats = await getStats(c.env.DB);
  let activeModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  try {
    const config = await c.env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('active_model').first('value');
    if (config) activeModel = config as string;
  } catch (e) {}
  
  return c.json({
    ...stats,
    active_model: activeModel,
    available_models: [
      { id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast', name: 'Llama 3.3 70B (Fast)' },
      { id: '@cf/meta/llama-3.1-8b-instruct', name: 'Llama 3.1 8B' },
      { id: '@cf/qwen/qwen1.5-14b-chat-awq', name: 'Qwen 1.5 14B' },
      { id: '@cf/google/gemma-7b-it-lora', name: 'Gemma 7B' },
      { id: '@cf/mistral/mistral-7b-instruct-v0.1', name: 'Mistral 7B' }
    ],
    status: 'Operational'
  });
});

app.get('/api/init', async (c) => {
  // Seed initial logs to avoid empty UI
  await c.env.DB.prepare('INSERT INTO logs (level, message) VALUES (?, ?)')
    .bind('info', 'Kernel System: Initializing Moltbot OS...')
    .run();
  await c.env.DB.prepare('INSERT INTO logs (level, message) VALUES (?, ?)')
    .bind('success', 'Kernel System: All D1 and AI subsystems online.')
    .run();
  return c.text('System Initialized');
});

app.get('/api/metrics', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 20').all();
    return c.json((results || []).reverse());
  } catch (e) { return c.json([]); }
});

app.get('/api/logs', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100').all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

app.get('/api/skills', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM skills').all();
    return c.json(results || []);
  } catch (e) { return c.json([]); }
});

app.post('/api/config', async (c) => {
  const { key, value } = await c.req.json();
  await c.env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)')
    .bind(key, value)
    .run();
  return c.json({ success: true });
});

app.post('/api/chat', async (c) => {
  const { text, chatId = 'web-user' } = await c.req.json();
  await saveMessage(chatId, 'user', text, c.env.DB);
  const history = await getHistory(chatId, c.env.DB);
  const result = await runAgent([{ role: 'system', content: 'Moltbot OS Assistant' }, ...history], c.env, chatId);
  await saveMessage(chatId, 'assistant', result.text, c.env.DB);
  return c.json({ text: result.text, image: result.image });
});

app.post('/webhook', async (c) => {
  const update: TelegramUpdate = await c.req.json();
  if (update.message?.text) {
    const chatId = update.message.chat.id.toString();
    await saveMessage(chatId, 'user', update.message.text, c.env.DB);
    const history = await getHistory(chatId, c.env.DB);
    const result = await runAgent([{ role: 'system', content: 'Moltbot OS Assistant' }, ...history], c.env, chatId);
    await saveMessage(chatId, 'assistant', result.text, c.env.DB);
    // Simple notification logic
    await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: result.text, parse_mode: 'Markdown' })
    });
  }
  return c.json({ ok: true });
});

export default app;
