import { ActionIcon, Button, Group, Popover, SimpleGrid, Stack, Tooltip, UnstyledButton } from '@mantine/core';
import { IconArrowsShuffle, IconDice5, IconPalette, IconColorSwatch, IconSwitchVertical, IconWaveSine } from '@tabler/icons-react';
import { MAX_COLORS, PALETTES, paletteColors, rgbToHex, type Palette, type RGB } from '../../config';
import { setConfig, useConfig, useConfigValue } from '../../store';
import { ColorPopover, Note, Section, SliderField, SwitchField } from '../fields';

function gradient(palette: Palette) {
  const stops = Array.from({ length: 8 }, (_, i) => palette.sample(1 - i / 7));
  return `linear-gradient(90deg, ${stops.join(',')})`;
}

function PalettePicker() {
  return (
    <Popover width={280} position="bottom-end" withArrow>
      <Popover.Target>
        <Tooltip label="Palettes">
          <ActionIcon size="sm" aria-label="Pick a palette"><IconPalette size={16} /></ActionIcon>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={10}>
        <SimpleGrid cols={2} spacing={8} verticalSpacing={8}>
          {PALETTES.map(palette => (
            <UnstyledButton
              key={palette.name}
              className="palette-option"
              onClick={() => setConfig({ colors: paletteColors(palette) })}
            >
              <span className="palette-gradient" style={{ background: gradient(palette) }} />
              <span className="palette-name">{palette.name}</span>
            </UnstyledButton>
          ))}
        </SimpleGrid>
      </Popover.Dropdown>
    </Popover>
  );
}

function ColorStrip() {
  const colors = useConfigValue('colors');
  const colorNumber = useConfigValue('colorNumber');

  const setColor = (idx: number, rgb: RGB) => {
    const next = colors.slice();
    next[idx] = rgb;
    setConfig({ colors: next });
  };

  return (
    <div className="color-strip">
      {colors.slice(0, colorNumber).map((color, idx) => (
        <ColorPopover key={idx} value={color} onChange={rgb => setColor(idx, rgb)}>
          <button
            type="button"
            className="color-strip-item"
            style={{ background: rgbToHex(color) }}
            aria-label={`Color ${idx + 1}`}
            title={rgbToHex(color).toUpperCase()}
          />
        </ColorPopover>
      ))}
    </div>
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
    <Stack gap={12}>
      <Section
        title="Strips"
        icon={<IconWaveSine size={15} />}
        right={
          <Button
            size="compact-xs"
            variant="light"
            leftSection={<IconDice5 size={14} />}
            onClick={() => setConfig({ seed: Math.random() })}
          >
            Shuffle
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
        <SliderField name="imperfection" label="Handmade" min={0} max={1} step={0.05}
          hint="How irregular the strips are: slight lean and uneven height, like hand glued paper." />
        <SliderField name="curl" label="End curls" min={0} max={1} step={0.05}
          hint="Chance that a strip end is rolled into a small scroll." />
        <SliderField name="minHeight" label="Min height" min={0.05} max={3} step={0.05} />
        <SliderField name="maxHeight" label="Max height" min={0.05} max={3} step={0.05} />
        <SwitchField name="paperVisible" label="Show strips" />
      </Section>

      <Section
        title="Colors"
        icon={<IconColorSwatch size={15} />}
        right={
          <Group gap={0}>
            <Tooltip label="Random palette">
              <ActionIcon size="sm" aria-label="Random palette" onClick={randomPalette}>
                <IconArrowsShuffle size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Reverse order">
              <ActionIcon size="sm" aria-label="Reverse colors" onClick={reverseColors}>
                <IconSwitchVertical size={16} />
              </ActionIcon>
            </Tooltip>
            <PalettePicker />
          </Group>
        }
      >
        <ColorStrip />
        <Note>Click a swatch to edit it. Each color is a layer with its own height.</Note>
        <SliderField name="colorNumber" label="Layers" min={1} max={MAX_COLORS} step={1} />
        <SwitchField name="clusterColors" label="Group by area"
          hint="Cluster strips by position so neighbouring strips share a color and height." />
      </Section>
    </Stack>
  );
}
