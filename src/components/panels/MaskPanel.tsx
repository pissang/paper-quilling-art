import { useEffect, useState } from 'react';
import { ActionIcon, Group, Image, SegmentedControl, Stack, Text, TextInput } from '@mantine/core';
import { Dropzone, IMAGE_MIME_TYPE } from '@mantine/dropzone';
import { IconBorderOuter, IconLetterCase, IconPhotoUp, IconX } from '@tabler/icons-react';
import { setConfig, useConfigValue } from '../../store';
import { ColorField, Note, Section, SelectField, SliderField, SwitchField } from '../fields';

type MaskMode = 'none' | 'text' | 'image';

const FONTS = [
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: '"Brush Script MT", cursive', label: 'Script' },
  { value: 'Impact, fantasy', label: 'Display' }
];

export function MaskPanel() {
  const maskText = useConfigValue('maskText');
  const maskImage = useConfigValue('maskImage');
  const [mode, setMode] = useState<MaskMode>(maskText ? 'text' : maskImage ? 'image' : 'none');
  const [text, setText] = useState(maskText);

  useEffect(() => setText(maskText), [maskText]);

  // Typing is applied after a short pause; regenerating per keystroke is slow.
  useEffect(() => {
    if (text === maskText || mode !== 'text') {
      return;
    }
    const timer = setTimeout(() => setConfig({ maskText: text }), 500);
    return () => clearTimeout(timer);
  }, [text, mode, maskText]);

  const changeMode = (value: string) => {
    const next = value as MaskMode;
    setMode(next);
    if (next === 'none') {
      setConfig({ maskText: '', maskImage: '' });
    }
    else if (next === 'text') {
      setConfig({ maskImage: '', maskText: text || 'Paper' });
    }
    else {
      setConfig({ maskText: '' });
    }
  };

  const onDrop = (files: File[]) => {
    const file = files[0];
    if (file) {
      setConfig({ maskText: '', maskImage: URL.createObjectURL(file) });
    }
  };

  const hasMask = mode !== 'none' && (mode === 'text' ? !!maskText : !!maskImage);

  return (
    <Stack gap={12}>
      <Section title="Shape" icon={<IconLetterCase size={15} />}>
        <SegmentedControl
          size="xs"
          fullWidth
          value={mode}
          onChange={changeMode}
          data={[
            { value: 'none', label: 'Full canvas' },
            { value: 'text', label: 'Text' },
            { value: 'image', label: 'Image' }
          ]}
        />
        {mode === 'none' && (
          <Note>Strips fill the whole square. Choose text or an image to fill a shape and trace its outline.</Note>
        )}
        {mode === 'text' && (
          <>
            <TextInput size="sm" placeholder="Type a word" value={text} onChange={e => setText(e.currentTarget.value)} />
            <SelectField name="maskTextFont" label="Font" data={FONTS} />
            <SliderField name="maskTextSize" label="Size" min={20} max={240} step={2} />
          </>
        )}
        {mode === 'image' && (
          maskImage
            ? (
              <Group gap="sm" wrap="nowrap" align="flex-start">
                <Image src={maskImage} w={88} h={88} fit="contain" radius="md" bg="white" className="mask-thumb" />
                <Stack gap={6} style={{ flex: 1 }}>
                  <Note>Dark areas become the shape. Drop another image to replace it.</Note>
                  <ActionIcon variant="light" color="red" size="sm" aria-label="Remove image" onClick={() => setConfig({ maskImage: '' })}>
                    <IconX size={14} />
                  </ActionIcon>
                </Stack>
              </Group>
            )
            : (
              <Dropzone onDrop={onDrop} accept={IMAGE_MIME_TYPE} maxFiles={1} p="md" radius="md" className="dropzone">
                <Group justify="center" gap="sm" mih={80} style={{ pointerEvents: 'none' }}>
                  <IconPhotoUp size={28} stroke={1.5} color="var(--mantine-color-clay-4)" />
                  <div>
                    <Text size="sm">Drop an image here</Text>
                    <Text size="xs" c="dimmed">Dark shapes on a light background work best</Text>
                  </div>
                </Group>
              </Dropzone>
            )
        )}
      </Section>

      <Section title="Outline" icon={<IconBorderOuter size={15} />}>
        <SwitchField name="outlineVisible" label="Show outline" />
        <SliderField name="outlineThickness" label="Thickness" min={0.01} max={0.2} step={0.005} />
        <SliderField name="outlineHeight" label="Height" min={0.1} max={3} step={0.05} />
        <ColorField name="outlineColor" label="Color" />
        {!hasMask && <Note>The outline only appears when a text or image shape is set.</Note>}
      </Section>
    </Stack>
  );
}
