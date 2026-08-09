import tseslint from "typescript-eslint";

const restrictedFrameScheduling = [
  "error",
  {
    selector:
      "CallExpression[callee.name='requestAnimationFrame'], " +
      "CallExpression[callee.name='cancelAnimationFrame'], " +
      "CallExpression[callee.object.name='window'][callee.property.name='requestAnimationFrame'], " +
      "CallExpression[callee.object.name='window'][callee.property.name='cancelAnimationFrame'], " +
      "CallExpression[callee.object.name='globalThis'][callee.property.name='requestAnimationFrame'], " +
      "CallExpression[callee.object.name='globalThis'][callee.property.name='cancelAnimationFrame']",
    message: "Only src/loop/game-loop.ts may own frame scheduling.",
  },
];

function restrictedImports(...allowedNames) {
  const restricted = ["pixi.js", "planck"].filter((name) => !allowedNames.includes(name));
  return [
    "error",
    {
      paths: restricted.map((name) => ({
        name,
        message:
          name === "pixi.js"
            ? "Import PixiJS only from src/rendering."
            : "Import Planck only from src/physics or tests/physics.",
      })),
    },
  ];
}

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/consistent-type-imports": ["error", { "fixStyle": "separate-type-imports" }],
      "@typescript-eslint/no-misused-promises": ["error", { "checksVoidReturn": false }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports(),
      "no-restricted-syntax": restrictedFrameScheduling,
    },
  },
  {
    files: ["src/rendering/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports("pixi.js"),
    },
  },
  {
    files: ["src/physics/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports("planck"),
    },
  },
  {
    files: ["src/loop/game-loop.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
  {
    files: ["tests/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports(),
    },
  },
  {
    files: ["tests/physics/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": restrictedImports("planck"),
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },
  },
);
