import js from '@eslint/js';
import globals from 'globals';

/**
 * Phase 0 の ESLint 設定。
 * 目的は「既存コードの問題を可視化する」こと。レガシーコードを今すぐ全て直すのが
 * 目的ではないため、ノイズの多いスタイル系ルールは warn に落としている。
 * リファクタリングの進行に合わせて段階的に error へ引き上げる想定。
 */
export default [
  // 第三者ライブラリ（vendored）と生成物・依存物は対象外
  {
    ignores: [
      'node_modules/**',
      'marked.js',
      'prism.js',
      'coverage/**',
      '.eslint-report.json',
    ],
  },

  js.configs.recommended,

  // ブラウザ側スクリプト（アプリ本体・補助スクリプト・SW）
  {
    files: ['app.js', 'function-calling.js', 'dropbox.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        ...globals.serviceworker,
        // 外部ライブラリ（index.html で読み込む）
        marked: 'readonly',
        Prism: 'readonly',
        JSZip: 'readonly',
        // app.js が window 経由で公開し、他ファイルが参照する独自グローバル
        // （Phase 1 で import 化して順次削除していく対象）
        functionCallingTools: 'writable',
        functionDeclarations: 'writable',
        dropboxApi: 'writable',
      },
    },
    rules: {
      // バグに直結するものは error のまま
      'no-undef': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-args': 'error',
      // 蓄積した負債は warn で可視化（段階的に解消）
      'no-unused-vars': ['warn', { args: 'none', vars: 'all' }],
      'no-empty': ['warn', { allowEmptyCatch: false }],
      'no-constant-condition': 'warn',
      'no-cond-assign': 'warn',
      'no-fallthrough': 'warn',
      'no-prototype-builtins': 'off',
    },
  },

  // app.js は function-calling.js が定義する関数を実行時グローバルとして利用
  {
    files: ['app.js'],
    languageOptions: {
      globals: { normalizeCharacterName: 'readonly' },
    },
  },

  // 補助スクリプトは app.js が定義するグローバルを直接参照している
  // （クロスファイル結合。Phase 1 の import 化で解消予定）
  {
    files: ['function-calling.js', 'dropbox.js'],
    languageOptions: {
      globals: {
        appLogic: 'readonly',
        state: 'readonly',
        dbUtils: 'readonly',
        uiUtils: 'readonly',
        apiUtils: 'readonly',
        htmlUtils: 'readonly',
      },
    },
  },

  // Node 側（設定・テスト）
  {
    files: ['*.config.js', 'tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
];
