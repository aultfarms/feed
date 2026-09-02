import * as React from 'react';

const colorShortcuts: Record<string, string> = {
  y: 'YELLOW',
  g: 'GREEN',
  b: 'BLUE',
  r: 'RED',
  p: 'PURPLE',
  w: 'WHITE',
  n: 'NOTAG',
};

export function useTagEntryKeys({
  onDigit,
  onBackspace,
  onColor,
}: {
  onDigit: (digit: number) => void;
  onBackspace: () => void;
  onColor: (color: string) => void;
}): void {
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (/^[0-9]$/.test(event.key)) {
        onDigit(Number(event.key));
        event.preventDefault();
        return;
      }
      if (event.key === 'Backspace') {
        onBackspace();
        event.preventDefault();
        return;
      }
      const color = colorShortcuts[event.key.toLowerCase()];
      if (color) {
        onColor(color);
        event.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onBackspace, onColor, onDigit]);
}
