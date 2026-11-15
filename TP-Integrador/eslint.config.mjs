import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import globals from 'globals';
import html from 'eslint-plugin-html';

// Diagnóstico inicial: reglas de estilo como advertencias; sin autofix.
// El código de aplicación conserva CommonJS.
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/.idea/**',
      '**/coverage/**',
      'tests/spikes/audio/output/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', 'public/**/*.html'],
    plugins: {'@stylistic': stylistic},
    languageOptions: {ecmaVersion: 'latest'},
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': 'warn',
      'no-var': 'warn',
      'prefer-const': 'warn',
      'curly': ['warn', 'all'],
      'eqeqeq': ['warn', 'always', {null: 'ignore'}],
      'require-atomic-updates': 'warn',
      '@stylistic/indent': ['warn', 2, {SwitchCase: 1, MemberExpression: 2}],
      '@stylistic/quotes': ['warn', 'single', {avoidEscape: true}],
      '@stylistic/semi': ['warn', 'always'],
      '@stylistic/comma-dangle': ['warn', {
        arrays: 'always-multiline',
        objects: 'always-multiline',
        imports: 'always-multiline',
        exports: 'always-multiline',
        functions: 'ignore',
      }],
      '@stylistic/brace-style': ['warn', '1tbs'],
      '@stylistic/object-curly-spacing': ['warn', 'never'],
      '@stylistic/comma-spacing': ['warn', {before: false, after: true}],
      '@stylistic/keyword-spacing': 'warn',
      '@stylistic/space-infix-ops': 'warn',
      '@stylistic/no-trailing-spaces': 'warn',
      '@stylistic/no-tabs': 'warn',
      '@stylistic/eol-last': ['warn', 'always'],
      '@stylistic/max-len': ['warn', {code: 80, tabWidth: 2, ignoreUrls: true}],
    },
  },
  {
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {sourceType: 'module', globals: globals.node},
  },
  {
    files: ['public/**/*.js'],
    languageOptions: {sourceType: 'script', globals: globals.browser},
  },
  {
    files: ['public/**/*.html'],
    plugins: {html},
    settings: {
      'html/indent': '0',
    },
    languageOptions: {sourceType: 'script', globals: globals.browser},
    rules: {
      // Estas funciones se invocan desde atributos HTML del cliente actual.
      'no-unused-vars': ['warn', {
        varsIgnorePattern: '^(joinGame|toggleReady|leaveGame|handleInput|sendAnswer)$',
      }],
    },
  },
];
