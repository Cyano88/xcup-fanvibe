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
    title: 'Distribution Cup ties FVB trading, X activity, World Cup stakes and country backing into one leaderboard',
    source: 'FanVibe Desk',
    image: '/assets/fvb-token-logo.png',
    url: '#',
    tag: 'Matchday',
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
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const [feed, setFeed] = useState<NewsFeed | null>(null);
  const [loading, setLoading] = useState(true);
  const items = useMemo(() => feed?.articles?.length ? feed.articles : loading ? [] : FALLBACK_NEWS, [feed, loading]);
  const lead = items.length ? items[active % items.length] : null;
  const hasLeadUrl = !!lead?.url && lead.url !== '#';
  const leadImage = lead && brokenImages[lead.image] ? '/assets/fanvibe-season-bg.jpeg' : lead?.image;
  const statusText = loading
    ? 'Refreshing feed'
    : feed?.mode === 'live'
      ? `Updated ${feed.freshnessSeconds}s ago`
      : feed?.error
        ? 'Provider feed unavailable'
        : 'FanVibe desk feed';

  useEffect(() => {
    setLoading(true);
    fetch(`${BACKEND_HTTP}/worldcup/news`)
      .then(res => {
        if (!res.ok) throw new Error(`News route ${res.status}`);
        return res.json();
      })
      .then((data: NewsFeed) => setFeed(data))
      .catch(() => setFeed(null))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!items.length) return;
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
          {statusText}
        </div>
      </div>

      <div
        className="group relative block min-h-[360px] overflow-hidden rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white shadow-sm"
      >
        {lead && hasLeadUrl && <a href={lead.url} target="_blank" rel="noopener noreferrer" className="absolute inset-0 z-20" aria-label={`Read ${lead.title}`} />}
        {leadImage ? (
          <img
            src={leadImage}
            alt=""
            onError={() => lead && setBrokenImages(prev => ({ ...prev, [lead.image]: true }))}
            className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="absolute inset-0 bg-zinc-100 dark:bg-zinc-950" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/55 to-black/10" />
        <div className="relative z-10 flex min-h-[360px] flex-col justify-end p-5 sm:p-6">
          <div className="mb-3 inline-flex w-fit items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-white backdrop-blur">
            {lead?.tag ?? 'Updating'}
          </div>
          <h3 className="max-w-3xl text-2xl font-semibold tracking-tight text-white sm:text-4xl">
            {lead?.title ?? 'Refreshing latest football and X Layer stories'}
          </h3>
          {lead?.description && (
            <p className="mt-3 max-w-2xl text-sm font-medium leading-6 text-zinc-200 line-clamp-2">
              {lead.description}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-3 text-xs font-semibold text-zinc-200">
            <span>{lead?.source ?? 'FanVibe News'}</span>
            {hasLeadUrl ? (
              <span className="inline-flex items-center gap-1">
                Read full story
                <ExternalLink size={13} />
              </span>
            ) : (
              <span className="rounded-full border border-white/15 bg-white/10 px-2 py-1 text-[11px] text-zinc-300">
                Source access unavailable
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border dark:border-zinc-900 border-zinc-200 dark:bg-zinc-950 bg-white">
        {items.map((item, index) => {
          const hasUrl = !!item.url && item.url !== '#';
          const image = brokenImages[item.image] ? '/assets/fanvibe-season-bg.jpeg' : item.image;
          const ListItemTag = hasUrl ? 'a' : 'button';
          return (
          <ListItemTag
            key={item.title}
            {...(hasUrl
              ? { href: item.url, target: '_blank', rel: 'noopener noreferrer', onMouseEnter: () => setActive(index), onFocus: () => setActive(index) }
              : { type: 'button', onClick: () => setActive(index) })}
            className={`flex w-full items-center gap-3 border-b px-3 py-3 text-left last:border-b-0 dark:border-zinc-900 border-zinc-100 transition-colors ${
              active === index
                ? 'dark:bg-blue-500/10 bg-blue-50'
                : 'dark:hover:bg-zinc-900/60 hover:bg-zinc-50'
            }`}
          >
            <div className="w-7 shrink-0 text-center text-sm font-black tabular-nums dark:text-zinc-500 text-zinc-400">
              {index + 1}
            </div>
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg border dark:border-zinc-800 border-zinc-200 dark:bg-zinc-900 bg-zinc-100">
              <img
                src={image}
                alt=""
                onError={() => setBrokenImages(prev => ({ ...prev, [item.image]: true }))}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-[10px] font-extrabold uppercase dark:text-blue-300 text-blue-600">
                  {item.tag}
                </span>
                <span className="truncate text-[10px] font-bold uppercase tracking-widest dark:text-zinc-500 text-zinc-400">
                  {item.source}
                </span>
              </div>
              <div className="mt-1 line-clamp-2 text-sm font-semibold leading-5 dark:text-zinc-100 text-zinc-900">
                {item.title}
              </div>
              <div className="mt-1 line-clamp-1 text-[11px] dark:text-zinc-500 text-zinc-500">
                {item.description || (hasUrl ? 'Open the lead card for the full source.' : 'Full source restricted.')}
              </div>
            </div>
            <div className="hidden shrink-0 text-[11px] font-bold dark:text-zinc-600 text-zinc-400 sm:block">
              {hasUrl ? 'Open' : 'Restricted'}
            </div>
          </ListItemTag>
        );})}
      </div>
    </section>
  );
}
