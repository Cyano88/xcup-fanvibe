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
      className="relative w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200
        text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800
        dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800
        light:text-zinc-500 light:hover:text-zinc-800 light:hover:bg-zinc-100"
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
