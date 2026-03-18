import { Env, Message } from './types';
import { googleSearch, fetchWebPage, generateImage, tools as coreTools } from './tools';

export async function runAgent(
  messages: Message[],
  env: Env,
  chatId: string
): Promise<{ text: string; image?: any }> {
  let currentMessages = [...messages];
  
  // 0. Fetch Active Model from config
  const config = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('active_model').first('value');
  const model = (config as string) || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  
  // 1. Fetch Dynamic Skills from D1
  const { results: dbSkills } = await env.DB.prepare('SELECT * FROM skills WHERE active = 1').all();
  const dynamicTools = (dbSkills as any[]).map(s => JSON.parse(s.schema_json));
  
  // Combine Core + Dynamic
  const allTools = [...coreTools, ...dynamicTools];

  let iterations = 0;
  while (iterations < 3) {
    iterations++;
    
    try {
      const response: any = await env.AI.run(model, {
        messages: currentMessages,
        tools: allTools
      });

      const content = response.response || '';
      const toolCalls = response.tool_calls || [];

      if (toolCalls.length === 0) return { text: content };

      currentMessages.push({ role: 'assistant', content: JSON.stringify(toolCalls) });

      for (const toolCall of toolCalls) {
        const { name, arguments: args } = toolCall;
        let result = '';

        await env.DB.prepare('INSERT INTO logs (level, message) VALUES (?, ?)')
          .bind('info', `Agent using skill: ${name}`)
          .run();

        // Handle Core Tools
        if (name === 'google_search') result = await googleSearch(args.query, env);
        else if (name === 'fetch_page') result = await fetchWebPage(args.url);
        else if (name === 'generate_image') {
          const imgData = await generateImage(args.prompt, env);
          if (imgData) return { text: `Generated image: ${args.prompt}`, image: imgData };
          result = 'Failed to generate image.';
        }
        // Handle Dynamic Tools (API Redirect)
        else {
          const skill = (dbSkills as any[]).find(s => s.name === name);
          if (skill && skill.endpoint_url) {
            try {
              const apiRes = await fetch(skill.endpoint_url, {
                method: 'POST',
                body: JSON.stringify(args),
                headers: { 'Content-Type': 'application/json' }
              });
              result = await apiRes.text();
            } catch (e) {
              result = `Error executing dynamic skill ${name}: ${e}`;
            }
          } else {
            result = `Unknown tool: ${name}`;
          }
        }

        currentMessages.push({ role: 'tool', content: result });
      }
    } catch (e) {
      await env.DB.prepare('INSERT INTO logs (level, message) VALUES (?, ?)')
        .bind('error', `Agent System Error: ${e}`)
        .run();
      return { text: `System Error: ${e}` };
    }
  }
  return { text: 'Maximum reasoning iterations reached.' };
}
