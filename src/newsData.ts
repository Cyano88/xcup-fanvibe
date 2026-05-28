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
const OFFICIAL_OKX_NEWS: WorldCupNewsItem[] = [
  {
    title: 'OKX introduces Exchange OS on X Layer for custom spot, perpetual and outcome markets',
    description: 'Official OKX announcement for Exchange OS, the X Layer market infrastructure that includes staged support for 2026 World Cup outcome markets.',
    source: 'OKX Learn',
    image: '/assets/okx-xlayer-news.webp',
    url: 'https://www.okx.com/en-us/learn/exchange-os',
    publishedAt: '2026-05-26T00:00:00.000Z',
    tag: 'X Layer',
  },
  {
    title: 'X Layer details Flashblocks engineering for 200ms finality and zero-reorg protection',
    description: 'Official X Layer engineering post covering flashblocks, low-latency RPC updates and real-time app infrastructure.',
    source: 'OKX Learn',
    image: '/assets/okx-layer-x.jpg',
    url: 'https://www.okx.com/en-ae/learn/flashblocks-on-x-layer',
    publishedAt: '2026-05-27T00:00:00.000Z',
    tag: 'Infrastructure',
  },
  {
    title: 'Build X: X Cup Hackathon is live for World Cup markets on X Layer',
    description: 'Official OKX Web3 hackathon track for football prediction experiences, running May 19-28 with a 14,000 USDT prize pool.',
    source: 'OKX Web3',
    image: '/assets/okx-layer-x.jpg',
    url: 'https://web3.okx.com/zh-hans/xlayer/build-x-hackathon/xcup',
    publishedAt: '2026-05-19T23:59:00.000Z',
    tag: 'Hackathon',
  },
  {
    title: 'Build X: Hook the Future brings Uniswap v4 hooks to X Layer builders',
    description: 'Official OKX Web3 hackathon track for X Layer and Uniswap v4 hook applications, running May 22-28 with a 14,000 USDT prize pool.',
    source: 'OKX Web3',
    image: '/assets/okx-layer-x.jpg',
    url: 'https://web3.okx.com/ar/xlayer/build-x-hackathon/hook',
    publishedAt: '2026-05-22T23:59:00.000Z',
    tag: 'Hackathon',
  },
];

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
    articles: OFFICIAL_OKX_NEWS,
    source: 'fallback',
    mode: 'live',
    updatedAt: Date.now(),
    freshnessSeconds: 0,
    providerConfigured: !!process.env.NEWS_API_KEY,
    error,
  };
}

function mergeOfficialNews(articles: WorldCupNewsItem[]): WorldCupNewsItem[] {
  const seen = new Set<string>();
  const dedupe = (article: WorldCupNewsItem) => {
      const key = article.url || article.title;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
  };
  const liveArticles = articles.filter(dedupe);
  const officialArticles = OFFICIAL_OKX_NEWS.filter(dedupe);
  const merged: WorldCupNewsItem[] = [];
  let officialIndex = 0;

  liveArticles.forEach((article, index) => {
    merged.push(article);
    if ((index + 1) % 2 === 0 && officialIndex < officialArticles.length) {
      merged.push(officialArticles[officialIndex]);
      officialIndex += 1;
    }
  });

  while (officialIndex < officialArticles.length) {
    merged.push(officialArticles[officialIndex]);
    officialIndex += 1;
  }

  return merged.slice(0, 12);
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
    const articles = mergeOfficialNews(normalizeArticles(json.articles ?? []));

    cache = {
      articles,
      source: 'gnews',
      mode: 'live',
      updatedAt: Date.now(),
      freshnessSeconds: 0,
      providerConfigured: true,
      error: undefined,
    };
    return cache;
  } catch (err: unknown) {
    cache = fallbackFeed(err instanceof Error ? err.message : String(err));
    return cache;
  }
}
