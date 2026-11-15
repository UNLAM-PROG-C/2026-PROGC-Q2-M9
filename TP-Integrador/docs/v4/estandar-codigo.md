# Estándar de código - Trivia Musical V4

**Fecha:** 15/11/2026

**Revisión:** 07

**Tareas relacionadas:** STD-01 a STD-09.

**Estado:** Adecuación de estilo, renombrado y JSDoc completados y registrados en Git. T0, T1 y T2 aprobadas; T3 y T4 aprobadas con OBS-STD-01 abierta. OBS-STD-02 mitigada; automatización permanente de JSDoc diferida. Cierre documental, auditoría final, push e integración pendientes.

## 1. Objetivo

Establecer convenciones comunes de programación para Trivia Musical, tomando como referencia el estándar de JavaScript de Google solicitado por la cátedra de Programación Concurrente.

Referencia oficial: https://google.github.io/styleguide/jsguide.html

Se busca mejorar la uniformidad, legibilidad y mantenibilidad del código, facilitar el trabajo colaborativo y automatizar la detección de determinados incumplimientos y malas prácticas.

## 2. Alcance

El estándar se aplica a todo el código JavaScript propio que forma parte de V4:

- Servidor principal.
- Coordinadores de juego y sesión.
- Colas y mecanismos de concurrencia.
- Modelos, contratos y transformaciones de audio.
- JavaScript embebido en el cliente HTML.
- Pruebas automatizadas y spikes tecnológicos.
- Nuevos componentes que se incorporen durante el desarrollo.

Se incluyen tanto los componentes nuevos de V4 como aquellos heredados de versiones anteriores. Se excluyen las dependencias de terceros, archivos generados y el contenido HTML y CSS como tales. La versión V3 congelada permanece intacta.

## 3. Herramientas adoptadas

| Herramienta | Versión | Propósito |
|---|---|---|
| ESLint | 10.15.0 | Análisis estático |
| @eslint/js | 10.0.1 | Reglas recomendadas de JavaScript |
| @stylistic/eslint-plugin | 5.10.0 | Convenciones de formato |
| eslint-plugin-html | 8.2.1 | Análisis del JavaScript embebido |
| globals | 16.5.0 | Reconocimiento de entornos de ejecución |
| EditorConfig | No aplica | Configuración compartida entre editores |

Entorno validado: Node.js 24.20.0, npm 11.19.0, Windows y PowerShell.

Las dependencias de desarrollo están declaradas con versiones exactas en `package.json` y registradas en `package-lock.json`. Los integrantes deberán utilizar una versión de Node.js compatible con estas herramientas. Se recomienda reproducir el entorno validado; la compatibilidad con otras versiones deberá verificarse.

## 4. Convenciones adoptadas

| Aspecto | Convención |
|---|---|
| Indentación de bloques | Dos espacios |
| Tabulaciones | No utilizar |
| Comillas | Simples, salvo excepciones justificadas |
| Punto y coma | Obligatorio según las reglas configuradas |
| Comas finales | En arrays y objetos multilínea |
| Llaves | Explícitas en estructuras de control |
| Longitud de línea | Límite general de 80 columnas |
| Variables y funciones | camelCase |
| Clases | PascalCase |
| Constantes | CONSTANT_CASE cuando corresponda |
| Archivos JavaScript | kebab-case, minúsculas y extensión `.js`; excepción técnica `eslint.config.mjs` |
| Codificación | UTF-8 |
| Espacios sobrantes | Evitarlos |
| Declaraciones de variables | Preferir const cuando no exista reasignación |
| Comparaciones | Igualdad estricta, con la excepción configurada para null |

Se permite omitir paréntesis en parámetros simples de funciones flecha. Las reglas automatizadas constituyen una aproximación al estándar de Google y no reemplazan la revisión manual. Las excepciones de la guía, las continuaciones de línea y otros aspectos no cubiertos automáticamente deberán evaluarse durante la revisión de código.

## 5. Decisiones y excepciones de alcance

### 5.1. Sistema de módulos

Se conserva CommonJS para el código existente de la aplicación. No se realizará una migración generalizada a ES Modules como parte de esta iniciativa. Esta decisión constituye una desviación respecto de las convenciones de módulos de la guía de Google y evita modificaciones estructurales ajenas a los objetivos funcionales de V4.

### 5.2. Documentación JSDoc

STD-06 se completó después de un piloto y una aprobación de alcance integral por archivos. Documentar responsabilidades y contratos, especialmente en componentes concurrentes, modelos, transformaciones y pruebas; usar descripciones en español y etiquetas compatibles con Google/Closure, preferentemente `@return`, `@fileoverview` y `@const` cuando corresponda. Evitar promesas de garantías no implementadas, duplicación innecesaria del código y tipos demasiado restrictivos. El diagnóstico especializado de cinco reglas se aprobó, pero no se conserva el plugin permanente por OBS-STD-02. Por ahora la revisión de nuevos JSDoc es manual y el lint vigente controla el estilo general, no estas cinco reglas. La sección [7 de la guía](https://google.github.io/styleguide/jsguide.html#jsdoc) sigue siendo la referencia; no se afirma conformidad exhaustiva.

### 5.3. Nombres de archivos existentes

STD-05 completada en `2b86634`: diez archivos renombrados a `kebab-case`, con actualización de rutas y script de pruebas. Se conserva `eslint.config.mjs` por razones técnicas. Los nombres de clases no cambian. La sección [2.1 de la guía](https://google.github.io/styleguide/jsguide.html#file-name) fundamenta la convención adoptada. Los nombres previos se conservan únicamente cuando se documenta el historial.

### 5.4. Programación asincrónica y concurrencia

No se impondrán prohibiciones generalizadas sobre la utilización de `await` dentro de bucles. La regla `require-atomic-updates` se utiliza como advertencia y sus hallazgos deberán evaluarse contextualmente. ESLint no garantiza la ausencia de condiciones de carrera, interbloqueos, problemas de sincronización ni otros defectos de concurrencia.

### 5.5. Aceptación académica

Las excepciones adoptadas permiten reducir el esfuerzo y los riesgos de modificación del código. No deberá afirmarse un cumplimiento íntegro del estándar de Google mientras existan desviaciones. Si la cátedra exige conformidad estricta, deberá confirmarse la aceptación de las excepciones adoptadas.

## 6. Tratamiento del frontend

El JavaScript del cliente continúa embebido en `public/index.html`. Se utiliza eslint-plugin-html para permitir su análisis sin alterar la arquitectura existente.

Durante las primeras simulaciones se detectó `ESLintCircularFixesWarning`, asociado al formateo automático del JavaScript embebido.

| Experimento | Resultado |
|---|---|
| Normalización de CRLF a LF | No resolvió el conflicto |
| Desactivación temporal de curly | Eliminó el conflicto, pero excluía una regla |
| Desactivación temporal de indent | Eliminó el conflicto, pero excluía una regla |
| Correcciones en dos pasadas | No resolvió el conflicto |
| Configuración explícita de la indentación base | Solución validada en simulación integral |

La solución adoptada consiste en incorporar la siguiente configuración al bloque correspondiente al HTML en `eslint.config.mjs`:

```javascript
settings: {
  'html/indent': '0',
},
```

Esta configuración permitió completar la simulación integral sin correcciones circulares ni advertencias autocorregibles pendientes. Se mantienen activas las reglas previamente configuradas. No se ha demostrado la causa interna exacta del incidente. La aplicación efectiva no emitió advertencias de correcciones circulares y la regresión funcional del navegador resultó satisfactoria (11/11).

El plugin analiza el JavaScript contenido en los bloques script, no la totalidad de las construcciones HTML, CSS ni los atributos HTML de eventos. Se exceptúan de `no-unused-vars` las cinco funciones invocadas desde atributos del HTML existente: `joinGame`, `toggleReady`, `leaveGame`, `handleInput` y `sendAnswer`.

No se realizará una extracción permanente del JavaScript a archivos independientes ni una normalización general de finales de línea como parte de esta adecuación.

## 7. Archivos de configuración

| Archivo | Responsabilidad |
|---|---|
| eslint.config.mjs | Definición de reglas, plugins y entornos |
| .editorconfig | Convenciones compartidas entre editores |
| package.json | Dependencias y comandos de ejecución |
| package-lock.json | Registro reproducible de dependencias |
| .gitignore | Exclusión de informes locales generados (verificada) |

## 8. Preparación del entorno de desarrollo

Los comandos deberán ejecutarse desde la carpeta `TP-Integrador`, donde se encuentra `package.json`.

Una vez incorporada la configuración a la rama de integración, cada integrante podrá instalar las dependencias registradas mediante:

```powershell
node --version
npm --version
npm ci
```

No será necesario instalar ESLint globalmente ni configurar manualmente las reglas. Para comprobar las dependencias instaladas:

```powershell
npm ls --depth=0
npx eslint --version
```

Las actualizaciones de versiones de herramientas deberán coordinarse con el equipo.

## 9. Comandos de trabajo

### 9.1. Analizar el código completo

```powershell
npm run lint
```

Para exigir cero advertencias en una comprobación local:

```powershell
npm run lint -- --max-warnings 0
```

Este comando fue validado en STD-04B y T4. No se modificó el script permanente ni se configuró un gate de PRs.

### 9.2. Generar un informe estructurado

```powershell
npm run lint:report
```

El informe se genera en `lint-report.json`.

### 9.3. Simular correcciones automáticas

```powershell
npx eslint . public/index.html --fix-dry-run --format json --output-file lint-report-dry-run.json
```

Permite analizar el resultado de las correcciones sin modificar los archivos originales.

### 9.4. Aplicar correcciones automáticas

La utilización de `--fix` deberá realizarse de manera controlada, sobre una rama de trabajo y previa coordinación con el equipo cuando involucre modificaciones masivas. Antes de aplicar correcciones deberán verificarse el estado de Git, el alcance de los archivos afectados y las pruebas de referencia. Después deberán revisarse las diferencias y ejecutarse las pruebas de regresión.

Durante STD-01 a STD-03 se realizaron únicamente diagnósticos y simulaciones. En STD-04A se ejecutó `npx eslint . public/index.html --fix`, se validaron las diferencias y se registró el código corregido en el commit `d2a84e7`.

### 9.5. Interpretación de los códigos de salida

| Código | Significado |
|---|---|
| 0 | Ejecución satisfactoria, sin errores y dentro del límite de advertencias configurado |
| 1 | Errores detectados o límite de advertencias excedido |
| 2 | Problema de configuración o ejecución de ESLint |

En esta etapa no se ha configurado un límite de advertencias que bloquee automáticamente los Pull Requests. Un código de salida 0 no implica ausencia de advertencias.

## 10. Evidencias de diagnóstico, simulación y aplicación efectiva

La auditoría comprendió 17 archivos propios de la aplicación y sus pruebas, además de la configuración de ESLint.

### 10.1. Investigación inicial

| Indicador | Diagnóstico inicial | Primera simulación |
|---|---:|---:|
| Archivos analizados | 18 | 18 |
| Errores | 0 | 0 |
| Advertencias | 2.995 | 145 |
| Advertencias autocorregibles | 2.819 | 9 |
| Advertencias del frontend | 348 | 36 |
| Conflictos circulares | No aplica | Sí |

### 10.2. Comparación con la configuración definitiva

| Indicador | Línea base definitiva | Segunda simulación integral | Aplicación efectiva |
|---|---:|---:|---:|
| Archivos analizados | 18 | 18 | 18 |
| Errores | 0 | 0 | 0 |
| Advertencias | 3.060 | 137 | 137 |
| Advertencias autocorregibles | 2.855 | 0 | 0 |
| Advertencias sin corrección directa | 205 | 137 | 137 |
| Conflictos circulares | No aplica | No | No |

Fuentes: `lint-report-baseline-v2.json` (resumen de consola), `lint-report-dry-run-v2.json` y `lint-report-after-autofix.json`.

**Reducción neta efectiva: 2.923 advertencias (95,52 %), coincidente con la simulación.**

La diferencia de 65 advertencias entre la línea base definitiva y el diagnóstico inicial coincide con el cambio de configuración del análisis del HTML, efectuado sin modificar el código funcional. La comparación de referencia para STD-04A es la de esta sección, pues utiliza la misma configuración del linter antes y después de aplicar las correcciones.

Las 137 advertencias residuales corresponden a 136 observaciones por longitud máxima de líneas y un parámetro no utilizado. La auditoría estática registrada verificó la coincidencia de hashes Git con la simulación en los 17 archivos, la comparación normalizada de AST, la sintaxis y la preservación de HTML/CSS fuera del script (normalizando finales de línea). El commit de autofix incluye 17 archivos, 2.655 líneas añadidas y 2.573 eliminadas; `git diff --cached --check` no informó problemas. Estas verificaciones no prueban por sí solas equivalencia semántica ni corrección concurrente.

### Adecuación residual efectiva (STD-04B)

Se resolvieron las 137 advertencias residuales en cuatro bloques, mediante parches revisados y una modificación localizada de la configuración. Se conservaron las reglas de ESLint y las excepciones previamente adoptadas.

| Etapa | Archivos intervenidos | Advertencias de salida | Resultado |
|---|---:|---:|---|
| Después de STD-04A | 17 | 137 | PASS |
| B1: servidor y coordinadores | 3 | 83 | PASS |
| B2: cliente web | 1 | 55 | PASS |
| B3: pruebas y spikes (aplicación inicial) | 5 | 2 | Una nueva advertencia de indentación |
| B3: corrección localizada de indentación | 1 de los 5 anteriores | 1 | PASS |
| B4: configuración ESLint | 1 | 0 | PASS |

B1 eliminó 53 advertencias de longitud y el parámetro `reject` no utilizado en `fetchPlaylistFromItunes()`, sin rediseñar su tratamiento de errores. B2 eliminó las 28 advertencias de longitud del JavaScript embebido, preservando el HTML y CSS fuera del bloque script. B3 eliminó 54 advertencias de longitud, preservando las expresiones regulares, mensajes de diagnóstico y criterios de validación; apareció una advertencia de indentación en C06 (línea 145), corregida con autofix localizado (siete a cuatro espacios). B4 dividió en dos fragmentos concatenados la cadena de `varsIgnorePattern`, conservando el mismo patrón; ESLint ajustó también el cierre del objeto. No se modificaron las dependencias ni se desactivaron reglas para obtener el resultado.

Los parches B1, B2 y B3 se verificaron con `git apply --check --index` antes de su aplicación. Las verificaciones estáticas independientes registradas incluyeron sintaxis, comparación normalizada de AST y preservación de mensajes y expresiones regulares; las pruebas locales del usuario y la regresión T2 completaron la validación. La comparación estructural no demuestra equivalencia semántica absoluta.

El comando `npm run lint -- --max-warnings 0` finalizó con código 0, sin errores ni advertencias, antes del commit. El límite se utilizó como criterio de aceptación puntual, no como nuevo gate permanente. El diff preparado y el commit coinciden: 10 archivos, 418 inserciones y 138 eliminaciones; `git diff --cached --check` sin observaciones. Commit `159fb3f`, mensaje `style: resolve remaining Google JavaScript style warnings`. El documento técnico y los documentos adicionales quedaron fuera del commit. Se eliminó el 100 % de las advertencias de la línea base definitiva (3.060 a 0). Este resultado solo certifica las reglas configuradas y los archivos analizados.


### Adecuación de nombres de archivos (STD-05)

Se aprobó el criterio `kebab-case` para los nombres físicos de los archivos JavaScript. Los nombres de clases, símbolos exportados y el sistema CommonJS se conservan. Se mantiene `eslint.config.mjs` como excepción técnica de configuración. Los siguientes diez renombrados quedaron registrados en Git:

| Ubicación relativa a TP-Integrador | Nombre anterior | Nombre vigente |
|---|---|---|
| game/ | AnswerQueue.js | answer-queue.js |
| game/ | GameCoordinator.js | game-coordinator.js |
| game/ | SessionCoordinator.js | session-coordinator.js |
| game/ | SessionState.js | session-state.js |
| server/audio/model/ | AudioJob.js | audio-job.js |
| server/audio/model/ | AudioMode.js | audio-mode.js |
| server/audio/model/ | AudioResult.js | audio-result.js |
| server/audio/model/ | PreparedRound.js | prepared-round.js |
| server/audio/transform/ | AudioTransform.js | audio-transform.js |
| tests/ | audio-model.test.js | audio-model-test.js |

El parche `STD-05-nombres-archivos.patch` actualiza 15 rutas `require` y el script `test:c05` de `package.json`. Se modificaron además `server.js`, `tests/spikes/audio/c07-transform-modes.js` y `package.json`. No se cambiaron las dependencias, las reglas de lint ni la lógica de aplicación. El comando público de pruebas sigue siendo `npm run test:c05`.

Se verificó la compatibilidad y aplicación mediante `git -C .. apply --check --index` y `git -C .. apply --index`, ambos con salida 0. Git identificó diez renombrados (cuatro R100 y seis con similitud de 94 a 98 %) y tres archivos modificados: 13 archivos, 16 inserciones y 16 eliminaciones. `git diff --cached --check` no informó observaciones. La validación estricta `npm run lint -- --max-warnings 0` devolvió 0, tanto después de aplicar el parche como antes del commit.

Commit local `2b86634`, mensaje `style: standardize JavaScript filenames and module references`. Fue el HEAD al cierre de STD-05; la documentación técnica quedó fuera del staging. No se ha confirmado push ni integración.

## 11. Preservación de evidencias

Los informes de diagnóstico, simulación y aplicación efectiva deberán conservarse localmente o en la documentación compartida del equipo. No deberán incorporarse al repositorio mediante Git, debido a su tamaño y a que pueden contener rutas locales y copias del código fuente.

Se agregó y verificó mediante `git check-ignore` este patrón en el `.gitignore` de `TP-Integrador`:

```gitignore
/lint-report*.json
```

## 12. Verificación del comportamiento funcional

Las adecuaciones deberán complementarse con pruebas antes y después del cambio.

| Comando | Propósito |
|---|---|
| npm run test:c05 | Contratos y modelos de audio |
| npm run test:alt02 | Prueba automatizada de concurrencia |
| npm run test:alt02:matrix | Matriz de escenarios de concurrencia |
| npm run test:c03 | Validación del stack tecnológico de audio |
| npm run test:c06 | Validación de transformación REVERSE |
| npm run test:c07 | Validación de modos NORMAL, REVERSE y LOW_PASS |

Las pruebas de audio que utilizan previews reales requieren disponibilidad de los servicios externos correspondientes y FFmpeg. También deberán realizarse pruebas funcionales del servidor y cliente web.

Se tendrá especial cuidado al modificar los mensajes y logs utilizados por las pruebas automatizadas de concurrencia. Su contenido deberá mantenerse, aunque se redistribuya el código fuente en varias líneas.

Las pruebas automatizadas de referencia, ejecutadas después de configurar las herramientas y antes de aplicar correcciones, resultaron satisfactorias: C05, matriz ALT-02 (4/4 escenarios), C03, C06 y C07. Todos los comandos devolvieron código 0. La comprobación sintáctica independiente de la salida simulada también fue satisfactoria. La regresión posterior al autofix también resultó satisfactoria: C05, matriz ALT-02 (4/4), C03, C06 y C07 (dos ejecuciones), con códigos de salida 0. Las pruebas funcionales de referencia y regresión en navegador STD-FL-01 a STD-FL-11 obtuvieron 11/11 PASS en ambos casos. STD-FL-07 fue confirmado posteriormente como PASS. No se reportaron observaciones adicionales. No es una certificación de ausencia absoluta de defectos. La regresión posterior a STD-04B se detalla a continuación.

### Regresión posterior a STD-04B (T2)

| Validación | T0: referencia | T1: autofix | T2: residual |
|---|---|---|---|
| C05 | PASS | PASS | PASS |
| ALT-02 S1 | PASS | PASS | PASS |
| ALT-02 S2 | PASS | PASS | PASS |
| ALT-02 S3 | PASS | PASS | PASS |
| ALT-02 S4 | PASS | PASS | PASS |
| C03 | PASS | PASS | PASS |
| C06 | PASS | PASS | PASS |
| C07 | PASS | PASS | PASS |
| STD-FL-01 a STD-FL-11 | PASS 11/11 | PASS 11/11 | PASS 11/11 |

Los cinco comandos automatizados de T2 devolvieron código 0. En S4 se mantuvieron 20 rondas, cinco clientes, 100 respuestas, secuencias 1..100, cola máxima de cinco, 20 adjudicaciones, 80 descartes, puntaje total 2.000, 20 victorias de ALT02-C5, cero dobles adjudicaciones y cero inconsistencias entre clientes. Las pruebas de audio conservaron el preview de 1.003.902 bytes, PCM de 5.287.680 bytes, WAV de C06 de 5.287.724 bytes, PCM de 16 bits LE estéreo a 44.100 Hz, duración 29,98 s y corte LOW_PASS de 1.200 Hz.

| Procesamiento | T2 (ms) |
|---|---:|
| C06 REVERSE | 64,80 |
| C07 NORMAL | 1,05 |
| C07 REVERSE | 63,63 |
| C07 LOW_PASS | 71,85 |

No se trata de un benchmark controlado y no se atribuyen variaciones de rendimiento a los cambios de estilo. Los once casos funcionales de navegador obtuvieron PASS, sin observaciones reportadas. En los tres puntos de control se contabilizan 33 resultados funcionales y 24 resultados automatizados (cuatro escenarios ALT-02 y cuatro pruebas de audio por punto), todos satisfactorios: 57/57, sin contar la repetición adicional de C07 en T1. No se certifica la ausencia absoluta de defectos ni funcionalidades futuras del pipeline.


### Regresión específica posterior a STD-05 (T3)

| Verificación | Resultado |
|---|---|
| C05, nuevo archivo de pruebas | PASS, salida 0 |
| Matriz ALT-02 S1, S2, S3, S4 | PASS 4/4, salida 0 |
| C07, nuevas rutas de módulos | PASS, salida 0 |
| Inicio normal y partida de una ronda con dos clientes | PASS con observación de audio |
| Reinicio de partida | PASS, sin desfase perceptible |
| ESLint estricto | PASS, cero errores y advertencias |
| Búsqueda de rutas anteriores | Sin coincidencias reportadas en código ejecutable; una referencia histórica/desactualizada en este documento técnico |

C03 y C06 no se repitieron en T3 por decisión de alcance: sus rutas no cambiaron. No se repitieron los once casos funcionales completos; se hizo una prueba reducida de arranque y partida. El resultado de la búsqueda se limita a las rutas y archivos examinados; las ramas de terceros, documentación externa y referencias no rastreadas no fueron verificadas. Los nombres originales se conservan en las tablas históricas de auditoría y renombrado.

S4 mantuvo los indicadores de T0, T1 y T2: 20 rondas, 5 clientes, 100 ANSWER, secuencias 1..100, tamaño máximo de cola 5, 20 adjudicaciones, 80 descartes, 2.000 puntos, 20 victorias de ALT02-C5, cero dobles adjudicaciones y cero inconsistencias de cliente. En C07 el preview descargado fue de 1.003.902 bytes y el PCM de 5.287.680 bytes, con LOW_PASS de corte 1.200 Hz. Tiempos observados: NORMAL 1,17 ms, REVERSE 63,02 ms y LOW_PASS 64,03 ms. Estos tiempos aislados no constituyen un benchmark ni demuestran mejoras atribuibles al renombrado.

### Regresión final (T4), posterior a STD-06

Fecha: 15/11/2026. Entorno Windows, Node.js 24.20.0, npm 11.19.0. Después de la reversión de la instalación experimental de JSDoc se ejecutó nuevamente el lint estricto (código 0), se generó el informe (código 0) y se repitió la regresión integral. Los cinco comandos automatizados devolvieron 0. No se ejecutó la consulta independiente de versión de FFmpeg en las salidas recibidas; la disponibilidad y operatividad del ejecutable quedan cubiertas funcionalmente por C03 y C06.

| Validación | T0 | T1 | T2 | T3 (reducida) | T4 |
|---|---|---|---|---|---|
| C05 | PASS | PASS | PASS | PASS | PASS |
| ALT-02 S1 | PASS | PASS | PASS | PASS | PASS |
| ALT-02 S2 | PASS | PASS | PASS | PASS | PASS |
| ALT-02 S3 | PASS | PASS | PASS | PASS | PASS |
| ALT-02 S4 | PASS | PASS | PASS | PASS | PASS |
| C03 | PASS | PASS | PASS | No repetido | PASS |
| C06 | PASS | PASS | PASS | No repetido | PASS |
| C07 | PASS | PASS | PASS | PASS | PASS |
| STD-FL-01 a STD-FL-11 | 11/11 | 11/11 | 11/11 | Partida reducida con OBS | 11/11 con OBS |

En T4 se confirmaron 8/8 casos automatizados y 11/11 funcionales (19/19 en total). En las cuatro regresiones integrales T0, T1, T2 y T4 se registraron 76/76 resultados satisfactorios, sin contar la prueba adicional de C07 de T1 ni las ejecuciones reducidas de T3. La observación de reproducción permanece abierta; el resultado PASS de reproducción atestigua que el audio se reproduce, no una garantía de sincronización.

| Caso T4-C | Funcionalidad | Resultado |
|---|---|---|
| STD-FL-01 | Ingreso y registro | PASS |
| STD-FL-02 | Barrera READY | PASS |
| STD-FL-03 | Inicio de partida | PASS |
| STD-FL-04 | Reproducción de audio | PASS con OBS-STD-01 |
| STD-FL-05 | Respuesta incorrecta | PASS |
| STD-FL-06 | Autocompletado | PASS |
| STD-FL-07 | Respuesta correcta | PASS |
| STD-FL-08 | Transición entre rondas | PASS |
| STD-FL-09 | Finalización | PASS |
| STD-FL-10 | Reinicio | PASS |
| STD-FL-11 | Desconexión | PASS |

La matriz ALT-02 volvió a aprobar S1 a S4. En S4 se registraron 20 rondas/20 aprobadas, 5 clientes, offsets de seguidores 0/0/0/0/0 ms, liderazgo de ALT02-C5 confirmado por recepción del servidor, demora artificial de drenaje de 100 ms (solo prueba), cola máxima 5, 100 ANSWER con secuencias 1..100, 20 adjudicaciones, 80 descartes, 2.000 puntos, 20 victorias de C5, doubleWinner=0 y clientMismatch=0. Los indicadores coinciden con T0 a T3. No demuestran simultaneidad física ni corrección para todos los escenarios posibles.

C03, C06 y C07 emplearon el preview real de Daft Punk (One More Time): 1.003.902 bytes de preview, 5.287.680 bytes PCM, 16 bits LE, estéreo, 44.100 Hz, duración aproximada de 29,98 s. C06 generó 5.287.724 bytes WAV y aprobó su verificación estructural de frames; C07 generó los tres WAV y aprobó la interfaz pura compartida con corte LOW_PASS de 1.200 Hz.

| Procesamiento (ms) | T0 | T1 | T2 | T3 | T4 |
|---|---:|---:|---:|---:|---:|
| C06 REVERSE | 64,31 | 64,60 | 64,80 | No repetido | 64,50 |
| C07 NORMAL | 0,97 | 1,30 | 1,05 | 1,17 | 1,01 |
| C07 REVERSE | 69,86 | 64,91 | 63,63 | 63,02 | 64,23 |
| C07 LOW_PASS | 74,58 | 71,94 | 71,85 | 64,03 | 74,97 |

Se utiliza la primera ejecución de C07 de T1 para comparar; la repetición se conserva en el registro histórico. Los tiempos son observaciones aisladas, no un benchmark; no se atribuyen las variaciones a las adecuaciones. **STD-08 completada: T4 aprobada con observación no bloqueante.**

### OBS-STD-01. Desfase temporal de reproducción entre clientes

| Campo | T3 (registro histórico) | T4 (actualización) |
|---|---|---|
| Fecha | 15/11/2026 | 15/11/2026 |
| Condiciones | Dos clientes, ingreso alrededor de 10:40, inicio programado 10:41 | Dos clientes; primera partida con tres rondas |
| Ocurrencia | Primera ronda, efecto de eco | Tercera ronda de la primera partida; rondas 1 y 2 sin desfase perceptible |
| Desfase estimado | Cercano a un segundo o inferior | Aproximadamente un segundo |
| Tras reinicio | Sin desfase perceptible | Inicio de la segunda partida sin desfase perceptible |
| Medición instrumental | No | No |
| Frecuencia | Una ocurrencia; desconocida | Recurrente, intermitente en las ejecuciones observadas |
| Severidad y prioridad | Bajas preliminares | Medias propuestas por potencial impacto sobre la equidad |
| Estado | Abierta, no bloqueante | Abierta, no bloqueante para la adecuación al estándar |

Se espera reproducción aproximadamente sincronizada. La recurrencia en una ronda posterior debilita la hipótesis de un problema exclusivo del primer inicio programado. El reinicio no constituye una corrección demostrada. No se estableció qué cliente comenzó antes ni la causa raíz. No hay evidencia suficiente para atribuir el comportamiento a STD-05, JSDoc u otra adecuación de estilo, ni para asegurar que ya existía antes de T3. La adjudicación FIFO correcta según recepción en el servidor no garantiza igualdad temporal de oportunidades: quien escucha primero puede reconocer antes el fragmento.

Se propone investigar en una tarea funcional independiente de V4: repetir rondas e inicios/reinicios en condiciones comparables; registrar emisión y recepción de mensajes, disponibilidad del recurso y eventos de reproducción por cliente; distinguir relojes locales y retrasos de red; medir dispersión y acordar tolerancias de sincronización y equidad. Hipótesis abiertas: entrega WebSocket, buffering, planificación de los navegadores, reproductor y disponibilidad de recursos. Prefetch, pipeline y workers pueden mejorar disponibilidad y reducir cargas, pero no garantizan por sí solos un instante común de reproducción. No se introducen correcciones funcionales en la rama de estilo.

**Resultado T3 y T4: aprobados dentro de su alcance con OBS-STD-01 no bloqueante.** La propuesta de severidad y prioridad media deberá coordinarse con el equipo; no representa una decisión de implementación de V4.

### STD-06. Documentación JSDoc: piloto, ampliación y validación

La decisión inicial de diferir JSDoc por esfuerzo se revisó mediante un piloto documental. STD-06A comenzó con `game/answer-queue.js` y `server/audio/model/audio-job.js`, representativos del contrato concurrente y del contrato de datos. En STD-06B se aprobó ampliar la documentación a todo el código propio, con profundidad diferenciada según responsabilidad y complejidad. Se conservaron los comentarios existentes, CommonJS y el comportamiento ejecutable. Se adoptaron descripciones en español y etiquetas de acuerdo con las convenciones de Google/Closure.

| Bloque | Alcance | Archivos | Inserciones |
|---|---|---:|---:|
| STD-06A | Piloto: cola y AudioJob | 2 | 63 |
| STD-06B | Evaluación y aprobación del alcance integral | 0 | 0 |
| STD-06C | Coordinadores y estados de sesión | 3 | 188 |
| STD-06D | Modelos restantes y transformación de audio | 4 | 137 |
| STD-06E | Servidor y cliente web | 2 | 281 |
| STD-06F | Pruebas y spikes | 6 | 210 |
| **Total** | **Documentación de aplicación y pruebas** | **17** | **879** |

Se documentaron responsabilidades, entradas, retornos, excepciones, contratos y límites de las garantías reales. La cola FIFO no garantiza simultaneidad física de envío; la adjudicación corresponde al consumidor único. Los modelos de audio no son inmutables por incorporar JSDoc. La transformación PCM es síncrona, sin I/O y no ejecuta workers por sí misma; REVERSE opera por frames completos, preservando canales. Los spikes documentan qué verifican y qué no: los tiempos aislados no son benchmarks, las pruebas de extremos no verifican exhaustivamente cada frame y ALT-02 no cubre todos los intercalados posibles. El frontend no garantiza inicio simultáneo de audio; la autoridad de adjudicación reside en el servidor.

| Archivo relativo a TP-Integrador | Inserciones |
|---|---:|
| game/answer-queue.js | 39 |
| game/game-coordinator.js | 78 |
| game/session-coordinator.js | 88 |
| game/session-state.js | 22 |
| public/index.html | 78 |
| server.js | 203 |
| server/audio/model/audio-job.js | 24 |
| server/audio/model/audio-mode.js | 19 |
| server/audio/model/audio-result.js | 29 |
| server/audio/model/prepared-round.js | 23 |
| server/audio/transform/audio-transform.js | 66 |
| tests/alt02-concurrent-answers.js | 66 |
| tests/alt02-matrix.js | 14 |
| tests/audio-model-test.js | 25 |
| tests/spikes/audio/c06-reverse-end-to-end.js | 38 |
| tests/spikes/audio/c07-transform-modes.js | 42 |
| tests/spikes/c03-audio-stack-spike.js | 25 |
| **Total** | **879** |

Los cinco parches se aplicaron sucesivamente con `git -C .. apply --check --index` y `git -C .. apply --index`. Cada bloque superó el lint estricto. En una copia reconstruida a partir de STD-05, la comparación con los cinco parches aplicados confirmó tokens ejecutables y AST idénticos en 17/17 unidades, preservación del HTML/CSS exterior al script y 879 inserciones sin eliminaciones. El parser aislado de JSDoc de TypeScript 5.8.3 examinó 180 bloques y 249 etiquetas, con cero diagnósticos sintácticos. No se trata de comprobación integral de tipos ni certificación semántica de los comentarios.

| Etiqueta | Cantidad |
|---|---:|
| `@param` | 129 |
| `@return` | 60 |
| `@type` | 34 |
| `@throws` | 14 |
| `@fileoverview` | 8 |
| `@enum` | 2 |
| `@typedef` | 1 |
| `@const` | 1 |
| **Total** | **249** |

#### STD-06G. Diagnóstico especializado y automatización

Se instaló `eslint-plugin-jsdoc@65.4.6` fuera del repositorio junto a ESLint 10.15.0, reutilizando la configuración base y agregando cinco reglas para los `.js` y el JavaScript embebido del frontend. El primer diagnóstico de 18 archivos (17 unidades de código más la configuración) produjo cero errores y nueve advertencias de preferencias: ocho `@fileoverview` y una `@const`. La solución fue alinear las preferencias del plugin con las convenciones de Google, sin modificar archivos documentados ni desactivar reglas.

| Regla | Inicial | Definitivo |
|---|---:|---:|
| `jsdoc/check-tag-names` | 9 | 0 |
| `jsdoc/valid-types` | 0 | 0 |
| `jsdoc/check-param-names` | 0 | 0 |
| `jsdoc/require-param-type` | 0 | 0 |
| `jsdoc/require-returns-type` | 0 | 0 |
| **Total advertencias** | **9** | **0** |

Configuración experimental validada (NO vigente en la rama final):

```javascript
import jsdoc from 'eslint-plugin-jsdoc';
// Objeto adicional del array export default de ESLint:
// Se reproduce el bloque para una eventual reevaluación.
```

```javascript
  {
    files: ['**/*.js', 'public/**/*.html'],
    plugins: {jsdoc},
    settings: {
      jsdoc: {
        mode: 'closure',
        tagNamePreference: {
          returns: 'return',
          file: 'fileoverview',
          constant: 'const',
        },
      },
    },
    rules: {
      'jsdoc/check-tag-names': 'warn',
      'jsdoc/valid-types': 'warn',
      'jsdoc/check-param-names': 'warn',
      'jsdoc/require-param-type': 'warn',
      'jsdoc/require-returns-type': 'warn',
    },
  },
```

Los comandos con `--config` temporal y `--max-warnings 0` devolvieron 0. Se generaron los informes `lint-report-jsdoc.json` (inicial) y `lint-report-jsdoc-v2.json` (ajustado) en el entorno local; se verificaron las salidas de consola, no se recibió el JSON completo. Se evaluó la incorporación permanente. La instalación directa del plugin añadió 43 paquetes y 631 líneas al lockfile. El primer lint tras instalarlo aún no incluía sus reglas: se detectó que faltaba modificar `eslint.config.mjs`. Tras agregar el import y bloque anterior, `--print-config` confirmó las cinco reglas en `server.js` y `public/index.html`; el lint estricto y el informe de 18 archivos dieron cero errores y advertencias. La incorporación permanente se revirtió después por OBS-STD-02. No se impuso `require-jsdoc` ni se activó el preset completo. La cobertura por archivos y las cinco reglas aprobadas no equivalen al cumplimiento exhaustivo de la sección 7 de la guía.

#### OBS-STD-02. Vulnerabilidad transitiva y decisión de diferir el plugin

La auditoría de npm del 15/11/2026 reportó tres entradas de severidad moderada asociadas a un aviso de denegación de servicio de `minimatch` ([GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)). Según la salida de npm, afectaba versiones desde 7.0.0 hasta antes de 11.0.1. La cadena experimental fue `eslint-plugin-jsdoc@65.4.6` → `@typescript-eslint/utils@8.72.2` → `@typescript-eslint/typescript-estree@8.72.2` → `minimatch@10.2.6` (rango solicitado `^10.2.2`). Las otras dos entradas son dependencias afectadas indirectamente, no tres avisos independientes. ESLint ya utilizaba `minimatch@11.0.8`, no afectado por este aviso. `npm audit --omit=dev` devolvió cero vulnerabilidades durante la experiencia; la exposición identificada se limitaba al árbol de desarrollo.

| Intervención | Evidencia y resultado |
|---|---|
| `npm audit fix --dry-run --json` | 0 paquetes añadidos, cambiados o retirados; 3 advertencias de seguridad persistentes |
| Override específico `overrides.@typescript-eslint/typescript-estree.minimatch=11.0.8` + instalación | `npm ls` informó `minimatch@10.2.6 invalid: "11.0.8"` y ELSPROBLEMS; auditoría 3 moderadas |
| Actualización dirigida en copia temporal con `npm update minimatch --package-lock-only --save --ignore-scripts --engine-strict` | Sin cambios efectivos; misma inconsistencia |
| `npm ci --ignore-scripts --engine-strict` en copia temporal | Reprodujo la inconsistencia y las 3 entradas de auditoría; archivos de dependencias sin diferencias |
| Reversión selectiva en el proyecto | Restauración de `package.json`, `package-lock.json` y `eslint.config.mjs` desde `2b86634`, luego `npm install --ignore-scripts --engine-strict` |
| Comprobación posterior | 43 paquetes retirados; 185 paquetes auditados; `npm ls minimatch --all` válido, únicamente 11.0.8; auditoría completa y de producción: 0; lint estricto: 0 |

No se utilizó `npm audit fix --force`, no se regeneró indiscriminadamente el lockfile ni se modificó manualmente. No se determinó la causa interna del comportamiento de npm. Se verificó `git diff --exit-code HEAD -- package.json package-lock.json eslint.config.mjs` con salida 0 tras restaurar las herramientas. El código JSDoc permaneció íntegro. FFmpeg se verificó funcionalmente en C03/C06 durante T4.

**Decisión final:** OBS-STD-02 mitigada mediante retirada del componente que introducía la dependencia vulnerable, no mediante reparación de minimatch. Automatización permanente de JSDoc diferida; el diagnóstico especializado previo sigue siendo evidencia histórica válida para el código documentado. No quedaron el plugin ni el override en las dependencias finales. La incorporación futura deberá reevaluarse cuando exista una combinación estable compatible, sin el aviso identificado, repitiendo auditoría, lint y pruebas; no se presupone compatibilidad futura. La auditoría de npm refleja avisos conocidos al momento de ejecución, no ausencia absoluta de riesgos. STD-06 queda aprobada en el alcance acordado.

**Commit JSDoc:** `976ca23`, `docs: add JSDoc documentation across application and tests`, registrado localmente con 17 archivos, 879 inserciones y cero eliminaciones. El staging quedó vacío. No se incorporaron dependencias nuevas ni documentos Markdown en ese commit.

## 13. Procedimiento para el desarrollo futuro

1. Desarrollar sobre la rama correspondiente.
2. Respetar las convenciones adoptadas.
3. Ejecutar ESLint antes de solicitar revisión.
4. Resolver los errores y las nuevas advertencias injustificadas.
5. Ejecutar las pruebas relacionadas con la modificación.
6. Revisar las diferencias mediante Git.
7. Crear el Pull Request correspondiente.

No deberán mezclarse modificaciones masivas de formato con cambios funcionales no relacionados. Revisar manualmente la exactitud de JSDoc en los cambios futuros; no reinstalar el plugin ni el override experimental sin reevaluar versiones, auditoría y compatibilidad.

## 14. Estado de las tareas STD

| ID | Descripción | Estado |
|---|---|---|
| STD-01 | Definición del estándar | Completada |
| STD-02 | Configuración de herramientas | Completada; commit `5875b32` |
| STD-03 | Diagnóstico integral | Completada, línea base definitiva registrada |
| STD-04A | Adecuación automática | Completada y registrada en `d2a84e7` |
| STD-04B | Adecuación manual residual | Completada; commit `159fb3f`, cero advertencias, regresión T2 aprobada |
| STD-05 | Nombres de archivos | Completada; commit `2b86634`, T3 aprobada con observación no bloqueante |
| STD-06 | JSDoc | Completada; `976ca23`; diagnóstico especializado aprobado y automatización permanente diferida por OBS-STD-02 |
| STD-07 | Inclusión del frontend | Completada; T0, T1, T2 y T4 aprobadas; OBS-STD-01 abierta |
| STD-08 | Regresión y verificación final | Completada; T4 19/19 aprobada con OBS-STD-01 no bloqueante |
| STD-09 | Automatización de controles sobre PRs | Diferida |

## 15. Control de versiones

- Rama de trabajo: `chore/google-style-setup`.
- Rama de integración: `integration/tp-integrador-v4`.
- Commit de referencia: `4175a77`.
- Commit de configuración: `5875b32`.
- Commit de adecuación automática: `d2a84e7`.
- Commit de adecuación residual: `159fb3f` (10 archivos; 418 inserciones y 138 eliminaciones).
- Commit de renombrado: `2b86634` (13 archivos; 16 inserciones y 16 eliminaciones).
- Commit JSDoc: `976ca23` (17 archivos; 879 inserciones, cero eliminaciones).

Los commits están registrados en la rama de trabajo local. Push e integración no confirmados. Los dos documentos adicionales no rastreados quedaron fuera de los commits. La revisión 07 de este documento está pendiente de incorporarse al repositorio. No se ha registrado aún el commit de cierre documental.

La incorporación de herramientas y configuración deberá registrarse separadamente de las adecuaciones automáticas y manuales. Se verificó que el lockfile conserva los 89 paquetes originales y agrega 95 entradas de desarrollo, sin modificaciones en las dependencias funcionales. Las pruebas de regresión y la revisión de cambios serán condiciones previas a la integración definitiva. Coordinar con el equipo la integración de modificaciones masivas para reducir conflictos de merge.

## 16. Limitaciones

La ausencia de errores o advertencias en ESLint no garantiza el cumplimiento completo del estándar de Google ni la corrección funcional de la aplicación. El análisis estático complementa las revisiones de código, las pruebas funcionales, las pruebas de concurrencia y la validación arquitectónica.

Las decisiones de alcance, excepciones y criterios no automatizados deberán mantenerse explícitamente documentados. STD-06 no incorpora un analizador de tipos ni el plugin permanente. OBS-STD-01 queda abierta; OBS-STD-02 se mitigó retirando las dependencias experimentales. El resultado de `npm audit` es temporal y limitado a los avisos conocidos.
