const MAX_ARCHIVE_PAGES_FAST = 20;
const MAX_ARCHIVE_PAGES_DEEP = 6;
const MAX_CIRCULARS_TO_ANALYZE_FAST = 180;
const MAX_CIRCULARS_TO_ANALYZE_DEEP = 35;
const SCAN_MARGIN_DAYS = 120;
const MAX_PDFS_PER_CIRCULAR = 2;
const MAX_PDF_READS_PER_ARCHIVE = 2;
const MAX_PDF_BYTES = 1200 * 1024;
const PDF_FETCH_TIMEOUT_MS = 3500;
const MAX_PDF_SCAN_CHARS = 1200000;
const MAX_PDF_STREAMS_TO_SCAN = 40;
const MAX_PDF_STREAM_CHARS = 300000;

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: corsHeaders()
      });
    }

    if (url.pathname === "/api/analyze") {
      return handleAnalyze(url);
    }

    if (url.pathname === "/api/diagnose") {
      return handleDiagnose(url);
    }

    if (url.pathname === "/calendar.ics" || url.pathname === "/api/calendar.ics") {
      return handleCalendar(url);
    }

    return new Response("Not found", { status: 404 });
  }
};

async function handleDiagnose(url) {
  const schoolUrl = url.searchParams.get("url");

  if (!schoolUrl) {
    return jsonResponse({
      ok: false,
      message: "Parametro url mancante",
      support: "invalid",
      signals: {}
    }, 400);
  }

  let parsedSchoolUrl;

  try {
    parsedSchoolUrl = new URL(schoolUrl);
  } catch {
    return jsonResponse({
      ok: false,
      message: "URL scuola non valido",
      inputUrl: schoolUrl,
      support: "invalid",
      signals: {}
    }, 400);
  }

  try {
    const page = await readPage(parsedSchoolUrl.toString());
    const html = page.html || "";
    const links = extractLinks(html, parsedSchoolUrl.toString());

    const archiveCandidates = detectArchiveCandidatesForDiagnose(links, parsedSchoolUrl.toString());

    const pdfLinks = links.filter((link) =>
      String(link.url || link.href || "").toLowerCase().includes(".pdf")
    );

    const spaggiariLinks = links.filter((link) => {
      const value = `${link.url || ""} ${link.href || ""}`.toLowerCase();
      return value.includes("spaggiari.eu") || value.includes("cspace.spaggiari.eu");
    });

    const bestArchive = archiveCandidates[0] || null;
    const siteName = parsedSchoolUrl.hostname.replace(/^www\./, "");
    const siteIconUrl = extractSiteIconUrlForDiagnose(html, parsedSchoolUrl.origin);

    const platform = detectPlatformForDiagnose(html, links, bestArchive);

    const support = detectSupportForDiagnose(platform, {
      archiveCandidates,
      pdfLinks,
      spaggiariLinks
    });

    return jsonResponse({
      ok: true,
      inputUrl: parsedSchoolUrl.toString(),
      siteName,
      siteIconUrl,
      detectedArchiveUrl: bestArchive ? bestArchive.url : null,
      platform,
      confidence: bestArchive ? bestArchive.confidence : 0,
      reason: bestArchive ? bestArchive.reason : "Nessun archivio circolari riconosciuto con sicurezza",
      support,
      signals: {
        homepageLinks: links.length,
        archiveCandidates: archiveCandidates.length,
        pdfLinks: pdfLinks.length,
        spaggiariLinks: spaggiariLinks.length
      },
      archiveCandidates: archiveCandidates.slice(0, 5)
    });
  } catch (error) {
    return jsonResponse({
      ok: false,
      inputUrl: parsedSchoolUrl.toString(),
      message: "Diagnosi non riuscita",
      error: String(error),
      support: "unknown",
      signals: {}
    }, 200);
  }
}

function extractSiteIconUrlForDiagnose(html, baseUrl) {
  const value = String(html || "");

  const candidates = [];

  const linkRegex = /<link\b[^>]*>/gi;
  let linkMatch;

  while ((linkMatch = linkRegex.exec(value)) !== null) {
    const tag = linkMatch[0];
    const rel = extractHtmlAttributeForDiagnose(tag, "rel").toLowerCase();
    const href = extractHtmlAttributeForDiagnose(tag, "href");

    if (!href) continue;

    if (
      rel.includes("icon") ||
      rel.includes("shortcut icon") ||
      rel.includes("apple-touch-icon")
    ) {
      candidates.push(href);
    }
  }

  const metaRegex = /<meta\b[^>]*>/gi;
  let metaMatch;

  while ((metaMatch = metaRegex.exec(value)) !== null) {
    const tag = metaMatch[0];
    const property = extractHtmlAttributeForDiagnose(tag, "property").toLowerCase();
    const name = extractHtmlAttributeForDiagnose(tag, "name").toLowerCase();
    const content = extractHtmlAttributeForDiagnose(tag, "content");

    if (!content) continue;

    if (
      property === "og:image" ||
      property === "twitter:image" ||
      name === "twitter:image"
    ) {
      candidates.push(content);
    }
  }

  for (const candidate of candidates) {
    try {
      return new URL(candidate, baseUrl).toString();
    } catch {}
  }

  try {
    return new URL("/favicon.ico", baseUrl).toString();
  } catch {
    return null;
  }
}

function extractHtmlAttributeForDiagnose(tag, attributeName) {
  const pattern = new RegExp(`${attributeName}=["']([^"']+)["']`, "i");
  const match = String(tag || "").match(pattern);
  return match ? match[1] : "";
}


function detectArchiveCandidatesForDiagnose(links, baseUrl) {
  if (!Array.isArray(links)) return [];

  const candidates = [];

  for (const link of links) {
    const rawUrl = link.url || link.href;
    if (!rawUrl) continue;

    let absoluteUrl;

    try {
      absoluteUrl = new URL(rawUrl, baseUrl).toString();
    } catch {
      continue;
    }

    const text = `${link.text || ""} ${link.title || ""} ${link.label || ""}`
      .replace(/\s+/g, " ")
      .trim();

    const lowerUrl = absoluteUrl.toLowerCase();
    const lowerText = text.toLowerCase();

    let score = 0;
    const reasons = [];

    if (lowerText === "le circolari") {
      score += 100;
      reasons.push("testo esatto Le circolari");
    }

    if (lowerText.includes("circolari")) {
      score += 70;
      reasons.push("testo contiene circolari");
    }

    if (lowerText.includes("comunicati") || lowerText.includes("comunicazioni")) {
      score += 45;
      reasons.push("testo contiene comunicati/comunicazioni");
    }

    if (lowerText.includes("archivio")) {
      score += 30;
      reasons.push("testo contiene archivio");
    }

    if (lowerUrl.includes("/circolare/")) {
      score += 80;
      reasons.push("URL contiene /circolare/");
    }

    if (lowerUrl.includes("/circolari/")) {
      score += 80;
      reasons.push("URL contiene /circolari/");
    }

    if (lowerUrl.includes("/categoria/le-circolari/")) {
      score += 75;
      reasons.push("URL contiene /categoria/le-circolari/");
    }

    if (lowerUrl.includes("/categoria/circolari/")) {
      score += 70;
      reasons.push("URL contiene /categoria/circolari/");
    }

    if (lowerUrl.includes("/comunicati")) {
      score += 65;
      reasons.push("URL contiene /comunicati");
    }

    if (lowerUrl.includes("/pagine/archivio-circolari")) {
      score += 60;
      reasons.push("URL contiene archivio-circolari");
    }

    if (
      lowerUrl.includes("privacy") ||
      lowerUrl.includes("cookie") ||
      lowerUrl.includes("wp-login") ||
      lowerUrl.includes("/feed") ||
      lowerUrl.includes("#")
    ) {
      score -= 100;
      reasons.push("link utility escluso");
    }

    if (score <= 0) continue;

    candidates.push({
      url: absoluteUrl,
      text,
      score,
      confidence: Math.min(0.99, Math.round((score / 120) * 100) / 100),
      reason: reasons.join(", ")
    });
  }

  const seen = new Set();

  return candidates
    .sort((a, b) => b.score - a.score)
    .filter((candidate) => {
      if (seen.has(candidate.url)) return false;
      seen.add(candidate.url);
      return true;
    });
}

function detectPlatformForDiagnose(html, links, bestArchive) {
  const value = String(html || "").toLowerCase();

  const allLinks = Array.isArray(links)
    ? links.map((link) => `${link.url || ""} ${link.href || ""}`).join(" ").toLowerCase()
    : "";

  const archiveUrl = bestArchive ? String(bestArchive.url || "").toLowerCase() : "";

  if (
    value.includes("web.spaggiari.eu") ||
    allLinks.includes("web.spaggiari.eu") ||
    allLinks.includes("cspace.spaggiari.eu") ||
    archiveUrl.includes("spaggiari.eu")
  ) {
    return "spaggiari";
  }

  if (
    value.includes("wp-content") ||
    value.includes("wp-json") ||
    value.includes("wordpress") ||
    archiveUrl.includes("/circolare/") ||
    archiveUrl.includes("/circolari/")
  ) {
    return "wordpress-school";
  }

  if (
    value.includes("designers.italia.it") ||
    value.includes("bootstrap-italia") ||
    value.includes("schema.gov.it")
  ) {
    return "design-scuola-italia";
  }

  if (archiveUrl.includes(".pdf")) {
    return "pdf-direct";
  }

  return "unknown";
}

function detectSupportForDiagnose(platform, signals) {
  if (platform === "wordpress-school" || platform === "design-scuola-italia") {
    return "supported";
  }

  if (platform === "spaggiari") {
    return "partial-spaggiari";
  }

  if (signals && signals.pdfLinks && signals.pdfLinks.length > 0) {
    return "partial-pdf";
  }

  if (signals && signals.archiveCandidates && signals.archiveCandidates.length > 0) {
    return "partial";
  }

  return "unsupported";
}


async function handleAnalyze(url) {
  const schoolUrl = url.searchParams.get("url");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const analysisMode = normalizeAnalysisMode(url.searchParams.get("mode"));

  const validation = validateRequestParams(schoolUrl, from, to);

  if (!validation.ok) {
    return jsonResponse(validation.body, validation.status);
  }

  try {
    const data = await analyzeSchoolUrl(validation.schoolUrl, validation.from, validation.to, analysisMode);

    return jsonResponse({
      ok: true,
      message: data.mode === "archive"
        ? "Archivio letto correttamente"
        : "Pagina letta correttamente",
      ...data
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

async function handleCalendar(url) {
  const schoolUrl = url.searchParams.get("url");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const analysisMode = normalizeAnalysisMode(url.searchParams.get("mode"));

  const validation = validateRequestParams(schoolUrl, from, to);

  if (!validation.ok) {
    return new Response("Parametri non validi", {
      status: validation.status,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...corsHeaders()
      }
    });
  }

  try {
    const data = await analyzeSchoolUrl(validation.schoolUrl, validation.from, validation.to, analysisMode);
    const calendarItems = [
      ...data.events,
      ...data.dubbi.filter((item) => item.date)
    ];
    const ics = buildIcsCalendar(calendarItems, validation.schoolUrl, validation.from, validation.to);

    return new Response(ics, {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=circolari-sync.ics",
        "Cache-Control": "public, max-age=900",
        ...corsHeaders()
      }
    });
  } catch (error) {
    return new Response("Errore durante la generazione del calendario", {
      status: 500,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        ...corsHeaders()
      }
    });
  }
}

function normalizeAnalysisMode(value) {
  return value === "deep" ? "deep" : "fast";
}

function validateRequestParams(schoolUrl, from, to) {
  if (!schoolUrl) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "Parametro url mancante",
        events: [],
        dubbi: []
      }
    };
  }

  let parsedSchoolUrl;

  try {
    parsedSchoolUrl = new URL(schoolUrl);
  } catch (error) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "URL non valido",
        url: schoolUrl,
        events: [],
        dubbi: []
      }
    };
  }

  if (parsedSchoolUrl.protocol !== "https:" && parsedSchoolUrl.protocol !== "http:") {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "Sono supportati solo URL http o https",
        url: schoolUrl,
        events: [],
        dubbi: []
      }
    };
  }

  if (from && !isValidDateString(from)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "Parametro from non valido. Usa il formato YYYY-MM-DD",
        events: [],
        dubbi: []
      }
    };
  }

  if (to && !isValidDateString(to)) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "Parametro to non valido. Usa il formato YYYY-MM-DD",
        events: [],
        dubbi: []
      }
    };
  }

  if (from && to && from > to) {
    return {
      ok: false,
      status: 400,
      body: {
        ok: false,
        message: "La data di inizio non può essere successiva alla data di fine",
        events: [],
        dubbi: []
      }
    };
  }

  return {
    ok: true,
    schoolUrl,
    parsedSchoolUrl,
    from,
    to
  };
}

async function analyzeSchoolUrl(schoolUrl, from, to, analysisMode = "fast") {
  const inputUrl = schoolUrl;
  let parsedSchoolUrl = new URL(schoolUrl);
  let analyzedUrl = schoolUrl;
  let archiveAutoDetected = false;
  let firstPage = await readPage(schoolUrl);

  let allLinks = extractLinks(firstPage.html, parsedSchoolUrl);
  let circularLinks = filterCircularLinks(allLinks);
  let realCircularLinks = mergeDirectCircularPdfLinks(filterRealCircularPages(circularLinks, parsedSchoolUrl), circularLinks);

  let isArchive = looksLikeCircularArchive(parsedSchoolUrl);

  if (!isArchive && shouldTryDefaultCircularArchive(parsedSchoolUrl, realCircularLinks)) {
    const archiveCandidates = [
      "/circolare/",
      "/circolari/",
      "/categoria/circolari/",
      "/documento/circolari/"
    ];

    let bestArchive = null;

    for (const archivePath of archiveCandidates) {
      const candidateArchiveUrl = new URL(archivePath, parsedSchoolUrl.origin);

      try {
        const candidatePage = await readPage(candidateArchiveUrl.toString());
        const candidateLinks = extractLinks(candidatePage.html, candidateArchiveUrl);
        const candidateCircularLinks = filterCircularLinks(candidateLinks);
        const candidateRealCircularLinks = mergeDirectCircularPdfLinks(filterRealCircularPages(candidateCircularLinks, candidateArchiveUrl), candidateCircularLinks);

        const archivePathBonus =
          archivePath === "/circolari/" ? 100 :
          archivePath === "/categoria/circolari/" ? 40 :
          archivePath === "/documento/circolari/" ? 30 :
          archivePath === "/circolare/" ? 0 :
          0;

        const archiveScore =
          archivePathBonus +
          candidateRealCircularLinks.length * 10 +
          candidateCircularLinks.length;

        const isKnownArchiveCandidate = archiveCandidates.includes(archivePath);

        if (
          (looksLikeCircularArchive(candidateArchiveUrl) || isKnownArchiveCandidate) &&
          archiveScore > 0 &&
          (!bestArchive || archiveScore > bestArchive.score)
        ) {
          bestArchive = {
            score: archiveScore,
            parsedUrl: candidateArchiveUrl,
            page: candidatePage,
            links: candidateLinks,
            circularLinks: candidateCircularLinks,
            realCircularLinks: candidateRealCircularLinks
          };
        }
      } catch (error) {
        // Se un candidato archivio non è leggibile, proviamo il successivo.
      }
    }

    if (bestArchive) {
      parsedSchoolUrl = bestArchive.parsedUrl;
      analyzedUrl = bestArchive.parsedUrl.toString();
      archiveAutoDetected = true;
      firstPage = bestArchive.page;
      allLinks = bestArchive.links;
      circularLinks = bestArchive.circularLinks;
      realCircularLinks = bestArchive.realCircularLinks;

      if (
        realCircularLinks.length === 0 &&
        parsedSchoolUrl.pathname.toLowerCase().includes("/circolari/")
      ) {
        realCircularLinks = getDirectPdfArchiveLinks(allLinks, parsedSchoolUrl.toString());
        circularLinks = realCircularLinks;
      }

      isArchive = true;
    }
  }

  if (isArchive) {
    const archiveLimits = getArchiveLimits(analysisMode);
    const archiveLinks = await collectCircularLinksFromArchive(parsedSchoolUrl, from, to, archiveLimits);

    const rawArchiveLinksBeforeDateFilter = Array.isArray(archiveLinks.links)
      ? [...archiveLinks.links]
      : [];

    archiveLinks.links = archiveLinks.links
      .filter((link) => shouldKeepArchiveLink(link, from, to))
      .slice(0, archiveLimits.maxCircolari);

    if (
      archiveLinks.links.length === 0 &&
      parsedSchoolUrl.pathname.toLowerCase().includes("/circolari/")
    ) {
      const fallbackArchiveLinks = [
        ...rawArchiveLinksBeforeDateFilter,
        ...(Array.isArray(realCircularLinks) ? realCircularLinks : []),
        ...(Array.isArray(circularLinks) ? circularLinks : []),
        ...(Array.isArray(allLinks) ? getDirectPdfArchiveLinks(allLinks, parsedSchoolUrl.toString()) : []),
        ...(firstPage && firstPage.html ? getDirectPdfArchiveLinksFromHtml(firstPage.html, parsedSchoolUrl.toString()) : [])
      ];

      const uniqueFallbackArchiveLinks = [];
      const seenFallbackArchiveLinks = new Set();

      for (const link of fallbackArchiveLinks) {
        if (!link || !link.url || seenFallbackArchiveLinks.has(link.url)) {
          continue;
        }

        seenFallbackArchiveLinks.add(link.url);
        uniqueFallbackArchiveLinks.push(link);
      }

      if (uniqueFallbackArchiveLinks.length > 0) {
        archiveLinks.links = uniqueFallbackArchiveLinks.slice(0, archiveLimits.maxCircolari);
        circularLinks = archiveLinks.links;
        realCircularLinks = archiveLinks.links;
      }
    }

    archiveLinks.totalLinksFound = archiveLinks.links.length;

    const analysis = await analyzeCircularLinks(archiveLinks, from, to, {
      readPdfAttachments: analysisMode === "deep",
      maxPdfReads: MAX_PDF_READS_PER_ARCHIVE
    });

    return {
      mode: "archive",
      analysisMode,
      url: analyzedUrl,
      inputUrl,
      analyzedUrl,
      archiveAutoDetected,
      from: from || null,
      to: to || null,
      maxArchivePages: archiveLimits.maxArchivePages,
      maxCircolari: archiveLimits.maxCircolari,
      maxPdfReadsPerArchive: analysisMode === "deep" ? MAX_PDF_READS_PER_ARCHIVE : 0,
      archivePagesRead: archiveLinks.archivePagesRead,
      linksFound: allLinks.length,
      circularLinksFound: circularLinks.length,
      realCircularLinksFound: archiveLinks.totalLinksFound,
      analyzedCount: analysis.analyzedPages.length,
      pdfLinksFound: analysis.pdfLinksFound,
      pdfReadsAttempted: analysis.pdfReadsAttempted,
      pdfReadsSucceeded: analysis.pdfReadsSucceeded,
      pdfReadsFailed: analysis.pdfReadsFailed,
      circularLinks: archiveLinks.links.slice(0, 30),
      analyzedPages: analysis.analyzedPages,
      events: analysis.events,
      dubbi: analysis.dubbi
    };
  }

  const pageText = extractCleanText(firstPage.html);
  const htmlMainText = extractMainCircularText(pageText);
  const pdfText = await extractPdfTextFromCircularPage(firstPage.html, analyzedUrl);
  const mainText = normalizeExtractedPdfSpacing(`${htmlMainText}\n\n${pdfText}`);
  const analysis = analyzeText(mainText, analyzedUrl);
  const filtered = filterAnalysisByRange(analysis, from, to);

  return {
    mode: "single",
    analysisMode: "deep",
    url: analyzedUrl,
    inputUrl,
    analyzedUrl,
    archiveAutoDetected,
    from: from || null,
    to: to || null,
    contentType: firstPage.contentType,
    htmlLength: firstPage.html.length,
    textLength: pageText.length,
    mainTextLength: mainText.length,
    mainTextPreview: mainText.slice(0, 2000),
    linksFound: allLinks.length,
    circularLinksFound: realCircularLinks.length,
    circularLinks: realCircularLinks.slice(0, 20),
    analyzedCount: 1,
    events: filtered.events,
    dubbi: filtered.dubbi
  };
}

async function collectCircularLinksFromArchive(archiveUrl, from, to, limits = {}) {
  const maxArchivePages = limits.maxArchivePages || MAX_ARCHIVE_PAGES_FAST;
  const maxCircolari = limits.maxCircolari || MAX_CIRCULARS_TO_ANALYZE_FAST;
  const links = [];
  const seen = new Set();
  let totalLinksFound = 0;
  let archivePagesRead = 0;

  const scanFrom = from ? addDays(from, -SCAN_MARGIN_DAYS) : null;

  for (let pageNumber = 1; pageNumber <= maxArchivePages; pageNumber++) {
    const pageUrl = buildArchivePageUrl(archiveUrl, pageNumber);

    let page;

    try {
      page = await readPage(pageUrl);
    } catch (error) {
      break;
    }

    archivePagesRead++;

    const pageLinks = extractLinks(page.html, new URL(pageUrl));
    const circularLinks = filterCircularLinks(pageLinks);
    const realCircularLinks = mergeDirectCircularPdfLinks(filterRealCircularPages(circularLinks, archiveUrl), circularLinks);
    const pageDates = [];

    totalLinksFound += realCircularLinks.length;

    for (const link of realCircularLinks) {
      const archiveDate = findArchiveDateInTitle(link.title);

      if (archiveDate) {
        pageDates.push(archiveDate);
      }

      const isNoDateOperationalPdf = !archiveDate && isOperationalDirectPdf(link);

      if (!isNoDateOperationalPdf && !shouldKeepArchiveLink({ ...link, archiveDate }, scanFrom, to)) {
        continue;
      }

      if (seen.has(link.url)) {
        continue;
      }

      seen.add(link.url);

      links.push({
        title: link.title,
        url: link.url,
        archiveDate: archiveDate || null
      });

      if (links.length >= maxCircolari) {
        return {
          links,
          totalLinksFound,
          archivePagesRead
        };
      }
    }

    if (scanFrom && pageDates.length > 0) {
      const newestDate = pageDates.sort().at(-1);

      if (newestDate < scanFrom) {
        break;
      }
    }
  }

  return {
    links,
    totalLinksFound,
    archivePagesRead
  };
}


function isOperationalDirectPdf(link) {
  try {
    const rawUrl = String(link?.url || "");
    const rawText = String(`${link?.title || ""} ${link?.text || ""} ${link?.url || ""}`);
    const parsedUrl = new URL(rawUrl, "https://example.com/");
    const path = parsedUrl.pathname.toLowerCase();
    const text = normalizeText(rawText);

    if (!path.endsWith(".pdf")) {
      return false;
    }

    const directPdfKeywords = [
      "circolare",
      "circolari",
      "convocazione",
      "collegio",
      "consiglio",
      "consigli",
      "scrutinio",
      "scrutini",
      "riunione",
      "incontro",
      "dipartimenti",
      "dipartimento",
      "glo",
      "gli",
      "glh"
    ];

    return directPdfKeywords.some((keyword) => text.includes(keyword));
  } catch (error) {
    return false;
  }
}




function directPdfLooksUseful(url, text = "") {
  const normalized = normalizeText(`${url || ""} ${text || ""}`);

  return (
    normalized.includes("circolare") ||
    normalized.includes("circolari") ||
    normalized.includes("convocazione") ||
    normalized.includes("collegio") ||
    normalized.includes("consiglio") ||
    normalized.includes("consigli") ||
    normalized.includes("scrutinio") ||
    normalized.includes("scrutini") ||
    normalized.includes("riunione") ||
    normalized.includes("incontro") ||
    normalized.includes("dipartimenti") ||
    normalized.includes("dipartimento") ||
    normalized.includes("glo") ||
    normalized.includes("gli") ||
    normalized.includes("glh")
  );
}

function getDirectPdfArchiveLinksFromHtml(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const source = String(html || "");
  const linkRegex = /<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi;

  let match;

  while ((match = linkRegex.exec(source)) !== null) {
    try {
      const href = match[1];
      const rawInner = match[2] || "";
      const text = rawInner
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      const parsedUrl = new URL(href, baseUrl);
      const finalUrl = parsedUrl.toString();

      if (!directPdfLooksUseful(finalUrl, text)) {
        continue;
      }

      if (seen.has(finalUrl)) {
        continue;
      }

      seen.add(finalUrl);
      out.push({
        url: finalUrl,
        title: text || finalUrl,
        text: text || finalUrl,
        archiveDate: null
      });
    } catch (error) {
      // Link non valido: ignorato.
    }
  }

  return out;
}


function getDirectPdfArchiveLinks(links, baseUrl) {
  const out = [];
  const seen = new Set();

  for (const link of Array.isArray(links) ? links : []) {
    try {
      const parsedUrl = new URL(link.url, baseUrl);
      const path = parsedUrl.pathname.toLowerCase();
      const text = normalizeText(`${link.title || ""} ${link.text || ""} ${link.url || ""} ${path}`);

      if (!path.endsWith(".pdf")) {
        continue;
      }

      const looksUseful =
        text.includes("circolare") ||
        text.includes("circolari") ||
        text.includes("convocazione") ||
        text.includes("collegio") ||
        text.includes("consiglio") ||
        text.includes("consigli") ||
        text.includes("scrutinio") ||
        text.includes("scrutini") ||
        text.includes("riunione") ||
        text.includes("incontro") ||
        text.includes("dipartimenti") ||
        text.includes("dipartimento") ||
        text.includes("glo") ||
        text.includes("gli") ||
        text.includes("glh");

      if (!looksUseful) {
        continue;
      }

      const finalUrl = parsedUrl.toString();
      if (seen.has(finalUrl)) {
        continue;
      }

      seen.add(finalUrl);
      out.push({
        ...link,
        url: finalUrl,
        title: link.title || link.text || finalUrl,
        archiveDate: link.archiveDate || null
      });
    } catch (error) {
      // Link non valido: ignorato.
    }
  }

  return out;
}

function mergeDirectCircularPdfLinks(realLinks, candidateLinks) {
  const merged = [];
  const seen = new Set();

  for (const link of Array.isArray(realLinks) ? realLinks : []) {
    const key = String(link.url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(link);
  }

  for (const link of Array.isArray(candidateLinks) ? candidateLinks : []) {
    if (!isOperationalDirectPdf(link)) {
      continue;
    }

    const key = String(link.url || "");
    if (!key || seen.has(key)) continue;

    seen.add(key);
    merged.push(link);
  }

  return merged;
}

function shouldKeepArchiveLink(link, from, to) {
  if (!link) {
    return false;
  }

  if (isOperationalDirectPdf(link)) {
    return true;
  }

  const title = link.title || link.text || link.url || "";
  const archiveDate = link.archiveDate || findArchiveDateInTitle(title);

  // Nuova logica semplice:
  // il sito usa una finestra automatica breve. Se l'archivio ci dà una data
  // chiara fuori finestra, non apriamo proprio quella circolare.
  if (archiveDate) {
    if (from && archiveDate < from) {
      return false;
    }

    if (to && archiveDate > to) {
      return false;
    }

    return true;
  } 

  // Nella nuova versione il calendario usa una finestra breve.
  // Se dall'archivio non riusciamo a leggere la data del link, non apriamo
  // la circolare: evita di analizzare pagine vecchie o generiche fuori periodo.
  return false;
}


function buildArchiveItemFallbackText(link) {
  const parts = [];

  if (link.title) {
    parts.push(link.title);
  }

  if (link.archiveDate) {
    parts.push(`Data pubblicazione archivio: ${link.archiveDate}`);
  }

  if (link.url) {
    parts.push(link.url);

    try {
      const url = new URL(link.url);
      const fileName = decodeURIComponent(url.pathname.split("/").pop() || "");
      if (fileName) {
        parts.push(fileName.replace(/[-_]+/g, " ").replace(/\.pdf$/i, ""));
      }
    } catch (error) {
      // URL non valido: ignora fallback nome file
    }
  }

  return parts.join("\n");
}

async function analyzeCircularLinks(linksData, from, to, options = {}) {
  const events = [];
  const dubbi = [];
  const analyzedPages = [];
  const readPdfAttachments = options.readPdfAttachments === true;
  const maxPdfReads = Number.isFinite(options.maxPdfReads) ? options.maxPdfReads : 0;

  let pdfLinksFound = 0;
  let pdfReadsAttempted = 0;
  let pdfReadsSucceeded = 0;
  let pdfReadsFailed = 0;

  for (const link of linksData.links) {
    try {
      const linkUrl = new URL(link.url);
      const isDirectPdfLink = linkUrl.pathname.toLowerCase().endsWith(".pdf");

      if (isDirectPdfLink) {
        let pdfText = "";
        let pdfReadOk = false;

        if (readPdfAttachments && pdfReadsAttempted < maxPdfReads) {
          pdfReadsAttempted += 1;

          try {
            pdfText = await readPdfText(link.url);
            pdfReadOk = Boolean(pdfText && pdfText.trim());
            if (pdfReadOk) {
              pdfReadsSucceeded += 1;
            } else {
              pdfReadsFailed += 1;
            }
          } catch (error) {
            pdfReadsFailed += 1;
          }
        }

        const fallbackText = buildArchiveItemFallbackText(link);
        const mainText = normalizeExtractedPdfSpacing(
          pdfText ? `${fallbackText}\n\n${pdfText}` : fallbackText
        );
        const analysis = analyzeText(mainText, link.url);
        const filtered = filterAnalysisByRange(analysis, from, to);
        const enrichedDubbi = enrichDubbiWithPdfNotes(filtered.dubbi, {
          pdfLinksFound: 1,
          readPdfAttachments,
          pdfText,
          pdfReadsFailed: pdfReadOk ? 0 : 1
        });

        pdfLinksFound += 1;

        events.push(...filtered.events);
        dubbi.push(...enrichedDubbi);

        analyzedPages.push({
          title: link.title,
          url: link.url,
          archiveDate: link.archiveDate,
          ok: true,
          mainTextLength: mainText.length,
          pdfLinksFound: 1,
          pdfReadsAttempted: readPdfAttachments ? 1 : 0,
          pdfReadsSucceeded: pdfReadOk ? 1 : 0,
          pdfReadsFailed: pdfReadOk ? 0 : 1
        });

        continue;
      }

      const circularPage = await readPage(link.url);
      const pageText = extractCleanText(circularPage.html);
      const htmlMainText = extractMainCircularText(pageText);
      const circularPdfLinksFound = extractPdfLinks(circularPage.html, link.url).length;
      let pdfText = "";
      let pdfStats = {
        pdfLinksFound: circularPdfLinksFound,
        pdfReadsAttempted: 0,
        pdfReadsSucceeded: 0,
        pdfReadsFailed: 0
      };

      pdfLinksFound += circularPdfLinksFound;

      const fallbackText = buildArchiveItemFallbackText(link);
      const htmlOnlyText = normalizeExtractedPdfSpacing(`${fallbackText}\n\n${htmlMainText}`);
      const htmlOnlyAnalysis = analyzeText(htmlOnlyText, link.url);
      const htmlOnlyFiltered = filterAnalysisByRange(htmlOnlyAnalysis, from, to);
      const shouldTryPdf = shouldReadPdfForArchiveItem(htmlOnlyFiltered, circularPdfLinksFound, link);

      if (readPdfAttachments && shouldTryPdf && pdfReadsAttempted < maxPdfReads) {
        const remainingPdfReads = maxPdfReads - pdfReadsAttempted;
        pdfStats = await readPdfTextFromCircularPage(circularPage.html, link.url, remainingPdfReads);
        pdfText = pdfStats.text;

        pdfReadsAttempted += pdfStats.pdfReadsAttempted;
        pdfReadsSucceeded += pdfStats.pdfReadsSucceeded;
        pdfReadsFailed += pdfStats.pdfReadsFailed;
      }

      const mainText = pdfText
        ? normalizeExtractedPdfSpacing(`${htmlMainText}\n\n${pdfText}`)
        : htmlOnlyText;

      const analysis = pdfText ? analyzeText(mainText, link.url) : htmlOnlyAnalysis;
      const filtered = pdfText ? filterAnalysisByRange(analysis, from, to) : htmlOnlyFiltered;
      const enrichedDubbi = enrichDubbiWithPdfNotes(filtered.dubbi, {
        pdfLinksFound: circularPdfLinksFound,
        readPdfAttachments,
        pdfText,
        pdfReadsFailed: pdfStats.pdfReadsFailed
      });

      events.push(...filtered.events);
      dubbi.push(...enrichedDubbi);

      analyzedPages.push({
        title: link.title,
        url: link.url,
        archiveDate: link.archiveDate,
        ok: true,
        mainTextLength: mainText.length,
        pdfLinksFound: circularPdfLinksFound,
        pdfReadsAttempted: pdfStats.pdfReadsAttempted,
        pdfReadsSucceeded: pdfStats.pdfReadsSucceeded,
        pdfReadsFailed: pdfStats.pdfReadsFailed
      });
    } catch (error) {
      dubbi.push({
        title: link.title,
        date: null,
        startTime: null,
        endTime: null,
        sourceUrl: link.url,
        reason: "errore lettura circolare"
      });

      analyzedPages.push({
        title: link.title,
        url: link.url,
        archiveDate: link.archiveDate,
        ok: false,
        error: String(error)
      });
    }
  }

  return {
    events: deduplicateItems(events),
    dubbi: deduplicateItems(dubbi),
    analyzedPages,
    pdfLinksFound,
    pdfReadsAttempted,
    pdfReadsSucceeded,
    pdfReadsFailed
  };
}


async function readPage(pageUrl) {
  const pageResponse = await fetch(pageUrl, {
    headers: {
      "User-Agent": "circolari-sync/0.2"
    }
  });

  if (!pageResponse.ok) {
    throw new Error(`Pagina non leggibile, status ${pageResponse.status}`);
  }

  const contentType = pageResponse.headers.get("content-type") || "";
  const html = await pageResponse.text();

  return {
    url: pageUrl,
    contentType,
    html
  };
}

async function extractPdfTextFromCircularPage(html, pageUrl) {
  const result = await readPdfTextFromCircularPage(html, pageUrl, MAX_PDFS_PER_CIRCULAR);
  return result.text;
}

async function readPdfTextFromCircularPage(html, pageUrl, maxPdfs = MAX_PDFS_PER_CIRCULAR) {
  const allPdfLinks = extractPdfLinks(html, pageUrl);
  const pdfLinks = allPdfLinks.slice(0, Math.max(0, maxPdfs));
  const texts = [];
  let pdfReadsSucceeded = 0;
  let pdfReadsFailed = 0;

  for (const pdfUrl of pdfLinks) {
    try {
      const text = await readPdfText(pdfUrl);
      if (text) {
        texts.push(text);
        pdfReadsSucceeded++;
      } else {
        pdfReadsFailed++;
      }
    } catch (error) {
      pdfReadsFailed++;
      // Se un PDF non è leggibile, continuiamo con gli altri dati della circolare.
    }
  }

  return {
    text: texts.join("\n\n"),
    pdfLinksFound: allPdfLinks.length,
    pdfReadsAttempted: pdfLinks.length,
    pdfReadsSucceeded,
    pdfReadsFailed
  };
}

function extractPdfLinks(html, baseUrl) {
  return extractLinks(html, baseUrl)
    .map((link) => link.url)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return parsed.pathname.toLowerCase().endsWith(".pdf");
      } catch (error) {
        return false;
      }
    });
}

async function readPdfText(pdfUrl) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PDF_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(pdfUrl, {
      signal: controller.signal,
      headers: {
        "User-Agent": "circolari-sync/0.3"
      }
    });

    if (!response.ok) {
      throw new Error(`PDF non leggibile, status ${response.status}`);
    }

    const contentLength = Number.parseInt(response.headers.get("content-length") || "0", 10);

    if (contentLength > MAX_PDF_BYTES) {
      throw new Error("PDF troppo grande per l’analisi gratuita");
    }

    const arrayBuffer = await response.arrayBuffer();

    if (arrayBuffer.byteLength > MAX_PDF_BYTES) {
      throw new Error("PDF troppo grande per l’analisi gratuita");
    }

    return await extractTextFromPdfBytes(new Uint8Array(arrayBuffer));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function extractTextFromPdfBytes(bytes) {
  const binary = bytesToBinaryString(bytes).slice(0, MAX_PDF_SCAN_CHARS);
  const streamTexts = await extractPdfStreams(binary);
  const rawText = streamTexts.join("\n");

  return cleanText(
    decodePdfText(rawText)
      .replace(/\\n/g, " ")
      .replace(/\\r/g, " ")
  );
}

function bytesToBinaryString(bytes) {
  let result = "";
  const chunkSize = 8192;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.slice(index, index + chunkSize);
    result += String.fromCharCode(...chunk);
  }

  return result;
}

async function extractPdfStreams(binary) {
  const texts = [];
  const streamRegex = /<<(.*?)>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let match;
  let streamsScanned = 0;

  while ((match = streamRegex.exec(binary)) !== null) {
    if (streamsScanned >= MAX_PDF_STREAMS_TO_SCAN) {
      break;
    }

    streamsScanned++;

    const dictionary = match[1] || "";
    const stream = match[2] || "";

    if (stream.length > MAX_PDF_STREAM_CHARS) {
      continue;
    }

    texts.push(extractPdfTextOperators(stream));

    if (dictionary.includes("/FlateDecode")) {
      const decompressed = await tryDecompressPdfStream(stream);
      if (decompressed && decompressed.length <= MAX_PDF_STREAM_CHARS) {
        texts.push(extractPdfTextOperators(decompressed));
      }
    }
  }

  texts.push(extractPdfTextOperators(binary.slice(0, MAX_PDF_SCAN_CHARS)));

  return texts.filter(Boolean);
}

async function tryDecompressPdfStream(stream) {
  if (typeof DecompressionStream === "undefined") {
    return "";
  }

  const bytes = binaryStringToBytes(stream.replace(/^\r?\n/, "").replace(/\r?\n$/, ""));

  for (const format of ["deflate", "deflate-raw"]) {
    try {
      const decompressionStream = new DecompressionStream(format);
      const writer = decompressionStream.writable.getWriter();

      await writer.write(bytes);
      await writer.close();

      const response = new Response(decompressionStream.readable);
      const buffer = await response.arrayBuffer();

      return bytesToBinaryString(new Uint8Array(buffer));
    } catch (error) {
      // Proviamo il formato successivo.
    }
  }

  return "";
}

function binaryStringToBytes(value) {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 255;
  }

  return bytes;
}

function extractPdfTextOperators(content) {
  const pieces = [];

  const tjRegex = /\(([^()]*(?:\\.[^()]*)*)\)\s*Tj/g;
  let tjMatch;

  while ((tjMatch = tjRegex.exec(content)) !== null) {
    pieces.push(tjMatch[1]);
  }

  const arrayRegex = /\[((?:\s*\([^()]*(?:\\.[^()]*)*\)\s*-?\d*)+)\]\s*TJ/g;
  let arrayMatch;

  while ((arrayMatch = arrayRegex.exec(content)) !== null) {
    const arrayContent = arrayMatch[1];
    const stringRegex = /\(([^()]*(?:\\.[^()]*)*)\)/g;
    let stringMatch;
    const row = [];

    while ((stringMatch = stringRegex.exec(arrayContent)) !== null) {
      row.push(stringMatch[1]);
    }

    pieces.push(row.join(""));
  }

  return pieces.join(" ");
}

function decodePdfText(text) {
  return text
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\")
    .replace(/\\r/g, " ")
    .replace(/\\n/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\([0-7]{3})/g, (_, octal) => {
      return String.fromCharCode(parseInt(octal, 8));
    });
}


function buildArchivePageUrl(archiveUrl, pageNumber) {
  const url = new URL(archiveUrl.toString());

  if (pageNumber === 1) {
    url.pathname = "/circolare/";
    url.search = "";
    return url.toString();
  }

  url.pathname = `/circolare/page/${pageNumber}/`;
  url.search = "";
  return url.toString();
}

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

function filterRealCircularPages(links, baseUrl) {
  const baseHost = baseUrl.hostname;
  const seen = new Set();
  const result = [];

  for (const link of links) {
    let parsedUrl;

    try {
      parsedUrl = new URL(link.url, baseUrl);
    } catch (error) {
      continue;
    }

    const normalizedHost = parsedUrl.hostname.replace(/^www\./, "");
    const normalizedBaseHost = baseHost.replace(/^www\./, "");

    if (normalizedHost !== normalizedBaseHost) {
      continue;
    }

    const normalizedPath = parsedUrl.pathname.toLowerCase();
    const normalizedText = `${link.title || ""} ${link.text || ""} ${link.url || ""}`.toLowerCase();
    const isDirectCircularPdf =
      normalizedPath.endsWith(".pdf") &&
      (
        normalizedText.includes("circolare") ||
        normalizedText.includes("circolari") ||
        normalizedPath.includes("/wp-content/uploads/")
      );

    if (!parsedUrl.pathname.startsWith("/circolare/") && !isDirectCircularPdf) {
      continue;
    }

    if (parsedUrl.pathname === "/circolare/") {
      continue;
    }

    if (/^\/circolare\/page\/\d+\/?$/.test(parsedUrl.pathname)) {
      continue;
    }

    if (parsedUrl.searchParams.has("pdf") && !isDirectCircularPdf) {
      continue;
    }

    parsedUrl.hash = "";

    const cleanUrl = parsedUrl.toString();

    if (seen.has(cleanUrl)) {
      continue;
    }

    seen.add(cleanUrl);

    result.push({
      title: link.title,
      url: cleanUrl
    });
  }

  return result;
}

function looksLikeCircularArchive(url) {
  if (url.pathname === "/circolare/" || url.pathname === "/circolare") {
    return true;
  }

  if (/^\/circolare\/page\/\d+\/?$/.test(url.pathname)) {
    return true;
  }

  return false;
}

function getArchiveLimits(analysisMode) {
  if (analysisMode === "deep") {
    return {
      maxArchivePages: MAX_ARCHIVE_PAGES_DEEP,
      maxCircolari: MAX_CIRCULARS_TO_ANALYZE_DEEP
    };
  }

  return {
    maxArchivePages: MAX_ARCHIVE_PAGES_FAST,
    maxCircolari: MAX_CIRCULARS_TO_ANALYZE_FAST
  };
}

function shouldTryDefaultCircularArchive(url, realCircularLinks) {
  if (looksLikeCircularArchive(url)) {
    return false;
  }

  // Se l'utente inserisce la homepage della scuola, proviamo comunque
  // l'archivio standard /circolare/. Molte homepage contengono link a
  // singole circolari recenti, ma non sono un vero archivio paginato.
  if (url.pathname === "/" || url.pathname === "") {
    return true;
  }

  return false;
}

function normalizeExtractedPdfSpacing(text) {
  return cleanText(text)
    .replace(/(\d)\s+(\d)(?=\s*[:./-])/g, "$1$2")
    .replace(/([:./-])\s+(\d)/g, "$1$2")
    .replace(/(\d)\s+(\d)(?=\D)/g, "$1$2")
    .replace(/ore\s+(\d{1,2})\s*[:.,]\s*(\d)\s+(\d)/gi, "ore $1:$2$3")
    .replace(/ore\s+(\d{1,2})\s*[:.,]\s*(\d{2})/gi, "ore $1:$2");
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

function shouldReadPdfForArchiveItem(filteredAnalysis, pdfLinksFound, link) {
  if (pdfLinksFound <= 0) {
    return false;
  }

  const linkText = `${link.title || ""} ${link.url || ""}`.toLowerCase();

  const highPriorityWords = [
    "convocazione",
    "collegio",
    "consiglio",
    "consigli",
    "scrutinio",
    "scrutini",
    "riunione",
    "incontro",
    "dipartimenti",
    "glo",
    "gli",
    "glh"
  ];

  const lowPriorityWords = [
    "assemblea sindacale",
    "assemblea usb",
    "flc cgil",
    "pubblicazione esiti",
    "calendario scolastico",
    "trasmissione",
    "monitoraggio",
    "salvataggio materiali",
    "decreti di liquidazione"
  ];

  const hasHighPriorityWord = highPriorityWords.some((word) => linkText.includes(word));
  const hasLowPriorityWord = lowPriorityWords.some((word) => linkText.includes(word));

  if (!hasHighPriorityWord || hasLowPriorityWord) {
    return false;
  }

  return filteredAnalysis.dubbi.some((item) => {
    const reason = String(item.reason || "").toLowerCase();
    return item.date && !item.startTime && reason.includes("orario non trovato");
  });
}

function enrichDubbiWithPdfNotes(items, pdfInfo) {
  return items.map((item) => {
    if (item.startTime || pdfInfo.pdfLinksFound <= 0) {
      return item;
    }

    let note = "";

    if (!pdfInfo.readPdfAttachments) {
      note = "Alcuni orari potrebbero essere negli allegati PDF. Prova l’analisi approfondita.";
    } else if (!pdfInfo.pdfText) {
      note = "PDF allegato non leggibile automaticamente: potrebbe essere scannerizzato o composto da immagini.";
    } else if (pdfInfo.pdfReadsFailed > 0) {
      note = "Almeno un PDF allegato non è stato leggibile automaticamente.";
    }

    if (!note) {
      return item;
    }

    return {
      ...item,
      reason: item.reason ? `${item.reason}. ${note}` : note
    };
  });
}

function filterAnalysisByRange(analysis, from, to) {
  return {
    events: analysis.events
      .filter((item) => isItemInRange(item, from, to))
      .filter((item) => looksLikeUsefulCalendarItem(item)),
    dubbi: analysis.dubbi
      .filter((item) => isItemInRange(item, from, to, true))
      .filter((item) => looksLikeUsefulCalendarItem(item))
  };
}

function looksLikePotentialEventText(text) {
  const normalized = text.toLowerCase();

  return [
    "assemblea",
    "collegio",
    "convocazione",
    "consiglio",
    "scrutinio",
    "scrutini",
    "riunione",
    "incontro",
    "open day",
    "uscita",
    "viaggio",
    "esame",
    "prove",
    "formazione",
    "sindacale",
    "sciopero"
  ].some((word) => normalized.includes(word));
}

function looksLikeUsefulCalendarItem(item) {
  if (!item.date) {
    return false;
  }

  if (item.startTime && item.endTime) {
    return true;
  }

  const text = `${item.title || ""} ${item.reason || ""}`.toLowerCase();

  const eventWords = [
    "assemblea",
    "collegio",
    "consiglio",
    "consigli",
    "riunione",
    "incontro",
    "convocazione",
    "scrutinio",
    "scrutini",
    "esame",
    "esami",
    "sciopero",
    "uscita",
    "chiusura",
    "sospensione",
    "festa",
    "festività",
    "prova",
    "prove",
    "invalsi",
    "manifestazione",
    "evento",
    "webinar",
    "corso",
    "dipartimenti",
    "glh",
    "gli",
    "glo"
  ];

  const genericWords = [
    "pubblicazione",
    "trasmissione",
    "comunicazione salvataggio",
    "monitoraggio",
    "rendicontazione",
    "ricognizione",
    "graduatorie",
    "informativa",
    "privacy",
    "trattamento dei dati",
    "materiali digitali",
    "decreti di liquidazione"
  ];

  const hasEventWord = eventWords.some((word) => text.includes(word));
  const hasGenericWord = genericWords.some((word) => text.includes(word));

  if (hasEventWord) {
    return true;
  }

  if (hasGenericWord) {
    return false;
  }

  return false;
}

function isItemInRange(item, from, to, keepWithoutDate = false) {
  if (!item.date) {
    return keepWithoutDate;
  }

  if (from && item.date < from) {
    return false;
  }

  if (to && item.date > to) {
    return false;
  }

  return true;
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

function findArchiveDateInTitle(title) {
  const months = {
    gen: "01",
    gennaio: "01",
    feb: "02",
    febbraio: "02",
    mar: "03",
    marzo: "03",
    apr: "04",
    aprile: "04",
    mag: "05",
    maggio: "05",
    giu: "06",
    giugno: "06",
    lug: "07",
    luglio: "07",
    ago: "08",
    agosto: "08",
    set: "09",
    settembre: "09",
    ott: "10",
    ottobre: "10",
    nov: "11",
    novembre: "11",
    dic: "12",
    dicembre: "12"
  };

  const text = cleanText(title);

  const numericMatch = text.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);

  if (numericMatch) {
    const day = numericMatch[1].padStart(2, "0");
    const month = numericMatch[2].padStart(2, "0");
    const year = numericMatch[3];

    return `${year}-${month}-${day}`;
  }

  const italianDayMonthYearMatch = text.match(/\b(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\s+(20\d{2})\b/i);

  if (italianDayMonthYearMatch) {
    const day = italianDayMonthYearMatch[1].padStart(2, "0");
    const monthName = italianDayMonthYearMatch[2].toLowerCase();
    const year = italianDayMonthYearMatch[3];
    const month = months[monthName];

    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  const italianYearDayMonthMatch = text.match(/\b(20\d{2})\s+(\d{1,2})\s+([A-Za-zÀ-ÿ]{3,})\b/i);

  if (italianYearDayMonthMatch) {
    const year = italianYearDayMonthMatch[1];
    const day = italianYearDayMonthMatch[2].padStart(2, "0");
    const monthName = italianYearDayMonthMatch[3].toLowerCase();
    const month = months[monthName];

    if (month) {
      return `${year}-${month}-${day}`;
    }
  }

  return null;
}

function normalizeTime(hour, minute) {
  const parsedHour = Number.parseInt(hour, 10);
  const parsedMinute = Number.parseInt(minute || "00", 10);

  if (
    Number.isNaN(parsedHour) ||
    Number.isNaN(parsedMinute) ||
    parsedHour < 0 ||
    parsedHour > 23 ||
    parsedMinute < 0 ||
    parsedMinute > 59
  ) {
    return null;
  }

  return `${String(parsedHour).padStart(2, "0")}:${String(parsedMinute).padStart(2, "0")}`;
}

function findTimeRange(text) {
  const normalized = cleanText(text).replace(/\s+/g, " ");

  const rangePatterns = [
    /(?:dalle|dalle ore|ore)\s*(\d{1,2})(?:[:.,](\d{2}))?\s*(?:alle|[-–—])\s*(?:ore\s*)?(\d{1,2})(?:[:.,](\d{2}))?/i,
    /(\d{1,2})(?:[:.,](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.,](\d{2}))?/i
  ];

  for (const pattern of rangePatterns) {
    const match = normalized.match(pattern);

    if (match) {
      const startTime = normalizeTime(match[1], match[2] || "00");
      const endTime = normalizeTime(match[3], match[4] || "00");

      if (startTime && endTime && startTime < endTime) {
        return { startTime, endTime };
      }
    }
  }

  const oreMatches = [...normalized.matchAll(/(?:alle\s+)?ore\s*(\d{1,2})(?:[:.,](\d{2}))?/gi)]
    .map((match) => normalizeTime(match[1], match[2] || "00"))
    .filter(Boolean);

  if (oreMatches.length >= 2) {
    return {
      startTime: oreMatches[0],
      endTime: oreMatches[oreMatches.length - 1]
    };
  }

  return null;
}


function buildIcsCalendar(events, sourceUrl, from, to) {
  const now = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CircolariSync//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CircolariSync",
    "X-WR-CALDESC:Calendario generato da circolari scolastiche pubbliche"
  ];

  for (const event of events) {
    if (!event.date) {
      continue;
    }

    const uid = makeUid(event);

    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${now}`);

    if (event.startTime && event.endTime) {
      const dtStart = formatIcsDateTime(event.date, event.startTime);
      const dtEnd = formatIcsDateTime(event.date, event.endTime);

      lines.push(`DTSTART:${dtStart}`);
      lines.push(`DTEND:${dtEnd}`);
    } else {
      const startDate = formatIcsDate(event.date);
      const endDate = formatIcsDate(addDays(event.date, 1));

      lines.push(`DTSTART;VALUE=DATE:${startDate}`);
      lines.push(`DTEND;VALUE=DATE:${endDate}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(event.title)}`);
    lines.push(`DESCRIPTION:${escapeIcsText(`Fonte: ${event.sourceUrl}`)}`);
    lines.push(`URL:${event.sourceUrl}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");

  return lines.join("\r\n");
}

function makeUid(event) {
  const raw = `${event.date}-${event.startTime}-${event.endTime}-${event.sourceUrl}`;
  let hash = 0;

  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash) + raw.charCodeAt(i);
    hash |= 0;
  }

  return `circolari-sync-${Math.abs(hash)}@circolari-sync`;
}

function formatIcsDateTime(date, time) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function formatIcsDate(date) {
  return date.replaceAll("-", "");
}

function escapeIcsText(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

function deduplicateItems(items) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = `${item.title}|${item.date}|${item.startTime}|${item.endTime}|${item.sourceUrl}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(item);
  }

  return result;
}

function isValidDateString(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function addDays(dateString, days) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
