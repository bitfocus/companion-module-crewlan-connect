import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "pkg/**", "node_modules/**", ".pnp.*", ".yarn/**"],
  },
  ...tseslint.configs.recommended,
);
