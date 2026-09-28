import 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    moderatorPrincipal: string | null;
  }
}
