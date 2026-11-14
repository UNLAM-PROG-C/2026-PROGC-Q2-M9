# Arquitectura V4 - Trivia Musical

## 1. Objetivo

V4 amplía la versión V3 incorporando procesamiento de audio CPU-bound mediante `worker_threads`, un pool fijo de workers, una cola de trabajos, preparación anticipada de rondas y un buffer acotado de rondas preparadas.

La ampliación debe conservar las responsabilidades de V3 relacionadas con sesión, respuestas, ganador y comunicación con los clientes.

Principio central:

> V3 decide cuándo se juega una ronda.
>
> V4 prepara qué audio puede utilizar esa ronda.

---

## 2. Arquitectura general

```text
Browsers
   |
   | WebSocket / HTTP
   v
server.js
   |
   +--> SessionCoordinator
   |        |
   |        +--> SessionState
   |
   +--> AnswerQueue
   |        |
   |        v
   |   GameCoordinator
   |
   +--> AudioPreparationManager
            |
            v
         JobQueue
            |
            v
      AudioWorkerPool
        |    |    |
        v    v    v
       W1   W2   W3...
            |
            v
       AudioResult
            |
            v
   PreparedRoundBuffer
            |
            v
        server.js
            |
            v
         Browser
```

La cantidad concreta de workers y la capacidad concreta del buffer son parámetros del MVP y no forman parte de esta definición arquitectónica.

---

## 3. Componentes heredados de V3

### 3.1 `server.js`

Responsabilidad principal:

- coordinar componentes;
- gestionar WebSockets;
- servir contenido HTTP;
- administrar timers;
- disparar transiciones de ronda;
- traducir eventos externos a operaciones de los coordinadores;
- enviar resultados y estados a los clientes.

`server.js` no debe realizar procesamiento pesado de audio.

El event loop debe permanecer disponible para atender conexiones, mensajes, timers y coordinación.

### 3.2 `SessionCoordinator`

Responsabilidad:

- controlar el ciclo de vida de la partida;
- administrar las transiciones entre estados;
- coordinar READY;
- decidir cuándo puede comenzar una partida o una ronda;
- mantener la generación lógica de partida mediante `gameId`.

No procesa audio ni decide ganadores.

### 3.3 `SessionState`

Representa los estados del ciclo de vida de la sesión.

Estados actuales:

- `LOBBY`
- `ROUND_ACTIVE`
- `BETWEEN_ROUNDS`
- `GAME_OVER`

### 3.4 `AnswerQueue`

Responsabilidad:

- recibir eventos de respuesta;
- conservar su orden lógico de procesamiento;
- desacoplar recepción de respuestas de su adjudicación.

Esta cola pertenece al flujo de respuestas de jugadores.

No debe confundirse con `JobQueue`, que pertenece al pipeline de preparación de audio.

### 3.5 `GameCoordinator`

Responsabilidad:

- adjudicar respuestas;
- determinar el ganador de una ronda;
- controlar intentos y puntajes;
- garantizar una única adjudicación válida por ronda.

No procesa audio ni administra workers.

---

## 4. Componentes nuevos de V4

### 4.1 `AudioPreparationManager`

Actúa como coordinador o "Jefe" del pipeline de audio.

Responsabilidades:

- determinar qué rondas necesitan preparación;
- crear `AudioJob`;
- solicitar trabajos al subsistema de workers;
- coordinar preparación anticipada;
- evitar trabajos duplicados;
- recibir resultados;
- publicar rondas listas en `PreparedRoundBuffer`;
- validar que los resultados pertenezcan a la partida vigente.

No realiza directamente procesamiento CPU-bound.

No administra reglas de puntaje, ganador ni ciclo de vida de la sesión.

### 4.2 `JobQueue`

Cola de trabajos pendientes de procesamiento.

Responsabilidades:

- almacenar `AudioJob` que esperan capacidad de procesamiento;
- mantener orden FIFO de despacho;
- desacoplar producción de trabajos de disponibilidad de workers.

Importante:

FIFO de despacho no implica FIFO de finalización.

Dos trabajos enviados en orden A, B pueden finalizar B, A si sus tiempos de procesamiento son diferentes.

### 4.3 `AudioWorkerPool`

Administra un conjunto fijo y reutilizable de workers creados mediante `worker_threads`.

Responsabilidades:

- crear y mantener workers persistentes;
- conocer cuáles están libres y ocupados;
- asignar trabajos pendientes a workers disponibles;
- limitar el paralelismo;
- reutilizar workers entre múltiples trabajos;
- detectar terminaciones anormales de workers;
- restaurar la capacidad del pool cuando corresponda.

El pool no decide qué ronda debe prepararse ni qué modo de audio corresponde.

### 4.4 `AudioWorker`

Unidad de ejecución CPU-bound.

Responsabilidades:

- recibir un `AudioJob`;
- ejecutar procesamiento de audio;
- producir un `AudioResult`;
- devolver el resultado al proceso principal.

El worker no conoce:

- jugadores;
- READY;
- ganador;
- leaderboard;
- estado de sesión;
- reglas de puntuación.

Su contrato debe estar limitado al trabajo de procesamiento recibido.

### 4.5 `PreparedRoundBuffer`

Almacena rondas cuyo audio ya está preparado y puede ser consumido por el juego.

Responsabilidades:

- mantener una cantidad acotada de rondas preparadas;
- permitir localizar una ronda por identidad lógica;
- impedir crecimiento ilimitado de trabajo preparado;
- desacoplar velocidad de preparación de velocidad de consumo.

La identidad prevista para una ronda preparada es:

```text
gameId + roundId
```

El buffer no debe implementarse como una cola FIFO ingenua.

Los workers pueden terminar trabajos fuera de orden, por lo que una ronda preparada debe poder localizarse por identidad y no solamente por posición de llegada.

---

## 5. Flujo de preparación

Flujo conceptual:

```text
AudioPreparationManager
        |
        | crea AudioJob
        v
     JobQueue
        |
        | dispatch
        v
 AudioWorkerPool
        |
        | asigna
        v
   AudioWorker
        |
        | procesamiento CPU-bound
        v
    AudioResult
        |
        v
AudioPreparationManager
        |
        | valida resultado
        v
PreparedRoundBuffer
```

Cuando el juego necesita iniciar una ronda:

```text
SessionCoordinator / server.js
        |
        | ronda N debe comenzar
        v
PreparedRoundBuffer
        |
        | busca gameId + roundId
        v
PreparedRound
        |
        v
server.js
        |
        v
cliente
```

---

## 6. Separación entre las dos colas

V4 contiene dos problemas de productor-consumidor diferentes.

### `AnswerQueue`

```text
Clientes
   |
   v
AnswerQueue
   |
   v
GameCoordinator
```

Transporta respuestas de jugadores.

### `JobQueue`

```text
AudioPreparationManager
   |
   v
JobQueue
   |
   v
AudioWorkerPool
```

Transporta trabajos de procesamiento de audio.

Aunque ambas utilizan una cola, resuelven problemas distintos y no deben compartir responsabilidades.

---

## 7. Event loop y workers

El proceso principal de Node.js conserva:

- WebSockets;
- HTTP;
- timers;
- estado de sesión;
- coordinación;
- colas lógicas;
- integración de resultados.

Los `worker_threads` se reservan para trabajo CPU-bound.

```text
MAIN THREAD / EVENT LOOP
------------------------
WebSockets
HTTP
timers
SessionCoordinator
AnswerQueue
GameCoordinator
AudioPreparationManager
JobQueue
PreparedRoundBuffer


WORKER THREADS
--------------
decode / transformación / procesamiento CPU-bound de audio
```

El objetivo no es trasladar toda la aplicación a múltiples hilos.

El objetivo es evitar que el procesamiento pesado de audio bloquee el event loop.

---

## 8. Pipeline

La preparación de una ronda se modela como un pipeline conceptual:

```text
obtener fuente
    |
    v
decodificar
    |
    v
transformar
    |
    v
validar
    |
    v
publicar ronda preparada
```

No todas las etapas necesariamente deben ejecutarse dentro de un worker.

Las operaciones principalmente de I/O pueden permanecer en el proceso principal o utilizar APIs asíncronas.

Las operaciones CPU-bound son candidatas a ejecutarse mediante `worker_threads`.

---

## 9. Prefetch

V4 debe permitir preparar rondas futuras antes de que sean necesarias.

Conceptualmente:

```text
Ronda actual: N

Preparación anticipada:
N+1
N+2
N+3
...
```

La cantidad concreta de rondas anticipadas depende de la capacidad configurada y de las decisiones posteriores del MVP.

El prefetch no debe producir trabajo ilimitado.

La admisión de nuevos trabajos deberá considerar tanto:

- rondas ya preparadas;
- trabajos actualmente en ejecución.

---

## 10. Identidad y reinicio de partida

Todo trabajo relacionado con una partida debe poder asociarse con un `gameId`.

Esto permite distinguir resultados vigentes de resultados pertenecientes a una partida anterior.

Flujo conceptual:

```text
gameId = 10
AudioJob iniciado
      |
      | ocurre RESTART
      v
gameId = 11
      |
      | llega resultado viejo
      v
resultado.gameId = 10
      |
      v
descartar
```

La política concreta de limpieza de trabajos pendientes y trabajos en ejecución se define en una decisión posterior.

---

## 11. Contratos entre componentes

La arquitectura prevé al menos tres contratos lógicos:

```text
AudioJob
AudioResult
PreparedRound
```

Su estructura exacta se define en C05 / D03.

C02 solamente establece que dichos contratos deben transportar identidad suficiente para relacionar:

- trabajo;
- partida;
- ronda;
- modo de procesamiento;
- resultado.

---

## 12. Límites arquitectónicos

V4 no debe:

- duplicar el ciclo de vida que ya controla `SessionCoordinator`;
- duplicar la adjudicación que ya controla `GameCoordinator`;
- utilizar el nombre visible del jugador como identidad interna;
- ejecutar procesamiento pesado de audio directamente en el event loop;
- crear un worker nuevo por cada trabajo;
- asumir que los trabajos terminan en el mismo orden en que fueron enviados;
- permitir crecimiento ilimitado de trabajos o rondas preparadas.

---

## 13. Conceptos de Programación Concurrente asociados

| Concepto | Implementación prevista |
|---|---|
| Cliente/Servidor | Browser + servidor Node.js |
| Event loop | Proceso principal de Node.js |
| Threads | `worker_threads` |
| Jefe/Trabajador | `AudioPreparationManager` + workers |
| Worker Pool | `AudioWorkerPool` |
| Productor/Consumidor | Manager -> `JobQueue` -> Pool |
| Cola FIFO | `JobQueue` para despacho |
| Buffer acotado | `PreparedRoundBuffer` |
| Pipeline | etapas de preparación de audio |
| Prefetch | preparación de rondas futuras |
| Backpressure | límite de trabajo preparado/en ejecución |
| Identidad de generación | `gameId` |
| Serialización lógica | `AnswerQueue` + `GameCoordinator` |
| Barrera lógica | READY en `SessionCoordinator` |

Este mapa se ampliará incrementalmente como parte de C27.

---

## 14. Regla arquitectónica de referencia

Ante una duda sobre dónde debe implementarse una responsabilidad:

```text
¿Es ciclo de vida de partida?
    -> SessionCoordinator

¿Es adjudicación de respuestas?
    -> GameCoordinator

¿Es recepción/orden de respuestas?
    -> AnswerQueue

¿Es decisión de qué audio preparar?
    -> AudioPreparationManager

¿Es espera de un trabajo CPU?
    -> JobQueue

¿Es administración de threads?
    -> AudioWorkerPool

¿Es procesamiento CPU-bound?
    -> AudioWorker

¿Es almacenamiento de rondas ya listas?
    -> PreparedRoundBuffer

¿Es transporte, timers o integración?
    -> server.js
```

La arquitectura debe conservar estas fronteras durante la implementación de V4.
