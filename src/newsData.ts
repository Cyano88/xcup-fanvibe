export interface WorldCupNewsItem {
  title: string;
  description: string;
  source: string;
  image: string;
  url: string;
  publishedAt: string;
  tag: string;
}

export interface WorldCupNewsFeed {
  articles: WorldCupNewsItem[];
  source: 'gnews' | 'fallback';
  mode: 'live' | 'fallback';
  updatedAt: number;
  freshnessSeconds: number;
  providerConfigured: boolean;
  error?: string;
}

interface GNewsArticle {
  title?: string;
  description?: string;
  content?: string;
  url?: string;
  image?: string;
  publishedAt?: string;
  source?: {
    name?: string;
    url?: string;
  };
}

const NEWS_CACHE_MS = Number(process.env.NEWS_CACHE_MS ?? '900000');
const NEWS_API_URL = process.env.NEWS_API_URL ?? 'https://gnews.io/api/v4/search';
const NEWS_QUERY = process.env.NEWS_QUERY ?? 'World Cup 2026 OR FIFA World Cup';
const FALLBACK_IMAGE = '/assets/fanvibe-season-bg.jpeg';

let cache: WorldCupNewsFeed | null = null;

function tagFor(article: GNewsArticle): string {
  const text = `${article.title ?? ''} ${article.description ?? ''}`.toLowerCase();
  if (text.includes('injury') || text.includes('squad') || text.includes('roster')) return 'Squads';
  if (text.includes('qualif') || text.includes('draw') || text.includes('fixture')) return 'Fixtures';
  if (text.includes('ticket') || text.includes('stadium') || text.includes('venue')) return 'Venues';
  if (text.includes('odds') || text.includes('bet')) return 'Markets';
  return 'World Cup';
}

function fallbackFeed(error?: string): WorldCupNewsFeed {
  return {
    articles: [],
    source: 'fallback',
    mode: 'fallback',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: !!process.env.NEWS_API_KEY,
    error,
  };
}

function normalizeArticles(articles: GNewsArticle[]): WorldCupNewsItem[] {
  return articles
    .filter(article => article.title && article.url)
    .slice(0, 10)
    .map(article => ({
      title: article.title!,
      description: article.description ?? article.content ?? '',
      source: article.source?.name ?? 'World Cup News',
      image: article.image || FALLBACK_IMAGE,
      url: article.url!,
      publishedAt: article.publishedAt ?? new Date().toISOString(),
      tag: tagFor(article),
    }));
}

export async function getWorldCupNews(force = false): Promise<WorldCupNewsFeed> {
  if (!force && cache && Date.now() - cache.updatedAt < NEWS_CACHE_MS) {
    return { ...cache, freshnessSeconds: Math.floor((Date.now() - cache.updatedAt) / 1000) };
  }

  const token = process.env.NEWS_API_KEY;
  if (!token) {
    cache = fallbackFeed('NEWS_API_KEY is not configured');
    return cache;
  }

  try {
    const url = new URL(NEWS_API_URL);
    url.searchParams.set('q', NEWS_QUERY);
    url.searchParams.set('lang', 'en');
    url.searchParams.set('max', '10');
    url.searchParams.set('apikey', token);

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`GNews API ${res.status}`);
    const json = await res.json() as { articles?: GNewsArticle[] };
    const articles = normalizeArticles(json.articles ?? []);

    cache = {
      articles,
      source: 'gnews',
      mode: articles.length ? 'live' : 'fallback',
      updatedAt: Date.now(),
      freshnessSeconds: 0,
      providerConfigured: true,
      error: articles.length ? undefined : 'No news articles returned',
    };
    return cache;
  } catch (err: unknown) {
    cache = fallbackFeed(err instanceof Error ? err.message : String(err));
    return cache;
  }
}
