# OneAgent Repository Conventions

## Language & Runtime

- **TypeScript** with ES modules (`"type": "module"` in package.json)
- Target: ES2022+ (see `tsconfig.json`)
- Node.js runtime

## Package Manager

- Use **npm** (not yarn or pnpm)
- Lock file: `package-lock.json`

## Scripts

| Command         | Purpose                        |
|-----------------|--------------------------------|
| `npm run build` | Compile TypeScript via `tsc`   |
| `npm run dev`   | Watch mode compilation         |
| `npm test`      | Run tests via vitest           |
| `npm start`     | Start the agent orchestrator   |

## Testing

- Framework: **vitest**
- Test files go in `__tests__/` directories alongside source files
- Test file naming: `<module>.test.ts`
- Run all tests before submitting a PR

## Code Style

- Use named exports
- Organize code by domain: `agents/`, `config/`, `db/`, `tools/`, `web/`, `workspace/`
- Keep modules focused and small
- Use `zod` for runtime validation and schema definitions

## Dependencies

- HTTP framework: Hono
- AI SDK: `@anthropic-ai/claude-agent-sdk` and `one-agent-sdk`
- Database: better-sqlite3
- Config: YAML-based (`oneagent.yaml`)
