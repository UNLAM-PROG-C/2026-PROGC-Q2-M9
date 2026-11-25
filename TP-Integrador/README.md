# Trivia Musical

El proyecto consiste en el desarrollo de una aplicación web multijugador de trivia musical desarrollada para la materia Programación Concurrente. Se trata de un juego donde los participantes escuchan fragmentos de canciones y tienen que adivinar sus títulos. Para ello se utiliza un servidor Node.js que coordina la sala, las rondas, las respuestas y la puntuación en tiempo real. Los clientes se conectan a través de un navegador web.

## Funcionalidades

- Sala de espera con ingreso de participantes y confirmación antes de iniciar.
- Playlist obtenida con la API de iTunes. El servidor selecciona
  una de las direcciones de búsqueda configuradas y utiliza canciones
  disponibles para la partida.
- Rondas con tiempo límite, pausa entre rondas y cierre de partida.
- Respuestas en tiempo real y adjudicación ordenada en el servidor: el primer
  acierto procesado gana la ronda.
- Puntaje potencial inicial de 100 puntos. Cada respuesta incorrecta descuenta
  5 puntos, con un mínimo de 10; la cantidad máxima de errores por ronda es
  configurable.
- Tabla de posiciones, aviso de ganador y reinicio para una nueva partida.

## Tecnologías

| Área | Tecnología |
|---|---|
| Servidor | Node.js, JavaScript, Express |
| Comunicación en tiempo real | WebSocket, mediante `ws` |
| Interfaz | HTML y JavaScript |
| Manejo del audio | `worker_threads`, `ffmpeg-static` y módulos propios de procesamiento |
| Pruebas y calidad | Node.js test runner, pruebas de integración y ESLint |

## Funcionamiento y concurrencia

El servidor HTTP sirve la interfaz de `public/` y mantiene las conexiones
WebSocket con los navegadores. La sesión de juego pasa por los estados de sala
de espera, ronda activa, intervalo entre rondas y partida finalizada. El
servidor valida las respuestas y modifica los puntajes, y los clientes presentan
el estado recibido.

Las respuestas se encolan para procesarlas de forma ordenada, evitando que
respuestas concurrentes adjudiquen más de un ganador para la misma ronda. El
proyecto también incluye un sistema de preparación de audio con cola de
trabajos, pool de worker_threads y buffer de rondas preparadas.

## Requisitos

### Servidor

- Node.js. Se recomienda Node.js 22.13 o posterior.
- npm.
- Conexión a Internet para instalar dependencias y consultar iTunes; la
  disponibilidad de previews depende del servicio externo.
- El equipo debe poder ejecutar Node.js y sus dependencias.

### Sistema operativo y clientes

- Se requiere un navegador con soporte para WebSocket, JavaScript y
  reproducción de audio HTML5.
- Cada participante necesita conexión de red con el servidor y salida de
  audio.

## Instalación y ejecución

Desde una terminal, ubicarse en la carpeta del proyecto:

```bash
cd TP-Integrador
npm ci
npm start
```

Abrir [http://localhost:3000](http://localhost:3000) en el navegador. El puerto
predeterminado es `3000`; se puede cambiar mediante la variable de entorno
`PORT`. Para jugar desde otros equipos, deben tener acceso de red al servidor y
usar su dirección IP y puerto.

## Configuración

Editar `game-config.json` antes de iniciar el servidor:

| Propiedad | Descripción |
|---|---|
| `startTime` | Hora programada de inicio; puede ser `null`. |
| `startDelaySeconds` | Demora inicial antes de comenzar. |
| `delayNextRound` | Pausa entre rondas. |
| `roundTimeoutSeconds` | Duración máxima de una ronda. |
| `maxRounds` | Cantidad de rondas de la partida. |
| `minPlayers`, `maxPlayers` | Límites de participantes. |
| `maxWrongAttempts` | Máximo de respuestas incorrectas por jugador y ronda. |
| `itunesSearchUrls` | Direcciones de búsqueda de canciones en iTunes. |

## Pruebas y lint

```bash
npm test
npm run lint
```
