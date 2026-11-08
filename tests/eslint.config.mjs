// Analyse du code de Venus (lancée sur GitHub à chaque envoi, ou à la main : npm run analyse, depuis tests/).
// Seules les vraies erreurs bloquent : variable ou fonction inconnue, clé en double, code inatteignable,
// règle des crochets React non respectée.
import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

const rules = {
  'no-undef': 'error', 'no-dupe-keys': 'error', 'no-unreachable': 'error', 'no-self-assign': 'error', 'no-unsafe-finally': 'error',
  'use-isnan': 'error', 'valid-typeof': 'error', 'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-loss-of-precision': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
};
export default [
  { ignores: ['**/node_modules/**', 'web/.next/**', 'web/partage/**', 'web-dist/**', 'public/vendor/**', '**/*.min.js'] },
  { files: ['server/**/*.js', 'scripts/**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: globals.node }, rules },
  // Tests : une partie du code s'exécute dans la page (page.evaluate)
  { files: ['tests/**/*.mjs'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.node, ...globals.browser } }, rules },
  { files: ['public/js/**/*.js', 'public/sw.js'], languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.serviceworker, cast: 'readonly', chrome: 'readonly', Hls: 'readonly' } }, rules },
  {
    files: ['web/**/*.js'], plugins: { 'react-hooks': hooks },
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } }, globals: { ...globals.browser, ...globals.node } },
    rules: { ...rules, 'no-unused-vars': 'off', 'react-hooks/rules-of-hooks': 'error' },
  },
];
