import { Hono } from 'hono';
import { Env, TelegramUpdate, Message } from './types';
import { runAgent } from './agent';

const app = new Hono<{ Bindings: Env }>();

// Database helpers
async function getHistory(chatId: string, db: D1Database): Promise<Message[]> {
  const { results } = await db
    .prepare('SELECT role, content FROM messages WHERE chat_id = ? ORDER BY timestamp DESC LIMIT 10')
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

// Telegram helpers
async function sendTelegram(chatId: string, text: string, token: string) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'Markdown'
    })
  });
}

async function sendTelegramPhoto(chatId: string, photo: any, token: string) {
  const url = `https://api.telegram.org/bot${token}/sendPhoto`;
  const formData = new FormData();
  formData.append('chat_id', chatId);
  const blob = new Blob([photo], { type: 'image/png' });
  formData.append('photo', blob, 'image.png');
  
  await fetch(url, {
    method: 'POST',
    body: formData
  });
}

// Routes
app.get('/', (c) => c.text('Moltbot-Free is running!'));

app.get('/setup', async (c) => {
  const url = new URL(c.req.url);
  const webhookUrl = `${url.protocol}//${url.host}/webhook`;
  const token = c.env.TELEGRAM_BOT_TOKEN;
  
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook?url=${webhookUrl}`);
  const data = await response.json();
  return c.json(data);
});

app.post('/webhook', async (c) => {
  const update: TelegramUpdate = await c.req.json();
  const env = c.env;
  
  if (update.message && update.message.text) {
    const chatId = update.message.chat.id.toString();
    const userId = update.message.from.id.toString();
    const text = update.message.text;

    // Security check: Only allow authorized users if set
    if (env.ALLOWED_USER_IDS && !env.ALLOWED_USER_IDS.split(',').includes(userId)) {
      await sendTelegram(chatId, 'Unauthorized access.', env.TELEGRAM_BOT_TOKEN);
      return c.json({ ok: true });
    }

    // Load history
    const history = await getHistory(chatId, env.DB);
    const systemPrompt: Message = {
      role: 'system',
      content: 'You are Moltbot, a personal AI assistant running on Cloudflare. You are helpful, concise, and have access to the web.'
    };
    
    const messages: Message[] = [systemPrompt, ...history, { role: 'user', content: text }];
    
    // Save user message
    await saveMessage(chatId, 'user', text, env.DB);

    // Let the agent think
    try {
      const result = await runAgent(messages, env, chatId);
      
      // Save assistant response
      await saveMessage(chatId, 'assistant', result.text, env.DB);

      // Send to Telegram
      if (result.image) {
        await sendTelegramPhoto(chatId, result.image, env.TELEGRAM_BOT_TOKEN);
      } else {
        await sendTelegram(chatId, result.text, env.TELEGRAM_BOT_TOKEN);
      }
    } catch (e) {
      console.error('Webhook error:', e);
      await sendTelegram(chatId, `Error: ${e}`, env.TELEGRAM_BOT_TOKEN);
    }
  }

  return c.json({ ok: true });
});

export default app;
