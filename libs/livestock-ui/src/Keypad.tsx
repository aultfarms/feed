export function Keypad({
  onNumber,
  onClear,
  onBackspace,
}: {
  onNumber: (number: number) => void;
  onClear: () => void;
  onBackspace: () => void;
}) {
  const rows: Array<Array<number | { label: string; action: () => void }>> = [
    [1, 2, 3],
    [4, 5, 6],
    [7, 8, 9],
    [
      { label: 'C', action: onClear },
      0,
      { label: '<--', action: onBackspace },
    ],
  ];

  return (
    <div className="keypad">
      {rows.map((row, rowIndex) => (
        <div className="keypadrow" key={rowIndex}>
          {row.map(item => {
            const label = typeof item === 'number' ? String(item) : item.label;
            return (
              <button
                className="keypadbutton"
                key={label}
                type="button"
                aria-label={label === '<--' ? 'Backspace tag number' : undefined}
                onClick={() => (typeof item === 'number' ? onNumber(item) : item.action())}
              >
                {label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
