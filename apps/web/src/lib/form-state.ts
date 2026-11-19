// Result type shared by server actions that report back to a form.
export type ActionResult = { ok?: boolean; error?: string; errors?: string[] } | undefined;

/** Run a server action body, turning expected errors into a form message. */
export async function formAction(fn: () => Promise<void | ActionResult>, expected: (new (...a: never[]) => Error)[]): Promise<ActionResult> {
  try {
    return (await fn()) ?? { ok: true };
  } catch (e) {
    if (expected.some((E) => e instanceof E)) return { error: (e as Error).message };
    throw e;
  }
}
