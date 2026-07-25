import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    {
        ignores: ["out/", "dist/", "**/*.d.ts", "webviews/", "node_modules/"]
    },
    {
        files: ["src/**/*.ts"],
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2022,
                sourceType: "module"
            }
        },
        rules: {
            // Naming conventions
            "@typescript-eslint/naming-convention": ["warn", {
                selector: "import",
                format: ["camelCase", "PascalCase"]
            }],
            // TypeScript specific - relaxed for legacy code
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
            "@typescript-eslint/ban-ts-comment": "off",
            "@typescript-eslint/no-require-imports": "off",
            "@typescript-eslint/no-empty-object-type": "off",
            // Code style
            "curly": "warn",
            "eqeqeq": "warn",
            "no-throw-literal": "warn",
            "no-empty": ["warn", { allowEmptyCatch: true }],
            "no-case-declarations": "off",
            "no-useless-escape": "warn",
            "no-async-promise-executor": "warn",
            "prefer-const": "warn"
        }
    }
);
