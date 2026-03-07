import { Hono } from "hono";
import { Layout } from "../components/layout.js";
import type { PlanningRepo, PlanningSessionRow } from "../../db/planning.js";

export interface PlanningContext {
  planningRepo: PlanningRepo;
  onChat: (sessionId: string, message: string) => AsyncGenerator<string>;
}

function renderPlan(plan: any) {
  return (
    <div class="space-y-4">
      <h3 class="text-lg font-bold">{plan.title}</h3>
      <p class="text-gray-400">{plan.description}</p>
      {plan.phases.map((phase: any) => (
        <div class="border border-gray-700 rounded p-3">
          <h4 class="font-semibold text-blue-300 mb-2">{phase.name}</h4>
          <div class="space-y-2">
            {phase.tasks.map((task: any) => (
              <div class="bg-gray-900 rounded p-2">
                <div class="flex items-center gap-2">
                  <span class={`text-xs px-1.5 py-0.5 rounded ${
                    task.complexity === "low" ? "bg-green-900 text-green-300" :
                    task.complexity === "medium" ? "bg-yellow-900 text-yellow-300" :
                    "bg-red-900 text-red-300"
                  }`}>{task.complexity}</span>
                  <span class="font-medium">{task.title}</span>
                  {task.issueNumber && (
                    <span class="text-blue-400 text-sm">#{task.issueNumber}</span>
                  )}
                </div>
                {task.dependsOn.length > 0 && (
                  <div class="text-xs text-gray-500 mt-1">Depends on: {task.dependsOn.join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function planningScript(id: string): string {
  return `
    const chatEl = document.getElementById('chat');
    const form = document.getElementById('chat-form');
    const publishBtn = document.getElementById('publish-btn');

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
      const sendBtn = form.querySelector('button[type="submit"]');
      sendBtn.disabled = true;
      sendBtn.textContent = 'Thinking...';
      try {
        const res = await fetch('/planning/${id}/chat', {
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
        if (data.plan) {
          location.reload();
        }
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Send';
      }
    };

    if (publishBtn) {
      publishBtn.onclick = async () => {
        if (!confirm('Publish all tasks as GitHub issues?')) return;
        publishBtn.disabled = true;
        publishBtn.textContent = 'Publishing...';
        const res = await fetch('/planning/${id}/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'Please publish the plan now.' }),
        });
        const data = await res.json();
        alert(data.response || 'Published!');
        location.reload();
      };
    }
  `;
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
    const plan = ctx.planningRepo.loadPlan(id);
    return c.html(
      <Layout title={`Planning: ${id}`}>
        <h1 class="text-xl font-bold mb-4">Planning Session</h1>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Chat panel */}
          <div>
            <h2 class="text-lg font-semibold mb-2">Chat</h2>
            <div id="chat" class="bg-gray-800 rounded p-4 max-h-[60vh] overflow-y-auto mb-4 space-y-3">
              {history.map((msg) => (
                <div class={msg.role === "user" ? "text-blue-300" : "text-gray-300"}>
                  <span class="font-semibold">{msg.role}:</span> {msg.content}
                </div>
              ))}
            </div>
            <form id="chat-form" class="flex gap-2">
              <input type="text" name="message" placeholder="Type a message..."
                class="flex-1 bg-gray-700 rounded px-4 py-2 text-sm" autocomplete="off" />
              <button type="submit" class="bg-blue-600 hover:bg-blue-700 px-4 py-2 rounded text-sm">Send</button>
            </form>
          </div>

          {/* Plan viewer panel */}
          <div>
            <div class="flex justify-between items-center mb-2">
              <h2 class="text-lg font-semibold">Plan</h2>
              {plan?.status === "draft" && (
                <button id="publish-btn" class="bg-green-600 hover:bg-green-700 px-3 py-1 rounded text-sm">
                  Publish to GitHub
                </button>
              )}
              {plan?.status === "published" && (
                <span class="text-green-400 text-sm">Published</span>
              )}
            </div>
            <div id="plan-viewer" class="bg-gray-800 rounded p-4 max-h-[60vh] overflow-y-auto">
              {plan ? renderPlan(plan) : <p class="text-gray-500">No plan yet. Start chatting to build one.</p>}
            </div>
          </div>
        </div>
        <script dangerouslySetInnerHTML={{ __html: planningScript(id) }} />
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
