import { Hono } from 'hono';
import { Env, TelegramUpdate, Message } from './types';
import { runAgent } from './agent';

const app = new Hono<{ Bindings: Env }>();

// Database & Stats Helpers
async function getHistory(chatId: string, db: D1Database): Promise<Message[]> {
  const { results } = await db
    .prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT 15')
    .bind(chatId)
    .all();
  
  return (results as any[]).reverse().map(r => ({
    role: r.role as any,
    content: r.content
  }));
}

async function saveMessage(chatId: string, role: string, content: string, db: D1Database) {
  await db.prepare('INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)')
    .bind(chatId, role, content)
    .run();
}

async function getStats(db: D1Database) {
  const conversations = await db.prepare('SELECT COUNT(DISTINCT chat_id) as count FROM messages').first('count');
  const totalMessages = await db.prepare('SELECT COUNT(*) as count FROM messages').first('count');
  const totalLogs = await db.prepare('SELECT COUNT(*) as count FROM logs').first('count');
  
  return {
    conversations: conversations || 0,
    totalMessages: totalMessages || 0,
    totalLogs: totalLogs || 0,
    model: 'Llama 3.3 70B',
    storage_kb: Math.round((Number(totalMessages) * 0.5)), // Rough estimate
  };
}

// Telegram Helpers
async function sendTelegram(chatId: string, text: string, token: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: text, parse_mode: 'Markdown' })
  });
}

// API Routes
app.get('/api/status', async (c) => {
  const stats = await getStats(c.env.DB);
  return c.json({
    ...stats,
    platform: 'Cloudflare Workers (Free)',
    interface: 'Telegram + Web UI',
    tools: ['Google Search', 'Web Reader', 'Image Gen'],
    status: 'Operational'
  });
});

app.get('/api/logs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 100').all();
  return c.json(results);
});

app.get('/api/skills', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM skills').all();
  return c.json(results);
});

app.post('/api/skills', async (c) => {
  const { name, description, schema_json, endpoint_url } = await c.req.json();
  await c.env.DB.prepare('INSERT INTO skills (name, description, schema_json, endpoint_url) VALUES (?, ?, ?, ?)')
    .bind(name, description, schema_json, endpoint_url)
    .run();
  return c.json({ success: true });
});

app.delete('/api/skills/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM skills WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

app.post('/api/chat', async (c) => {
  const { text, chatId = 'web-user' } = await c.req.json();
  const env = c.env;

  await saveMessage(chatId, 'user', text, env.DB);
  const history = await getHistory(chatId, env.DB);
  
  const systemPrompt: Message = {
    role: 'system',
    content: 'You are Moltbot, a personal AI assistant. You are responding via the Web Dashboard.'
  };

  const result = await runAgent([systemPrompt, ...history], env, chatId);
  await saveMessage(chatId, 'assistant', result.text, env.DB);
  
  return c.json({ text: result.text, image: result.image });
});

// Setup & Webhook
app.get('/setup', async (c) => {
  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;
  const response = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/setWebhook?url=${webhookUrl}`);
  return c.json(await response.json());
});

app.post('/webhook', async (c) => {
  const update: TelegramUpdate = await c.req.json();
  if (update.message?.text) {
    const chatId = update.message.chat.id.toString();
    const text = update.message.text;

    await saveMessage(chatId, 'user', text, c.env.DB);
    const history = await getHistory(chatId, c.env.DB);
    const result = await runAgent([{ role: 'system', content: 'You are Moltbot.' }, ...history], c.env, chatId);
    
    await saveMessage(chatId, 'assistant', result.text, c.env.DB);
    await sendTelegram(chatId, result.text, c.env.TELEGRAM_BOT_TOKEN);
  }
  return c.json({ ok: true });
});

export default app;
