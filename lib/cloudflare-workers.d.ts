// Minimale Typen für das Runtime-Modul der Workers (die vollen Runtime-Typen sind nicht eingebunden).
declare module 'cloudflare:workers' {
  export class DurableObject {
    constructor(ctx: unknown, env: unknown)
  }
}
