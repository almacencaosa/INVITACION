const { getStore } = require("@netlify/blobs");

exports.handler = async (event, context) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  try {
    // Almacén persistente nativo de Netlify
    const store = getStore("gender_reveal");

    // Obtener los votos actuales
    let votes = await store.get("votes", { type: "json" });
    if (!votes || typeof votes !== "object") {
      votes = { boy: 0, girl: 0 };
    } else {
      votes.boy = parseInt(votes.boy, 10) || 0;
      votes.girl = parseInt(votes.girl, 10) || 0;
    }

    // --- LEER VOTOS (GET) ---
    if (event.httpMethod === "GET") {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          votes,
          total: votes.boy + votes.girl
        })
      };
    }

    // --- REGISTRAR O CAMBIAR VOTO (POST) ---
    if (event.httpMethod === "POST") {
      let bodyData = {};
      try {
        bodyData = JSON.parse(event.body || "{}");
      } catch (e) {
        bodyData = {};
      }

      const { team, previousTeam } = bodyData;

      if (team !== "boy" && team !== "girl") {
        return {
          statusCode: 400,
          headers,
          body: JSON.stringify({ error: "Equipo inválido. Debe ser 'boy' o 'girl'." })
        };
      }

      // Si el usuario ya había votado antes por el otro equipo, restamos 1 al equipo anterior
      if (previousTeam && (previousTeam === "boy" || previousTeam === "girl") && previousTeam !== team) {
        if (votes[previousTeam] > 0) {
          votes[previousTeam] = Math.max(0, votes[previousTeam] - 1);
        }
      }

      // Sumamos 1 al equipo elegido
      votes[team] = (votes[team] || 0) + 1;

      // Guardamos directamente en la base de datos de Netlify (Netlify Blobs)
      await store.setJSON("votes", votes);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          success: true,
          votes,
          total: votes.boy + votes.girl
        })
      };
    }

    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ error: "Método no permitido" })
    };
  } catch (error) {
    console.error("Error en la base de datos de Netlify:", error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

