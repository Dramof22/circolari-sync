export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/api/analyze") {
      return Response.json({
        ok: true,
        message: "API CircolariSync attiva",
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