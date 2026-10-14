import type { ReactNode } from 'react';
import { ColorInput, Group, SegmentedControl, Select, Slider, Stack, Switch, Text, Tooltip } from '@mantine/core';
import { hexToRgb, rgbToHex, type Config, type RGB } from '../config';
import { setConfig, useConfigValue } from '../store';

type KeysOfType<T> = { [K in keyof Config]: Config[K] extends T ? K : never }[keyof Config];

export function Section({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <Stack gap={8}>
      <Group justify="space-between" h={22}>
        <span className="section-title">{title}</span>
        {right}
      </Group>
      {children}
    </Stack>
  );
}

function Label({ label, hint }: { label: string; hint?: string }) {
  const text = <span className="field-row-label">{label}</span>;
  return hint
    ? <Tooltip label={hint} position="left" withArrow multiline w={220} openDelay={300}>{text}</Tooltip>
    : text;
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
  return (
    <div className="field-row">
      <Label label={label} hint={hint} />
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={v => setConfig({ [name]: v })}
      />
      <span className="field-row-value">{format ? format(value) : value.toFixed(decimals)}</span>
    </div>
  );
}

export function SwitchField({ name, label, hint }: { name: KeysOfType<boolean>; label: string; hint?: string }) {
  const value = useConfigValue(name);
  return (
    <Group justify="space-between" mih={30}>
      <Label label={label} hint={hint} />
      <Switch size="sm" checked={value} onChange={e => setConfig({ [name]: e.currentTarget.checked })} />
    </Group>
  );
}

export function RgbInput({ value, onChange, label }: { value: RGB; onChange: (value: RGB) => void; label?: string }) {
  return (
    <ColorInput
      size="xs"
      aria-label={label}
      value={rgbToHex(value)}
      format="hex"
      withEyeDropper={false}
      onChange={hex => /^#[0-9a-f]{6}$/i.test(hex) && onChange(hexToRgb(hex))}
    />
  );
}

export function ColorField({ name, label }: { name: KeysOfType<RGB>; label: string }) {
  const value = useConfigValue(name) as RGB;
  return (
    <div className="field-row" style={{ gridTemplateColumns: '96px 1fr' }}>
      <Label label={label} />
      <RgbInput value={value} label={label} onChange={rgb => setConfig({ [name]: rgb })} />
    </div>
  );
}

interface ChoiceFieldProps<K extends keyof Config> {
  name: K;
  label: string;
  data: { value: string; label: string }[];
  variant?: 'segmented' | 'select';
}

export function ChoiceField<K extends keyof Config>({ name, label, data, variant = 'segmented' }: ChoiceFieldProps<K>) {
  const value = String(useConfigValue(name));
  const onChange = (v: string | null) => v != null && setConfig({ [name]: v } as Partial<Config>);
  return (
    <div className="field-row" style={{ gridTemplateColumns: '96px 1fr' }}>
      <Label label={label} />
      {variant === 'segmented'
        ? <SegmentedControl size="xs" fullWidth value={value} data={data} onChange={onChange} />
        : <Select size="xs" value={value} data={data} onChange={onChange} allowDeselect={false} />}
    </div>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <Text size="xs" c="dimmed" lh={1.45}>{children}</Text>;
}
