import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { PlanningRepo, PlanningSessionRow } from "../../db/planning.js";

export interface PlanningContext {
  planningRepo: PlanningRepo;
  onChat: (sessionId: string, message: string) => AsyncGenerator<string>;
}

export function planningRoute(ctx: PlanningContext): Hono {
  const route = new Hono();

  route.get("/", (c) => {
    const sessions = ctx.planningRepo.list();
    return c.html(
      <Layout title="Planning">
        <div class="flex justify-between items-center mb-6">
          <h1 class="text-2xl font-bold">Planning Sessions</h1>
          <form method="post" action="/planning/new">
            <button class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">New Session</button>
          </form>
        </div>
        <div class="space-y-2">
          {sessions.map((s: PlanningSessionRow) => (
            <a href={`/planning/${s.id}`} class="block bg-gray-800 rounded p-4 hover:bg-gray-700">
              <div class="flex justify-between items-center">
                <div class="font-medium">{s.id}</div>
                {s.status && (
                  <span class={`text-xs px-2 py-0.5 rounded ${
                    s.status === "published" ? "bg-green-900 text-green-300" :
                    s.status === "approved" ? "bg-blue-900 text-blue-300" :
                    "bg-gray-700 text-gray-400"
                  }`}>{s.status}</span>
                )}
              </div>
              <div class="text-gray-500 text-sm">{s.issueKey ?? "No issue"} — {s.updatedAt}</div>
            </a>
          ))}
        </div>
      </Layout>
    );
  });

  route.post("/new", (c) => {
    const id = crypto.randomUUID();
    ctx.planningRepo.save(id, []);
    return c.redirect(`/planning/${id}`);
  });

  route.get("/:id", (c) => {
    const id = c.req.param("id");
    const history = ctx.planningRepo.load(id);
    return c.html(
      <Layout title={`Planning: ${id}`}>
        <h1 class="text-xl font-bold mb-4">Planning Session</h1>
        <div id="chat" class="bg-gray-800 rounded p-4 max-h-96 overflow-y-auto mb-4 space-y-3">
          {history.map((msg) => (
            <div class={msg.role === "user" ? "text-blue-300" : "text-gray-300"}>
              <span class="font-semibold">{msg.role}:</span> {msg.content}
            </div>
          ))}
        </div>
        <form id="chat-form" class="flex gap-2">
          <input
            type="text"
            name="message"
            placeholder="Type a message..."
            class="flex-1 bg-gray-700 rounded px-4 py-2 text-sm"
            autocomplete="off"
          />
          <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">Send</button>
        </form>
        <script dangerouslySetInnerHTML={{ __html: `
          const chatEl = document.getElementById('chat');
          const form = document.getElementById('chat-form');
          form.onsubmit = async (e) => {
            e.preventDefault();
            const input = form.message;
            const msg = input.value;
            if (!msg.trim()) return;
            const userDiv = document.createElement('div');
            userDiv.className = 'text-blue-300';
            userDiv.innerHTML = '<span class="font-semibold">user:</span> ' + msg;
            chatEl.appendChild(userDiv);
            input.value = '';
            const res = await fetch('/api/v1/planning/${id}/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ message: msg }),
            });
            const data = await res.json();
            const assistDiv = document.createElement('div');
            assistDiv.className = 'text-gray-300';
            assistDiv.innerHTML = '<span class="font-semibold">assistant:</span> ' + (data.response || '');
            chatEl.appendChild(assistDiv);
            chatEl.scrollTop = chatEl.scrollHeight;
          };
        `}} />
      </Layout>
    );
  });

  // Chat API endpoint
  route.post("/:id/chat", async (c) => {
    const id = c.req.param("id");
    const { message } = await c.req.json<{ message: string }>();

    // Save user message
    const history = ctx.planningRepo.load(id);
    history.push({ role: "user", content: message });

    // Collect response from generator
    let response = "";
    for await (const chunk of ctx.onChat(id, message)) {
      response += chunk;
    }

    // Save assistant response
    history.push({ role: "assistant", content: response });
    ctx.planningRepo.save(id, history);

    // Return plan alongside the response if one exists
    const plan = ctx.planningRepo.loadPlan(id);
    return c.json({ response, plan });
  });

  // Plan state endpoint
  route.get("/:id/plan", (c) => {
    const id = c.req.param("id");
    const plan = ctx.planningRepo.loadPlan(id);
    if (!plan) return c.json({ plan: null });
    return c.json({ plan });
  });

  return route;
}
