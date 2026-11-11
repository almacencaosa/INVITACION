import { sql } from 'drizzle-orm';
import { getDb } from '../../db/index.ts';
import { votes as voteTable } from '../../db/schema.ts';

export function createVotesHandler(connect = getDb) {
  return async (request) => {
    const reply = (body, status = 200) => Response.json(body, {
      status,
      headers: { 'Cache-Control': 'no-store', Allow: 'GET, POST' },
    });
    if (!['GET', 'POST'].includes(request.method)) {
      return reply({ error: 'Método no permitido.' }, 405);
    }

    let vote;
    if (request.method === 'POST') {
      try {
        vote = await request.json();
      } catch {
        return reply({ error: 'El contenido debe ser JSON válido.' }, 400);
      }
      if (!vote || !['boy', 'girl'].includes(vote.team) ||
          typeof vote.voterId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(vote.voterId)) {
        return reply({ error: 'El equipo o identificador de voto no es válido.' }, 400);
      }
    }

    try {
      const db = connect();
      if (vote) {
        // A unique voter row makes retries safe and team changes atomic.
        await db.insert(voteTable).values({ voterId: vote.voterId, team: vote.team })
          .onConflictDoUpdate({
            target: voteTable.voterId,
            set: { team: vote.team, updatedAt: sql`now()` },
          });
      }
      const [counts] = await db.select({
        boy: sql`count(*) filter (where ${voteTable.team} = 'boy')::integer`,
        girl: sql`count(*) filter (where ${voteTable.team} = 'girl')::integer`,
      }).from(voteTable);
      return reply({ success: true, votes: counts, total: counts.boy + counts.girl });
    } catch {
      // Keep connection details out of logs and public responses.
      console.error('No se pudo consultar o guardar la votación.');
      return reply({ error: 'No se pudo conectar con la votación. Intenta de nuevo.' }, 503);
    }
  };
}

export default async function handler(request) {
  return createVotesHandler()(request);
}
