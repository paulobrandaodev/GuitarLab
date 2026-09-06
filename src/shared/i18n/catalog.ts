import type { ptBR } from './pt-BR'

/**
 * The shape every language must match.
 *
 * Derived from the Portuguese catalogue, which is the source of truth. Because
 * `en.ts` and `es.ts` are declared `: Catalog`, the compiler reports a missing
 * key, an extra one, or an interpolating entry whose arguments drifted — so
 * `npm run typecheck` keeps the three files in step with no tooling of its own.
 */
export type Catalog = typeof ptBR
