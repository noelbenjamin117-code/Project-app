// The real `server-only` package throws on import outside a server component
// graph. Services are plain async functions, so tests call them directly and
// alias the guard to this no-op.
export {};
