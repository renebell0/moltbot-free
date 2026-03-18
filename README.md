# Moltbot-Free (Cloudflare Tier)

Este es una versión optimizada de Moltbot (OpenClaw) diseñada específicamente para funcionar en el **Plan Gratuito de Cloudflare Workers**, utilizando **Telegram** como interfaz y herramientas nativas gratuitas.

## Características
- **IA:** Utiliza `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Gratis en Workers AI).
- **Memoria:** Historial persistente usando Cloudflare D1.
- **Búsqueda Web:** Integración con Google Custom Search (100 búsquedas gratis/día).
- **Lectura de Páginas:** Capacidad para leer contenido de URLs (fetch nativo).
- **Generación de Imágenes:** Stable Diffusion XL Lightning integrado.
- **Seguridad:** Filtro opcional por ID de usuario de Telegram.

## Requisitos
1. Cuenta de Cloudflare.
2. Bot de Telegram (creado vía @BotFather).
3. Google Custom Search API Key y CX ID (opcional, para búsqueda).

## Instalación y Despliegue

1. **Instalar dependencias:**
   ```bash
   cd moltbot-free
   npm install
   ```

2. **Crear la Base de Datos D1:**
   ```bash
   npx wrangler d1 create moltbot_db
   ```
   Copia el `database_id` obtenido y pégalo en `wrangler.json`.

3. **Inicializar la Base de Datos:**
   ```bash
   npx wrangler d1 execute moltbot_db --file=./schema.sql --remote
   ```

4. **Configurar Secretos:**
   Ejecuta los siguientes comandos para configurar tus tokens:
   ```bash
   npx wrangler secret put TELEGRAM_BOT_TOKEN
   npx wrangler secret put GOOGLE_SEARCH_API_KEY
   npx wrangler secret put GOOGLE_SEARCH_CX
   ```

5. **Desplegar:**
   ```bash
   npx wrangler deploy
   ```

6. **Configurar Webhook:**
   Visita la URL de tu worker final en el navegador:
   `https://moltbot-free.<tu-subdominio>.workers.dev/setup`

## Notas de Optimización
- El bot está diseñado para no exceder los **10ms de CPU** del plan gratuito al delegar el razonamiento pesado a `env.AI`.
- Se utiliza un sistema de "Typing..." automático (vía Telegram API) para mejorar la experiencia de usuario mientras la IA procesa.
- El historial se limita a los últimos 10 mensajes para ahorrar tokens y mantenerse dentro de los límites de contexto.

---
*Desarrollado por Gemini CLI Agent.*
