import { Env, Message } from './types';
import { googleSearch, fetchWebPage, generateImage, tools } from './tools';

export async function runAgent(
  messages: Message[],
  env: Env,
  chatId: string
): Promise<{ text: string; image?: any }> {
  let currentMessages = [...messages];
  const model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
  
  let iterations = 0;
  const maxIterations = 3;

  while (iterations < maxIterations) {
    iterations++;
    
    try {
      const response: any = await env.AI.run(model, {
        messages: currentMessages,
        tools: tools
      });

      const choice = response.response ? response : response; // Handle different SDK response formats
      const content = choice.response || '';
      const toolCalls = choice.tool_calls || [];

      if (toolCalls.length === 0) {
        return { text: content };
      }

      // Add assistant's message with tool calls to history
      currentMessages.push({ role: 'assistant', content: JSON.stringify(toolCalls) });

      for (const toolCall of toolCalls) {
        const name = toolCall.name;
        const args = toolCall.arguments || {};
        let result = '';

        console.log(`Executing tool: ${name} with args:`, args);

        if (name === 'google_search') {
          result = await googleSearch(args.query, env);
        } else if (name === 'fetch_page') {
          result = await fetchWebPage(args.url);
        } else if (name === 'generate_image') {
          const imgData = await generateImage(args.prompt, env);
          if (imgData) {
            return { text: `Generated image for: ${args.prompt}`, image: imgData };
          }
          result = 'Failed to generate image.';
        }

        currentMessages.push({
          role: 'tool',
          content: result
        });
      }
    } catch (e) {
      console.error('Agent error:', e);
      return { text: `Sorry, I encountered an error: ${e}` };
    }
  }

  return { text: 'I tried my best but couldn\'t finish the task in time.' };
}
