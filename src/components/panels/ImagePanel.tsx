import { Group, Image, SimpleGrid, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { IconColorSwatch, IconPhoto, IconPhotoUp } from '@tabler/icons-react';
import { SAMPLES, rgbToHex } from '../../config';
import { setConfig, useConfigValue, useRenderInfo } from '../../store';
import { Note, Section, SliderField, SwitchField } from '../fields';

function PaletteStrip() {
  const palette = useRenderInfo(s => s.palette);
  if (!palette.length) {
    return null;
  }
  return (
    <div className="color-strip">
      {palette.map((color, idx) => (
        <span
          key={idx}
          className="color-strip-item"
          style={{ background: rgbToHex(color) }}
          title={rgbToHex(color).toUpperCase()}
        />
      ))}
    </div>
  );
}

export function ImagePanel() {
  const image = useConfigValue('image');
  const onDrop = (files: File[]) => {
    const file = files[0];
    if (file) {
      setConfig({ image: URL.createObjectURL(file) });
    }
  };

  return (
    <Stack gap={12}>
      <Section title="Image" icon={<IconPhoto size={15} />}>
        <SimpleGrid cols={6} spacing={6}>
          {SAMPLES.map(sample => (
            <Tooltip key={sample.url} label={sample.name}>
              <UnstyledButton
                className="sample-option"
                data-active={image === sample.url || undefined}
                aria-label={`Use the ${sample.name} sample`}
                onClick={() => setConfig({ ...sample.settings, image: sample.url })}
              >
                <img src={sample.url} alt="" />
              </UnstyledButton>
            </Tooltip>
          ))}
        </SimpleGrid>
        <Dropzone onDrop={onDrop} accept={IMAGE_MIME_TYPE} maxFiles={1} p="xs" radius="md" className="dropzone">
          <Group gap="sm" wrap="nowrap" style={{ pointerEvents: 'none' }}>
            <Image src={image} w={72} h={72} fit="contain" radius="md" bg="white" className="mask-thumb" />
            <div>
              <Group gap={6}>
                <IconPhotoUp size={16} stroke={1.6} color="var(--mantine-color-clay-4)" />
                <Text size="sm">Drop or click to upload</Text>
              </Group>
              <Text size="xs" c="dimmed" mt={4}>
                Its shapes become paper regions and its colors the paper. Bold, simple pictures work best.
              </Text>
            </div>
          </Group>
        </Dropzone>
        <SwitchField name="removeBackground" label="Remove background"
          hint="Leave a plain background around the subject as bare board." />
      </Section>

      <Section title="Paper colors" icon={<IconColorSwatch size={15} />}>
        <PaletteStrip />
        <SliderField name="colorNumber" label="Colors" min={2} max={16} step={1}
          hint="Number of paper colors taken from the image." />
        <SliderField name="colorBoost" label="Vividness" min={0.5} max={2} step={0.05}
          hint="Paper is usually more saturated than a photo; raise this for punchier colors." />
        <SliderField name="detail" label="Detail" min={120} max={600} step={10}
          hint="Resolution the image is analysed at. Higher keeps smaller regions." />
        <SliderField name="edgeSmoothing" label="Edge smoothing" min={0} max={8} step={0.5}
          hint="Evens out the edges of the color regions, so outline strips run in smooth curves. Higher values round off corners." />
        <Note>Each color region is outlined by paper strips and filled with quilled pieces of that color.</Note>
      </Section>
    </Stack>
  );
}
