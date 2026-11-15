# Estándar de código - Trivia Musical V4

**Fecha:** 15/11/2026  
**Revisión:** 03  
**Tareas relacionadas:** STD-01 a STD-09.

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
| Archivos nuevos | Minúsculas, con guiones cuando corresponda |
| Codificación | UTF-8 |
| Espacios sobrantes | Evitarlos |
| Declaraciones de variables | Preferir const cuando no exista reasignación |
| Comparaciones | Igualdad estricta, con la excepción configurada para null |

Se permite omitir paréntesis en parámetros simples de funciones flecha. Las reglas automatizadas constituyen una aproximación al estándar de Google y no reemplazan la revisión manual. Las excepciones de la guía, las continuaciones de línea y otros aspectos no cubiertos automáticamente deberán evaluarse durante la revisión de código.

## 5. Decisiones y excepciones de alcance

### 5.1. Sistema de módulos

Se conserva CommonJS para el código existente de la aplicación. No se realizará una migración generalizada a ES Modules como parte de esta iniciativa. Esta decisión constituye una desviación respecto de las convenciones de módulos de la guía de Google y evita modificaciones estructurales ajenas a los objetivos funcionales de V4.

### 5.2. Documentación JSDoc

No se exigirá incorporar documentación JSDoc como parte de la adecuación. Se conservarán los comentarios existentes y la documentación externa de arquitectura, contratos y decisiones. Esta exclusión constituye una desviación respecto de los requisitos de documentación de la guía de Google.

### 5.3. Nombres de archivos existentes

Los nombres existentes serán evaluados separadamente mediante STD-05. No deberán renombrarse como parte de una corrección automática de formato.

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

Esta configuración permitió completar la simulación integral sin correcciones circulares ni advertencias autocorregibles pendientes. Se mantienen activas las reglas previamente configuradas. No se ha demostrado la causa interna exacta del incidente.

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

Durante STD-01 a STD-03 se realizaron únicamente diagnósticos y simulaciones, sin aplicar correcciones sobre los archivos funcionales.

### 9.5. Interpretación de los códigos de salida

| Código | Significado |
|---|---|
| 0 | Ejecución satisfactoria, sin errores y dentro del límite de advertencias configurado |
| 1 | Errores detectados o límite de advertencias excedido |
| 2 | Problema de configuración o ejecución de ESLint |

En esta etapa no se ha configurado un límite de advertencias que bloquee automáticamente los Pull Requests. Un código de salida 0 no implica ausencia de advertencias.

## 10. Evidencias de diagnóstico y simulación

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

| Indicador | Línea base definitiva | Segunda simulación integral |
|---|---:|---:|
| Archivos analizados | 18 | 18 |
| Errores | 0 | 0 |
| Advertencias | 3.060 | 137 |
| Advertencias autocorregibles | 2.855 | 0 |
| Advertencias sin corrección directa | 205 | 137 |
| Conflictos circulares | No aplica | No |

Fuentes: `lint-report-baseline-v2.json` (resumen de consola) y `lint-report-dry-run-v2.json`.

**Reducción neta simulada: 2.923 advertencias (95,52 %).**

La diferencia de 65 advertencias entre la línea base definitiva y el diagnóstico inicial coincide con el cambio de configuración del análisis del HTML, efectuado sin modificar el código funcional. La comparación de referencia para STD-04A es la de esta sección, pues utiliza la misma configuración del linter antes y después de simular las correcciones.

Las 137 advertencias residuales corresponden a 136 observaciones por longitud máxima de líneas y un parámetro no utilizado. La simulación no demuestra por sí sola equivalencia funcional ni corrección concurrente.

## 11. Preservación de evidencias

Los informes de diagnóstico y simulación deberán conservarse localmente o en la documentación compartida del equipo. No deberán incorporarse al repositorio mediante Git, debido a su tamaño y a que pueden contener rutas locales y copias del código fuente.

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

Las pruebas automatizadas de referencia, ejecutadas después de configurar las herramientas y antes de aplicar correcciones, resultaron satisfactorias: C05, matriz ALT-02 (4/4 escenarios), C03, C06 y C07. Todos los comandos devolvieron código 0. La comprobación sintáctica independiente de la salida simulada también fue satisfactoria. Quedan pendientes la prueba manual de referencia del cliente web y las pruebas de regresión sobre el código efectivamente corregido.

## 13. Procedimiento para el desarrollo futuro

1. Desarrollar sobre la rama correspondiente.
2. Respetar las convenciones adoptadas.
3. Ejecutar ESLint antes de solicitar revisión.
4. Resolver los errores y las nuevas advertencias injustificadas.
5. Ejecutar las pruebas relacionadas con la modificación.
6. Revisar las diferencias mediante Git.
7. Crear el Pull Request correspondiente.

No deberán mezclarse modificaciones masivas de formato con cambios funcionales no relacionados.

## 14. Estado de las tareas STD

| ID | Descripción | Estado |
|---|---|---|
| STD-01 | Definición del estándar | Completada |
| STD-02 | Configuración de herramientas | Validada, pendiente commit |
| STD-03 | Diagnóstico integral | Completada, línea base definitiva registrada |
| STD-04A | Adecuación automática | Simulación validada, aplicación pendiente |
| STD-04B | Adecuación manual residual | Pendiente |
| STD-05 | Nombres de archivos | Pendiente de decisión |
| STD-06 | JSDoc | Excluida |
| STD-07 | Inclusión del frontend | Configuración y simulación validadas |
| STD-08 | Regresión y verificación final | Línea base automatizada aprobada; prueba manual y regresión pendientes |
| STD-09 | Automatización de controles sobre PRs | Diferida |

## 15. Control de versiones

- Rama de trabajo: `chore/google-style-setup`.
- Rama de integración: `integration/tp-integrador-v4`.
- Commit de referencia: `4175a77`.

La incorporación de herramientas y configuración deberá registrarse separadamente de las adecuaciones automáticas y manuales. Se verificó que el lockfile conserva los 89 paquetes originales y agrega 95 entradas de desarrollo, sin modificaciones en las dependencias funcionales. Las pruebas de regresión y la revisión de cambios serán condiciones previas a la integración definitiva. Coordinar con el equipo la integración de modificaciones masivas para reducir conflictos de merge.

## 16. Limitaciones

La ausencia de errores o advertencias en ESLint no garantiza el cumplimiento completo del estándar de Google ni la corrección funcional de la aplicación. El análisis estático complementa las revisiones de código, las pruebas funcionales, las pruebas de concurrencia y la validación arquitectónica.

Las decisiones de alcance, excepciones y criterios no automatizados deberán mantenerse explícitamente documentados.
