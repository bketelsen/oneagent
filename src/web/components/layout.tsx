import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — OneAgent</title>
      <script src="https://cdn.tailwindcss.com"></script>
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
        (function() {
          var es = new EventSource('/api/v1/events');
          var eventTypes = [
            'agent:text', 'agent:tool_call', 'agent:tool_result',
            'agent:handoff', 'agent:error', 'agent:done',
            'agent:started', 'agent:completed', 'agent:failed'
          ];
          eventTypes.forEach(function(eventType) {
            es.addEventListener(eventType, function(e) {
              var data = JSON.parse(e.data);
              document.dispatchEvent(new CustomEvent('sse', { detail: { type: eventType, ...data } }));
            });
          });
        })();
      `}} />
    </body>
  </html>
);
