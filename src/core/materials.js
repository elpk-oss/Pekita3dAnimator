/** Presets de material rápidos, compartidos por el inspector y la app. */
export const MATERIAL_PRESETS = [
  { id: 'plastic', name: 'Plástico', props: { roughness: 0.42, metalness: 0.05 } },
  { id: 'metal', name: 'Metal', props: { roughness: 0.22, metalness: 1 } },
  { id: 'gold', name: 'Oro', props: { color: '#f5c542', roughness: 0.18, metalness: 1 } },
  { id: 'glass', name: 'Cristal', props: { roughness: 0.06, metalness: 0.1, opacity: 0.35 } },
  { id: 'rubber', name: 'Goma', props: { roughness: 0.95, metalness: 0 } },
  { id: 'matte', name: 'Mate', props: { roughness: 1, metalness: 0 } },
  { id: 'emissive', name: 'Emisivo', props: { emissive: '#f5c542', emissiveIntensity: 1.6, roughness: 0.6, metalness: 0 } },
  { id: 'wood', name: 'Madera', props: { color: '#c98b4b', roughness: 0.72, metalness: 0 } },
];

export function materialPreset(id) {
  return MATERIAL_PRESETS.find((preset) => preset.id === id) || null;
}
