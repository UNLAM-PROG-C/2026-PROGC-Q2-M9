# C03 / D01 - Stack de audio V4

## 1. Objetivo

Definir y validar el stack técnico mínimo para obtener previews reales de iTunes, decodificarlos a una representación manipulable y preparar el camino para ejecutar transformaciones de audio dentro de `worker_threads`.

La decisión busca minimizar dependencias y mantener explícita la separación entre:

- I/O de red;
- decodificación de audio;
- procesamiento CPU-bound;
- entrega posterior del recurso preparado al navegador.

---

## 2. Decisión D01

**Estado:** Decisión validada

El stack elegido para V4 es:

```text
Node.js
├── fetch nativo
│   └── obtención de previews
│
├── ffmpeg-static 5.3.0
│   └── FFmpeg 6.1.1
│       └── decodificación de audio comprimido a PCM
│
├── JavaScript
│   └── manipulación de muestras PCM
│
└── worker_threads
    └── ejecución del procesamiento CPU-bound
```

---

## 3. Responsabilidad de cada componente

### `fetch` nativo de Node.js

Se utiliza para:

- consultar la iTunes Search API;
- obtener un `previewUrl`;
- descargar el preview real de la canción.

No interviene en el procesamiento del audio.

### `ffmpeg-static`

Se utiliza como mecanismo de codec y decodificación.

Responsabilidades previstas:

- aceptar el preview comprimido entregado por iTunes;
- decodificarlo;
- producir audio PCM en una representación simple para ser manipulada desde JavaScript.

Versión fijada:

```text
ffmpeg-static 5.3.0
FFmpeg 6.1.1
```

La versión se fija de manera exacta en `package.json` y `package-lock.json` para evitar variaciones implícitas entre instalaciones.

El script de instalación de `ffmpeg-static@5.3.0` queda aprobado explícitamente mediante `allowScripts`.

### JavaScript

Las transformaciones funcionales del MVP no deben delegarse a filtros de FFmpeg.

JavaScript será responsable de manipular las muestras PCM para implementar los modos definidos en D02.

### `worker_threads`

Los modos CPU-bound se ejecutarán dentro del modelo concurrente de V4.

El objetivo es que `worker_threads` sea el mecanismo explícito mediante el cual se demuestre procesamiento concurrente real.

---

## 4. Formato intermedio elegido

El spike C03 validó la conversión del preview real a:

```text
PCM signed 16-bit little-endian
2 canales
44100 Hz
```

Este formato es suficientemente simple para permitir manipulación directa de muestras desde JavaScript.

La representación concreta que finalmente circulará entre componentes podrá refinarse durante la implementación, pero D01 valida que el audio real puede convertirse a PCM manipulable.

---

## 5. Spike técnico

Archivo:

```text
tests/spikes/c03-audio-stack-spike.js
```

Flujo validado:

```text
iTunes Search API
        |
        v
previewUrl real
        |
        v
fetch de Node.js
        |
        v
audio comprimido AAC/M4A
        |
        v
FFmpeg
        |
        v
PCM s16le estéreo 44100 Hz
```

Resultado observado durante la validación:

```text
Canción: Daft Punk - One More Time
Preview descargado: 1003902 bytes
PCM generado: 5287680 bytes
Duración PCM aproximada: 29.98 s
Resultado: PASS
```

Esto demuestra que el stack puede operar con el mismo tipo de preview utilizado por Trivia Musical y no solamente con archivos de prueba artificiales.

---

## 6. Qué NO hará FFmpeg

Aunque FFmpeg dispone de filtros para invertir audio o aplicar filtros de frecuencia, esas transformaciones no se utilizarán para implementar los modos del MVP.

En particular, no se delegará a FFmpeg:

- `REVERSE`;
- `LOW_PASS`;
- otras transformaciones CPU-bound que formen parte de la demostración concurrente.

La razón es académica y arquitectónica: esas operaciones deben ejecutarse dentro de los workers para que el proyecto demuestre explícitamente `worker_threads`, Worker Pool y procesamiento concurrente.

La frontera prevista es:

```text
FFmpeg
  |
  v
decodificación
  |
  v
PCM
  |
  v
worker_thread
  |
  v
REVERSE / LOW_PASS
```

---

## 7. Reproducibilidad

La instalación fue validada mediante:

```text
npm ci
```

Luego de reinstalar las dependencias, `ffmpeg-static` continuó resolviendo correctamente el ejecutable y FFmpeg volvió a ejecutar normalmente.

También se verificó que npm no reportara scripts de instalación pendientes de revisión después de aprobar explícitamente `ffmpeg-static@5.3.0`.

---

## 8. Relación con C06

C03 / D01 valida:

```text
preview real
    |
    v
PCM manipulable
```

C06 deberá extender ese flujo hasta:

```text
preview real
    |
    v
PCM
    |
    v
REVERSE en JavaScript
    |
    v
WAV válido
    |
    v
reproducción real
```

Por lo tanto, C03 reduce el riesgo del stack técnico, mientras que C06 validará la primera transformación completa end-to-end.
