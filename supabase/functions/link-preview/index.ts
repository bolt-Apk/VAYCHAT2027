import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface LinkPreviewResponse {
  title?: string;
  description?: string;
  image?: string;
  url: string;
  favicon?: string;
}

interface ErrorResponse {
  error: string;
  url: string;
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));
}

function extractMetaTagContent(html: string, propertyOrName: string): string | null {
  const escapedProp = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match meta tags - handle self-closing, spaces before >, etc.
  const metaTagRegex = /<meta\s+([^>]*?)\/?\s*>/gi;
  let match;
  while ((match = metaTagRegex.exec(html)) !== null) {
    const attrs = match[1];
    // Check for property="X" or name="X" (case insensitive, flexible spacing)
    const propMatch = attrs.match(new RegExp(`(?:property|name)\\s*=\\s*["']\\s*${escapedProp}\\s*["']`, "i"));
    if (!propMatch) continue;
    // Extract content value - handle both single and double quotes
    const contentMatch = attrs.match(/content\s*=\s*"([^"]*?)"|content\s*=\s*'([^']*?)'/i);
    if (contentMatch) {
      const value = contentMatch[1] ?? contentMatch[2];
      if (value) return decodeHtmlEntities(value.trim());
    }
  }
  return null;
}

function extractLinkRel(html: string, rel: string): string | null {
  const regex = new RegExp(`<link\\s+[^>]*rel=["']${rel}["'][^>]*>`, 'gi');
  let match;
  while ((match = regex.exec(html)) !== null) {
    const hrefMatch = match[0].match(/href\s*=\s*["']([^"']+?)["']/i);
    if (hrefMatch && hrefMatch[1]) {
      return decodeHtmlEntities(hrefMatch[1]);
    }
  }
  return null;
}

function extractTitleTag(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match ? decodeHtmlEntities(match[1].trim()) : null;
}

async function fetchUrlWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "ru-RU,ru;q=0.9,en-US;q=0.8,en;q=0.7",
        "Accept-Encoding": "gzip, deflate, br",
        "Cache-Control": "no-cache",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeoutId);
  }
}

function isValidUrl(urlString: string): boolean {
  try {
    const parsed = new URL(urlString);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname === "[::1]" ||
      /^127\./.test(hostname) ||
      /^10\./.test(hostname) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      /^192\.168\./.test(hostname) ||
      /^169\.254\./.test(hostname) ||
      /^0\./.test(hostname) ||
      hostname.endsWith(".local") ||
      hostname.endsWith(".internal")
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

function resolveUrl(src: string, baseUrl: string): string | undefined {
  if (!src) return undefined;
  // Handle protocol-relative URLs
  if (src.startsWith("//")) {
    try {
      const baseProtocol = new URL(baseUrl).protocol;
      return `${baseProtocol}${src}`;
    } catch {
      return `https:${src}`;
    }
  }
  if (src.startsWith("http")) return src;
  // Handle data URIs - skip them
  if (src.startsWith("data:")) return undefined;
  try {
    return new URL(src, baseUrl).href;
  } catch {
    return undefined;
  }
}

function extractFavicon(html: string, baseUrl: string): string | undefined {
  // Try <link rel="icon"> or <link rel="shortcut icon">
  const iconHref = extractLinkRel(html, "icon") 
    || extractLinkRel(html, "shortcut icon")
    || extractLinkRel(html, "apple-touch-icon");
  if (iconHref) {
    return resolveUrl(iconHref, baseUrl);
  }
  // Default favicon path
  try {
    const parsed = new URL(baseUrl);
    return `${parsed.origin}/favicon.ico`;
  } catch {
    return undefined;
  }
}

async function getLinkPreview(url: string): Promise<LinkPreviewResponse | ErrorResponse> {
  if (!isValidUrl(url)) {
    return { error: "Invalid URL format", url };
  }

  try {
    const html = await fetchUrlWithTimeout(url, 8000);

    const ogTitle = extractMetaTagContent(html, "og:title");
    const ogDescription = extractMetaTagContent(html, "og:description")
      || extractMetaTagContent(html, "description");
    const ogImage = extractMetaTagContent(html, "og:image");
    const ogImageSecure = extractMetaTagContent(html, "og:image:secure_url");
    const ogImageUrl = extractMetaTagContent(html, "og:image:url");

    const title = ogTitle || extractTitleTag(html);

    // Resolve image URL with multiple fallbacks
    let imageUrl = ogImage ? resolveUrl(ogImage, url) : undefined;

    if (!imageUrl && ogImageSecure) {
      imageUrl = resolveUrl(ogImageSecure, url);
    }

    if (!imageUrl && ogImageUrl) {
      imageUrl = resolveUrl(ogImageUrl, url);
    }

    // Fallback: twitter:image
    if (!imageUrl) {
      const twitterImage = extractMetaTagContent(html, "twitter:image");
      if (twitterImage) {
        imageUrl = resolveUrl(twitterImage, url);
      }
    }

    // Fallback: twitter:image:src
    if (!imageUrl) {
      const twitterImageSrc = extractMetaTagContent(html, "twitter:image:src");
      if (twitterImageSrc) {
        imageUrl = resolveUrl(twitterImageSrc, url);
      }
    }

    // Fallback: <link rel="image_src">
    if (!imageUrl) {
      const imageSrcLink = extractLinkRel(html, "image_src");
      if (imageSrcLink) {
        imageUrl = resolveUrl(imageSrcLink, url);
      }
    }

    // Fallback: first large img with src (skip tiny icons, avatars, tracking pixels)
    if (!imageUrl) {
      const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
      let imgMatch;
      while ((imgMatch = imgRegex.exec(html)) !== null) {
        const src = imgMatch[1];
        // Skip data URIs, tracking pixels, and very small icons
        if (src.startsWith("data:")) continue;
        if (/1x1|pixel|track|beacon|spacer/i.test(src)) continue;
        if (/\.svg$/i.test(src)) continue;
        // Check for width/height attributes that indicate it's not a tiny image
        const fullTag = imgMatch[0];
        const widthMatch = fullTag.match(/width=["']?(\d+)/i);
        if (widthMatch && parseInt(widthMatch[1]) < 50) continue;
        const heightMatch = fullTag.match(/height=["']?(\d+)/i);
        if (heightMatch && parseInt(heightMatch[1]) < 50) continue;
        imageUrl = resolveUrl(src, url);
        if (imageUrl) break;
      }
    }

    // Get favicon for the site
    const favicon = extractFavicon(html, url);

    return {
      title: title || undefined,
      description: ogDescription || undefined,
      image: imageUrl,
      favicon,
      url,
    };
  } catch (error) {
    let errorMessage = "Unknown error";
    if (error instanceof TypeError) {
      errorMessage = "Failed to fetch URL";
    } else if (error instanceof Error) {
      if (error.name === "AbortError") {
        errorMessage = "Request timeout";
      } else {
        errorMessage = error.message;
      }
    }
    return { error: errorMessage, url };
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Use POST." }),
      { status: 405, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }

  try {
    const body = await req.json();
    const { url } = body;

    if (!url || typeof url !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid 'url' field in request body" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const result = await getLinkPreview(url);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error) {
    let errorMessage = "Internal server error";
    if (error instanceof SyntaxError) {
      errorMessage = "Invalid JSON in request body";
    } else if (error instanceof Error) {
      errorMessage = error.message;
    }

    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
