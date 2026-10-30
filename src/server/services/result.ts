import "server-only";
import { ZodError } from "zod";
import type { IntegrityProblem } from "@/lib/integrity";
import { zodFieldErrors } from "@/lib/schemas";
import type { ActionResult, FieldErrors } from "@/lib/types";
import { DataFileError } from "../db/json-file";
import { NotFoundError } from "../db/repositories";
import { InvalidWriteError } from "../db/store";

export type Failure = Extract<ActionResult<never>, { ok: false }>;

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail(error: string, fieldErrors?: FieldErrors): Failure {
  return fieldErrors && Object.keys(fieldErrors).length ? { ok: false, error, fieldErrors } : { ok: false, error };
}

export function fromZod(error: ZodError): Failure {
  return fail("Please fix the highlighted fields.", zodFieldErrors(error));
}

export function fromProblem(p: IntegrityProblem): Failure {
  return fail(p.error, p.fieldErrors);
}

export function isFailure(x: unknown): x is Failure {
  return typeof x === "object" && x !== null && (x as { ok?: unknown }).ok === false;
}

/** Run a service body, converting known errors into `{ ok: false }` results. */
export async function guard<T>(fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) return fromZod(err);
    if (err instanceof NotFoundError) return fail(err.message);
    if (err instanceof DataFileError) return fail(err.message);
    if (err instanceof InvalidWriteError) {
      console.error("[budget] refused to write invalid data", err);
      return fail(`Nothing was saved: the result would be invalid (${err.detail}).`);
    }
    console.error("[budget] unexpected error in action", err);
    return fail(`Unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Validate an id argument coming from the client. */
export function parseId(id: unknown): string | Failure {
  if (typeof id !== "string" || id.trim() === "" || id.length > 100) return fail("Invalid id");
  return id;
}
