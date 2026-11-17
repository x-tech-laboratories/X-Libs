// Words for anything thrown, since libraries throw plain objects and strings as well as Errors.

interface CodedError {
  code?: unknown;
  category?: unknown;
  message?: unknown;
  data?: unknown;
}

// An Error's message, a shaka-style object's category and code, a string as it is, and anything else as JSON.
export function describe_error(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "Unknown error";
  if (typeof error !== "object") return String(error);

  const coded = error as CodedError;
  if (typeof coded.code === "number") {
    const name = typeof coded.category === "number" ? `${coded.category}.${coded.code}` : String(coded.code);
    const text = typeof coded.message === "string" && coded.message ? coded.message : undefined;
    const detail = text ?? (Array.isArray(coded.data) ? coded.data.find((item): item is string => typeof item === "string") : undefined);
    return detail ? `Error ${name}: ${detail}` : `Error ${name}`;
  }
  if (typeof coded.message === "string" && coded.message) return coded.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

// Electron's wrapping of a failed call, which electron/bridge's clean_error_message strips too.
const REMOTE_ERROR_PREFIX = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;

// describe_error's words without Electron's "Error invoking remote method" wrapping, for a failed call shown to the user.
export function describe_call_error(error: unknown): string {
  return describe_error(error).replace(REMOTE_ERROR_PREFIX, "");
}
