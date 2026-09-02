export function TagBar({
  color,
  number,
  dirty,
  resolvedColor,
  onColorChange,
  onNumberChange,
}: {
  color: string;
  number: number;
  dirty: boolean;
  resolvedColor: string;
  onColorChange: (color: string) => void;
  onNumberChange: (number: number) => void;
}) {
  return (
    <div className="tagbar" style={{ borderColor: dirty ? 'red' : '#CCCCCC' }}>
      <input
        aria-label="Tag color"
        className="colortext"
        style={{ color: resolvedColor, borderColor: resolvedColor }}
        value={color}
        type="text"
        onChange={(event) => onColorChange(event.target.value.toUpperCase())}
      />
      <input
        aria-label="Tag number"
        className="numbertext"
        value={number || ''}
        type="text"
        inputMode="numeric"
        onChange={(event) => onNumberChange(Number(event.target.value.replace(/\D/g, '')) || 0)}
      />
    </div>
  );
}
