export interface Env {
  DB: D1Database;
  AI: any;
  BUCKET: R2Bucket;
  TELEGRAM_BOT_TOKEN: string;
  ALLOWED_USER_IDS: string;
  GOOGLE_SEARCH_API_KEY: string;
  GOOGLE_SEARCH_CX: string;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  from: {
    id: number;
    username?: string;
  };
  chat: {
    id: number;
    type: string;
  };
  text?: string;
  photo?: any[];
  document?: any;
}

export interface TelegramCallbackQuery {
  id: string;
  from: { id: number };
  message?: TelegramMessage;
  data: string;
}

export interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}
