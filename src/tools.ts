import { Env } from './types';

export async function googleSearch(query: string, env: Env) {
  if (!env.GOOGLE_SEARCH_API_KEY || !env.GOOGLE_SEARCH_CX) {
    return 'Error: Google Search API not configured.';
  }

  const url = `https://www.googleapis.com/customsearch/v1?key=${env.GOOGLE_SEARCH_API_KEY}&cx=${env.GOOGLE_SEARCH_CX}&q=${encodeURIComponent(query)}`;
  
  try {
    const response = await fetch(url);
    const data: any = await response.json();
    
    if (!data.items) return 'No results found.';
    
    return data.items.slice(0, 3).map((item: any) => 
      `Title: ${item.title}\nSnippet: ${item.snippet}\nLink: ${item.link}`
    ).join('\n\n');
  } catch (e) {
    return `Error searching: ${e}`;
  }
}

export async function fetchWebPage(url: string) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Moltbot-Free (Cloudflare Worker)'
      }
    });
    
    const html = await response.text();
    // Simple HTML to text
    const text = html
      .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, '')
      .replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000); // Limit context
      
    return text || 'No readable content found.';
  } catch (e) {
    return `Error fetching page: ${e}`;
  }
}

export async function generateImage(prompt: string, env: Env) {
  try {
    const inputs = { prompt };
    const response = await env.AI.run('@cf/bytedance/stable-diffusion-xl-lightning', inputs);
    
    // stable-diffusion returns a binary blob or similar
    // We'll return it as a Uint8Array for uploading to R2 or sending back
    return response;
  } catch (e) {
    console.error('Image gen error:', e);
    return null;
  }
}

export const tools = [
  {
    name: 'google_search',
    description: 'Search the web for current information.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query.' }
      },
      required: ['query']
    }
  },
  {
    name: 'fetch_page',
    description: 'Read the content of a specific web page.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The URL to read.' }
      },
      required: ['url']
    }
  },
  {
    name: 'generate_image',
    description: 'Create an image based on a description.',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Detailed description of the image.' }
      },
      required: ['prompt']
    }
  }
];
