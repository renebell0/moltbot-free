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
  try {
    await db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
      .bind(chatId, role, content)
      .run();
  } catch (e) { console.error('Save message error:', e); }
}

async function addLog(level: string, message: string, db: D1Database) {
  try {
    await db.prepare('INSERT INTO logs (level, message) VALUES (?, ?)')
      .bind(level, message)
      .run();
  } catch (e) {}
}

// Robust Telegram Sender
async function sendTelegram(chatId: string, text: string, token: string, db: D1Database) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  try {
    // Try sending with Markdown first
    let response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
    });

    // If it fails (likely due to markdown formatting), try as plain text
    if (response && !response.ok) {
      await addLog('error', `Telegram Markdown failed, retrying plain text... status: ${response.status}`, db);
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: text })
      });
    }

    if (response && !response.ok) {
      const errorData = await response.text();
      await addLog('error', `Telegram Critical Failure: ${errorData}`, db);
    } else if (response) {
      await addLog('success', `Message delivered to Telegram (Chat: ${chatId})`, db);
    }
  } catch (e) {
    await addLog('error', `Fetch Error in sendTelegram: ${e}`, db);
  }
}

// API Routes
app.get('/api/status', async (c) => {
  const conversations = await c.env.DB.prepare('SELECT COUNT(DISTINCT chat_id) as count FROM messages').first('count') || 0;
  const totalMessages = await c.env.DB.prepare('SELECT COUNT(*) as count FROM messages').first('count') || 0;
  const totalLogs = await c.env.DB.prepare('SELECT COUNT(*) as count FROM logs').first('count') || 0;
  let activeModel = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  try {
    const config = await c.env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('active_model').first('value');
    if (config) activeModel = config as string;
  } catch (e) {}
  
  return c.json({
    conversations: Number(conversations),
    totalMessages: Number(totalMessages),
    totalLogs: Number(totalLogs),
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
  await addLog('info', 'Kernel System: Initializing Moltbot OS...', c.env.DB);
  await addLog('success', 'Kernel System: All D1 and AI subsystems online.', c.env.DB);
  return c.text('System Initialized');
});

app.get('/api/metrics', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM metrics ORDER BY timestamp DESC LIMIT 20').all();
  return c.json((results || []).reverse());
});

app.get('/api/logs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100').all();
  return c.json(results || []);
});

app.get('/api/skills', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM skills').all();
  return c.json(results || []);
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
    const userId = update.message.from.id.toString();
    const text = update.message.text;

    // Security Check
    if (c.env.ALLOWED_USER_IDS && !c.env.ALLOWED_USER_IDS.split(',').includes(userId)) {
      return c.json({ ok: true });
    }

    await saveMessage(chatId, 'user', text, c.env.DB);
    const history = await getHistory(chatId, c.env.DB);
    const result = await runAgent([{ role: 'system', content: 'Moltbot OS Assistant' }, ...history], c.env, chatId);
    
    await saveMessage(chatId, 'assistant', result.text, c.env.DB);
    await sendTelegram(chatId, result.text, c.env.TELEGRAM_BOT_TOKEN, c.env.DB);
  }
  return c.json({ ok: true });
});

app.get('/setup', async (c) => {
  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
  return c.json(await response.json());
});

app.delete('/api/skills/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM skills WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

export default app;
