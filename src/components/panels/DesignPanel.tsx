import { ActionIcon, Button, Group, Popover, SimpleGrid, Stack, Tooltip } from '@mantine/core';
import { IconArrowsShuffle, IconDice5, IconPalette, IconSwitchVertical } from '@tabler/icons-react';
import { MAX_COLORS, PALETTES, paletteColors, rgbToHex, type Palette, type RGB } from '../../config';
import { setConfig, useConfig, useConfigValue } from '../../store';
import { RgbInput, Section, SliderField, SwitchField } from '../fields';

function gradient(palette: Palette) {
  const stops = Array.from({ length: 8 }, (_, i) => palette.sample(1 - i / 7));
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

function PalettePicker() {
  return (
    <Popover width={300} position="bottom-end" shadow="md" withArrow>
      <Popover.Target>
        <Tooltip label="Pick a palette">
          <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Pick a palette"><IconPalette size={16} /></ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown>
        <SimpleGrid cols={2} spacing={8}>
          {PALETTES.map(palette => (
            <Tooltip key={palette.name} label={palette.name} openDelay={400}>
              <div
                className="palette-swatch"
                style={{ background: gradient(palette) }}
                onClick={() => setConfig({ colors: paletteColors(palette) })}
              />
            </Tooltip>
          ))}
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
}

function ColorList() {
  const colors = useConfigValue('colors');
  const colorNumber = useConfigValue('colorNumber');

  const setColor = (idx: number, rgb: RGB) => {
    const next = colors.slice();
    next[idx] = rgb;
    setConfig({ colors: next });
  };

  return (
    <Stack gap={6}>
      <div style={{ display: 'flex', height: 26, borderRadius: 8, overflow: 'hidden' }}>
        {colors.slice(0, colorNumber).map((c, i) => (
          <div key={i} style={{ flex: 1, background: rgbToHex(c) }} />
        ))}
      </div>
      <SimpleGrid cols={2} spacing={6} verticalSpacing={6}>
        {colors.slice(0, colorNumber).map((color, idx) => (
          <RgbInput key={idx} label={`Color ${idx + 1}`} value={color} onChange={rgb => setColor(idx, rgb)} />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

export function DesignPanel() {
  const randomPalette = () => {
    const palette = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    setConfig({ colors: paletteColors(palette) });
  };
  const reverseColors = () => {
    const { colors, colorNumber } = useConfig.getState().config;
    const used = colors.slice(0, colorNumber).reverse();
    setConfig({ colors: [...used, ...colors.slice(colorNumber)] });
  };

  return (
    <Stack gap={22}>
      <Section
        title="Strips"
        right={
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconDice5 size={14} />}
            onClick={() => setConfig({ seed: Math.random() })}
          >
            New seed
          </Button>
        }
      >
        <SliderField name="number" label="Count" min={50} max={3000} step={10}
          hint="Number of paper strips. High counts take longer to build and trace." />
        <SliderField name="trail" label="Length" min={20} max={300} step={5}
          hint="Maximum number of steps each strip follows the noise field." />
        <SliderField name="noiseScale" label="Swirl" min={0.5} max={10} step={0.1}
          hint="Scale of the Perlin flow field. Larger values give bigger swirls." />
        <SliderField name="thickness" label="Thickness" min={0.005} max={0.08} step={0.001} />
        <SliderField name="minHeight" label="Min height" min={0.05} max={3} step={0.05} />
        <SliderField name="maxHeight" label="Max height" min={0.05} max={3} step={0.05} />
        <SwitchField name="paperVisible" label="Visible" />
      </Section>

      <Section
        title="Colors"
        right={
          <Group gap={2}>
            <Tooltip label="Random palette">
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Random palette" onClick={randomPalette}>
                <IconArrowsShuffle size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Reverse order">
              <ActionIcon variant="subtle" color="gray" size="sm" aria-label="Reverse colors" onClick={reverseColors}>
                <IconSwitchVertical size={16} />
              </ActionIcon>
            </Tooltip>
            <PalettePicker />
          </Group>
        }
      >
        <SliderField name="colorNumber" label="Colors" min={1} max={MAX_COLORS} step={1} />
        <SwitchField name="clusterColors" label="Group by area"
          hint="Cluster strips by position so neighbouring strips share a color and height." />
        <ColorList />
      </Section>
    </Stack>
  );
}
