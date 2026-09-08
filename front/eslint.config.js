import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import boundaries from 'eslint-plugin-boundaries';

const ELEMENTS = [
  { type: 'shared',     pattern: 'src/shared/**/*' },
  { type: 'features',  pattern: 'src/features/*/(*)', capture: ['feature', 'file'] },
  { type: 'components',pattern: 'src/components/**/*' },
  { type: 'pages',     pattern: 'src/pages/**/*' },
  { type: 'data',      pattern: 'src/data/**/*' },
  { type: 'hooks',     pattern: 'src/hooks/**/*' },
];

// Import 허용 방향:
//   shared     ← 외부 라이브러리만
//   data       ← 외부 라이브러리만
//   hooks      ← shared, data
//   components ← shared, data, hooks
//   features   ← shared, data, hooks  (다른 feature 직접 참조 금지)
//   pages      ← 위 모두
//   App.jsx / main.jsx ← 경계 규칙 제외 (진입점)
const BOUNDARY_RULES = {
  default: 'disallow',
  rules: [
    { from: 'shared',     allow: [] },
    { from: 'data',       allow: [] },
    { from: 'hooks',      allow: ['shared', 'data'] },
    { from: 'components', allow: ['shared', 'data', 'hooks'] },
    {
      from: [['features', { feature: '*' }]],
      allow: [
        'shared', 'data', 'hooks',
        ['features', { feature: '${from.feature}' }],
      ],
    },
    { from: 'pages',      allow: ['shared', 'data', 'hooks', 'components', 'features'] },
  ],
};

export default [
  js.configs.recommended,

  // ── 일반 규칙 (src 전체) ────────────────────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },

  // ── 아키텍처 경계 규칙 (진입점 제외) ───────────────────────────
  {
    files: ['src/**/*.{js,jsx}'],
    ignores: ['src/App.jsx', 'src/main.jsx'],
    plugins: { boundaries },
    settings: { 'boundaries/elements': ELEMENTS },
    rules: {
      'boundaries/element-types': ['error', BOUNDARY_RULES],
      'boundaries/no-unknown': 'warn',
    },
  },

  { ignores: ['dist/**', 'node_modules/**'] },
];
