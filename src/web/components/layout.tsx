import type { FC, PropsWithChildren } from "hono/jsx";

export const Layout: FC<PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title} — OneAgent</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script dangerouslySetInnerHTML={{ __html: `
        tailwind.config = { darkMode: 'class' }
      `}} />
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var theme = localStorage.getItem('theme');
          if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
            document.documentElement.classList.add('dark');
          } else {
            document.documentElement.classList.remove('dark');
          }
        })();
      `}} />
      <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
      <style dangerouslySetInnerHTML={{ __html: `
        .chat-md h1,.chat-md h2,.chat-md h3,.chat-md h4 { font-weight:700; margin:0.5em 0 0.25em; }
        .chat-md h1 { font-size:1.25em; } .chat-md h2 { font-size:1.1em; } .chat-md h3 { font-size:1em; }
        .chat-md p { margin:0.25em 0; }
        .chat-md ul,.chat-md ol { margin:0.25em 0 0.25em 1.5em; }
        .chat-md ul { list-style:disc; } .chat-md ol { list-style:decimal; }
        .chat-md li { margin:0.1em 0; }
        .chat-md code { background:rgba(0,0,0,0.1); padding:0.1em 0.3em; border-radius:3px; font-size:0.9em; }
        .dark .chat-md code { background:rgba(255,255,255,0.1); }
        .chat-md pre { background:rgba(0,0,0,0.05); padding:0.75em; border-radius:6px; overflow-x:auto; margin:0.5em 0; }
        .dark .chat-md pre { background:rgba(0,0,0,0.3); }
        .chat-md pre code { background:none; padding:0; }
        .chat-md blockquote { border-left:3px solid rgba(0,0,0,0.2); padding-left:0.75em; margin:0.5em 0; opacity:0.8; }
        .dark .chat-md blockquote { border-left-color: rgba(255,255,255,0.2); }
        .chat-md a { color:#60a5fa; text-decoration:underline; }
        .chat-md strong { font-weight:700; }
        .chat-md em { font-style:italic; }
      `}} />
    </head>
    <body class="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 min-h-screen">
      <nav class="bg-gray-100 border-b border-gray-200 dark:bg-gray-800 dark:border-gray-700 px-6 py-3 flex gap-6">
        <a href="/" class="font-bold text-gray-900 dark:text-white">OneAgent</a>
        <a href="/sprint" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">Sprint</a>
        <a href="/planning" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">Planning</a>
        <a href="/settings" class="text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white">Settings</a>
        <button
          id="theme-toggle"
          class="ml-auto text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white rounded-lg text-sm p-2"
          title="Toggle dark mode"
        >
          <svg id="theme-icon-dark" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z"></path>
          </svg>
          <svg id="theme-icon-light" class="hidden w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" fill-rule="evenodd" clip-rule="evenodd"></path>
          </svg>
        </button>
      </nav>
      <main class="p-6">{children}</main>
      <script dangerouslySetInnerHTML={{ __html: `
        (function() {
          var toggle = document.getElementById('theme-toggle');
          var iconDark = document.getElementById('theme-icon-dark');
          var iconLight = document.getElementById('theme-icon-light');
          function updateIcons() {
            if (document.documentElement.classList.contains('dark')) {
              iconDark.classList.add('hidden');
              iconLight.classList.remove('hidden');
            } else {
              iconLight.classList.add('hidden');
              iconDark.classList.remove('hidden');
            }
          }
          updateIcons();
          toggle.addEventListener('click', function() {
            document.documentElement.classList.toggle('dark');
            localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
            updateIcons();
          });
        })();
      `}} />
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
