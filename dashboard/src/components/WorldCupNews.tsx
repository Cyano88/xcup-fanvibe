import { useEffect, useMemo, useState } from 'react';
import { ExternalLink, Newspaper } from 'lucide-react';

interface NewsItem {
  title: string;
  description?: string;
  source: string;
  image: string;
  url: string;
  tag: string;
  publishedAt?: string;
}

interface NewsFeed {
  articles: NewsItem[];
  source: 'gnews' | 'fallback';
  mode: 'live' | 'fallback';
  freshnessSeconds: number;
  providerConfigured: boolean;
  error?: string;
}

const BACKEND_HTTP = import.meta.env.VITE_BACKEND_HTTP ?? 'http://localhost:3001';

const FALLBACK_NEWS: NewsItem[] = [
  {
    title: 'World Cup 2026 markets are live across all group-stage match windows',
    source: 'FanVibe Desk',
    image: '/assets/fanvibe-season-bg.jpeg',
    url: '#',
    tag: 'Markets',
  },
  {
    title: 'Synthetic season model now blends team strength, form, confederation and upset volatility',
    source: 'FanVibe Desk',
    image: '/assets/fanvibe-hero-logo.jpeg',
    url: '#',
    tag: 'Simulation',
  },
  {
    title: 'X Layer settlement proof keeps stake, payout and refund history linked to explorer records',
    source: 'FanVibe Desk',
    image: '/assets/brand-e.png',
    url: '#',
    tag: 'Settlement',
  },
];

export function WorldCupNews() {
  const [active, setActive] = useState(0);
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const items = useMemo(() => feed?.articles?.length ? feed.articles : FALLBACK_NEWS, [feed]);
  const lead = items[active % items.length];

  useEffect(() => {
    fetch(`${BACKEND_HTTP}/worldcup/news`)
      .then(res => res.json())
      .then((data: NewsFeed) => setFeed(data))
      .catch(() => setFeed(null));
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setActive(index => (index + 1) % items.length), 6500);
    return () => clearInterval(timer);
  }, [items.length]);

  useEffect(() => {
    setActive(0);
  }, [items]);

  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-extrabold uppercase tracking-[0.18em] dark:text-blue-300 text-blue-600">
            <Newspaper size={14} />
            Breaking News
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight dark:text-zinc-100 text-zinc-950">
            World Cup Pulse
          </h2>
        </div>
        <div className="hidden sm:block text-right text-xs dark:text-zinc-500 text-zinc-500">
          {feed?.mode === 'live' ? `GNews - synced ${feed.freshnessSeconds}s ago` : feed?.error ?? 'Fallback desk feed'}
        </div>
      </div>

      <a
        href={lead.url}
        target={lead.url === '#' ? undefined : '_blank'}
        rel={lead.url === '#' ? undefined : 'noopener noreferrer'}
        className="group relative block min-h-[360px] overflow-hidden rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white shadow-sm"
      >
        <img
          src={lead.image}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
        <div className="relative z-10 flex min-h-[360px] flex-col justify-end p-5 sm:p-6">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white backdrop-blur">
            {lead.tag}
          </div>
          <h3 className="max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-4xl">
            {lead.title}
          </h3>
          {lead.description && (
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-200 line-clamp-2">
              {lead.description}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-zinc-200">
            <span>{lead.source}</span>
            <span className="inline-flex items-center gap-1">
              Read story
              <ExternalLink size={13} />
            </span>
          </div>
        </div>
      </a>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {items.map((item, index) => (
          <button
            key={item.title}
            onClick={() => setActive(index)}
            className={`overflow-hidden rounded-lg border text-left transition-colors ${
              active === index
                ? 'dark:border-blue-500/60 border-blue-300 dark:bg-blue-500/10 bg-blue-50'
                : 'dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white dark:hover:border-zinc-700 hover:border-zinc-300'
            }`}
          >
            <div className="aspect-[16/9] overflow-hidden">
              <img src={item.image} alt="" className="h-full w-full object-cover" />
            </div>
            <div className="p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                {item.source}
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-semibold dark:text-zinc-100 text-zinc-900">
                {item.title}
              </div>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
