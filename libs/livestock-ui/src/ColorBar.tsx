import type { TagColors } from '@aultfarms/livestock';

export function ColorBar({
  tagColors,
  selectedColor,
  onSelect,
}: {
  tagColors: TagColors;
  selectedColor?: string;
  onSelect: (color: string) => void;
}) {
  return (
    <div className="colorbar">
      {Object.entries(tagColors)
        .filter(([name]) => name !== 'NOTAG')
        .map(([name, color]) => (
          <button
            aria-label={`Select ${name} tag`}
            aria-pressed={selectedColor === name}
            className="colorbutton"
            key={name}
            title={name}
            type="button"
            onClick={() => onSelect(name)}
            style={{ backgroundColor: color }}
          />
        ))}
      <button
        aria-label="Select untagged animal"
        aria-pressed={selectedColor === 'NOTAG'}
        className="colorbutton colorbutton-notag"
        title="NOTAG"
        type="button"
        onClick={() => onSelect('NOTAG')}
      />
    </div>
  );
}
