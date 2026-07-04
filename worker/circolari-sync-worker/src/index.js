export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    if (url.pathname === "/api/analyze") {
      const schoolUrl = url.searchParams.get("url");

      if (!schoolUrl) {
        return Response.json({
          ok: false,
          message: "URL scuola mancante",
        }, {
          headers: corsHeaders(),
        });
      }

      return Response.json({
        ok: true,
        message: "URL ricevuto correttamente",
        url: schoolUrl,
        events: [],
        dubbi: [],
      }, {
        headers: corsHeaders(),
      });
    }

    return new Response("CircolariSync Worker attivo", {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...corsHeaders(),
      },
    });
  },
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}