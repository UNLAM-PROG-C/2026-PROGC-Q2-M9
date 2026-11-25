# C05 / D03 - Contratos de audio V4

## Decisión

Los contratos lógicos mínimos de V4 son:

```text
AudioJob
├── jobId
├── gameId
├── roundId
├── mode
└── source

AudioResult
├── jobId
├── gameId
├── roundId
├── mode
├── ok
├── resource
└── error

PreparedRound
├── gameId
├── roundId
├── mode
├── song
└── resource
```

## Criterios

`jobId` identifica el trabajo de preparación.

`gameId` identifica la generación de partida y permite detectar resultados obsoletos después de un reinicio.

`roundId` identifica la ronda dentro de una partida.

`mode` admite únicamente los modos del MVP definidos por D02.

`source` representa la entrada necesaria para obtener o procesar audio. Su forma concreta no se fija en D03 porque depende de C03 / D01.

`resource` representa la salida reproducible. Su forma concreta tampoco se fija todavía porque depende del stack de audio y de la decisión de entrega al navegador.

`PreparedRound` no contiene `jobId` porque el consumidor de una ronda preparada debe identificarla mediante `gameId + roundId`, independientemente del trabajo interno que la produjo.

## Invariantes de AudioResult

Para un resultado exitoso:

```text
ok = true
resource presente
error = null
```

Para un resultado fallido:

```text
ok = false
resource = null
error presente
```

Los contratos validan identidad e invariantes mínimas, pero deliberadamente no fijan codecs, URLs, rutas, `Buffer`, librerías ni parámetros DSP.

## Relación con otras decisiones

D02 define los modos válidos.

D03 define la información que atraviesa el pipeline.

D01 definirá el stack técnico y concretará la representación interna de `source` y `resource`.

D08 definirá cómo el recurso de audio preparado llega finalmente al navegador.
