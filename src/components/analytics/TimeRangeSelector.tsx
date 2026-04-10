import { TIME_RANGES, type TimeRange } from "@/lib/analytics-utils";

interface TimeRangeSelectorProps {
  value: TimeRange;
  onChange: (range: TimeRange) => void;
}

export default function TimeRangeSelector({ value, onChange }: TimeRangeSelectorProps) {
  return (
    <div className="time-pills">
      {TIME_RANGES.map((range) => (
        <button
          key={range}
          className={`time-pill ${value === range ? "active" : ""}`}
          onClick={() => onChange(range)}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
