import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — OneAgent</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <style dangerouslySetInnerHTML={{ __html: `
        .chat-md h1,.chat-md h2,.chat-md h3,.chat-md h4 { font-weight:700; margin:0.5em 0 0.25em; }
        .chat-md h1 { font-size:1.25em; } .chat-md h2 { font-size:1.1em; } .chat-md h3 { font-size:1em; }
        .chat-md p { margin:0.25em 0; }
        .chat-md ul,.chat-md ol { margin:0.25em 0 0.25em 1.5em; }
        .chat-md ul { list-style:disc; } .chat-md ol { list-style:decimal; }
        .chat-md li { margin:0.1em 0; }
        .chat-md code { background:rgba(255,255,255,0.1); padding:0.1em 0.3em; border-radius:3px; font-size:0.9em; }
        .chat-md pre { background:rgba(0,0,0,0.3); padding:0.75em; border-radius:6px; overflow-x:auto; margin:0.5em 0; }
        .chat-md pre code { background:none; padding:0; }
        .chat-md blockquote { border-left:3px solid rgba(255,255,255,0.2); padding-left:0.75em; margin:0.5em 0; opacity:0.8; }
        .chat-md a { color:#60a5fa; text-decoration:underline; }
        .chat-md strong { font-weight:700; }
        .chat-md em { font-style:italic; }
      `}} />
    </head>
    <body class="bg-gray-900 text-gray-100 min-h-screen">
      <nav class="bg-gray-800 border-b border-gray-700 px-6 py-3 flex gap-6">
        <a href="/" class="font-bold text-white">OneAgent</a>
        <a href="/sprint" class="text-gray-300 hover:text-white">Sprint</a>
        <a href="/planning" class="text-gray-300 hover:text-white">Planning</a>
        <a href="/settings" class="text-gray-300 hover:text-white">Settings</a>
      </nav>
      <main class="p-6">{children}</main>
      <script dangerouslySetInnerHTML={{ __html: `
        const es = new EventSource('/api/v1/events');
        es.onmessage = (e) => {
          const event = JSON.parse(e.data);
          document.dispatchEvent(new CustomEvent('sse', { detail: event }));
        };
      `}} />
    </body>
  </html>
);
