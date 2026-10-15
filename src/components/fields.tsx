import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ColorPicker, Group, Popover, Select, Switch, Text, TextInput, Tooltip } from '@mantine/core';
import { hexToRgb, rgbToHex, type Config, type RGB } from '../config';
import { setConfig, useConfigValue } from '../store';

type KeysOfType<T> = { [K in keyof Config]: Config[K] extends T ? K : never }[keyof Config];

interface SectionProps {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
}

export function Section({ title, icon, right, children }: SectionProps) {
  return (
    <section className="section">
      <header className="section-header">
        <span className="section-title">
          {icon && <span className="section-icon">{icon}</span>}
          {title}
        </span>
        {right}
      </header>
      <div className="section-body">{children}</div>
    </section>
  );
}

function Label({ label, hint }: { label: string; hint?: string }) {
  const text = <span className={hint ? 'field-label field-label-hint' : 'field-label'}>{label}</span>;
  return hint
    ? <Tooltip label={hint} position="left" multiline w={220}>{text}</Tooltip>
    : text;
}

/** Numeric readout that turns into an input on focus. */
function ValueInput({ value, decimals, min, max, format, onChange }: {
  value: number;
  decimals: number;
  min: number;
  max: number;
  format?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const commit = () => {
    setEditing(false);
    const parsed = parseFloat(draft);
    if (Number.isFinite(parsed)) {
      onChange(Math.min(Math.max(parsed, min), max));
    }
  };

  return (
    <input
      className="field-value"
      value={editing ? draft : format ? format(value) : value.toFixed(decimals)}
      onFocus={e => {
        setDraft(value.toFixed(decimals));
        setEditing(true);
        requestAnimationFrame(() => e.target.select());
      }}
      onChange={e => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
        else if (e.key === 'Escape') {
          setEditing(false);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

interface ScrubSliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  label: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

/** Handle-less slider: a filled bar that is clicked or dragged anywhere. */
export function ScrubSlider({ value, min, max, step, label, disabled, onChange }: ScrubSliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));

  const commit = (raw: number) => {
    const snapped = Math.round((raw - min) / step) * step + min;
    const next = +Math.min(Math.max(snapped, min), max).toFixed(decimals);
    if (next !== value) {
      onChange(next);
    }
  };

  const fromPointer = (e: PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect();
    commit(min + (e.clientX - rect.left) / rect.width * (max - min));
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const big = e.shiftKey ? 10 : 1;
    const delta: Record<string, number> = {
      ArrowRight: step * big, ArrowUp: step * big, ArrowLeft: -step * big, ArrowDown: -step * big,
      PageUp: (max - min) / 10, PageDown: -(max - min) / 10
    };
    if (e.key in delta) {
      commit(value + delta[e.key]);
    }
    else if (e.key === 'Home') {
      commit(min);
    }
    else if (e.key === 'End') {
      commit(max);
    }
    else {
      return;
    }
    e.preventDefault();
  };

  const ratio = max > min ? Math.min(Math.max((value - min) / (max - min), 0), 1) : 0;

  return (
    <div
      ref={ref}
      className="scrub"
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-disabled={disabled || undefined}
      data-disabled={disabled || undefined}
      onPointerDown={e => {
        if (disabled || e.button !== 0) {
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        e.currentTarget.focus();
        fromPointer(e);
      }}
      onPointerMove={e => e.currentTarget.hasPointerCapture(e.pointerId) && fromPointer(e)}
      onKeyDown={onKeyDown}
    >
      <div className="scrub-fill" style={{ width: `${ratio * 100}%` }} />
    </div>
  );
}

interface SliderFieldProps {
  name: KeysOfType<number>;
  label: string;
  hint?: string;
  min: number;
  max: number;
  step: number;
  format?: (value: number) => string;
  disabled?: boolean;
}

export function SliderField({ name, label, hint, min, max, step, format, disabled }: SliderFieldProps) {
  const value = useConfigValue(name);
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  const set = (v: number) => setConfig({ [name]: v });
  return (
    <div className="field">
      <Label label={label} hint={hint} />
      <ScrubSlider value={value} min={min} max={max} step={step} label={label} disabled={disabled} onChange={set} />
      <ValueInput value={value} decimals={decimals} min={min} max={max} format={format} onChange={set} />
    </div>
  );
}

export function SwitchField({ name, label, hint }: { name: KeysOfType<boolean>; label: string; hint?: string }) {
  const value = useConfigValue(name);
  return (
    <Group justify="space-between" className="field-switch">
      <Label label={label} hint={hint} />
      <Switch checked={value} onChange={e => setConfig({ [name]: e.currentTarget.checked })} />
    </Group>
  );
}

const SWATCHES = ['#f4efe6', '#e8d5b5', '#d9a679', '#c4643c', '#8f2d2d', '#3d5a80', '#1f3b57', '#2a2a2a'];

/** Color picker popover around any trigger element. */
export function ColorPopover({ value, onChange, children }: {
  value: RGB;
  onChange: (value: RGB) => void;
  children: ReactNode;
}) {
  const hex = rgbToHex(value);
  const [text, setText] = useState(hex);
  useEffect(() => setText(hex), [hex]);
  return (
    <Popover width={232} position="left-start" withArrow trapFocus>
      <Popover.Target>{children}</Popover.Target>
      <Popover.Dropdown p={10}>
        <ColorPicker
          size="sm"
          fullWidth
          format="hex"
          value={hex}
          swatches={SWATCHES}
          swatchesPerRow={8}
          onChange={v => onChange(hexToRgb(v))}
        />
        <TextInput
          mt={8}
          size="xs"
          value={text}
          leftSection={<span className="color-dot" style={{ background: hex }} />}
          onChange={e => {
            const v = e.currentTarget.value;
            setText(v);
            if (/^#?[0-9a-f]{6}$/i.test(v)) {
              onChange(hexToRgb(v.startsWith('#') ? v : '#' + v));
            }
          }}
          styles={{ input: { fontFamily: 'var(--mantine-font-family-monospace)' } }}
        />
      </Popover.Dropdown>
    </Popover>
  );
}

export function ColorButton({ value, onChange, label }: { value: RGB; onChange: (value: RGB) => void; label: string }) {
  return (
    <ColorPopover value={value} onChange={onChange}>
      <button type="button" className="color-button" aria-label={label}>
        <span className="color-dot" style={{ background: rgbToHex(value) }} />
        <span className="color-hex">{rgbToHex(value).toUpperCase()}</span>
      </button>
    </ColorPopover>
  );
}

export function ColorField({ name, label }: { name: KeysOfType<RGB>; label: string }) {
  const value = useConfigValue(name) as RGB;
  return (
    <div className="field field-wide">
      <Label label={label} />
      <ColorButton value={value} label={label} onChange={rgb => setConfig({ [name]: rgb })} />
    </div>
  );
}

export function SelectField<K extends keyof Config>({ name, label, data }: {
  name: K;
  label: string;
  data: { value: string; label: string }[];
}) {
  const value = String(useConfigValue(name));
  return (
    <div className="field field-wide">
      <Label label={label} />
      <Select
        size="xs"
        value={value}
        data={data}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
        onChange={v => v != null && setConfig({ [name]: v } as Partial<Config>)}
      />
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text className="note">{children}</Text>;
}
