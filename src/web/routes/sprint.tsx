import { Hono } from "hono";
import { Layout } from "../components/layout.js";

export interface SprintContext {
  getBoard: () => Promise<{
    todo: Array<{ key: string; title: string }>;
    inProgress: Array<{ key: string; title: string }>;
    inReview: Array<{ key: string; title: string }>;
    done: Array<{ key: string; title: string }>;
  }>;
}

export function sprintRoute(ctx: SprintContext): Hono {
  const route = new Hono();

  route.get("/", async (c) => {
    const board = await ctx.getBoard();
    const columns = [
      { name: "Todo", items: board.todo, color: "gray" },
      { name: "In Progress", items: board.inProgress, color: "blue" },
      { name: "In Review", items: board.inReview, color: "yellow" },
      { name: "Done", items: board.done, color: "green" },
    ];

    return c.html(
      <Layout title="Sprint Board">
        <div class="grid grid-cols-4 gap-4">
          {columns.map((col) => (
            <div>
              <h3 class="font-semibold mb-3 text-gray-500 dark:text-gray-400">{col.name} ({col.items.length})</h3>
              <div class="space-y-2">
                {col.items.map((item) => (
                  <div class="bg-gray-100 dark:bg-gray-800 rounded p-3 text-sm">
                    <div class="font-medium">{item.title}</div>
                    <div class="text-gray-400 dark:text-gray-500 text-xs mt-1">{item.key}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Layout>
    );
  });

  return route;
}
