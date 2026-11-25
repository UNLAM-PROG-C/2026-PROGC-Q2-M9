import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';
import google from 'eslint-config-google';

// ESLint 10 removed these core JSDoc rules.
const googleRules = Object.fromEntries(
    Object.entries(google.rules).filter(([rule]) =>
      !['require-jsdoc', 'valid-jsdoc'].includes(rule),
    ),
);

export default [
  {
    ignores: [
      '**/.idea/**',
      '**/coverage/**',
      'tests/spikes/audio/output/**',
    ],
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs', 'public/**/*.html'],
    rules: {
      ...js.configs.recommended.rules,
      ...googleRules,
      'linebreak-style': 'off',
      'eqeqeq': ['error', 'always', {null: 'ignore'}],
      'require-atomic-updates': 'warn',
    },
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {sourceType: 'module', globals: globals.nodeBuiltin},
  },
  {
    files: ['**/*.cjs'],
    languageOptions: {sourceType: 'commonjs', globals: globals.node},
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
      'no-unused-vars': ['error', {
        args: 'none',
        varsIgnorePattern: '^(joinGame|toggleReady|leaveGame|' +
          'handleInput|sendAnswer)$',
      }],
    },
  },
];
