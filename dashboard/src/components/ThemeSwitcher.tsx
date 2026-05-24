import { Moon, Sun } from 'lucide-react';

interface Props {
  dark: boolean;
  onToggle: () => void;
}

export function ThemeSwitcher({ dark, onToggle }: Props) {
  return (
    <button
      onClick={onToggle}
      aria-label="Toggle theme"
      className="relative w-9 h-9 flex items-center justify-center rounded-lg border transition-all duration-200
        dark:border-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800 dark:hover:border-zinc-600
        border-zinc-300 text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 hover:border-zinc-400"
    >
      <span
        className="absolute transition-all duration-300"
        style={{ opacity: dark ? 1 : 0, transform: dark ? 'scale(1) rotate(0deg)' : 'scale(0.5) rotate(-90deg)' }}
      >
        <Moon size={16} />
      </span>
      <span
        className="absolute transition-all duration-300"
        style={{ opacity: dark ? 0 : 1, transform: dark ? 'scale(0.5) rotate(90deg)' : 'scale(1) rotate(0deg)' }}
      >
        <Sun size={16} />
      </span>
    </button>
  );
}
