# Agent Workflow

Tiny workflow primitives: sequence, parallel, retry, timeout, condition, step.

TypeScript package `agent-workflow`.

## Install

```sh
npm install github:theAliCanAcar/agent-workflow#main
```

## How to use

```ts
import { sequence, step } from 'agent-workflow';

const workflow = sequence(
  step('research', async (state) => ({ notes: 'found 2 invoices', input: state.input })),
  step('draft', async (state) => ({ email: 'Please pay invoice...' })),
);

console.log(await workflow.run({ input: { week: 12 } }));
```

## Use cases

### 1. Run a research → draft → approve pipeline

- **Scenario:** Steps must run in order and stop on failure.
- **Outcome:** Compose sequence(step(...), ...) and inspect per-step status.

### 2. Fan out independent work

- **Scenario:** Two lookups can run at the same time.
- **Outcome:** Use parallel(...) inside a larger sequence.

## Dependencies

- `agent-tools`: `github:theAliCanAcar/agent-tools#main`

## Scripts

```sh
npm install
npm run build
```

## Notes

- Keep API keys in environment variables or a gitignored `.env`. Never commit secrets.
- Side-effecting tools should go through approval when used with `agent-approval`.
- Related packages live in separate repositories under [theAliCanAcar](https://github.com/theAliCanAcar).

## License

MIT
