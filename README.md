# Ayuuk para Todos — MVP v4

Diccionario web estático para GitHub Pages.

## Qué cambió en v4

- La app deduplica también en cliente, aunque el JSON traiga registros repetidos.
- Si una palabra existe en `vocabulario_general` y también en una categoría específica, se conserva la categoría específica.
- La búsqueda por Ayuuk es exacta si existe la palabra: `AAT` devuelve solo `AAT`.
- La búsqueda por español usa palabra completa: `agua` devuelve `Agua`, `Agua caliente`, `Sin tomar agua`, pero evita `aguacate`.
- Ya no hace `HEAD /audio/*.mp3`, así evita 404 masivos en consola.
- El audio se controla con `data/audio_manifest.json`.

## Probar local

```bash
python3 -m http.server 8080
```

Abrir:

```text
http://localhost:8080
```

## Audio

1. Agrega archivos a `audio/`, por ejemplo:

```text
audio/nee.mp3
audio/uk.mp3
audio/aat.mp3
```

2. Decláralos en `data/audio_manifest.json`:

```json
{
  "files": ["nee.mp3", "uk.mp3", "aat.mp3"]
}
```

Si el archivo está en el manifest, la tarjeta muestra `▶ Escuchar`; si no, muestra `Audio pendiente`.
