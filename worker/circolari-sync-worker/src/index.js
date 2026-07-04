export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname !== "/api/analyze") {
      return new Response("Not found", { status: 404 });
    }

    const schoolUrl = url.searchParams.get("url");

    if (!schoolUrl) {
      return jsonResponse({
        ok: false,
        message: "Parametro url mancante",
        events: [],
        dubbi: []
      }, 400);
    }

    let parsedSchoolUrl;

    try {
      parsedSchoolUrl = new URL(schoolUrl);
    } catch (error) {
      return jsonResponse({
        ok: false,
        message: "URL non valido",
        url: schoolUrl,
        events: [],
        dubbi: []
      }, 400);
    }

    if (parsedSchoolUrl.protocol !== "https:" && parsedSchoolUrl.protocol !== "http:") {
      return jsonResponse({
        ok: false,
        message: "Sono supportati solo URL http o https",
        url: schoolUrl,
        events: [],
        dubbi: []
      }, 400);
    }

    try {
      const pageResponse = await fetch(schoolUrl, {
        headers: {
          "User-Agent": "circolari-sync/0.1"
        }
      });

      if (!pageResponse.ok) {
        return jsonResponse({
          ok: false,
          message: "Non riesco a leggere la pagina indicata",
          url: schoolUrl,
          status: pageResponse.status,
          events: [],
          dubbi: []
        }, 502);
      }

      const contentType = pageResponse.headers.get("content-type") || "";
      const html = await pageResponse.text();

      const allLinks = extractLinks(html, parsedSchoolUrl);
      const circularLinks = filterCircularLinks(allLinks);
      const pageText = extractCleanText(html);
      const mainText = extractMainCircularText(pageText);
      const analysis = analyzeText(mainText, schoolUrl);

      return jsonResponse({
        ok: true,
        message: "Pagina letta correttamente",
        url: schoolUrl,
        contentType,
        htmlLength: html.length,
        textLength: pageText.length,
        mainTextLength: mainText.length,
        mainTextPreview: mainText.slice(0, 2000),
        linksFound: allLinks.length,
        circularLinksFound: circularLinks.length,
        circularLinks: circularLinks.slice(0, 20),
        events: analysis.events,
        dubbi: analysis.dubbi
      });

    } catch (error) {
      return jsonResponse({
        ok: false,
        message: "Errore durante la lettura della pagina",
        url: schoolUrl,
        error: String(error),
        events: [],
        dubbi: []
      }, 500);
    }
  }
};

function extractLinks(html, baseUrl) {
  const links = [];
  const seen = new Set();

  const linkRegex = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = linkRegex.exec(html)) !== null) {
    const href = cleanText(match[1]);
    const label = cleanText(removeHtmlTags(match[2]));

    if (!href) {
      continue;
    }

    if (
      href.startsWith("#") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:") ||
      href.startsWith("javascript:")
    ) {
      continue;
    }

    let absoluteUrl;

    try {
      absoluteUrl = new URL(href, baseUrl).toString();
    } catch (error) {
      continue;
    }

    if (seen.has(absoluteUrl)) {
      continue;
    }

    seen.add(absoluteUrl);

    links.push({
      title: label || absoluteUrl,
      url: absoluteUrl
    });
  }

  return links;
}

function filterCircularLinks(links) {
  return links.filter((link) => {
    const text = `${link.title} ${link.url}`.toLowerCase();

    return (
      text.includes("circolare") ||
      text.includes("circolari") ||
      text.includes("comunicazione") ||
      text.includes("comunicazioni") ||
      text.includes("avviso") ||
      text.includes("avvisi")
    );
  });
}

function extractMainCircularText(text) {
  let mainText = text;

  const startMarkers = [
    "Home Novità Le circolari",
    "Le circolari Circolari personale scolastico",
    "Le circolari"
  ];

  for (const marker of startMarkers) {
    const index = mainText.indexOf(marker);

    if (index !== -1) {
      mainText = mainText.slice(index);
      break;
    }
  }

  const endMarkers = [
    "Circolari, notizie, eventi correlati",
    "Stampa / Condividi",
    "Argomenti",
    "Istituto Comprensivo Statale"
  ];

  for (const marker of endMarkers) {
    const index = mainText.indexOf(marker);

    if (index !== -1) {
      mainText = mainText.slice(0, index);
      break;
    }
  }

  return cleanText(mainText);
}

function analyzeText(text, sourceUrl) {
  const title = extractTitle(text);
  const date = findDate(text);
  const timeRange = findTimeRange(text);

  const item = {
    title,
    date: date || null,
    startTime: timeRange ? timeRange.startTime : null,
    endTime: timeRange ? timeRange.endTime : null,
    sourceUrl
  };

  if (date && timeRange) {
    return {
      events: [item],
      dubbi: []
    };
  }

  const missing = [];

  if (!date) {
    missing.push("data non trovata");
  }

  if (!timeRange) {
    missing.push("orario non trovato");
  }

  return {
    events: [],
    dubbi: [
      {
        ...item,
        reason: missing.join(", ")
      }
    ]
  };
}

function extractTitle(text) {
  const candidates = [];

  const circularTitleRegex = /Circolare\s*(?:n\.?\s*)?\d*\s*[:.]?\s*([^]+?)(?=\s+Circolare\s*(?:n\.?\s*)?\d|\s+OO\.CC|\s+Documenti|\s+Pubblicato|\s+Francesca Toscano|\s+Dirigente Scolastico|\s+-\s+Istituto)/gi;

  let match;

  while ((match = circularTitleRegex.exec(text)) !== null) {
    const candidate = cleanTitle(match[1]);

    if (candidate.length >= 10) {
      candidates.push(candidate);
    }
  }

  if (candidates.length > 0) {
    return shortestUsefulTitle(candidates);
  }

  const fallback = text
    .replace(/^Home\s+Novità\s+Le circolari\s*/i, "")
    .replace(/^Circolari personale scolastico\s*/i, "");

  return cleanTitle(fallback.slice(0, 180));
}

function shortestUsefulTitle(titles) {
  let best = titles[0];

  for (const title of titles) {
    if (title.length < best.length) {
      best = title;
    }
  }

  return best;
}

function cleanTitle(title) {
  let cleaned = cleanText(title)
    .replace(/^[:.\-\s]+/, "")
    .replace(/\s+Circolare\s+\d+.*$/i, "")
    .replace(/\s+Francesca Toscano.*$/i, "")
    .replace(/\s+Dirigente Scolastico.*$/i, "")
    .replace(/\s+La RSU di Istituto.*$/i, "")
    .trim();

  const sentenceEnd = cleaned.search(/[.!?]\s/);

  if (sentenceEnd !== -1 && sentenceEnd < 160) {
    cleaned = cleaned.slice(0, sentenceEnd + 1).trim();
  }

  if (cleaned.length > 160) {
    cleaned = cleaned.slice(0, 160).trim();
  }

  return cleaned;
}

function findDate(text) {
  const months = {
    gennaio: "01",
    febbraio: "02",
    marzo: "03",
    aprile: "04",
    maggio: "05",
    giugno: "06",
    luglio: "07",
    agosto: "08",
    settembre: "09",
    ottobre: "10",
    novembre: "11",
    dicembre: "12"
  };

  const writtenDateRegex = /\b(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)\s+(\d{4})\b/i;
  const writtenMatch = text.match(writtenDateRegex);

  if (writtenMatch) {
    const day = writtenMatch[1].padStart(2, "0");
    const month = months[writtenMatch[2].toLowerCase()];
    const year = writtenMatch[3];

    return `${year}-${month}-${day}`;
  }

  const numericDateRegex = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/;
  const numericMatch = text.match(numericDateRegex);

  if (numericMatch) {
    const day = numericMatch[1].padStart(2, "0");
    const month = numericMatch[2].padStart(2, "0");
    const year = numericMatch[3];

    return `${year}-${month}-${day}`;
  }

  return null;
}

function findTimeRange(text) {
  const timeRangeRegex = /\b(?:ore\s*)?(\d{1,2})[:.](\d{2})\s*[-–]\s*(?:ore\s*)?(\d{1,2})[:.](\d{2})\b/i;
  const match = text.match(timeRangeRegex);

  if (!match) {
    return null;
  }

  const startHour = match[1].padStart(2, "0");
  const startMinute = match[2];
  const endHour = match[3].padStart(2, "0");
  const endMinute = match[4];

  return {
    startTime: `${startHour}:${startMinute}`,
    endTime: `${endHour}:${endMinute}`
  };
}

function extractCleanText(html) {
  return cleanText(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  );
}

function removeHtmlTags(text) {
  return text.replace(/<[^>]*>/g, " ");
}

function cleanText(text) {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&#8217;/g, "’")
    .replace(/&#8220;/g, "“")
    .replace(/&#8221;/g, "”")
    .replace(/&#8211;/g, "–")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*"
    }
  });
}