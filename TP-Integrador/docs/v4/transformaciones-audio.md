# C07 - Transformaciones de audio puras

## Objetivo

Extraer las transformaciones de audio del spike C06 y ubicarlas en un módulo reutilizable, sin red, sin FFmpeg, sin `worker_threads` y sin conocimiento de Trivia Musical.

El módulo recibe PCM y devuelve PCM.

## Interfaz común

```text
transformPcm({
    pcm,
    mode,
    sampleRate,
    channels,
    bitsPerSample,
    options
}) -> Buffer
```

Los tres modos del MVP utilizan la misma interfaz:

- `NORMAL`
- `REVERSE`
- `LOW_PASS`

## Formato soportado por el MVP

```text
PCM signed 16-bit little-endian
sampleRate configurable
cantidad de canales configurable
```

La implementación valida frames completos y rechaza formatos distintos de 16 bits en esta etapa del proyecto.

## NORMAL

Devuelve una copia independiente del PCM original.

No modifica muestras y no necesita una transformación CPU-bound real. Se mantiene dentro de la interfaz común para simplificar el pipeline.

## REVERSE

Invierte el orden temporal de los frames completos.

Para audio estéreo:

```text
L1 R1 | L2 R2 | L3 R3

pasa a:

L3 R3 | L2 R2 | L1 R1
```

No invierte los canales dentro de cada frame.

## LOW_PASS

Se implementa como filtro pasa-bajos IIR de primer orden aplicado independientemente a cada canal.

Frecuencia de corte por defecto:

```text
1200 Hz
```

El valor puede sobrescribirse mediante:

```text
options.cutoffHz
```

La implementación exige:

```text
0 < cutoffHz < sampleRate / 2
```

El límite superior corresponde a la frecuencia de Nyquist.

El filtro usa:

```text
y[n] = y[n-1] + alpha * (x[n] - y[n-1])
```

donde `alpha` se calcula a partir de la frecuencia de muestreo y la frecuencia de corte.

## Frontera arquitectónica

Este módulo no:

- descarga audio;
- decodifica AAC/M4A;
- genera WAV;
- conoce canciones, partidas o rondas;
- crea workers;
- administra colas;
- realiza prefetch.

Su responsabilidad es solamente:

```text
PCM de entrada
    |
    v
transformación según mode
    |
    v
PCM de salida
```

Esta separación permite que C09 ejecute el mismo módulo dentro de un `worker_thread` sin duplicar la lógica de transformación.
