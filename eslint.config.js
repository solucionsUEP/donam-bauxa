import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    // Vendored / minified bundles and generated assets are not our source.
    ignores: [
      'frontend/js/bootstrap.bundle.min.js',
      'frontend/js/supabase.min.js',
      'node_modules/**',
      'TU_Delft_Report_Thesis_Template/**',
      'report.json',
    ],
  },
  js.configs.recommended,
  {
    // Browser-side ES modules.
    files: ['frontend/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        bootstrap: 'readonly', // Bootstrap 5 bundle global
        L: 'readonly', // Leaflet (lazy-loaded)
      },
    },
    rules: {
      // Source is shipped minified, so several stylistic checks would be noise.
      'no-unused-vars': 'warn',
      'no-empty': 'off',
      'no-cond-assign': 'off',
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-prototype-builtins': 'off',
      'no-useless-assignment': 'off',
      eqeqeq: 'off',
    },
  },
  {
    // Node-side tooling and the dev server.
    files: ['scripts/**/*.mjs', 'server.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
    },
  },
];
