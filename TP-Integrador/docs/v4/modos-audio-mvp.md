# C04 / D02 - Modos de audio del MVP V4

## 1. Objetivo

Definir y congelar el alcance funcional mínimo de modos de audio que formarán parte de V4 de Trivia Musical.

Esta decisión busca mantener un alcance suficiente para demostrar procesamiento real de audio y concurrencia con `worker_threads`, evitando incorporar transformaciones adicionales que aumenten innecesariamente el riesgo técnico y el esfuerzo de pruebas.

---

## 2. Decisión D02

**Estado:** Aprobada

Los modos incluidos en el MVP V4 son:

- `NORMAL`
- `REVERSE`
- `LOW_PASS`

No se incorporarán nuevos modos al MVP salvo que una decisión posterior de alcance los reemplace explícitamente.

---

## 3. Modo `NORMAL`

### Descripción

Utiliza el preview original de la canción sin transformación de audio.

### Propósito

`NORMAL` funciona como:

- modo de control;
- referencia frente a los modos transformados;
- mecanismo de degradación controlada o fallback;
- forma de mantener la ronda jugable si una transformación no está disponible.

### Procesamiento

No requiere necesariamente ejecutar un `AudioJob` dentro de un worker.

La implementación puede reutilizar directamente el recurso de audio original si esto simplifica el pipeline.

### Criterio de aceptación

El cliente debe poder reproducir el preview original de la canción utilizando el mismo flujo de ronda que los demás modos.

---

## 4. Modo `REVERSE`

### Descripción

Reproduce el contenido de audio en sentido temporal inverso.

Conceptualmente:

```text
audio original:
A B C D E

audio reverse:
E D C B A
```

La representación real dependerá del formato de audio y de la estrategia de decodificación elegida en C03 / D01.

### Propósito

`REVERSE` se incluye porque:

- es una transformación claramente perceptible;
- requiere manipulación real del audio;
- es relativamente simple de verificar;
- resulta adecuada para el primer spike end-to-end del pipeline;
- permite ejecutar procesamiento CPU-bound sencillo dentro del pipeline de workers, aunque por sí solo no demuestra paralelismo ni speedup.
### Criterio de aceptación

A partir de un preview válido:

1. el audio puede ser decodificado a una representación manipulable;
2. la transformación puede aplicarse correctamente;
3. el resultado puede convertirse nuevamente en un recurso reproducible;
4. el navegador puede reproducir el resultado;
5. el resultado es perceptiblemente diferente del original y corresponde a una inversión temporal.

---

## 5. Modo `LOW_PASS`

### Descripción

Aplica un filtro pasa-bajos al audio.

El objetivo del filtro es conservar principalmente las frecuencias por debajo de una frecuencia de corte y atenuar componentes de frecuencia superiores.

### Propósito

`LOW_PASS` se incluye porque:

- representa procesamiento DSP real;
- es conceptualmente distinto de `REVERSE`;
- incorpora procesamiento DSP CPU-bound, cuyo costo real deberá medirse durante la implementación;- aporta una transformación acústica reconocible;
- permite discutir procesamiento de señales dentro del contexto de Programación Concurrente.

### Parámetros

La frecuencia de corte concreta y la implementación del filtro no se fijan en D02.

Esos aspectos pertenecen a la implementación técnica y podrán definirse después de resolver el stack de audio en C03 / D01.

### Criterio de aceptación

A partir de un preview válido:

1. el audio puede ser decodificado;
2. el filtro puede aplicarse sin generar una salida inválida;
3. el resultado puede reproducirse en el navegador;
4. la transformación produce una diferencia auditiva verificable respecto del audio original;
5. el procesamiento puede ejecutarse dentro del pipeline de workers definido para V4.

---

## 6. Modos fuera del alcance del MVP

Quedan fuera del alcance previsto:

- `SPEED`
- `PITCH`
- `ECHO`
- `NOISE`
- otras transformaciones no incluidas expresamente en D02.

Se excluyen para evitar:

- crecimiento innecesario del alcance;
- más dependencias y casos de prueba;
- mayor complejidad del frontend;
- mayor cantidad de combinaciones a validar;
- desvío respecto del objetivo principal de concurrencia.

---

## 7. Relación con C03 / D01

D02 define **qué modos queremos ofrecer**.

C03 / D01 define **con qué stack técnico será posible implementarlos**.

Por lo tanto:

```text
D02
define alcance funcional

D01
define factibilidad y stack técnico
```

Si el spike técnico demuestra que una transformación elegida es inviable dentro del plazo o del entorno disponible, la decisión deberá revisarse explícitamente.

No se considerará válida una eliminación silenciosa de un modo durante la implementación.

---

## 8. Relación con el pipeline V4

Los modos transformados deben integrarse en el pipeline general:

```text
preview de origen
      |
      v
decodificación
      |
      v
transformación según mode
      |
      v
validación
      |
      v
recurso reproducible
      |
      v
PreparedRound
```

`NORMAL` puede omitir etapas de transformación si reutiliza directamente el preview original.

`REVERSE` y `LOW_PASS` requieren procesamiento real del contenido de audio.

---

## 9. Relación con concurrencia

La existencia de varios modos no constituye por sí sola concurrencia.

El aporte a Programación Concurrente aparece cuando las transformaciones CPU-bound son procesadas mediante:

- `worker_threads`;
- un pool fijo de workers;
- una cola de trabajos;
- procesamiento simultáneo de trabajos independientes;
- prefetch de rondas futuras.

Por lo tanto, D02 define el contenido del trabajo, pero no reemplaza la necesidad de demostrar ejecución concurrente real.

---

## 10. Regla de alcance

Para el MVP V4:

```text
NORMAL
REVERSE
LOW_PASS
```

son los únicos modos previstos.

Después del freeze funcional no deberán agregarse nuevos modos salvo que exista una razón bloqueante y se reevalúe explícitamente el alcance general del proyecto.
