import { isFailure, type Tool, type ToolContext, type ToolOutcome } from "agent-tools";

/**
 * agent-workflow: deliberately tiny. Enough to build most agent workflows:
 *
 *   const workflow = sequence(
 *     step("research", researchTool),
 *     step("analyze", analysisTool),
 *     step("draft", draftTool),
 *     step("approve", approvalStep),
 *     step("execute", executeTool),
 *   );
 *   await workflow.run({ input, context });
 */

export type WorkflowState = {
  /** Original workflow input. */
  input: unknown;
  /** Shared mutable context across steps. */
  context: Record<string, unknown>;
  /** Named results collected along the way. */
  results: Record<string, unknown>;
};

export type StepResult = {
  name: string;
  status: "success" | "error" | "skipped";
  output?: unknown;
  error?: { code?: string; message: string };
  durationMs: number;
};

export type WorkflowRunResult = {
  ok: boolean;
  state: WorkflowState;
  steps: StepResult[];
  output?: unknown;
  error?: { code?: string; message: string };
};

export type StepFn = (state: WorkflowState) => Promise<unknown> | unknown;

export type WorkflowStep = {
  name: string;
  run: StepFn;
};

export type Workflow = {
  name?: string;
  run(init: { input: unknown; context?: Record<string, unknown> }): Promise<WorkflowRunResult>;
};

/** Wrap a named function or a Tool into a workflow step. */
export function step(name: string, fnOrTool: StepFn | Tool<any, any>): WorkflowStep {
  const fn: StepFn =
    typeof fnOrTool === "function"
      ? (fnOrTool as StepFn)
      : (state) => (fnOrTool as Tool<any, any>).execute(state.input, state.context as ToolContext);
  return { name, run: fn };
}

/** Run steps one after another, threading results into state.results. */
export function sequence(...steps: WorkflowStep[]): Workflow {
  return {
    async run({ input, context = {} }) {
      const state: WorkflowState = { input, context, results: {} };
      const log: StepResult[] = [];
      for (const s of steps) {
        const started = Date.now();
        try {
          const output = await s.run(state);
          if (isFailure(output)) {
            const entry: StepResult = {
              name: s.name,
              status: "error",
              error: output.error,
              durationMs: Date.now() - started,
            };
            log.push(entry);
            return { ok: false, state, steps: log, error: output.error };
          }
          state.results[s.name] = output;
          log.push({ name: s.name, status: "success", output, durationMs: Date.now() - started });
        } catch (err) {
          const error = { message: (err as Error)?.message ?? "Step failed." };
          log.push({ name: s.name, status: "error", error, durationMs: Date.now() - started });
          return { ok: false, state, steps: log, error };
        }
      }
      const last = steps[steps.length - 1];
      return { ok: true, state, steps: log, output: last ? state.results[last.name] : undefined };
    },
  };
}

/** Run steps concurrently; results land in state.results by step name. */
export function parallel(...steps: WorkflowStep[]): WorkflowStep {
  return {
    name: `parallel(${steps.map((s) => s.name).join(",")})`,
    async run(state) {
      const outputs = await Promise.all(steps.map(async (s) => ({ name: s.name, value: await s.run(state) })));
      for (const { name, value } of outputs) state.results[name] = value;
      return outputs.map((o) => o.value);
    },
  };
}

/** Retry a step on failure. */
export function retryStep(
  inner: WorkflowStep,
  options: { attempts?: number; backoffMs?: number } = {}
): WorkflowStep {
  const attempts = Math.max(1, options.attempts ?? 3);
  const backoffMs = options.backoffMs ?? 200;
  return {
    name: inner.name,
    async run(state) {
      let lastErr: unknown;
      for (let i = 1; i <= attempts; i++) {
        try {
          return await inner.run(state);
        } catch (err) {
          lastErr = err;
          if (i < attempts) await new Promise((r) => setTimeout(r, backoffMs * i));
        }
      }
      throw lastErr;
    },
  };
}

/** Bound a step's wall-clock time. */
export function timeoutStep(inner: WorkflowStep, ms: number): WorkflowStep {
  return {
    name: inner.name,
    async run(state) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          inner.run(state),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`Step ${inner.name} timed out after ${ms}ms`)), ms);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
  };
}

/** Branch on accumulated state. */
export function condition(
  predicate: (state: WorkflowState) => boolean | Promise<boolean>,
  thenStep: WorkflowStep,
  elseStep?: WorkflowStep
): WorkflowStep {
  return {
    name: `condition(${thenStep.name})`,
    async run(state) {
      const take = await predicate(state);
      if (take) return thenStep.run(state);
      if (elseStep) return elseStep.run(state);
      return undefined;
    },
  };
}

/** Alias matching the spec's retry(...) / timeout(...) naming at workflow level. */
export const retry = retryStep;
export const timeout = timeoutStep;

export type { ToolOutcome };