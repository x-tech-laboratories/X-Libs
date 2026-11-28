// The models an OpenAI-compatible endpoint offers, from its GET /models, so the user can pick one rather than type its
// name. A llama.cpp router also says of each model whether it is in memory, which is kept; any failure is no list, with
// the reason in plain words that never hold the key. Needs only fetch, so it runs in a page as on Node.

// ── Shapes ───────────────────────────────────────────────────────────────────

export type ModelState = "loaded" | "loading" | "unloaded" | "failed" | "";

export interface EndpointModel {
  id: string;
  state: ModelState;
}

// The models an endpoint offers; an empty list with the reason when it lists none or could not be asked.
export interface ModelListing {
  models: EndpointModel[];
  problem: string;
}

// ── Reading ──────────────────────────────────────────────────────────────────

// How long the endpoint has to answer before the list is given up.
export const list_timeout_ms = 5000;

// The most models kept from one answer, so an odd server cannot flood the page.
export const most_models = 500;

const states: readonly ModelState[] = ["loaded", "loading", "unloaded", "failed"];

const is_record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

// A model's load state as a llama.cpp router gives it: `status` as `{ value }` or a plain word, or a `loaded` switch.
export function state_of(entry: Record<string, unknown>): ModelState {
  const status = is_record(entry.status) ? entry.status.value : entry.status;
  if (typeof status === "string" && (states as readonly string[]).includes(status)) return status as ModelState;
  if (is_record(entry.status) && entry.status.failed === true) return "failed";
  if (typeof entry.loaded === "boolean") return entry.loaded ? "loaded" : "unloaded";
  return "";
}

// The models in an OpenAI-format answer, `{ data: [{ id }] }`, each once, in the order given.
export function models_of(body: unknown): EndpointModel[] | null {
  if (!is_record(body) || !Array.isArray(body.data)) return null;
  const seen = new Set<string>();
  const models: EndpointModel[] = [];
  for (const entry of body.data) {
    if (!is_record(entry) || typeof entry.id !== "string") continue;
    const id = entry.id.trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    models.push({ id, state: state_of(entry) });
    if (models.length >= most_models) break;
  }
  return models;
}

// Where the endpoint is, by host and port alone, for a reason shown to the user.
function place_of(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "the endpoint";
  }
}

// The models the endpoint lists, asked with the key when there is one; never throws.
export async function list_endpoint_models(endpoint: string, api_key: string, signal?: AbortSignal, fetcher: typeof fetch = fetch): Promise<ModelListing> {
  const base = endpoint.trim().replace(/\/+$/, "");
  const place = place_of(base);
  const timeout = AbortSignal.timeout(list_timeout_ms);
  try {
    const response = await fetcher(`${base}/models`, {
      headers: { accept: "application/json", ...(api_key ? { authorization: `Bearer ${api_key}` } : {}) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (response.status === 401 || response.status === 403) return { models: [], problem: `${place} refused the API key when asked for its models.` };
    if (!response.ok) return { models: [], problem: `${place} does not list its models (it answered ${response.status}).` };
    const models = models_of(await response.json().catch(() => null));
    if (models === null) return { models: [], problem: `${place} answered, but not with a list of models.` };
    return { models, problem: models.length === 0 ? `${place} lists no models.` : "" };
  } catch {
    return { models: [], problem: timeout.aborted ? `${place} did not list its models in time.` : `${place} could not be reached to list its models.` };
  }
}

// ── Showing ──────────────────────────────────────────────────────────────────

const state_words: Record<Exclude<ModelState, "">, string> = { loaded: "loaded", loading: "loading", unloaded: "not loaded", failed: "failed to load" };

// A model's name with what its server says of it, such as "qwen3 (loaded)".
export function model_label(model: EndpointModel): string {
  return model.state ? `${model.id} (${state_words[model.state]})` : model.id;
}

// Whether the next request to this model may wait while its server loads it: it is listed as not loaded, or, where the
// server does not say, it was only just chosen.
export function may_load(listing: ModelListing | null, model: string, just_chosen: boolean): boolean {
  const found = listing?.models.find((each) => each.id === model);
  if (found?.state) return found.state !== "loaded";
  return just_chosen;
}
