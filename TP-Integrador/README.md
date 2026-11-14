# Trivia Musical - Baseline V4

## Baseline V3 de origen

Tag local de origen:
session-lifecycle-v3-complete

Commit de origen:
f855cdf16d13b602c866bfd48035cfbf3f1370cf

Esta versión fue importada al repositorio oficial de la cátedra como punto de partida de V4.

## Validaciones realizadas

- npm ci: OK
- ALT-02 matriz concurrente: 4/4 PASS
- npm start: OK
- Working tree original de V3: limpio antes de exportar

## Flujo Git V4

develop
  -> integration/tp-integrador-v4
       -> feature/<tarea>

La rama integration/tp-integrador-v4 funciona como base común de integración.
El desarrollo de funcionalidades debe realizarse en ramas feature/* y luego integrarse.
